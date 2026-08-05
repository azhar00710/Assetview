/**
 * Detection Knowledge Service
 *
 * Records accept/reject feedback from batch detection runs, computes
 * auto-thresholds, manages detection profiles with cached embeddings,
 * and identifies exclusion zones from rejected clusters.
 *
 * Follows the same patterns as OcrKnowledgeService.js.
 */

/**
 * Record accept/reject decisions from a batch detection run.
 */
export async function recordDetectionFeedback(prisma, { platformId, batchId, pnidId, category, decisions = [] }) {
  if (!decisions.length) return { inserted: 0 };
  let inserted = 0;

  for (const d of decisions) {
    const action = d.accepted ? 'accept' : 'reject';
    try {
      await prisma.$executeRaw`
        INSERT INTO ai_detection_feedback (
          platform_id, batch_id, pnid_id, category, action,
          tag_text, entity_type, confidence,
          bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
        ) VALUES (
          ${platformId}::uuid, ${batchId}::uuid, ${pnidId}::uuid, ${category},
          ${action}, ${d.tagText || null}, ${d.entityType || null}, ${d.confidence || 0},
          ${d.bboxXPct || 0}, ${d.bboxYPct || 0}, ${d.bboxWPct || 0}, ${d.bboxHPct || 0}
        )
      `;
      inserted++;
    } catch {
      // best-effort logging
    }
  }
  return { inserted };
}

/**
 * Compute an auto-tuned threshold for a platform+category based on
 * accumulated accept/reject feedback. Finds the confidence level where
 * the accept rate exceeds 85%.
 */
export async function computeAutoThreshold(prisma, platformId, category) {
  try {
    // Bucket feedback by confidence bands (0.1 increments)
    const rows = await prisma.$queryRaw`
      SELECT
        FLOOR(confidence * 10) / 10 AS band,
        COUNT(*) FILTER (WHERE action = 'accept') AS accepts,
        COUNT(*) FILTER (WHERE action = 'reject') AS rejects,
        COUNT(*) AS total
      FROM ai_detection_feedback
      WHERE platform_id = ${platformId}::uuid
        AND category = ${category}
      GROUP BY band
      ORDER BY band DESC
    `;

    if (!rows?.length) return null;

    // Find lowest band with accept rate >= 85%
    let bestThreshold = null;
    for (const r of rows) {
      const acceptRate = Number(r.total) > 0 ? Number(r.accepts) / Number(r.total) : 0;
      if (acceptRate >= 0.85 && Number(r.total) >= 3) {
        bestThreshold = Number(r.band);
      }
    }
    return bestThreshold;
  } catch {
    return null;
  }
}

/**
 * Update a detection profile's auto_threshold and accept/reject counts.
 */
export async function updateProfileStats(prisma, platformId, category) {
  const threshold = await computeAutoThreshold(prisma, platformId, category);

  try {
    const countRows = await prisma.$queryRaw`
      SELECT
        COUNT(*) FILTER (WHERE action = 'accept') AS total_accepted,
        COUNT(*) FILTER (WHERE action = 'reject') AS total_rejected
      FROM ai_detection_feedback
      WHERE platform_id = ${platformId}::uuid AND category = ${category}
    `;
    const counts = countRows?.[0] || { total_accepted: 0, total_rejected: 0 };

    await prisma.$executeRaw`
      UPDATE ai_detection_profile
      SET auto_threshold = ${threshold},
          total_accepted = ${Number(counts.total_accepted)},
          total_rejected = ${Number(counts.total_rejected)},
          updated_at = NOW()
      WHERE platform_id = ${platformId}::uuid AND category = ${category} AND is_active = true
    `;
  } catch {
    // best effort
  }
}

/**
 * Identify exclusion zones — regions where detections are consistently rejected.
 * Returns array of { pnidId, bbox: { xPct, yPct, wPct, hPct } } for regions
 * with >= 3 rejections in a small area.
 */
