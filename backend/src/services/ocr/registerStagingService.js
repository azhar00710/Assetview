/**
 * Register staging — compare approved OCR review tags with existing registers,
 * then stage link/add/remove actions before apply.
 */

import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { getStorageProvider } from '../storage/index.js';
import { syncBatchReviewToOcrExtractions } from './reviewSyncToExtractions.js';

const ALLOWED_KINDS = ['line', 'equipment', 'instrument', 'system'];
const LINK_KINDS = ['line', 'equipment', 'instrument'];

function normText(s) {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

function truncate(s, len = 100) {
  const v = normText(s);
  return v.length > len ? v.slice(0, len) : v;
}

function dedupeKey(batchId, fileId, entityKind, actionType, tagText = '', refId = '') {
  const h = crypto.createHash('sha256')
    .update(`${batchId}|${fileId}|${entityKind}|${actionType}|${normText(tagText).toLowerCase()}|${refId || ''}`)
    .digest('hex');
  return `${batchId}:${fileId}:${h}`;
}

function mapTagTypeToEntityKind(type) {
  const t = String(type || '').toLowerCase();
  if (ALLOWED_KINDS.includes(t)) return t;
  return null;
}

function mapInstrumentType(tagText) {
  const t = normText(tagText).toUpperCase();
  if (/^(PT|PIT|PI|PDT|PSV|PSH|PSL|PCV)/.test(t)) return 'pressure';
  if (/^(TT|TIT|TI|TCV)/.test(t)) return 'temperature';
  if (/^(FT|FIT|FI|FCV)/.test(t)) return 'flow';
  if (/^(LT|LIT|LI|LCV)/.test(t)) return 'level';
  if (/^(XV|SDV|ESDV|BDV|PSV|PRV)/.test(t)) return 'safety_valve';
  if (/CV/.test(t)) return 'control_valve';
  if (/^(AT|AIT)/.test(t)) return 'analyzer';
  return 'other';
}

function collectTagsForCompare(reviewJson) {
  const approved = [];
  const rejected = [];

  for (const t of reviewJson.approved || []) {
    approved.push({ ...t, _reviewAction: 'approved', _finalText: normText(t.text) });
  }
  for (const t of reviewJson.edited || []) {
    approved.push({
      ...t,
      _reviewAction: 'edited',
      _finalText: normText(t.text),
      _originalText: normText(t.originalText || t.text),
    });
  }
  for (const t of reviewJson.rejected || []) {
    rejected.push({ ...t, _reviewAction: 'rejected', _finalText: normText(t.text) });
  }
  return { approved, rejected };
}

function bboxFromPayload(source) {
  if (!source || typeof source !== 'object') return {};
  const p = source.position_pct || source.positionPct;
  if (!p || typeof p !== 'object') return {};
  return {
    x_pct: p.x_pct,
    y_pct: p.y_pct,
    w_pct: p.w_pct,
    h_pct: p.h_pct,
  };
}

function bboxFromExtraction(ex) {
  if (!ex) return {};
  return {
    x_pct: ex.bbox_x_pct,
    y_pct: ex.bbox_y_pct,
    w_pct: ex.bbox_w_pct,
    h_pct: ex.bbox_h_pct,
  };
}

async function resolveExtraction(prisma, pnidId, tag) {
  const candidates = [
    normText(tag.text),
    normText(tag.originalText),
    normText(tag._originalText),
    normText(tag._finalText),
  ].filter(Boolean);

  for (const text of candidates) {
    const rows = await prisma.$queryRaw`
      SELECT id, matched_entity_id, tag_type, status,
             bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
      FROM ocr_extraction
      WHERE pnid_id = ${pnidId}::uuid
        AND LOWER(TRIM(extracted_text)) = LOWER(TRIM(${text}))
      ORDER BY matched_entity_id DESC NULLS LAST, created_at ASC
      LIMIT 1
    `;
    if (rows.length) return rows[0];
  }
  return null;
}

async function resolveEntityByTagText(prisma, platformId, entityKind, tagText) {
  const text = normText(tagText);
  if (!text) return null;

  if (entityKind === 'line') {
    const rows = await prisma.$queryRaw`
      SELECT l.id
      FROM line l
      JOIN system s ON s.id = l.system_id
      WHERE s.platform_id = ${platformId}::uuid
        AND s.deleted_at IS NULL
        AND l.deleted_at IS NULL
        AND LOWER(TRIM(l.line_number)) = LOWER(TRIM(${text}))
      LIMIT 1
    `;
    return rows[0]?.id || null;
  }
  if (entityKind === 'equipment') {
    const rows = await prisma.$queryRaw`
      SELECT e.id
      FROM equipment e
      JOIN system s ON s.id = e.system_id
      WHERE s.platform_id = ${platformId}::uuid
        AND s.deleted_at IS NULL
        AND e.deleted_at IS NULL
        AND LOWER(TRIM(e.tag)) = LOWER(TRIM(${text}))
      LIMIT 1
    `;
    return rows[0]?.id || null;
  }
  if (entityKind === 'instrument') {
    const rows = await prisma.$queryRaw`
      SELECT i.id
      FROM instrument i
      JOIN system s ON s.id = i.system_id
      WHERE s.platform_id = ${platformId}::uuid
        AND s.deleted_at IS NULL
        AND i.deleted_at IS NULL
        AND LOWER(TRIM(i.tag)) = LOWER(TRIM(${text}))
      LIMIT 1
    `;
    return rows[0]?.id || null;
  }
  if (entityKind === 'system') {
    const rows = await prisma.$queryRaw`
      SELECT id
      FROM system
      WHERE platform_id = ${platformId}::uuid
        AND deleted_at IS NULL
        AND LOWER(TRIM(code)) = LOWER(TRIM(${text}))
      LIMIT 1
    `;
    return rows[0]?.id || null;
  }
  return null;
}

async function resolveSystemForCreate(tx, platformId, pnidId, payload) {
  const byCode = normText(payload?.systemCode || payload?.system_code);
  if (byCode) {
    const rows = await tx.$queryRaw`
      SELECT id FROM system
      WHERE platform_id = ${platformId}::uuid
        AND deleted_at IS NULL
        AND LOWER(TRIM(code)) = LOWER(TRIM(${byCode}))
      LIMIT 1
    `;
    if (rows[0]?.id) return rows[0].id;
  }

  const primary = await tx.$queryRaw`
    SELECT ps.system_id
    FROM pnid_system ps
    JOIN system s ON s.id = ps.system_id
    WHERE ps.pnid_id = ${pnidId}::uuid
      AND s.platform_id = ${platformId}::uuid
      AND s.deleted_at IS NULL
    ORDER BY ps.is_primary DESC, ps.created_at ASC
    LIMIT 1
  `;
  if (primary[0]?.system_id) return primary[0].system_id;

  const fallback = await tx.$queryRaw`
    SELECT id FROM system
    WHERE platform_id = ${platformId}::uuid
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `;
  if (fallback[0]?.id) return fallback[0].id;

  // Auto-create a default system if none exist on the platform
  const created = await tx.$queryRaw`
    INSERT INTO system (platform_id, code, name, sys_type, metadata)
    VALUES (${platformId}::uuid, 'DEFAULT', 'Default System (OCR)', 'process', '{"source":"ocr_staging_auto"}'::jsonb)
    ON CONFLICT (platform_id, code) DO UPDATE SET deleted_at = NULL, updated_at = NOW()
    RETURNING id
  `;
  return created[0]?.id || null;
}

async function upsertPnidLink(tx, { pnidId, entityKind, matchedEntityId, bbox }) {
  const rawX = bbox?.x_pct != null ? Number(bbox.x_pct) : null;
  const rawY = bbox?.y_pct != null ? Number(bbox.y_pct) : null;
  const hasUsableCoords = rawX != null && rawY != null && (rawX > 0 || rawY > 0);
  const x = hasUsableCoords ? rawX : null;
  const y = hasUsableCoords ? rawY : null;
  const w = hasUsableCoords && bbox?.w_pct != null ? Number(bbox.w_pct) : null;
  const h = hasUsableCoords && bbox?.h_pct != null ? Number(bbox.h_pct) : null;

  if (entityKind === 'line') {
    await tx.pnid_line.upsert({
      where: { pnid_id_line_id: { pnid_id: pnidId, line_id: matchedEntityId } },
      create: { pnid_id: pnidId, line_id: matchedEntityId, annotation_x_pct: x, annotation_y_pct: y },
      update: { annotation_x_pct: x, annotation_y_pct: y },
    });
    return;
  }
  if (entityKind === 'equipment') {
    await tx.pnid_equipment.upsert({
      where: { pnid_id_equipment_id: { pnid_id: pnidId, equipment_id: matchedEntityId } },
      create: {
        pnid_id: pnidId,
        equipment_id: matchedEntityId,
        annotation_x_pct: x,
        annotation_y_pct: y,
        annotation_w_pct: w,
        annotation_h_pct: h,
        position_verified: true,
      },
      update: {
        annotation_x_pct: x,
        annotation_y_pct: y,
        annotation_w_pct: w,
        annotation_h_pct: h,
        position_verified: true,
      },
    });
    return;
  }
  if (entityKind === 'instrument') {
    await tx.pnid_instrument.upsert({
      where: { pnid_id_instrument_id: { pnid_id: pnidId, instrument_id: matchedEntityId } },
      create: {
        pnid_id: pnidId,
        instrument_id: matchedEntityId,
        annotation_x_pct: x,
        annotation_y_pct: y,
        annotation_w_pct: w,
        annotation_h_pct: h,
        position_verified: true,
      },
      update: {
        annotation_x_pct: x,
        annotation_y_pct: y,
        annotation_w_pct: w,
        annotation_h_pct: h,
        position_verified: true,
      },
    });
    return;
  }
  if (entityKind === 'system') {
    await tx.pnid_system.upsert({
      where: { pnid_id_system_id: { pnid_id: pnidId, system_id: matchedEntityId } },
      create: { pnid_id: pnidId, system_id: matchedEntityId, is_primary: false },
      update: {},
    });
    return;
  }
  throw new Error(`Unsupported entity_kind: ${entityKind}`);
}

async function unlinkPnidLink(tx, { pnidId, entityKind, entityId }) {
  if (entityKind === 'line') {
    await tx.$executeRaw`
      DELETE FROM pnid_line WHERE pnid_id = ${pnidId}::uuid AND line_id = ${entityId}::uuid
    `;
    return;
  }
  if (entityKind === 'equipment') {
    await tx.$executeRaw`
      DELETE FROM pnid_equipment WHERE pnid_id = ${pnidId}::uuid AND equipment_id = ${entityId}::uuid
    `;
    return;
  }
  if (entityKind === 'instrument') {
    await tx.$executeRaw`
      DELETE FROM pnid_instrument WHERE pnid_id = ${pnidId}::uuid AND instrument_id = ${entityId}::uuid
    `;
    return;
  }
  if (entityKind === 'system') {
    await tx.$executeRaw`
      DELETE FROM pnid_system WHERE pnid_id = ${pnidId}::uuid AND system_id = ${entityId}::uuid
    `;
    return;
  }
  throw new Error(`Unsupported unlink kind: ${entityKind}`);
}

async function createEntityFromPayload(tx, platformId, pnidId, entityKind, payload = {}) {
  const tagText = truncate(payload.tagText || payload.tag_text || payload.originalText || 'NEW-TAG', 100);
  const systemId = await resolveSystemForCreate(tx, platformId, pnidId, payload);
  if (!systemId && entityKind !== 'system') {
    throw new Error(`Cannot resolve system for ${entityKind} create`);
  }

  if (entityKind === 'line') {
    const rows = await tx.$queryRaw`
      INSERT INTO line (system_id, line_number, metadata)
      VALUES (${systemId}::uuid, ${tagText}, '{"source":"ocr_staging"}'::jsonb)
      ON CONFLICT (system_id, line_number) DO UPDATE
      SET deleted_at = NULL, updated_at = NOW()
      RETURNING id
    `;
    return rows[0]?.id;
  }

  if (entityKind === 'equipment') {
    const existing = await tx.$queryRaw`
      SELECT id FROM equipment
      WHERE system_id = ${systemId}::uuid
        AND deleted_at IS NULL
        AND LOWER(TRIM(tag)) = LOWER(TRIM(${tagText}))
      LIMIT 1
    `;
    if (existing[0]?.id) return existing[0].id;
    const rows = await tx.$queryRaw`
      INSERT INTO equipment (system_id, tag, equipment_type, metadata)
      VALUES (${systemId}::uuid, ${tagText}, ${payload.equipmentType || 'Unknown'}, '{"source":"ocr_staging"}'::jsonb)
      RETURNING id
    `;
    return rows[0]?.id;
  }

  if (entityKind === 'instrument') {
    const existing = await tx.$queryRaw`
      SELECT id FROM instrument
      WHERE system_id = ${systemId}::uuid
        AND deleted_at IS NULL
        AND LOWER(TRIM(tag)) = LOWER(TRIM(${tagText}))
      LIMIT 1
    `;
    if (existing[0]?.id) return existing[0].id;
    const rows = await tx.$queryRaw`
      INSERT INTO instrument (system_id, tag, instrument_type, metadata)
      VALUES (${systemId}::uuid, ${tagText}, ${mapInstrumentType(tagText)}::instrument_type, '{"source":"ocr_staging"}'::jsonb)
      RETURNING id
    `;
    return rows[0]?.id;
  }

  if (entityKind === 'system') {
    const code = truncate(payload.systemCode || payload.tagText || 'NEW-SYSTEM', 50).toUpperCase();
    const rows = await tx.$queryRaw`
      INSERT INTO system (platform_id, code, name, sys_type, metadata)
      VALUES (${platformId}::uuid, ${code}, ${code}, 'process'::system_type, '{"source":"ocr_staging"}'::jsonb)
      ON CONFLICT (platform_id, code) DO UPDATE
      SET deleted_at = NULL, updated_at = NOW()
      RETURNING id
    `;
    return rows[0]?.id;
  }

  return null;
}

async function setExtractionApproved(tx, extractionId, matchedEntityId, appliedBy) {
  if (!extractionId) return;
  if (matchedEntityId) {
    await tx.$executeRaw`
      UPDATE ocr_extraction
      SET status = 'approved',
          matched_entity_id = ${matchedEntityId}::uuid,
          reviewed_at = NOW(),
          reviewed_by = ${appliedBy}
      WHERE id = ${extractionId}::uuid
    `;
    return;
  }
  await tx.$executeRaw`
    UPDATE ocr_extraction
    SET status = 'approved', reviewed_at = NOW(), reviewed_by = ${appliedBy}
    WHERE id = ${extractionId}::uuid
  `;
}

async function markBatchesPassedToAnnotation(tx, batchIds) {
  if (!batchIds?.length) return { batchesMarked: 0, pnidIds: [] };
  await tx.$executeRaw`
    UPDATE ocr_batch
    SET passed_to_annotation = true,
        annotation_passed_at = NOW()
    WHERE id = ANY(${batchIds}::uuid[])
  `;
  const pnids = await tx.$queryRaw`
    SELECT DISTINCT pnid_id
    FROM ocr_batch_file
    WHERE batch_id = ANY(${batchIds}::uuid[])
      AND pnid_id IS NOT NULL
  `;
  return { batchesMarked: batchIds.length, pnidIds: pnids.map(r => r.pnid_id) };
}

/**
 * Insert staging rows from approved/edited tags in batch review files,
 * plus optional remove candidates for already-linked pnid_* rows.
 */
export async function buildRegisterStagingFromBatches(prisma, platformId, { batchIds, entityKinds }) {
  const kinds = (entityKinds?.length ? entityKinds : ALLOWED_KINDS)
    .map(k => String(k).toLowerCase())
    .filter(k => ALLOWED_KINDS.includes(k));

  if (!batchIds?.length) throw new Error('batchIds required');
  if (!kinds.length) throw new Error('No valid entityKinds');

  const batches = await prisma.$queryRaw`
    SELECT id FROM ocr_batch
    WHERE platform_id = ${platformId}::uuid
      AND id = ANY(${batchIds}::uuid[])
  `;
  if (batches.length !== batchIds.length) {
    throw new Error('One or more batches not found or wrong platform');
  }

  const syncSummary = { upserted: 0, updated: 0, skipped: 0, batches: 0 };
  for (const bid of batchIds) {
    const s = await syncBatchReviewToOcrExtractions(prisma, bid);
    syncSummary.upserted += s.upserted;
    syncSummary.updated += s.updated;
    syncSummary.skipped += s.skipped;
    syncSummary.batches += 1;
  }

  let storageProvider;
  try {
    storageProvider = await getStorageProvider(prisma, { platformId });
  } catch {
    throw new Error('Storage not configured for this platform');
  }

  let inserted = 0;
  let skippedDuplicate = 0;
  let skippedKind = 0;
  let removalCandidates = 0;

  for (const batchId of batchIds) {
    const files = await prisma.$queryRaw`
      SELECT bf.id, bf.pnid_id, bf.review_output_key, bf.drawing_number, bf.storage_key
      FROM ocr_batch_file bf
      WHERE bf.batch_id = ${batchId}::uuid
        AND bf.review_output_key IS NOT NULL
    `;

    // Auto-resolve pnid_id for files that don't have it linked yet
    for (const file of files) {
      if (!file.pnid_id && file.drawing_number) {
        const [match] = await prisma.$queryRaw`
          SELECT p.id FROM pnid p
          JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
          JOIN system s ON s.id = ps.system_id
          WHERE s.platform_id = ${platformId}::uuid
            AND p.drawing_number = ${file.drawing_number}
            AND p.deleted_at IS NULL
          LIMIT 1
        `.catch(() => []);
        if (match) {
          file.pnid_id = match.id;
          await prisma.$executeRaw`
            UPDATE ocr_batch_file SET pnid_id = ${match.id}::uuid WHERE id = ${file.id}::uuid
          `.catch(() => {});
        }
      }
      if (!file.pnid_id && file.storage_key) {
        const [match] = await prisma.$queryRaw`
          SELECT p.id FROM pnid p
          JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
          JOIN system s ON s.id = ps.system_id
          WHERE s.platform_id = ${platformId}::uuid
            AND p.storage_key = ${file.storage_key}
            AND p.deleted_at IS NULL
          LIMIT 1
        `.catch(() => []);
        if (match) {
          file.pnid_id = match.id;
          await prisma.$executeRaw`
            UPDATE ocr_batch_file SET pnid_id = ${match.id}::uuid WHERE id = ${file.id}::uuid
          `.catch(() => {});
        }
      }
      // Fallback: match by filename stem against pnid drawing_number or storage_key
      if (!file.pnid_id && (file.drawing_number || file.storage_key)) {
        const stem = (file.storage_key || '').split('/').pop()?.replace(/\.[^.]+$/, '') || file.drawing_number;
        if (stem) {
          const [match] = await prisma.$queryRaw`
            SELECT p.id FROM pnid p
            JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
            JOIN system s ON s.id = ps.system_id
            WHERE s.platform_id = ${platformId}::uuid
              AND p.deleted_at IS NULL
              AND (
                LOWER(TRIM(p.drawing_number)) = LOWER(TRIM(${stem}))
                OR p.storage_key LIKE ${'%' + stem + '%'}
              )
            LIMIT 1
          `.catch(() => []);
          if (match) {
            file.pnid_id = match.id;
            await prisma.$executeRaw`
              UPDATE ocr_batch_file SET pnid_id = ${match.id}::uuid WHERE id = ${file.id}::uuid
            `.catch(() => {});
          }
        }
      }
    }

    // Backfill pnid_id on existing staging items that were created without it
    const resolvedFiles = files.filter(f => f.pnid_id);
    if (resolvedFiles.length) {
      for (const file of resolvedFiles) {
        await prisma.$executeRaw`
          UPDATE register_staging_item
          SET pnid_id = ${file.pnid_id}::uuid, updated_at = NOW()
          WHERE batch_file_id = ${file.id}::uuid
            AND platform_id = ${platformId}::uuid
            AND pnid_id IS NULL
        `.catch(() => {});
      }
    }

    for (const file of files) {
      let reviewJson;
      try {
        const downloaded = await storageProvider.download(file.review_output_key);
        const buf = downloaded.buffer || downloaded;
        reviewJson = JSON.parse(buf.toString('utf-8'));
      } catch {
        continue;
      }

      const { approved, rejected } = collectTagsForCompare(reviewJson);
      const approvedEntityRefsByKind = { line: new Set(), equipment: new Set(), instrument: new Set(), system: new Set() };

      for (const tag of approved) {
        const entityKind = mapTagTypeToEntityKind(tag.type);
        if (!entityKind || !kinds.includes(entityKind)) {
          skippedKind++;
          continue;
        }

        const ex = await resolveExtraction(prisma, file.pnid_id, tag);
        let matchedEntityId = ex?.matched_entity_id || null;
        if (!matchedEntityId) {
          matchedEntityId = await resolveEntityByTagText(prisma, platformId, entityKind, tag._finalText || tag.text);
          if (matchedEntityId && ex?.id) {
            await prisma.$executeRaw`
              UPDATE ocr_extraction
              SET matched_entity_id = ${matchedEntityId}::uuid,
                  match_method = 'staging_text_compare'
              WHERE id = ${ex.id}::uuid
            `;
          }
        }

        const actionType = matchedEntityId ? 'link_pnid' : 'create_entity';
        if (matchedEntityId) approvedEntityRefsByKind[entityKind].add(String(matchedEntityId));

        const payload = {
          tagText: normText(tag._finalText || tag.text),
          originalText: normText(tag.originalText || tag._originalText),
          tagType: tag.type,
          confidence: tag.confidence,
          reviewAction: tag._reviewAction,
          drawingNumber: file.drawing_number,
          position_pct: tag.position_pct || bboxFromPayload(tag),
        };
        const key = dedupeKey(batchId, file.id, entityKind, actionType, payload.tagText, matchedEntityId);

        const ins = await prisma.$queryRaw`
          INSERT INTO register_staging_item (
            platform_id, batch_id, batch_file_id, pnid_id, entity_kind, action_type,
            extraction_id, matched_entity_id, payload, status, dedupe_key
          ) VALUES (
            ${platformId}::uuid,
            ${batchId}::uuid,
            ${file.id}::uuid,
            ${file.pnid_id}::uuid,
            ${entityKind},
            ${actionType},
            ${ex?.id || null}::uuid,
            ${matchedEntityId}::uuid,
            ${JSON.stringify(payload)}::jsonb,
            'pending',
            ${key}
          )
          ON CONFLICT (dedupe_key) DO NOTHING
          RETURNING id
        `;
        if (ins.length) inserted++;
        else skippedDuplicate++;
      }

      for (const tag of rejected) {
        const entityKind = mapTagTypeToEntityKind(tag.type);
        if (!entityKind || !kinds.includes(entityKind)) continue;
        const ex = await resolveExtraction(prisma, file.pnid_id, tag);
        const matchedEntityId = ex?.matched_entity_id || null;
        if (!matchedEntityId) continue;
        const payload = {
          tagText: normText(tag._finalText || tag.text),
          tagType: tag.type,
          reviewAction: 'rejected',
          reason: 'review_rejected',
          drawingNumber: file.drawing_number,
        };
        const key = dedupeKey(batchId, file.id, entityKind, 'unlink_pnid', payload.tagText, matchedEntityId);
        const ins = await prisma.$queryRaw`
          INSERT INTO register_staging_item (
            platform_id, batch_id, batch_file_id, pnid_id, entity_kind, action_type,
            extraction_id, matched_entity_id, payload, status, dedupe_key
          ) VALUES (
            ${platformId}::uuid,
            ${batchId}::uuid,
            ${file.id}::uuid,
            ${file.pnid_id}::uuid,
            ${entityKind},
            'unlink_pnid',
            ${ex?.id || null}::uuid,
            ${matchedEntityId}::uuid,
            ${JSON.stringify(payload)}::jsonb,
            'pending',
            ${key}
          )
          ON CONFLICT (dedupe_key) DO NOTHING
          RETURNING id
        `;
        if (ins.length) removalCandidates++;
      }

      for (const kind of kinds.filter(k => LINK_KINDS.includes(k))) {
        let linkedRows = [];
        if (kind === 'line') {
          linkedRows = await prisma.$queryRaw`
            SELECT line_id AS entity_id FROM pnid_line WHERE pnid_id = ${file.pnid_id}::uuid
          `;
        } else if (kind === 'equipment') {
          linkedRows = await prisma.$queryRaw`
            SELECT equipment_id AS entity_id FROM pnid_equipment WHERE pnid_id = ${file.pnid_id}::uuid
          `;
        } else if (kind === 'instrument') {
          linkedRows = await prisma.$queryRaw`
            SELECT instrument_id AS entity_id FROM pnid_instrument WHERE pnid_id = ${file.pnid_id}::uuid
          `;
        }
        for (const row of linkedRows) {
          const id = String(row.entity_id);
          if (approvedEntityRefsByKind[kind].has(id)) continue;
          const key = dedupeKey(batchId, file.id, kind, 'unlink_pnid', 'missing_in_approved_set', id);
          const payload = {
            reviewAction: 'candidate_remove',
            reason: 'missing_in_approved_set',
            drawingNumber: file.drawing_number,
          };
          const ins = await prisma.$queryRaw`
            INSERT INTO register_staging_item (
              platform_id, batch_id, batch_file_id, pnid_id, entity_kind, action_type,
              extraction_id, matched_entity_id, payload, status, dedupe_key
            ) VALUES (
              ${platformId}::uuid,
              ${batchId}::uuid,
              ${file.id}::uuid,
              ${file.pnid_id}::uuid,
              ${kind},
              'unlink_pnid',
              NULL::uuid,
              ${id}::uuid,
              ${JSON.stringify(payload)}::jsonb,
              'pending',
              ${key}
            )
            ON CONFLICT (dedupe_key) DO NOTHING
            RETURNING id
          `;
          if (ins.length) removalCandidates++;
        }
      }
    }
  }

  return {
    inserted,
    skippedDuplicate,
    skippedKind,
    removalCandidates,
    entityKinds: kinds,
    batchCount: batchIds.length,
    reviewSync: syncSummary,
  };
}

export async function listRegisterStagingItems(prisma, platformId, { status, batchId, entityKind, limit = 2000 }) {
  const lim = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
  const parts = [Prisma.sql`rsi.platform_id = ${platformId}::uuid`];
  if (status) parts.push(Prisma.sql`rsi.status = ${status}`);
  if (batchId) parts.push(Prisma.sql`rsi.batch_id = ${batchId}::uuid`);
  if (entityKind) parts.push(Prisma.sql`rsi.entity_kind = ${entityKind}`);
  const whereSql = Prisma.join(parts, ' AND ');

  const items = await prisma.$queryRaw`
    SELECT rsi.id, rsi.batch_id, rsi.batch_file_id, rsi.pnid_id, rsi.entity_kind, rsi.action_type,
           rsi.extraction_id, rsi.matched_entity_id, rsi.payload, rsi.status, rsi.dedupe_key,
           rsi.created_at, rsi.applied_at, rsi.apply_run_id,
           ob.batch_name,
           COALESCE(l.line_number, e.tag, i.tag) AS matched_entity_tag
    FROM register_staging_item rsi
    JOIN ocr_batch ob ON ob.id = rsi.batch_id
    LEFT JOIN line l ON rsi.entity_kind = 'line' AND l.id = rsi.matched_entity_id
    LEFT JOIN equipment e ON rsi.entity_kind = 'equipment' AND e.id = rsi.matched_entity_id
    LEFT JOIN instrument i ON rsi.entity_kind = 'instrument' AND i.id = rsi.matched_entity_id
    WHERE ${whereSql}
    ORDER BY rsi.created_at DESC
    LIMIT ${lim}
  `;

  const counts = await prisma.$queryRaw`
    SELECT status, entity_kind, action_type, COUNT(*)::int AS c
    FROM register_staging_item
    WHERE platform_id = ${platformId}::uuid
    GROUP BY status, entity_kind, action_type
  `;

  return { items, counts };
}

export async function cancelRegisterStagingItems(prisma, platformId, stagingItemIds) {
  if (!stagingItemIds?.length) return { cancelled: 0 };
  const rows = await prisma.$queryRaw`
    UPDATE register_staging_item
    SET status = 'cancelled', updated_at = NOW()
    WHERE platform_id = ${platformId}::uuid
      AND id = ANY(${stagingItemIds}::uuid[])
      AND status = 'pending'
    RETURNING id
  `;
  return { cancelled: rows.length };
}

/**
 * Apply pending staging actions:
 * - link_pnid
 * - create_entity (create in register, then link)
 * - unlink_pnid
 *
 * Optional: pass involved batches to annotation module.
 */
export async function applyRegisterStaging(prisma, platformId, {
  stagingItemIds,
  applyAllPending,
  entityKinds,
  appliedBy = 'user',
  passToAnnotation = false,
}) {
  const kinds = entityKinds?.length
    ? entityKinds.map(k => String(k).toLowerCase()).filter(k => ALLOWED_KINDS.includes(k))
    : ALLOWED_KINDS;

  let ids = stagingItemIds;
  if (applyAllPending) {
    const rows = await prisma.$queryRaw`
      SELECT id FROM register_staging_item
      WHERE platform_id = ${platformId}::uuid
        AND status = 'pending'
        AND action_type IN ('link_pnid','create_entity','unlink_pnid')
        AND entity_kind = ANY(${kinds}::text[])
    `;
    ids = rows.map(r => r.id);
  }

  if (!ids?.length) {
    return { runId: null, applied: 0, skipped: 0, batch_ids: [], errors: [], message: 'No items to apply' };
  }

  const items = await prisma.$queryRaw`
    SELECT * FROM register_staging_item
    WHERE platform_id = ${platformId}::uuid
      AND id = ANY(${ids}::uuid[])
      AND status = 'pending'
      AND action_type IN ('link_pnid','create_entity','unlink_pnid')
  `;
  if (!items.length) {
    return { runId: null, applied: 0, skipped: 0, batch_ids: [], errors: [], message: 'No eligible pending actions' };
  }

  // Create the apply run record first
  const runRows = await prisma.$queryRaw`
    INSERT INTO register_apply_run (platform_id, batch_ids, applied_by, summary)
    VALUES (${platformId}::uuid, ARRAY[]::uuid[], ${appliedBy}, '{}'::jsonb)
    RETURNING id
  `;
  const runId = runRows[0]?.id;
  if (!runId) throw new Error('Failed to create apply run');

  const batchIdSet = new Set();
  let applied = 0;
  let skipped = 0;
  const errors = [];

  // ── Pre-resolve: backfill pnid_id from batch files & build tag→position map ──
  // This integrates the repair-links logic so coordinates are written in one step.
  const batchIdsForResolve = [...new Set(items.map(i => i.batch_id))];

  // Resolve pnid_id on batch files that don't have it
  for (const bid of batchIdsForResolve) {
    const unresolved = await prisma.$queryRaw`
      SELECT bf.id, bf.drawing_number, bf.storage_key, bf.pnid_id
      FROM ocr_batch_file bf
      WHERE bf.batch_id = ${bid}::uuid AND bf.pnid_id IS NULL
    `.catch(() => []);
    for (const bf of unresolved) {
      let pnidId = null;
      if (bf.drawing_number) {
        const [m] = await prisma.$queryRaw`
          SELECT p.id FROM pnid p
          WHERE p.deleted_at IS NULL
            AND LOWER(TRIM(p.drawing_number)) = LOWER(TRIM(${bf.drawing_number}))
          LIMIT 1
        `.catch(() => []);
        if (m) pnidId = m.id;
      }
      if (!pnidId && bf.storage_key) {
        const stem = bf.storage_key.split('/').pop()?.replace(/\.[^.]+$/, '');
        if (stem) {
          const [m] = await prisma.$queryRaw`
            SELECT p.id FROM pnid p
            WHERE p.deleted_at IS NULL
              AND (LOWER(TRIM(p.drawing_number)) = LOWER(TRIM(${stem})) OR p.storage_key LIKE ${'%' + stem + '%'})
            LIMIT 1
          `.catch(() => []);
          if (m) pnidId = m.id;
        }
      }
      if (pnidId) {
        await prisma.$executeRaw`UPDATE ocr_batch_file SET pnid_id = ${pnidId}::uuid WHERE id = ${bf.id}::uuid`.catch(() => {});
      }
    }
    // Backfill pnid_id on staging items from resolved batch files
    await prisma.$executeRaw`
      UPDATE register_staging_item rsi
      SET pnid_id = bf.pnid_id, updated_at = NOW()
      FROM ocr_batch_file bf
      WHERE rsi.batch_file_id = bf.id AND rsi.batch_id = ${bid}::uuid
        AND rsi.platform_id = ${platformId}::uuid
        AND rsi.pnid_id IS NULL AND bf.pnid_id IS NOT NULL
    `.catch(() => {});
  }

  // Re-fetch items to pick up resolved pnid_ids
  const refreshedItems = await prisma.$queryRaw`
    SELECT * FROM register_staging_item
    WHERE platform_id = ${platformId}::uuid
      AND id = ANY(${items.map(i => i.id)}::uuid[])
      AND status = 'pending'
  `;
  const itemMap = new Map(refreshedItems.map(i => [i.id, i]));

  // Build tag→position map from review JSONs for best-quality coordinates
  const tagPositionMap = new Map();
  let storageProvider;
  try { storageProvider = await getStorageProvider(prisma, { platformId }); } catch { storageProvider = null; }
  if (storageProvider) {
    const reviewFiles = await prisma.$queryRaw`
      SELECT bf.pnid_id, bf.review_output_key
      FROM ocr_batch_file bf
      WHERE bf.batch_id = ANY(${batchIdsForResolve}::uuid[])
        AND bf.review_output_key IS NOT NULL AND bf.pnid_id IS NOT NULL
    `.catch(() => []);
    for (const rf of reviewFiles) {
      try {
        const downloaded = await storageProvider.download(rf.review_output_key);
        const buf = downloaded.buffer || downloaded;
        const reviewJson = JSON.parse(buf.toString('utf-8'));
        for (const tag of [...(reviewJson.approved || []), ...(reviewJson.edited || [])]) {
          const pos = tag.position_pct || tag.positionPct;
          if (!pos || typeof pos !== 'object') continue;
          const x = Number(pos.x_pct ?? pos.xPct ?? 0);
          const y = Number(pos.y_pct ?? pos.yPct ?? 0);
          if (x === 0 && y === 0) continue;
          const text = (tag.text || '').trim().toLowerCase();
          if (!text) continue;
          const key = `${text}::${rf.pnid_id}`;
          if (!tagPositionMap.has(key)) {
            tagPositionMap.set(key, {
              x_pct: x, y_pct: y,
              w_pct: Number(pos.w_pct ?? pos.wPct ?? 0),
              h_pct: Number(pos.h_pct ?? pos.hPct ?? 0),
            });
          }
        }
      } catch { /* skip unreadable */ }
    }
  }

  // Ensure pnid_system entries exist for entities being linked
  const systemPnidPairs = new Set();
  for (const item of refreshedItems) {
    if (!item.pnid_id || !item.matched_entity_id || item.action_type === 'unlink_pnid') continue;
    let sysId = null;
    const kind = item.entity_kind;
    if (kind === 'line') {
      const [r] = await prisma.$queryRaw`SELECT system_id FROM line WHERE id = ${item.matched_entity_id}::uuid`.catch(() => []);
      sysId = r?.system_id;
    } else if (kind === 'equipment') {
      const [r] = await prisma.$queryRaw`SELECT system_id FROM equipment WHERE id = ${item.matched_entity_id}::uuid`.catch(() => []);
      sysId = r?.system_id;
    } else if (kind === 'instrument') {
      const [r] = await prisma.$queryRaw`SELECT system_id FROM instrument WHERE id = ${item.matched_entity_id}::uuid`.catch(() => []);
      sysId = r?.system_id;
    }
    if (sysId) systemPnidPairs.add(`${sysId}::${item.pnid_id}`);
  }
  for (const pair of systemPnidPairs) {
    const [sysId, pnidId] = pair.split('::');
    await prisma.$queryRaw`
      INSERT INTO pnid_system (pnid_id, system_id, is_primary)
      VALUES (${pnidId}::uuid, ${sysId}::uuid, false)
      ON CONFLICT (pnid_id, system_id) DO NOTHING
    `.catch(() => {});
  }

  // Process each item in its own transaction to prevent one failure from aborting everything
  for (const origItem of items) {
    const item = itemMap.get(origItem.id) || origItem; // use refreshed version
    batchIdSet.add(item.batch_id);
    try {
      // link_pnid and unlink_pnid require pnid_id; create_entity can work without it
      if (!item.pnid_id && item.action_type !== 'create_entity') {
        skipped++;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        let targetEntityId = item.matched_entity_id;
        const payload = item.payload || {};

        // Enhanced coordinate resolution: review JSON > extraction bbox > payload
        const tagText = (payload.tagText || payload.tag_text || '').trim().toLowerCase();
        let bbox = null;
        // 1. Best source: review JSON positions
        if (item.pnid_id && tagText) {
          bbox = tagPositionMap.get(`${tagText}::${item.pnid_id}`) || null;
        }
        // 2. Fallback: ocr_extraction bbox
        if ((!bbox || (bbox.x_pct === 0 && bbox.y_pct === 0)) && item.extraction_id) {
          const [ex] = await tx.$queryRaw`
            SELECT bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
            FROM ocr_extraction WHERE id = ${item.extraction_id}::uuid
          `;
          if (ex && (Number(ex.bbox_x_pct) > 0 || Number(ex.bbox_y_pct) > 0)) {
            bbox = bboxFromExtraction(ex);
          }
        }
        // 3. Fallback: text match in ocr_extraction
        if ((!bbox || (bbox.x_pct === 0 && bbox.y_pct === 0)) && item.pnid_id && tagText) {
          const [ex] = await tx.$queryRaw`
            SELECT bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
            FROM ocr_extraction
            WHERE pnid_id = ${item.pnid_id}::uuid
              AND LOWER(TRIM(extracted_text)) = ${tagText}
              AND bbox_x_pct > 0
            LIMIT 1
          `.catch(() => []);
          if (ex) bbox = bboxFromExtraction(ex);
        }
        // 4. Final fallback: staging payload position_pct
        if (!bbox || (bbox.x_pct === 0 && bbox.y_pct === 0)) {
          bbox = bboxFromPayload(payload);
        }

        if (item.action_type === 'create_entity') {
          targetEntityId = await createEntityFromPayload(tx, platformId, item.pnid_id, item.entity_kind, payload);
          if (!targetEntityId) throw new Error('Failed to create entity');
          if (item.pnid_id) {
            await upsertPnidLink(tx, {
              pnidId: item.pnid_id,
              entityKind: item.entity_kind,
              matchedEntityId: targetEntityId,
              bbox,
            });
          }
          await setExtractionApproved(tx, item.extraction_id, targetEntityId, appliedBy);
        } else if (item.action_type === 'link_pnid') {
          if (!targetEntityId) throw new Error('link_pnid missing matched_entity_id');
          // Verify entity still exists before linking (avoid FK violations on stale refs)
          let entityExists = false;
          if (item.entity_kind === 'line') {
            const [r] = await tx.$queryRaw`SELECT id FROM line WHERE id = ${targetEntityId}::uuid AND deleted_at IS NULL`;
            entityExists = !!r;
          } else if (item.entity_kind === 'equipment') {
            const [r] = await tx.$queryRaw`SELECT id FROM equipment WHERE id = ${targetEntityId}::uuid AND deleted_at IS NULL`;
            entityExists = !!r;
          } else if (item.entity_kind === 'instrument') {
            const [r] = await tx.$queryRaw`SELECT id FROM instrument WHERE id = ${targetEntityId}::uuid AND deleted_at IS NULL`;
            entityExists = !!r;
          } else { entityExists = true; }
          if (!entityExists) throw new Error(`${item.entity_kind} ${targetEntityId} no longer exists in register`);
          await upsertPnidLink(tx, {
            pnidId: item.pnid_id,
            entityKind: item.entity_kind,
            matchedEntityId: targetEntityId,
            bbox,
          });
          await setExtractionApproved(tx, item.extraction_id, targetEntityId, appliedBy);
        } else if (item.action_type === 'unlink_pnid') {
          if (!targetEntityId) throw new Error('unlink_pnid missing matched_entity_id');
          await unlinkPnidLink(tx, {
            pnidId: item.pnid_id,
            entityKind: item.entity_kind,
            entityId: targetEntityId,
          });
          if (item.extraction_id) {
            await tx.$executeRaw`
              UPDATE ocr_extraction
              SET status = 'rejected', reviewed_at = NOW(), reviewed_by = ${appliedBy}
              WHERE id = ${item.extraction_id}::uuid
            `;
          }
        }

        await tx.$executeRaw`
          UPDATE register_staging_item
          SET status = 'applied', applied_at = NOW(), updated_at = NOW(), apply_run_id = ${runId}::uuid
          WHERE id = ${item.id}::uuid
        `;
      }); // end per-item transaction

      applied++;
    } catch (err) {
      errors.push({ id: item.id, actionType: item.action_type, entityKind: item.entity_kind, error: err.message });
      skipped++;
    }
  }

  const batch_ids = [...batchIdSet];
  let annotationPass = { batchesMarked: 0, pnidIds: [] };
  if (passToAnnotation && batch_ids.length) {
    annotationPass = await markBatchesPassedToAnnotation(prisma, batch_ids);
  }

  // Compute entity-level and P&ID-level annotation summary
  const appliedSummary = { lines: 0, equipment: 0, instruments: 0, pnidIds: [] };
  try {
    const summaryRows = await prisma.$queryRaw`
      SELECT entity_kind, COUNT(*)::int AS c,
             array_agg(DISTINCT pnid_id) FILTER (WHERE pnid_id IS NOT NULL) AS pnid_ids
      FROM register_staging_item
      WHERE apply_run_id = ${runId}::uuid AND status = 'applied'
      GROUP BY entity_kind
    `;
    const pnidSet = new Set();
    for (const r of summaryRows) {
      if (r.entity_kind === 'line') appliedSummary.lines = r.c;
      else if (r.entity_kind === 'equipment') appliedSummary.equipment = r.c;
      else if (r.entity_kind === 'instrument') appliedSummary.instruments = r.c;
      (r.pnid_ids || []).forEach(id => pnidSet.add(id));
    }
    appliedSummary.pnidIds = [...pnidSet];
  } catch { /* non-critical */ }

  await prisma.$executeRaw`
    UPDATE register_apply_run
    SET batch_ids = ${batch_ids}::uuid[],
        summary = ${JSON.stringify({
          applied,
          skipped,
          errorCount: errors.length,
          passToAnnotation,
          annotationBatchesMarked: annotationPass.batchesMarked,
          ...appliedSummary,
        })}::jsonb
    WHERE id = ${runId}::uuid
  `;

  const txResult = {
    runId, applied, skipped, batch_ids, errors, passToAnnotation, annotationPass,
    appliedSummary,
    coordinatesFromReview: tagPositionMap.size,
  };

  // IMPORTANT: Do NOT auto-create annotation geometry during register apply.
  // This step only stages/registers entities + pnid junction linkage.
  // Annotation Workspace owns manual linking/drafting and approval lifecycle.

  return txResult;
}
