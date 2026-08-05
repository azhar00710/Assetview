/**
 * Persist human-approved OCR tags from Stage 3 review JSON into ocr_extraction
 * with geometry from the classified/review payload (position_pct / boundingBox).
 *
 * Register matches (matched_entity_id) are preserved on update when already set;
 * coordinates always come from OCR/review — never from the line/equipment list alone.
 */

import { getStorageProvider } from '../storage/index.js';

function normText(s) {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

function truncate200(s) {
  const t = normText(s);
  return t.length > 200 ? t.slice(0, 200) : t;
}

/**
 * DB allows: equipment | instrument | line | unknown
 * Stage-2/Review can emit richer classes (e.g. DRAIN_HEADER) that are still line tags.
 */
function normalizeTagTypeForDb(type, text, subType) {
  const t = String(type || '').toLowerCase();
  const st = String(subType || '').toLowerCase();
  const tagText = String(text || '').trim().toUpperCase();

  if (t === 'equipment' || t === 'instrument' || t === 'line') return t;

  // Treat line subclasses as line (headers/spools/segments)
  if (
    t.includes('line') ||
    t.includes('header') ||
    st.includes('line') ||
    st.includes('header') ||
    t === 'drain_header' ||
    t === 'vent_header' ||
    t === 'process_header'
  ) return 'line';

  // Heuristic fallback: common line-number pattern like 2"-DH-28-31-0311-B06S-N
  if (/^\d+(\.\d+)?["']?-[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(tagText)) return 'line';

  return 'unknown';
}

/**
 * The original AI-assigned class (including subType refinements) so
 * reviewers can see what the pipeline actually thought the tag was,
 * even when tag_type is clamped to 'unknown' by the CHECK constraint.
 * Truncated to 40 chars to match the ai_tag_type column.
 */
function extractAiTagType(type, subType) {
  const t = String(type || '').trim().toLowerCase();
  const st = String(subType || '').trim().toLowerCase();
  const composed = st && st !== t ? `${t}:${st}` : t;
  if (!composed) return null;
  return composed.length > 40 ? composed.slice(0, 40) : composed;
}

/**
 * Bbox % from Stage 2 tag (position_pct) or pixel box + page size.
 */
function bboxPctFromTag(tag) {
  const p = tag.position_pct || tag.positionPct;
  if (p && (p.x_pct != null || p.xPct != null)) {
    return {
      x: Number(p.x_pct ?? p.xPct ?? 0),
      y: Number(p.y_pct ?? p.yPct ?? 0),
      w: Number(p.w_pct ?? p.wPct ?? 0),
      h: Number(p.h_pct ?? p.hPct ?? 0),
    };
  }
  const bb = tag.boundingBox;
  const pageW = tag.pageWidth || tag.page_width || tag._pageW;
  const pageH = tag.pageHeight || tag.page_height || tag._pageH;
  if (bb && pageW && pageH && bb.minX != null) {
    return {
      x: +((bb.minX / pageW) * 100).toFixed(2),
      y: +((bb.minY / pageH) * 100).toFixed(2),
      w: +(((bb.maxX - bb.minX) / pageW) * 100).toFixed(2),
      h: +(((bb.maxY - bb.minY) / pageH) * 100).toFixed(2),
    };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function hasMeaningfulPctBox(box = {}) {
  const x = Number(box.x);
  const y = Number(box.y);
  const w = Number(box.w);
  const h = Number(box.h);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return false;
  if (w <= 0 || h <= 0) return false;
  if (x === 0 && y === 0 && w === 0 && h === 0) return false;
  return true;
}

function geometryScore(a = {}, b = {}) {
  return Math.abs(Number(a.x) - Number(b.x))
    + Math.abs(Number(a.y) - Number(b.y))
    + Math.abs(Number(a.w) - Number(b.w))
    + Math.abs(Number(a.h) - Number(b.h));
}

function pickExistingByGeometry(rows = [], targetBox = {}, { allowTextFallback = true } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (!hasMeaningfulPctBox(targetBox)) return allowTextFallback ? rows[0] : null;

  const candidates = rows
    .map((row) => ({
      row,
      box: {
        x: Number(row.bbox_x_pct || 0),
        y: Number(row.bbox_y_pct || 0),
        w: Number(row.bbox_w_pct || 0),
        h: Number(row.bbox_h_pct || 0),
      },
    }))
    .filter((item) => hasMeaningfulPctBox(item.box))
    .map((item) => ({
      row: item.row,
      score: geometryScore(targetBox, item.box),
    }))
    .sort((a, b) => a.score - b.score);

  // 8 pct-points total delta is a conservative tolerance across x/y/w/h fields.
  if (candidates.length > 0 && candidates[0].score <= 8) return candidates[0].row;
  return allowTextFallback ? rows[0] : null;
}

function collectApprovedTags(reviewJson) {
  const out = [];
  for (const t of reviewJson.approved || []) {
    out.push({ ...t, _finalText: normText(t.text), _reviewAction: 'approved' });
  }
  for (const t of reviewJson.edited || []) {
    out.push({
      ...t,
      _finalText: normText(t.text),
      _reviewAction: 'edited',
      _originalText: normText(t.originalText ?? t.text),
    });
  }
  return out;
}

/**
 * Collect rejected tags for audit persistence.
 * These get written as status='rejected' so reviewers can see what was
 * discarded without losing the geometry/evidence.
 */
function collectRejectedTags(reviewJson) {
  const out = [];
  for (const t of reviewJson.rejected || []) {
    const reason = t.reviewNotes
      || (t.automationDecision === 'auto_reject'
          ? `auto_reject: confidence ${((Number(t.confidence) || 0) * 100).toFixed(0)}%`
          : 'reviewer_rejected');
    out.push({
      ...t,
      _finalText: normText(t.text),
      _reviewAction: 'rejected',
      _rejectionReason: truncate255(reason),
    });
  }
  return out;
}

function truncate255(s) {
  const t = normText(s);
  return t.length > 255 ? t.slice(0, 255) : t;
}

/**
 * Upsert ocr_extraction rows from saved review files for one batch.
 * @returns {{ upserted: number, updated: number, skipped: number }}
 */
export async function syncBatchReviewToOcrExtractions(prisma, batchId) {
  const [batch] = await prisma.$queryRaw`
    SELECT id, platform_id FROM ocr_batch WHERE id = ${batchId}::uuid
  `;
  if (!batch) throw new Error('Batch not found');

  let storageProvider;
  try {
    storageProvider = await getStorageProvider(prisma, { platformId: batch.platform_id });
  } catch {
    throw new Error('Storage not configured');
  }

  const files = await prisma.$queryRaw`
    SELECT bf.id,
           COALESCE(bf.pnid_id, p.id) AS pnid_id,
           bf.review_output_key,
           (bf.pnid_id IS NULL AND p.id IS NOT NULL) AS needs_backfill
    FROM ocr_batch_file bf
    LEFT JOIN pnid p ON p.storage_key = bf.storage_key AND p.deleted_at IS NULL
    WHERE bf.batch_id = ${batchId}::uuid
      AND bf.review_output_key IS NOT NULL
      AND (bf.pnid_id IS NOT NULL OR p.id IS NOT NULL)
  `;

  let upserted = 0;
  let updated = 0;
  let skipped = 0;
  let pnidLinked = 0;
  let rejectedUpserted = 0;
  let rejectedUpdated = 0;

  for (const file of files) {
    // Backfill pnid_id on the batch file if it was resolved via storage_key JOIN
    if (file.needs_backfill && file.pnid_id) {
      await prisma.$executeRaw`
        UPDATE ocr_batch_file SET pnid_id = ${file.pnid_id}::uuid WHERE id = ${file.id}::uuid
      `;
      pnidLinked++;
    }
    let reviewJson;
    try {
      const downloaded = await storageProvider.download(file.review_output_key);
      const buf = downloaded.buffer || downloaded;
      reviewJson = JSON.parse(buf.toString('utf-8'));
    } catch {
      skipped++;
      continue;
    }

    const tags = collectApprovedTags(reviewJson);
    for (const tag of tags) {
      const extractedText = truncate200(tag._finalText);
      if (!extractedText) {
        skipped++;
        continue;
      }

      const tagType = normalizeTagTypeForDb(tag.type, extractedText, tag.subType || tag.correctedSubType);
      const aiTagType = extractAiTagType(tag.type, tag.subType || tag.correctedSubType);
      const conf = tag.confidence != null ? Number(tag.confidence) : 0.85;
      const { x, y, w, h } = bboxPctFromTag(tag);
      if (!hasMeaningfulPctBox({ x, y, w, h })) {
        // Preserve quality: don't upsert approved rows with missing/zero geometry.
        skipped++;
        continue;
      }

      const existingRows = await prisma.$queryRaw`
        SELECT id, matched_entity_id, status,
               bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
        FROM ocr_extraction
        WHERE pnid_id = ${file.pnid_id}::uuid
          AND LOWER(TRIM(extracted_text)) = LOWER(TRIM(${extractedText}))
        ORDER BY created_at ASC
      `;
      const existing = pickExistingByGeometry(existingRows, { x, y, w, h }, { allowTextFallback: false });

      if (existing) {
        await prisma.$executeRaw`
          UPDATE ocr_extraction SET
            tag_type = ${tagType},
            ai_tag_type = COALESCE(${aiTagType}, ai_tag_type),
            confidence = ${conf},
            bbox_x_pct = ${x},
            bbox_y_pct = ${y},
            bbox_w_pct = ${w},
            bbox_h_pct = ${h},
            status = 'approved',
            rejection_reason = NULL,
            reviewed_at = NOW(),
            reviewed_by = 'review_sync'
          WHERE id = ${existing.id}::uuid
        `;
        updated++;
      } else {
        await prisma.$executeRaw`
          INSERT INTO ocr_extraction (
            pnid_id, extracted_text, tag_type, ai_tag_type, confidence,
            bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct,
            status, reviewed_at, reviewed_by
          ) VALUES (
            ${file.pnid_id}::uuid,
            ${extractedText},
            ${tagType},
            ${aiTagType},
            ${conf},
            ${x}, ${y}, ${w}, ${h},
            'approved',
            NOW(),
            'review_sync'
          )
        `;
        upserted++;
      }
    }

    // Persist rejected tags for audit trail (status='rejected' + reason).
    const rejectedTags = collectRejectedTags(reviewJson);
    for (const tag of rejectedTags) {
      const extractedText = truncate200(tag._finalText);
      if (!extractedText) {
        skipped++;
        continue;
      }

      const tagType = normalizeTagTypeForDb(tag.type, extractedText, tag.subType || tag.correctedSubType);
      const aiTagType = extractAiTagType(tag.type, tag.subType || tag.correctedSubType);
      const conf = tag.confidence != null ? Number(tag.confidence) : 0;
      const { x, y, w, h } = bboxPctFromTag(tag);
      const reason = tag._rejectionReason || 'reviewer_rejected';

      const existingRows = await prisma.$queryRaw`
        SELECT id, status, bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
        FROM ocr_extraction
        WHERE pnid_id = ${file.pnid_id}::uuid
          AND LOWER(TRIM(extracted_text)) = LOWER(TRIM(${extractedText}))
        ORDER BY created_at ASC
      `;
      const existing = pickExistingByGeometry(existingRows, { x, y, w, h }, { allowTextFallback: true });

      if (existing) {
        // Don't downgrade an already-approved extraction to rejected — the
        // approved pass above runs first, so if a tag appears in both lists
        // (edit→approve of a tag previously rejected), approve wins.
        await prisma.$executeRaw`
          UPDATE ocr_extraction SET
            tag_type = ${tagType},
            ai_tag_type = COALESCE(${aiTagType}, ai_tag_type),
            confidence = ${conf},
            bbox_x_pct = ${x},
            bbox_y_pct = ${y},
            bbox_w_pct = ${w},
            bbox_h_pct = ${h},
            status = 'rejected',
            rejection_reason = ${reason},
            reviewed_at = NOW(),
            reviewed_by = 'review_sync'
          WHERE id = ${existing.id}::uuid
            AND status <> 'approved'
        `;
        rejectedUpdated++;
      } else {
        await prisma.$executeRaw`
          INSERT INTO ocr_extraction (
            pnid_id, extracted_text, tag_type, ai_tag_type, confidence,
            bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct,
            status, rejection_reason, reviewed_at, reviewed_by
          ) VALUES (
            ${file.pnid_id}::uuid,
            ${extractedText},
            ${tagType},
            ${aiTagType},
            ${conf},
            ${x}, ${y}, ${w}, ${h},
            'rejected',
            ${reason},
            NOW(),
            'review_sync'
          )
        `;
        rejectedUpserted++;
      }
    }
  }

  return {
    upserted,
    updated,
    skipped,
    filesScanned: files.length,
    pnidLinked,
    rejectedUpserted,
    rejectedUpdated,
  };
}
