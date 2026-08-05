import { getStorageProvider, parsePnidFilename } from './index.js';

/**
 * Storage Sync Service.
 * Scans a storage backend for P&ID files and reconciles with the database.
 *
 * Handles:
 *   - Detecting new files not in DB
 *   - Matching existing files by storage_key or drawing_number
 *   - Revision management: same drawing, different revision = new version
 *   - Duplicate detection: same drawing + same revision = skip or update
 */

const SUPPORTED_EXTENSIONS = ['.pdf', '.png', '.tiff', '.tif', '.jpg', '.jpeg'];

/**
 * Scan storage for a platform and return sync status.
 * @param {object} prisma - Prisma client
 * @param {string} platformId - Platform UUID
 * @param {object} [options] - { scanPrefix, configId }
 * @returns {Promise<{ platform, newFiles[], newRevisions[], duplicates[], orphaned[], matched[], errors[] }>}
 */
export async function scanPlatformStorage(prisma, platformId, options = {}) {
  const errors = [];

  // Get platform info
  const platform = await prisma.platform.findUnique({
    where: { id: platformId },
    include: {
      complex: {
        include: {
          location: {
            include: {
              concession: {
                include: { project: { include: { client: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!platform) throw new Error(`Platform ${platformId} not found`);

  // Get storage provider — use configId if provided, else resolve by platform scope
  let storage;
  if (options.configId) {
    const { createProvider } = await import('./index.js');
    const configs = await prisma.$queryRaw`
      SELECT * FROM storage_config WHERE id = ${options.configId}::uuid AND is_active = true LIMIT 1
    `;
    if (!configs?.length) throw new Error('Storage configuration not found');
    storage = createProvider(configs[0]);
  } else {
    try {
      storage = await getStorageProvider(prisma, { platformId });
    } catch (err) {
      throw new Error(`No storage configured for platform ${platform.code}: ${err.message}`);
    }
  }

  // Determine scan prefix: user-specified or platform code
  const scanPrefix = options.scanPrefix || `${platform.code}/pids/`;

  // List ALL files under the prefix (recursively)
  let storageFiles = [];

  if (typeof storage.listFiles === 'function') {
    storageFiles = await storage.listFiles(scanPrefix);
  } else if (typeof storage.list === 'function') {
    // Use the new list() method with no delimiter to get recursive listing
    storageFiles = await listAllRecursive(storage, scanPrefix);
  } else if (storage.config?.base_path) {
    const fs = await import('fs/promises');
    const path = await import('path');
    const fullDir = path.join(storage.config.base_path, scanPrefix);
    try {
      storageFiles = await walkDirForFiles(fullDir, storage.config.base_path);
    } catch (e) {
      if (e.code !== 'ENOENT') errors.push(`Failed to scan directory: ${e.message}`);
    }
  }

  // Filter to supported file types
  storageFiles = storageFiles.filter(f => {
    const ext = f.key.toLowerCase().match(/\.[^.]+$/)?.[0];
    return ext && SUPPORTED_EXTENSIONS.includes(ext);
  });

  // Get all existing P&IDs for this platform from DB
  // Use LEFT JOIN so we also find P&IDs that have no pnid_system link (unassigned)
  const existingPnids = await prisma.$queryRaw`
    SELECT DISTINCT p.id, p.drawing_number, p.revision, p.storage_key, p.has_image
    FROM pnid p
    LEFT JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
    LEFT JOIN system s ON s.id = ps.system_id
    WHERE p.deleted_at IS NULL
      AND (s.platform_id = ${platformId}::uuid OR ps.id IS NULL)
  `.catch(() => []);

  // Build lookup maps
  const dbStorageKeys = new Set(existingPnids.map(p => p.storage_key).filter(Boolean));

  // Map: drawing_number (lowercase) → array of { id, revision, storage_key }
  const dbDrawingMap = new Map();
  for (const p of existingPnids) {
    const dn = (p.drawing_number || '').toLowerCase();
    if (!dbDrawingMap.has(dn)) dbDrawingMap.set(dn, []);
    dbDrawingMap.get(dn).push(p);
  }

  // Get systems for this platform (used for auto-detection and UI system selector)
  const systems = await prisma.system.findMany({
    where: { platform_id: platformId },
    select: { id: true, code: true, name: true, sys_type: true },
    orderBy: { code: 'asc' },
  });

  // Classify each storage file
  const newFiles = [];
  const newRevisions = [];
  const duplicates = [];
  const matched = [];

  // Build system code lookup for auto-detection from filename
  const systemCodeMap = new Map();
  for (const s of systems) {
    systemCodeMap.set(s.code.toLowerCase(), s);
  }

  for (const file of storageFiles) {
    // Already linked by exact storage_key
    if (dbStorageKeys.has(file.key)) {
      const linkedPnid = existingPnids.find(p => p.storage_key === file.key);
      matched.push({ file, pnid: linkedPnid, status: 'matched_by_key' });
      continue;
    }

    // Parse filename to extract drawing number and revision
    const filename = file.key.split('/').pop();
    const parsed = parsePnidFilename(filename);
    const drawingLower = (parsed.drawingNumber || '').toLowerCase();

    // Auto-detect system from filename — check if any system code appears in the drawing number or path
    let detectedSystem = null;
    const filePathLower = file.key.toLowerCase();
    for (const [code, sys] of systemCodeMap) {
      if (drawingLower.includes(code) || filePathLower.includes(code)) {
        detectedSystem = { id: sys.id, code: sys.code, name: sys.name };
        break;
      }
    }

    const existingVersions = dbDrawingMap.get(drawingLower) || [];

    if (existingVersions.length === 0) {
      // Brand new P&ID — never seen this drawing number
      newFiles.push({ ...file, parsed, detectedSystem });
    } else {
      // Drawing number exists — check revision
      const sameRevision = existingVersions.find(
        v => (v.revision || '0') === (parsed.revision || '0')
      );

      if (sameRevision) {
        if (sameRevision.storage_key === file.key) {
          matched.push({ file, pnid: sameRevision, status: 'matched_by_name' });
        } else {
          // Same drawing + same revision but different file — DUPLICATE
          duplicates.push({
            ...file,
            parsed,
            detectedSystem,
            existingPnid: sameRevision,
            reason: `Rev ${parsed.revision || '0'} already exists in DB`,
          });
        }
      } else {
        // Same drawing but DIFFERENT revision — this is a NEW REVISION
        const latestExisting = existingVersions.reduce((a, b) =>
          parseInt(a.revision || '0') > parseInt(b.revision || '0') ? a : b
        );
        newRevisions.push({
          ...file,
          parsed,
          detectedSystem,
          existingPnid: latestExisting,
          existingRevision: latestExisting.revision,
          newRevision: parsed.revision,
        });
      }
    }
  }

  // Find orphaned DB records
  const storageKeySet = new Set(storageFiles.map(f => f.key));
  const orphaned = existingPnids.filter(p =>
    p.storage_key && p.has_image && !storageKeySet.has(p.storage_key)
  );

  return {
    platform: { id: platform.id, code: platform.code, name: platform.name },
    systems,
    scanPrefix,
    newFiles,
    newRevisions,
    duplicates,
    orphaned,
    matched,
    errors,
    totalInStorage: storageFiles.length,
    totalInDb: existingPnids.length,
  };
}

/**
 * Import detected new files into the database as P&ID records.
 * Handles: new P&IDs, new revisions of existing P&IDs, and duplicate updates.
 */
export async function importDetectedFiles(prisma, platformId, files, systemId = null, options = {}) {
  const created = [];
  const updated = [];
  const skipped = [];
  const errors = [];

  for (const file of files) {
    try {
      const drawingNumber = file.parsed?.drawingNumber || file.key.split('/').pop().replace(/\.[^.]+$/, '');
      const revision = file.parsed?.revision || '0';
      const importType = file.importType || 'new'; // 'new' | 'revision' | 'duplicate_update'

      // Resolve system: per-file system_id > global systemId > detected system > null (unassigned)
      const fileSystemId = file.system_id || systemId || file.detectedSystem?.id || null;

      if (importType === 'revision') {
        // New revision of existing drawing — create new pnid record with new revision
        // First check if this exact revision already exists
        const existingRevision = await prisma.$queryRaw`
          SELECT id FROM pnid WHERE drawing_number = ${drawingNumber} AND revision = ${revision} LIMIT 1
        `.catch(() => []);

        if (existingRevision?.length > 0) {
          skipped.push({ key: file.key, reason: `Rev ${revision} already exists for ${drawingNumber}` });
          continue;
        }

        // Mark old revision as superseded
        if (file.existingPnidId) {
          await prisma.$queryRaw`
            UPDATE pnid SET status = 'superseded', updated_at = NOW()
            WHERE id = ${file.existingPnidId}::uuid AND status != 'superseded'
          `.catch(() => {});
        }

        // Create new P&ID record with new revision
        const [pnid] = await prisma.$queryRaw`
          INSERT INTO pnid (drawing_number, title, revision, status, storage_key, has_image, uploaded_at)
          VALUES (${drawingNumber}, ${drawingNumber}, ${revision}, 'draft', ${file.key}, true, NOW())
          RETURNING id, drawing_number, revision
        `;

        // Link to system if available
        if (fileSystemId) {
          await prisma.$queryRaw`
            INSERT INTO pnid_system (pnid_id, system_id, is_primary)
            VALUES (${pnid.id}::uuid, ${fileSystemId}::uuid, true)
          `;
        }

        created.push({
          id: pnid.id,
          drawing_number: pnid.drawing_number,
          revision: pnid.revision,
          storage_key: file.key,
          type: 'new_revision',
          system_id: fileSystemId,
        });

      } else if (importType === 'duplicate_update') {
        // Same drawing + same revision — update storage_key to point to new file
        if (file.existingPnidId) {
          await prisma.$queryRaw`
            UPDATE pnid SET
              storage_key = ${file.key},
              has_image = true,
              uploaded_at = NOW(),
              updated_at = NOW()
            WHERE id = ${file.existingPnidId}::uuid
          `;
          updated.push({
            id: file.existingPnidId,
            drawing_number: drawingNumber,
            revision,
            storage_key: file.key,
            type: 'updated',
          });
        }

      } else {
        // Brand new P&ID
        // Check for unique constraint on drawing_number (include deleted records to avoid constraint violation)
        const existing = await prisma.$queryRaw`
          SELECT id, deleted_at FROM pnid WHERE drawing_number = ${drawingNumber} LIMIT 1
        `.catch(() => []);

        if (existing?.length > 0) {
          // Link existing record instead of creating duplicate
          // Also clear deleted_at so the record becomes visible again
          await prisma.$queryRaw`
            UPDATE pnid SET
              storage_key = ${file.key},
              has_image = true,
              revision = ${revision},
              deleted_at = NULL,
              uploaded_at = COALESCE(uploaded_at, NOW()),
              updated_at = NOW()
            WHERE id = ${existing[0].id}::uuid
          `;
          // Also create pnid_system link if missing for this system
          if (fileSystemId) {
            const existingLink = await prisma.$queryRaw`
              SELECT id FROM pnid_system WHERE pnid_id = ${existing[0].id}::uuid AND system_id = ${fileSystemId}::uuid LIMIT 1
            `.catch(() => []);
            if (!existingLink?.length) {
              // Check if there's already a primary system; if so, add as secondary
              const hasPrimary = await prisma.$queryRaw`
                SELECT id FROM pnid_system WHERE pnid_id = ${existing[0].id}::uuid AND is_primary = true LIMIT 1
              `.catch(() => []);
              const isPrimary = !hasPrimary?.length;
              await prisma.$queryRaw`
                INSERT INTO pnid_system (pnid_id, system_id, is_primary)
                VALUES (${existing[0].id}::uuid, ${fileSystemId}::uuid, ${isPrimary})
              `.catch(() => {}); // Ignore if unique constraint already satisfied
            }
          }
          updated.push({
            id: existing[0].id,
            drawing_number: drawingNumber,
            revision,
            storage_key: file.key,
            type: 'linked_existing',
            system_id: fileSystemId,
          });
          continue;
        }

        const [pnid] = await prisma.$queryRaw`
          INSERT INTO pnid (drawing_number, title, revision, status, storage_key, has_image, uploaded_at)
          VALUES (${drawingNumber}, ${drawingNumber}, ${revision}, 'draft', ${file.key}, true, NOW())
          RETURNING id, drawing_number, revision
        `;

        // Link to system if available — can be assigned later from P&ID list if null
        if (fileSystemId) {
          await prisma.$queryRaw`
            INSERT INTO pnid_system (pnid_id, system_id, is_primary)
            VALUES (${pnid.id}::uuid, ${fileSystemId}::uuid, true)
          `;
        }

        created.push({
          id: pnid.id,
          drawing_number: pnid.drawing_number,
          revision: pnid.revision,
          storage_key: file.key,
          type: 'new',
          system_id: fileSystemId,
        });
      }
    } catch (err) {
      errors.push({ key: file.key, error: err.message });
    }
  }

  return { created, updated, skipped, errors };
}

/**
 * Link an existing P&ID record to a storage file.
 */
export async function linkFileToRecord(prisma, pnidId, storageKey) {
  await prisma.$queryRaw`
    UPDATE pnid SET
      storage_key = ${storageKey},
      image_path = ${storageKey},
      has_image = true,
      uploaded_at = NOW(),
      updated_at = NOW()
    WHERE id = ${pnidId}::uuid
  `;
}

/**
 * List all files recursively using the provider's list() method.
 */
async function listAllRecursive(storage, prefix) {
  const allFiles = [];
  let continuationToken;

  do {
    const result = await storage.list(prefix, {
      delimiter: '', // no delimiter = recursive
      maxKeys: 1000,
      continuationToken,
    });

    allFiles.push(...result.files);
    continuationToken = result.isTruncated ? result.nextToken : undefined;
  } while (continuationToken);

  return allFiles;
}

/**
 * Walk a local directory recursively and return file list.
 */
async function walkDirForFiles(dir, basePath) {
  const fs = await import('fs/promises');
  const path = await import('path');
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await walkDirForFiles(fullPath, basePath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const stat = await fs.stat(fullPath);
        const relativePath = path.relative(basePath, fullPath);
        files.push({
          key: relativePath.replace(/\\/g, '/'),
          size: stat.size,
          updated: stat.mtime.toISOString(),
        });
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  return files;
}
