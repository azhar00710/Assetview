import prisma from '../../db.js';
import { getStorageProvider, generatePnidStorageKey } from '../../services/storage/index.js';

export default async function adminUploadRoutes(fastify) {
  // ═══ POST /admin/pnids/:id/upload — Upload P&ID file ═══
  fastify.post('/admin/pnids/:id/upload', async (request, reply) => {
    const { id } = request.params;

    // Parse multipart data from the request body
    // Frontend sends as JSON with base64 encoded file
    const { file, filename, contentType, revision, changeSummary, changeType } = request.body;

    if (!file) {
      return reply.status(400).send({ error: 'file is required (base64 encoded)' });
    }

    // Validate the P&ID exists
    const pnid = await prisma.pnid.findFirst({
      where: { id, deleted_at: null },
      include: {
        pnid_system: {
          where: { is_primary: true },
          include: { system: { include: { platform: { include: { complex: { include: { field: { include: { concession: true } } } } } } } } },
        },
      },
    });

    if (!pnid) {
      return reply.status(404).send({ error: 'P&ID not found' });
    }

    try {
      // Decode the base64 file
      const fileBuffer = Buffer.from(file, 'base64');
      const fileSize = fileBuffer.length;

      // Resolve platform code for storage key
      const primarySystem = pnid.pnid_system[0];
      const platformCode = primarySystem?.system?.platform?.code || 'unknown';

      // Determine revision
      const newRevision = revision || pnid.revision || '1';

      // Get storage provider
      const storage = await getStorageProvider(prisma, {
        platformId: primarySystem?.system?.platform_id,
      });

      // Generate storage keys
      const imageKey = generatePnidStorageKey(platformCode, pnid.drawing_number, newRevision, filename || 'drawing.pdf');
      const thumbnailFilename = 'thumbnail.jpg';
      const thumbnailKey = generatePnidStorageKey(platformCode, pnid.drawing_number, newRevision, thumbnailFilename);

      // Upload the file
      const uploadResult = await storage.upload(fileBuffer, imageKey, {
        contentType: contentType || 'application/pdf',
      });

      // Get current version number
      const currentVersions = await prisma.$queryRaw`
        SELECT COALESCE(MAX(version_number), 0) as max_version
        FROM pnid_version WHERE pnid_id = ${id}::uuid
      `;
      const nextVersion = Number(currentVersions[0]?.max_version || 0) + 1;

      // If there's an existing active version, supersede it and snapshot annotations
      const activeVersions = await prisma.$queryRaw`
        SELECT id FROM pnid_version
        WHERE pnid_id = ${id}::uuid AND status = 'active'
      `;

      if (activeVersions?.length > 0) {
        const activeVersionId = activeVersions[0].id;

        // Create annotation snapshot before superseding
        const equipmentAnnotations = await prisma.pnid_equipment.findMany({
          where: { pnid_id: id },
          include: { equipment: { select: { tag: true } } },
        });
        const instrumentAnnotations = await prisma.pnid_instrument.findMany({
          where: { pnid_id: id },
          include: { instrument: { select: { tag: true } } },
        });
        const annotations = await prisma.annotation.findMany({
          where: { pnid_id: id, deleted_at: null },
        });

        const snapshotData = {
          equipment: equipmentAnnotations.map(ea => ({
            equipment_id: ea.equipment_id,
            tag: ea.equipment?.tag,
            x_pct: ea.annotation_x_pct,
            y_pct: ea.annotation_y_pct,
            w_pct: ea.annotation_w_pct,
            h_pct: ea.annotation_h_pct,
          })),
          instruments: instrumentAnnotations.map(ia => ({
            instrument_id: ia.instrument_id,
            tag: ia.instrument?.tag,
            x_pct: ia.annotation_x_pct,
            y_pct: ia.annotation_y_pct,
            w_pct: ia.annotation_w_pct,
            h_pct: ia.annotation_h_pct,
          })),
          annotations: annotations.map(a => ({
            id: a.id,
            type: a.annotation_type,
            x_pct: a.x_pct,
            y_pct: a.y_pct,
            w_pct: a.w_pct,
            h_pct: a.h_pct,
            text: a.text,
            status: a.status,
          })),
        };

        // Create snapshot
        const [snapshot] = await prisma.$queryRaw`
          INSERT INTO annotation_snapshot (pnid_version_id, snapshot_data)
          VALUES (${activeVersionId}::uuid, ${JSON.stringify(snapshotData)}::jsonb)
          RETURNING id
        `;

        // Supersede old version
        await prisma.$queryRaw`
          UPDATE pnid_version SET
            status = 'superseded',
            superseded_at = NOW(),
            annotation_snapshot_id = ${snapshot.id}::uuid
          WHERE id = ${activeVersionId}::uuid
        `;

        // Mark existing annotation positions as unverified (carry forward)
        await prisma.$queryRaw`
          UPDATE pnid_equipment SET position_verified = false WHERE pnid_id = ${id}::uuid
        `;
        await prisma.$queryRaw`
          UPDATE pnid_instrument SET position_verified = false WHERE pnid_id = ${id}::uuid
        `;
      }

      // Create new version record
      const [newVersion] = await prisma.$queryRaw`
        INSERT INTO pnid_version (
          pnid_id, version_number, revision, storage_key, pdf_storage_key,
          thumbnail_key, file_checksum, file_size_bytes, change_summary,
          change_type, status, created_by
        ) VALUES (
          ${id}::uuid, ${nextVersion}, ${newRevision}, ${imageKey}, ${imageKey},
          ${thumbnailKey}, ${uploadResult.checksum}, ${BigInt(fileSize)}, ${changeSummary || null},
          ${changeType || 'minor_update'}, 'active', 'admin'
        )
        RETURNING id, version_number, revision, storage_key, status
      `;

      // Update the pnid record
      await prisma.pnid.update({
        where: { id },
        data: {
          revision: newRevision,
          has_image: true,
          storage_key: imageKey,
          thumbnail_key: thumbnailKey,
          file_checksum: uploadResult.checksum,
          file_size_bytes: BigInt(fileSize),
          uploaded_at: new Date(),
          uploaded_by: 'admin',
          active_version_id: newVersion.id,
          image_path: imageKey,
          updated_at: new Date(),
        },
      });

      // Log the change
      await prisma.$queryRaw`
        INSERT INTO change_log (entity_type, entity_id, action, changes, source, created_by)
        VALUES ('pnid', ${id}::uuid, 'upload', ${JSON.stringify({
          revision: { old: pnid.revision, new: newRevision },
          version: nextVersion,
          filename: filename,
          fileSize: fileSize,
        })}::jsonb, 'upload', 'admin')
      `;

      return reply.status(201).send({
        success: true,
        pnid: {
          id: pnid.id,
          drawingNumber: pnid.drawing_number,
          revision: newRevision,
          storageKey: imageKey,
          hasImage: true,
        },
        version: {
          id: newVersion.id,
          versionNumber: newVersion.version_number,
          revision: newVersion.revision,
          previousRevision: pnid.revision,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Upload failed: ${err.message}` });
    }
  });

  // ═══ GET /admin/pnids/:id/versions — List all versions ═══
  fastify.get('/admin/pnids/:id/versions', async (request, reply) => {
    const { id } = request.params;

    const versions = await prisma.$queryRaw`
      SELECT v.id, v.version_number, v.revision, v.storage_key,
             v.file_checksum, v.file_size_bytes, v.change_summary, v.change_type,
             v.status, v.created_at, v.created_by, v.superseded_at,
             CASE WHEN v.annotation_snapshot_id IS NOT NULL THEN true ELSE false END as has_snapshot
      FROM pnid_version v
      WHERE v.pnid_id = ${id}::uuid
      ORDER BY v.version_number DESC
    `;

    return { versions: versions.map(v => ({ ...v, file_size_bytes: v.file_size_bytes != null ? Number(v.file_size_bytes) : null })) };
  });

  // ═══ GET /admin/pnids/:id/versions/:versionId/snapshot — Get annotation snapshot ═══
  fastify.get('/admin/pnids/:id/versions/:versionId/snapshot', async (request, reply) => {
    const { versionId } = request.params;

    const snapshots = await prisma.$queryRaw`
      SELECT s.snapshot_data, s.created_at
      FROM annotation_snapshot s
      JOIN pnid_version v ON v.annotation_snapshot_id = s.id
      WHERE v.id = ${versionId}::uuid
      LIMIT 1
    `;

    if (!snapshots?.length) {
      return reply.status(404).send({ error: 'No snapshot found for this version' });
    }

    return { snapshot: snapshots[0] };
  });

  // ═══ GET /pnids/:id/image — Get signed URL for P&ID image ═══
  fastify.get('/pnids/:id/image', async (request, reply) => {
    const { id } = request.params;

    const pnid = await prisma.pnid.findFirst({
      where: { id, deleted_at: null },
      select: {
        storage_key: true,
        pnid_system: {
          where: { is_primary: true },
          include: { system: { select: { platform_id: true } } },
        },
      },
    });

    if (!pnid?.storage_key) {
      return reply.status(404).send({ error: 'No image uploaded for this P&ID' });
    }

    try {
      const platformId = pnid.pnid_system[0]?.system?.platform_id;
      const storage = await getStorageProvider(prisma, { platformId });
      const url = await storage.getUrl(pnid.storage_key);
      return { url };
    } catch (err) {
      return reply.status(500).send({ error: `Failed to get image URL: ${err.message}` });
    }
  });

  // ═══ GET /pnids/:id/file — Proxy P&ID file from storage (avoids CORS) ═══
  fastify.get('/pnids/:id/file', async (request, reply) => {
    const { id } = request.params;

    const pnid = await prisma.pnid.findFirst({
      where: { id, deleted_at: null },
      select: {
        storage_key: true,
        pnid_system: {
          where: { is_primary: true },
          include: { system: { select: { platform_id: true } } },
        },
      },
    });

    if (!pnid?.storage_key) {
      return reply.status(404).send({ error: 'No file uploaded for this P&ID' });
    }

    try {
      const platformId = pnid.pnid_system[0]?.system?.platform_id;
      const storage = await getStorageProvider(prisma, { platformId });
      const { buffer, contentType, size } = await storage.download(pnid.storage_key);

      reply
        .header('Content-Type', contentType)
        .header('Content-Length', size)
        .header('Cache-Control', 'private, max-age=3600')
        .send(buffer);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to fetch file: ${err.message}` });
    }
  });

  // ═══ POST /admin/pnids/:id/versions/:versionId/activate — Rollback to a previous version ═══
  fastify.post('/admin/pnids/:id/versions/:versionId/activate', async (request, reply) => {
    const { id, versionId } = request.params;

    try {
      // Find the specified version and verify it exists and is superseded
      const targetVersions = await prisma.$queryRaw`
        SELECT id, version_number, revision, storage_key, status
        FROM pnid_version
        WHERE id = ${versionId}::uuid AND pnid_id = ${id}::uuid
      `;

      if (!targetVersions?.length) {
        return reply.status(404).send({ error: 'Version not found' });
      }

      const targetVersion = targetVersions[0];

      if (targetVersion.status !== 'superseded') {
        return reply.status(400).send({ error: 'Only superseded versions can be reactivated' });
      }

      // Find the current active version
      const activeVersions = await prisma.$queryRaw`
        SELECT id FROM pnid_version
        WHERE pnid_id = ${id}::uuid AND status = 'active'
      `;

      if (activeVersions?.length > 0) {
        const activeVersionId = activeVersions[0].id;

        // Snapshot current annotations before superseding active version
        const equipmentAnnotations = await prisma.pnid_equipment.findMany({
          where: { pnid_id: id },
          include: { equipment: { select: { tag: true } } },
        });
        const instrumentAnnotations = await prisma.pnid_instrument.findMany({
          where: { pnid_id: id },
          include: { instrument: { select: { tag: true } } },
        });
        const annotations = await prisma.annotation.findMany({
          where: { pnid_id: id, deleted_at: null },
        });

        const snapshotData = {
          equipment: equipmentAnnotations.map(ea => ({
            equipment_id: ea.equipment_id,
            tag: ea.equipment?.tag,
            x_pct: ea.annotation_x_pct,
            y_pct: ea.annotation_y_pct,
            w_pct: ea.annotation_w_pct,
            h_pct: ea.annotation_h_pct,
          })),
          instruments: instrumentAnnotations.map(ia => ({
            instrument_id: ia.instrument_id,
            tag: ia.instrument?.tag,
            x_pct: ia.annotation_x_pct,
            y_pct: ia.annotation_y_pct,
            w_pct: ia.annotation_w_pct,
            h_pct: ia.annotation_h_pct,
          })),
          annotations: annotations.map(a => ({
            id: a.id,
            type: a.annotation_type,
            x_pct: a.x_pct,
            y_pct: a.y_pct,
            w_pct: a.w_pct,
            h_pct: a.h_pct,
            text: a.text,
            status: a.status,
          })),
        };

        // Create snapshot for the current active version
        const [snapshot] = await prisma.$queryRaw`
          INSERT INTO annotation_snapshot (pnid_version_id, snapshot_data)
          VALUES (${activeVersionId}::uuid, ${JSON.stringify(snapshotData)}::jsonb)
          RETURNING id
        `;

        // Supersede the current active version
        await prisma.$queryRaw`
          UPDATE pnid_version SET
            status = 'superseded',
            superseded_at = NOW(),
            annotation_snapshot_id = ${snapshot.id}::uuid
          WHERE id = ${activeVersionId}::uuid
        `;
      }

      // Set the target version to active
      await prisma.$queryRaw`
        UPDATE pnid_version SET
          status = 'active',
          superseded_at = NULL
        WHERE id = ${versionId}::uuid
      `;

      // Update the pnid record to match the reactivated version
      await prisma.pnid.update({
        where: { id },
        data: {
          storage_key: targetVersion.storage_key,
          revision: targetVersion.revision,
          active_version_id: targetVersion.id,
          updated_at: new Date(),
        },
      });

      // Mark annotation positions as unverified
      await prisma.$queryRaw`
        UPDATE pnid_equipment SET position_verified = false WHERE pnid_id = ${id}::uuid
      `;
      await prisma.$queryRaw`
        UPDATE pnid_instrument SET position_verified = false WHERE pnid_id = ${id}::uuid
      `;

      // Log to change_log
      await prisma.$queryRaw`
        INSERT INTO change_log (entity_type, entity_id, action, changes, source, created_by)
        VALUES ('pnid', ${id}::uuid, 'version_rollback', ${JSON.stringify({
          reactivated_version_id: versionId,
          reactivated_version_number: targetVersion.version_number,
          revision: targetVersion.revision,
        })}::jsonb, 'admin', 'admin')
      `;

      return {
        success: true,
        version: {
          id: targetVersion.id,
          versionNumber: targetVersion.version_number,
          revision: targetVersion.revision,
          status: 'active',
        },
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Version rollback failed: ${err.message}` });
    }
  });

  // ═══ GET /admin/pnids/:id/versions/compare — Compare two versions ═══
  fastify.get('/admin/pnids/:id/versions/compare', async (request, reply) => {
    const { id } = request.params;
    const { v1, v2 } = request.query;

    if (!v1 || !v2) {
      return reply.status(400).send({ error: 'Both v1 and v2 query parameters are required' });
    }

    try {
      // Fetch both versions' metadata
      const versions = await prisma.$queryRaw`
        SELECT v.id, v.version_number, v.revision, v.storage_key,
               v.file_size_bytes, v.change_summary, v.change_type,
               v.status, v.created_at, v.superseded_at, v.annotation_snapshot_id
        FROM pnid_version v
        WHERE v.pnid_id = ${id}::uuid AND v.id IN (${v1}::uuid, ${v2}::uuid)
        ORDER BY v.version_number ASC
      `;

      if (versions.length < 2) {
        return reply.status(404).send({ error: 'One or both versions not found' });
      }

      const version1 = versions.find(v => v.id === v1) || versions[0];
      const version2 = versions.find(v => v.id === v2) || versions[1];

      // Get annotation snapshot for v1 (the older one) if it exists
      let v1Annotations = null;
      if (version1.annotation_snapshot_id) {
        const snapshots = await prisma.$queryRaw`
          SELECT snapshot_data FROM annotation_snapshot
          WHERE id = ${version1.annotation_snapshot_id}::uuid
          LIMIT 1
        `;
        if (snapshots?.length) {
          v1Annotations = snapshots[0].snapshot_data;
        }
      }

      // Get current annotations for v2 if it's the active version
      let v2Annotations = null;
      if (version2.status === 'active') {
        const equipmentAnnotations = await prisma.pnid_equipment.findMany({
          where: { pnid_id: id },
          include: { equipment: { select: { tag: true } } },
        });
        const instrumentAnnotations = await prisma.pnid_instrument.findMany({
          where: { pnid_id: id },
          include: { instrument: { select: { tag: true } } },
        });

        v2Annotations = {
          equipment: equipmentAnnotations.map(ea => ({
            equipment_id: ea.equipment_id,
            tag: ea.equipment?.tag,
            x_pct: ea.annotation_x_pct,
            y_pct: ea.annotation_y_pct,
            w_pct: ea.annotation_w_pct,
            h_pct: ea.annotation_h_pct,
          })),
          instruments: instrumentAnnotations.map(ia => ({
            instrument_id: ia.instrument_id,
            tag: ia.instrument?.tag,
            x_pct: ia.annotation_x_pct,
            y_pct: ia.annotation_y_pct,
            w_pct: ia.annotation_w_pct,
            h_pct: ia.annotation_h_pct,
          })),
        };
      }

      return {
        v1: {
          id: version1.id,
          versionNumber: version1.version_number,
          revision: version1.revision,
          storageKey: version1.storage_key,
          fileSizeBytes: version1.file_size_bytes != null ? Number(version1.file_size_bytes) : null,
          changeSummary: version1.change_summary,
          changeType: version1.change_type,
          status: version1.status,
          createdAt: version1.created_at,
          annotations: v1Annotations,
        },
        v2: {
          id: version2.id,
          versionNumber: version2.version_number,
          revision: version2.revision,
          storageKey: version2.storage_key,
          fileSizeBytes: version2.file_size_bytes != null ? Number(version2.file_size_bytes) : null,
          changeSummary: version2.change_summary,
          changeType: version2.change_type,
          status: version2.status,
          createdAt: version2.created_at,
          annotations: v2Annotations,
        },
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Version comparison failed: ${err.message}` });
    }
  });

  // ═══ GET /admin/pnids/:id/versions/:versionId/image — Get signed URL for a version's image ═══
  fastify.get('/admin/pnids/:id/versions/:versionId/image', async (request, reply) => {
    const { id, versionId } = request.params;

    try {
      // Look up the version's storage_key
      const versions = await prisma.$queryRaw`
        SELECT v.storage_key FROM pnid_version v
        WHERE v.id = ${versionId}::uuid AND v.pnid_id = ${id}::uuid
      `;

      if (!versions?.length || !versions[0].storage_key) {
        return reply.status(404).send({ error: 'Version not found or has no image' });
      }

      // Get the pnid's platform for storage provider
      const pnid = await prisma.pnid.findFirst({
        where: { id, deleted_at: null },
        select: {
          pnid_system: {
            where: { is_primary: true },
            include: { system: { select: { platform_id: true } } },
          },
        },
      });

      const platformId = pnid?.pnid_system[0]?.system?.platform_id;
      const storage = await getStorageProvider(prisma, { platformId });
      const url = await storage.getUrl(versions[0].storage_key);

      return { url, storageKey: versions[0].storage_key };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to get version image URL: ${err.message}` });
    }
  });

  // ═══ PUT /admin/pnids/:id/annotations/verify — Bulk verify annotation positions ═══
  fastify.put('/admin/pnids/:id/annotations/verify', async (request, reply) => {
    const { id } = request.params;
    const { equipmentIds, instrumentIds, versionId } = request.body || {};

    if (!versionId) {
      return reply.status(400).send({ error: 'versionId is required' });
    }

    try {
      let equipmentUpdated = 0;
      let instrumentsUpdated = 0;

      if (equipmentIds?.length > 0) {
        const eqResult = await prisma.$queryRaw`
          UPDATE pnid_equipment
          SET position_verified = true, verified_for_version = ${versionId}::uuid
          WHERE pnid_id = ${id}::uuid AND equipment_id = ANY(${equipmentIds}::uuid[])
        `;
        equipmentUpdated = equipmentIds.length;
      }

      if (instrumentIds?.length > 0) {
        const instResult = await prisma.$queryRaw`
          UPDATE pnid_instrument
          SET position_verified = true, verified_for_version = ${versionId}::uuid
          WHERE pnid_id = ${id}::uuid AND instrument_id = ANY(${instrumentIds}::uuid[])
        `;
        instrumentsUpdated = instrumentIds.length;
      }

      // Log to change_log
      await prisma.$queryRaw`
        INSERT INTO change_log (entity_type, entity_id, action, changes, source, created_by)
        VALUES ('pnid', ${id}::uuid, 'annotations_verified', ${JSON.stringify({
          versionId,
          equipmentIds: equipmentIds || [],
          instrumentIds: instrumentIds || [],
        })}::jsonb, 'admin', 'admin')
      `;

      return {
        success: true,
        verified: {
          equipment: equipmentUpdated,
          instruments: instrumentsUpdated,
        },
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Verification failed: ${err.message}` });
    }
  });

  // ═══ GET /admin/pnids/:id/annotations/unverified — Get unverified annotation positions ═══
  fastify.get('/admin/pnids/:id/annotations/unverified', async (request, reply) => {
    const { id } = request.params;

    try {
      const unverifiedEquipment = await prisma.$queryRaw`
        SELECT pe.equipment_id, e.tag, e.equipment_type, e.description,
               pe.annotation_x_pct, pe.annotation_y_pct,
               pe.annotation_w_pct, pe.annotation_h_pct
        FROM pnid_equipment pe
        JOIN equipment e ON e.id = pe.equipment_id
        WHERE pe.pnid_id = ${id}::uuid AND pe.position_verified = false
        ORDER BY e.tag
      `;

      const unverifiedInstruments = await prisma.$queryRaw`
        SELECT pi.instrument_id, i.tag, i.instrument_type, i.description,
               pi.annotation_x_pct, pi.annotation_y_pct,
               pi.annotation_w_pct, pi.annotation_h_pct
        FROM pnid_instrument pi
        JOIN instrument i ON i.id = pi.instrument_id
        WHERE pi.pnid_id = ${id}::uuid AND pi.position_verified = false
        ORDER BY i.tag
      `;

      return {
        equipment: unverifiedEquipment,
        instruments: unverifiedInstruments,
        totals: {
          equipment: unverifiedEquipment.length,
          instruments: unverifiedInstruments.length,
        },
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to get unverified annotations: ${err.message}` });
    }
  });

  async function handleStorageFileProxy(request, reply) {
    const keyParam = request.params?.key ?? request.params?.['*'] ?? '';
    const decodedKey = decodeURIComponent(String(keyParam || ''));
    if (!decodedKey) {
      return reply.status(400).send({ error: 'Missing storage key' });
    }

    try {
      const storage = await getStorageProvider(prisma);

      if (typeof storage.download === 'function') {
        const downloaded = await storage.download(decodedKey);
        const buffer = downloaded?.buffer || downloaded;
        let contentType = downloaded?.contentType || 'application/octet-stream';
        if (!downloaded?.contentType) {
          if (decodedKey.endsWith('.pdf')) contentType = 'application/pdf';
          else if (decodedKey.endsWith('.png')) contentType = 'image/png';
          else if (decodedKey.endsWith('.jpg') || decodedKey.endsWith('.jpeg')) contentType = 'image/jpeg';
        }

        reply.header('Content-Type', contentType);
        reply.header('Cache-Control', 'public, max-age=3600');
        return reply.send(buffer);
      }

      // For cloud providers, redirect to signed URL
      const url = await storage.getUrl(decodedKey);
      return reply.redirect(302, url);
    } catch (err) {
      return reply.status(404).send({ error: 'File not found' });
    }
  }

  // Single-segment key (legacy)
  fastify.get('/storage/files/:key', handleStorageFileProxy);
  // Nested path key with slashes
  fastify.get('/storage/files/*', handleStorageFileProxy);
}