export async function getExclusionZones(prisma, platformId, pnidId = null) {
  try {
    const whereClause = pnidId
      ? prisma.$queryRaw`
          SELECT bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct, pnid_id, COUNT(*) AS reject_count
          FROM ai_detection_feedback
          WHERE platform_id = ${platformId}::uuid AND pnid_id = ${pnidId}::uuid AND action = 'reject'
          GROUP BY pnid_id, ROUND(bbox_x_pct / 5) * 5, ROUND(bbox_y_pct / 5) * 5, bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
          HAVING COUNT(*) >= 3
          ORDER BY reject_count DESC
          LIMIT 20
        `
      : prisma.$queryRaw`
          SELECT bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct, pnid_id, COUNT(*) AS reject_count
          FROM ai_detection_feedback
          WHERE platform_id = ${platformId}::uuid AND action = 'reject'
          GROUP BY pnid_id, ROUND(bbox_x_pct / 5) * 5, ROUND(bbox_y_pct / 5) * 5, bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
          HAVING COUNT(*) >= 3
          ORDER BY reject_count DESC
          LIMIT 50
        `;

    const rows = await whereClause;
    return (rows || []).map(r => ({
      pnidId: r.pnid_id,
      bbox: {
        xPct: Number(r.bbox_x_pct),
        yPct: Number(r.bbox_y_pct),
        wPct: Number(r.bbox_w_pct),
        hPct: Number(r.bbox_h_pct),
      },
      rejectCount: Number(r.reject_count),
    }));
  } catch {
    return [];
  }
}

/**
 * Save or update a named detection profile for a platform.
 */
export async function saveProfile(prisma, { platformId, name, category, examples, embeddings = null }) {
  try {
    await prisma.$executeRaw`
      INSERT INTO ai_detection_profile (platform_id, name, category, example_data, embeddings)
      VALUES (${platformId}::uuid, ${name}, ${category}, ${JSON.stringify(examples)}::jsonb, ${embeddings ? JSON.stringify(embeddings) : null}::jsonb)
      ON CONFLICT (platform_id, name) DO UPDATE SET
        category = EXCLUDED.category,
        example_data = EXCLUDED.example_data,
        embeddings = COALESCE(EXCLUDED.embeddings, ai_detection_profile.embeddings),
        is_active = true,
        updated_at = NOW()
    `;
    return { saved: true };
  } catch (err) {
    return { saved: false, error: err.message };
  }
}

/**
 * Get a saved detection profile by name.
 */
export async function getProfile(prisma, platformId, name) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT id, name, category, example_data, embeddings, total_accepted, total_rejected, auto_threshold, exclusion_zones
      FROM ai_detection_profile
      WHERE platform_id = ${platformId}::uuid AND name = ${name} AND is_active = true
      LIMIT 1
    `;
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * List all active profiles for a platform.
 */
export async function listProfiles(prisma, platformId) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT id, name, category, total_accepted, total_rejected, auto_threshold, created_at, updated_at
      FROM ai_detection_profile
      WHERE platform_id = ${platformId}::uuid AND is_active = true
      ORDER BY updated_at DESC
    `;
    return rows || [];
  } catch {
    return [];
  }
}

/**
 * Cross-drawing tag validation: find tags that appear on multiple drawings
 * within a batch. Tags appearing on 2+ drawings have higher reliability.
 */
export async function crossDrawingValidation(prisma, platformId, batchId) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT
        d.value->>'tag_text' AS tag_text,
        d.value->>'entity_type' AS entity_type,
        COUNT(DISTINCT r.pnid_id) AS drawing_count,
        AVG((d.value->>'confidence')::numeric) AS avg_confidence
      FROM ai_detection_batch_result r,
           jsonb_array_elements(r.detections) AS d(value)
      WHERE r.batch_id = ${batchId}::uuid
        AND r.status = 'completed'
        AND d.value->>'tag_text' IS NOT NULL
        AND d.value->>'tag_text' != ''
      GROUP BY d.value->>'tag_text', d.value->>'entity_type'
      HAVING COUNT(DISTINCT r.pnid_id) >= 2
      ORDER BY drawing_count DESC, avg_confidence DESC
    `;
    return rows || [];
  } catch {
    return [];
  }
}
