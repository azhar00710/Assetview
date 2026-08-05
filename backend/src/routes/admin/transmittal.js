import prisma from '../../db.js';
import { getStorageProvider, generatePnidStorageKey } from '../../services/storage/index.js';

/**
 * Parse a P&ID filename to extract drawing_number and revision.
 * Strips extension, then looks for _Rev{N}, _R{N}, _rev{N}, or -Rev{N} suffix.
 */
function parseFilename(filename) {
  // Strip extension
  const withoutExt = filename.replace(/\.(pdf|png|jpg|jpeg|tif|tiff|svg|dwg|dxf)$/i, '');

  // Look for revision suffix patterns: _RevN, _RN, _revN, -RevN
  const revMatch = withoutExt.match(/[_-][Rr]ev?(\d+)$/);

  if (revMatch) {
    const revision = revMatch[1];
    const drawingNumber = withoutExt.slice(0, revMatch.index);
    return { drawingNumber, revision };
  }

  // No revision found — entire stem is drawing_number, revision defaults to '0'
  return { drawingNumber: withoutExt, revision: '0' };
}

/**
 * Simple CSV parser: split by newline, then by comma.
 * Returns { headers: string[], rows: string[][] }
 */
function parseCsv(csvString) {
  const lines = csvString.trim().split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => line.split(',').map(c => c.trim()));
  return { headers, rows };
}

export default async function transmittalRoutes(fastify) {

  // ═══ 1. GET /admin/transmittals — List transmittals for a platform ═══
  fastify.get('/admin/transmittals', async (request, reply) => {
    const { platform_id } = request.query;

    if (!platform_id) {
      return reply.status(400).send({ error: 'platform_id query parameter is required' });
    }

    try {
      const transmittals = await prisma.$queryRaw`
        SELECT t.id, t.reference_number, t.platform_id, t.description,
               t.upload_date, t.uploaded_by, t.document_count, t.status,
               t.metadata, t.created_at, t.updated_at,
               COUNT(du.id)::int AS actual_document_count
        FROM transmittal t
        LEFT JOIN document_upload du ON du.transmittal_id = t.id
        WHERE t.platform_id = ${platform_id}::uuid AND t.deleted_at IS NULL
        GROUP BY t.id
        ORDER BY t.created_at DESC
      `;

      return { transmittals };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to list transmittals: ${err.message}` });
    }
  });

  // ═══ 2. POST /admin/transmittals — Create transmittal ═══
  fastify.post('/admin/transmittals', async (request, reply) => {
    const { reference_number, platform_id, description, uploaded_by } = request.body || {};

    if (!reference_number || !platform_id) {
      return reply.status(400).send({ error: 'reference_number and platform_id are required' });
    }

    try {
      const [transmittal] = await prisma.$queryRaw`
        INSERT INTO transmittal (reference_number, platform_id, description, uploaded_by)
        VALUES (${reference_number}, ${platform_id}::uuid, ${description || null}, ${uploaded_by || null})
        RETURNING id, reference_number, platform_id, description, upload_date, uploaded_by,
                  document_count, status, metadata, created_at, updated_at
      `;

      return reply.status(201).send({ transmittal });
    } catch (err) {
      // Handle unique constraint violation
      if (err.code === 'P2002' || err.message?.includes('unique') || err.message?.includes('duplicate')) {
        return reply.status(409).send({ error: 'A transmittal with this reference number already exists for this platform' });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to create transmittal: ${err.message}` });
    }
  });

  // ═══ 3. GET /admin/transmittals/:id — Get transmittal with documents ═══
  fastify.get('/admin/transmittals/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      const transmittals = await prisma.$queryRaw`
        SELECT id, reference_number, platform_id, description,
               upload_date, uploaded_by, document_count, status,
               metadata, created_at, updated_at
        FROM transmittal
        WHERE id = ${id}::uuid AND deleted_at IS NULL
      `;

      if (!transmittals?.length) {
        return reply.status(404).send({ error: 'Transmittal not found' });
      }

      const documents = await prisma.$queryRaw`
        SELECT id, transmittal_id, document_type, original_filename,
               parsed_identifier, revision, entity_id, version_id,
               storage_key, file_size_bytes, file_checksum,
               record_count, records_created, records_updated, records_errors,
               parse_errors, status, approved_at, approved_by,
               metadata, created_at, created_by
        FROM document_upload
        WHERE transmittal_id = ${id}::uuid
        ORDER BY created_at DESC
      `;

      return {
        transmittal: transmittals[0],
        documents: documents.map(d => ({ ...d, file_size_bytes: d.file_size_bytes != null ? Number(d.file_size_bytes) : null })),
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to get transmittal: ${err.message}` });
    }
  });

  // ═══ 4. PUT /admin/transmittals/:id — Update transmittal metadata ═══
  fastify.put('/admin/transmittals/:id', async (request, reply) => {
    const { id } = request.params;
    const { reference_number, description, uploaded_by, metadata } = request.body || {};

    try {
      const existing = await prisma.$queryRaw`
        SELECT id FROM transmittal WHERE id = ${id}::uuid AND deleted_at IS NULL
      `;

      if (!existing?.length) {
        return reply.status(404).send({ error: 'Transmittal not found' });
      }

      const [updated] = await prisma.$queryRaw`
        UPDATE transmittal SET
          reference_number = COALESCE(${reference_number || null}, reference_number),
          description = COALESCE(${description || null}, description),
          uploaded_by = COALESCE(${uploaded_by || null}, uploaded_by),
          metadata = COALESCE(${metadata ? JSON.stringify(metadata) : null}::jsonb, metadata),
          updated_at = NOW()
        WHERE id = ${id}::uuid
        RETURNING id, reference_number, platform_id, description, upload_date, uploaded_by,
                  document_count, status, metadata, created_at, updated_at
      `;

      return { transmittal: updated };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to update transmittal: ${err.message}` });
    }
  });

  // ═══ 5. DELETE /admin/transmittals/:id — Soft delete ═══
  fastify.delete('/admin/transmittals/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await prisma.$queryRaw`
        SELECT id FROM transmittal WHERE id = ${id}::uuid AND deleted_at IS NULL
      `;

      if (!existing?.length) {
        return reply.status(404).send({ error: 'Transmittal not found' });
      }

      await prisma.$queryRaw`
        UPDATE transmittal SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ${id}::uuid
      `;

      return { success: true, message: 'Transmittal deleted' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to delete transmittal: ${err.message}` });
    }
  });

  // ═══ 6. POST /admin/transmittals/:id/upload-pnid — Upload P&ID file ═══
  fastify.post('/admin/transmittals/:id/upload-pnid', async (request, reply) => {
    const { id } = request.params;
    const { file, filename, contentType } = request.body || {};

    if (!file || !filename) {
      return reply.status(400).send({ error: 'file (base64) and filename are required' });
    }

    try {
      // Verify transmittal exists
      const transmittals = await prisma.$queryRaw`
        SELECT id, platform_id FROM transmittal
        WHERE id = ${id}::uuid AND deleted_at IS NULL
      `;

      if (!transmittals?.length) {
        return reply.status(404).send({ error: 'Transmittal not found' });
      }

      const transmittal = transmittals[0];
      const platformId = transmittal.platform_id;

      // Parse filename to extract drawing_number and revision
      const { drawingNumber, revision } = parseFilename(filename);

      // Resolve platform code
      const platform = await prisma.platform.findUnique({ where: { id: platformId } });
      const platformCode = platform?.code || 'unknown';

      // Look up existing pnid by drawing_number
      const existingPnids = await prisma.$queryRaw`
        SELECT id, drawing_number, revision, status
        FROM pnid
        WHERE drawing_number = ${drawingNumber} AND deleted_at IS NULL
        LIMIT 1
      `;

      let pnidId;
      let versionNumber;
      let isNew = false;

      if (!existingPnids?.length) {
        // Not found — create new pnid record
        const [newPnid] = await prisma.$queryRaw`
          INSERT INTO pnid (drawing_number, revision, title, status)
          VALUES (${drawingNumber}, ${revision}, ${drawingNumber}, 'draft')
          RETURNING id
        `;
        pnidId = newPnid.id;
        versionNumber = 1;
        isNew = true;
      } else {
        const existingPnid = existingPnids[0];

        // Check latest version revision
        const latestVersions = await prisma.$queryRaw`
          SELECT version_number, revision
          FROM pnid_version
          WHERE pnid_id = ${existingPnid.id}::uuid
          ORDER BY version_number DESC
          LIMIT 1
        `;

        const latestRevision = latestVersions?.length
          ? latestVersions[0].revision
          : existingPnid.revision;
        const latestVersionNumber = latestVersions?.length
          ? Number(latestVersions[0].version_number)
          : 0;

        if (latestRevision === revision) {
          return reply.status(409).send({
            error: 'Conflict: a version with this revision already exists',
            drawingNumber,
            revision,
            existingPnidId: existingPnid.id,
          });
        }

        pnidId = existingPnid.id;
        versionNumber = latestVersionNumber + 1;
      }

      // Decode file and upload to storage
      const fileBuffer = Buffer.from(file, 'base64');
      const fileSize = fileBuffer.length;

      const storage = await getStorageProvider(prisma, { platformId });
      const storageKey = generatePnidStorageKey(platformCode, drawingNumber, revision, filename);

      const uploadResult = await storage.upload(fileBuffer, storageKey, {
        contentType: contentType || 'application/pdf',
      });

      // Create pnid_version record
      const [newVersion] = await prisma.$queryRaw`
        INSERT INTO pnid_version (
          pnid_id, version_number, revision, storage_key, pdf_storage_key,
          file_checksum, file_size_bytes, status, transmittal_id, created_by
        ) VALUES (
          ${pnidId}::uuid, ${versionNumber}, ${revision}, ${storageKey}, ${storageKey},
          ${uploadResult.checksum || null}, ${BigInt(fileSize)}, 'draft',
          ${id}::uuid, 'admin'
        )
        RETURNING id, version_number, revision, storage_key, status
      `;

      // Create document_upload record
      const [docUpload] = await prisma.$queryRaw`
        INSERT INTO document_upload (
          transmittal_id, document_type, original_filename,
          parsed_identifier, revision, entity_id, version_id,
          storage_key, file_size_bytes, file_checksum, status, created_by
        ) VALUES (
          ${id}::uuid, 'pnid', ${filename},
          ${drawingNumber}, ${revision}, ${pnidId}::uuid, ${newVersion.id}::uuid,
          ${storageKey}, ${BigInt(fileSize)}, ${uploadResult.checksum || null},
          'draft', 'admin'
        )
        RETURNING id, document_type, original_filename, parsed_identifier,
                  revision, entity_id, version_id, storage_key, status, created_at
      `;

      // Increment document_count
      await prisma.$queryRaw`
        UPDATE transmittal
        SET document_count = document_count + 1, updated_at = NOW()
        WHERE id = ${id}::uuid
      `;

      return reply.status(201).send({
        success: true,
        document: docUpload,
        pnid: {
          id: pnidId,
          drawingNumber,
          revision,
          isNew,
        },
        version: {
          id: newVersion.id,
          versionNumber: newVersion.version_number,
          revision: newVersion.revision,
          status: newVersion.status,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `P&ID upload failed: ${err.message}` });
    }
  });

  // ═══ 7. POST /admin/transmittals/:id/upload-list — Upload CSV line/equipment list ═══
  fastify.post('/admin/transmittals/:id/upload-list', async (request, reply) => {
    const { id } = request.params;
    const { csv, filename, list_type } = request.body || {};

    if (!csv || !filename || !list_type) {
      return reply.status(400).send({ error: 'csv, filename, and list_type are required' });
    }

    if (!['line_list', 'equipment_list'].includes(list_type)) {
      return reply.status(400).send({ error: 'list_type must be line_list or equipment_list' });
    }

    try {
      // Verify transmittal exists
      const transmittals = await prisma.$queryRaw`
        SELECT id, platform_id FROM transmittal
        WHERE id = ${id}::uuid AND deleted_at IS NULL
      `;

      if (!transmittals?.length) {
        return reply.status(404).send({ error: 'Transmittal not found' });
      }

      const transmittal = transmittals[0];
      const platformId = transmittal.platform_id;

      // Parse CSV
      const { headers, rows } = parseCsv(csv);
      const recordCount = rows.length;

      // Create document_upload record
      const [docUpload] = await prisma.$queryRaw`
        INSERT INTO document_upload (
          transmittal_id, document_type, original_filename,
          record_count, status, created_by
        ) VALUES (
          ${id}::uuid, ${list_type}, ${filename},
          ${recordCount}, 'draft', 'admin'
        )
        RETURNING id, document_type, original_filename, record_count, status, created_at
      `;

      // Determine next version number for this list_type on this platform
      const latestVersions = await prisma.$queryRaw`
        SELECT COALESCE(MAX(version_number), 0)::int AS max_version
        FROM list_upload_version
        WHERE platform_id = ${platformId}::uuid AND list_type = ${list_type}
      `;
      const nextVersion = (latestVersions[0]?.max_version || 0) + 1;

      // Create list_upload_version record
      const [listVersion] = await prisma.$queryRaw`
        INSERT INTO list_upload_version (
          platform_id, list_type, version_number,
          transmittal_id, document_upload_id,
          original_filename, record_count, status, created_by
        ) VALUES (
          ${platformId}::uuid, ${list_type}, ${nextVersion},
          ${id}::uuid, ${docUpload.id}::uuid,
          ${filename}, ${recordCount}, 'draft', 'admin'
        )
        RETURNING id, version_number, list_type, status
      `;

      // Increment document_count on transmittal
      await prisma.$queryRaw`
        UPDATE transmittal
        SET document_count = document_count + 1, updated_at = NOW()
        WHERE id = ${id}::uuid
      `;

      return reply.status(201).send({
        success: true,
        document: docUpload,
        listVersion: {
          id: listVersion.id,
          versionNumber: listVersion.version_number,
          listType: listVersion.list_type,
          status: listVersion.status,
        },
        preview: {
          headers,
          rows: rows.slice(0, 10),
          totalRows: recordCount,
          truncated: recordCount > 10,
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `List upload failed: ${err.message}` });
    }
  });

  // ═══ 8. PUT /admin/transmittals/:id/documents/:docId/approve — Approve a document ═══
  fastify.put('/admin/transmittals/:id/documents/:docId/approve', async (request, reply) => {
    const { id, docId } = request.params;
    const { approved_by } = request.body || {};

    try {
      // Fetch the document
      const docs = await prisma.$queryRaw`
        SELECT id, document_type, entity_id, version_id, status
        FROM document_upload
        WHERE id = ${docId}::uuid AND transmittal_id = ${id}::uuid
      `;

      if (!docs?.length) {
        return reply.status(404).send({ error: 'Document not found in this transmittal' });
      }

      const doc = docs[0];

      if (doc.status === 'approved') {
        return reply.status(400).send({ error: 'Document is already approved' });
      }

      // Update document_upload status
      await prisma.$queryRaw`
        UPDATE document_upload
        SET status = 'approved',
            approved_at = NOW(),
            approved_by = ${approved_by || 'admin'}
        WHERE id = ${docId}::uuid
      `;

      if (doc.document_type === 'pnid') {
        // Update pnid status to approved
        if (doc.entity_id) {
          await prisma.$queryRaw`
            UPDATE pnid SET status = 'approved', updated_at = NOW()
            WHERE id = ${doc.entity_id}::uuid
          `;
        }
        // Activate the version
        if (doc.version_id) {
          await prisma.$queryRaw`
            UPDATE pnid_version SET status = 'active'
            WHERE id = ${doc.version_id}::uuid
          `;
        }
      } else if (doc.document_type === 'line_list' || doc.document_type === 'equipment_list') {
        // Update list_upload_version status to active
        await prisma.$queryRaw`
          UPDATE list_upload_version
          SET status = 'active'
          WHERE document_upload_id = ${docId}::uuid
        `;
      }

      return {
        success: true,
        document: {
          id: docId,
          status: 'approved',
          approved_by: approved_by || 'admin',
        },
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Approval failed: ${err.message}` });
    }
  });

  // ═══ 9. PUT /admin/transmittals/:id/documents/:docId/reject — Reject a document ═══
  fastify.put('/admin/transmittals/:id/documents/:docId/reject', async (request, reply) => {
    const { id, docId } = request.params;
    const { reason } = request.body || {};

    try {
      const docs = await prisma.$queryRaw`
        SELECT id, status FROM document_upload
        WHERE id = ${docId}::uuid AND transmittal_id = ${id}::uuid
      `;

      if (!docs?.length) {
        return reply.status(404).send({ error: 'Document not found in this transmittal' });
      }

      await prisma.$queryRaw`
        UPDATE document_upload
        SET status = 'rejected',
            metadata = jsonb_set(COALESCE(metadata, '{}'), '{rejection_reason}', ${JSON.stringify(reason || '')}::jsonb)
        WHERE id = ${docId}::uuid
      `;

      return {
        success: true,
        document: {
          id: docId,
          status: 'rejected',
          reason: reason || null,
        },
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Rejection failed: ${err.message}` });
    }
  });

  // ═══ 10. POST /admin/transmittals/:id/approve-all — Bulk approve all draft documents ═══
  fastify.post('/admin/transmittals/:id/approve-all', async (request, reply) => {
    const { id } = request.params;
    const { approved_by } = request.body || {};

    try {
      // Get all draft documents for this transmittal
      const draftDocs = await prisma.$queryRaw`
        SELECT id, document_type, entity_id, version_id
        FROM document_upload
        WHERE transmittal_id = ${id}::uuid AND status = 'draft'
      `;

      if (!draftDocs?.length) {
        return reply.status(400).send({ error: 'No draft documents to approve' });
      }

      const approvedBy = approved_by || 'admin';
      let approvedCount = 0;

      for (const doc of draftDocs) {
        // Update document_upload status
        await prisma.$queryRaw`
          UPDATE document_upload
          SET status = 'approved', approved_at = NOW(), approved_by = ${approvedBy}
          WHERE id = ${doc.id}::uuid
        `;

        if (doc.document_type === 'pnid') {
          if (doc.entity_id) {
            await prisma.$queryRaw`
              UPDATE pnid SET status = 'approved', updated_at = NOW()
              WHERE id = ${doc.entity_id}::uuid
            `;
          }
          if (doc.version_id) {
            await prisma.$queryRaw`
              UPDATE pnid_version SET status = 'active'
              WHERE id = ${doc.version_id}::uuid
            `;
          }
        } else if (doc.document_type === 'line_list' || doc.document_type === 'equipment_list') {
          await prisma.$queryRaw`
            UPDATE list_upload_version
            SET status = 'active'
            WHERE document_upload_id = ${doc.id}::uuid
          `;
        }

        approvedCount++;
      }

      return {
        success: true,
        approved_count: approvedCount,
        approved_by: approvedBy,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Bulk approval failed: ${err.message}` });
    }
  });

  // ═══ 11. POST /admin/transmittals/:id/close — Close transmittal ═══
  fastify.post('/admin/transmittals/:id/close', async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await prisma.$queryRaw`
        SELECT id, status FROM transmittal WHERE id = ${id}::uuid AND deleted_at IS NULL
      `;

      if (!existing?.length) {
        return reply.status(404).send({ error: 'Transmittal not found' });
      }

      if (existing[0].status === 'closed') {
        return reply.status(400).send({ error: 'Transmittal is already closed' });
      }

      await prisma.$queryRaw`
        UPDATE transmittal SET status = 'closed', updated_at = NOW()
        WHERE id = ${id}::uuid
      `;

      return { success: true, message: 'Transmittal closed' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to close transmittal: ${err.message}` });
    }
  });

  // ═══ 12. GET /admin/pnids/:pnidId/revision-history — Full revision timeline ═══
  fastify.get('/admin/pnids/:pnidId/revision-history', async (request, reply) => {
    const { pnidId } = request.params;

    try {
      const history = await prisma.$queryRaw`
        SELECT
          v.version_number AS "versionNumber",
          v.revision,
          v.status,
          t.reference_number AS "transmittalRef",
          v.created_at AS "uploadedAt",
          v.created_by AS "uploadedBy",
          du.approved_at AS "approvedAt",
          v.change_summary AS "changeSummary",
          v.change_type AS "changeType"
        FROM pnid_version v
        LEFT JOIN transmittal t ON t.id = v.transmittal_id
        LEFT JOIN document_upload du ON du.version_id = v.id
        WHERE v.pnid_id = ${pnidId}::uuid
        ORDER BY v.version_number DESC
      `;

      return { pnidId, history };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to get revision history: ${err.message}` });
    }
  });

  // ═══ 13. GET /admin/lists/:platformId/revision-history — List upload version history ═══
  fastify.get('/admin/lists/:platformId/revision-history', async (request, reply) => {
    const { platformId } = request.params;
    const { type } = request.query;

    try {
      let history;

      if (type) {
        history = await prisma.$queryRaw`
          SELECT
            lv.id, lv.list_type AS "listType",
            lv.version_number AS "versionNumber",
            lv.revision, lv.status,
            lv.original_filename AS "originalFilename",
            lv.record_count AS "recordCount",
            lv.records_created AS "recordsCreated",
            lv.records_updated AS "recordsUpdated",
            lv.records_deleted AS "recordsDeleted",
            lv.change_summary AS "changeSummary",
            lv.created_at AS "createdAt",
            lv.created_by AS "createdBy",
            lv.superseded_at AS "supersededAt",
            t.reference_number AS "transmittalRef"
          FROM list_upload_version lv
          LEFT JOIN transmittal t ON t.id = lv.transmittal_id
          WHERE lv.platform_id = ${platformId}::uuid AND lv.list_type = ${type}
          ORDER BY lv.version_number DESC
        `;
      } else {
        history = await prisma.$queryRaw`
          SELECT
            lv.id, lv.list_type AS "listType",
            lv.version_number AS "versionNumber",
            lv.revision, lv.status,
            lv.original_filename AS "originalFilename",
            lv.record_count AS "recordCount",
            lv.records_created AS "recordsCreated",
            lv.records_updated AS "recordsUpdated",
            lv.records_deleted AS "recordsDeleted",
            lv.change_summary AS "changeSummary",
            lv.created_at AS "createdAt",
            lv.created_by AS "createdBy",
            lv.superseded_at AS "supersededAt",
            t.reference_number AS "transmittalRef"
          FROM list_upload_version lv
          LEFT JOIN transmittal t ON t.id = lv.transmittal_id
          WHERE lv.platform_id = ${platformId}::uuid
          ORDER BY lv.list_type, lv.version_number DESC
        `;
      }

      return { platformId, history };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to get list revision history: ${err.message}` });
    }
  });
}
