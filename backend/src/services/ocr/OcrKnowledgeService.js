/**
 * OCR knowledge loop:
 * - Stores per-review feedback events
 * - Learns simple reusable tag patterns from repeated corrections
 * - Exposes learned patterns for prompt injection
 */

function normalizeText(s) {
  return String(s || '').trim().toUpperCase();
}

function inferPattern(tagText) {
  const t = normalizeText(tagText);
  const match = t.match(/^([A-Z]{1,6})-(\d{2,8})(?:-([A-Z0-9]{1,3}))?$/);
  if (!match) return null;
  const prefix = match[1];
  const hasSuffix = !!match[3];
  const regex = hasSuffix
    ? `^${prefix}-\\d{2,8}-[A-Z0-9]{1,3}$`
    : `^${prefix}-\\d{2,8}$`;
  return { prefix, regex };
}

export async function getLearnedPatterns(prisma, platformId) {
  try {
    return await prisma.$queryRaw`
      SELECT pattern_key, regex_pattern, target_type, support_count, confidence
      FROM ocr_learned_pattern
      WHERE platform_id = ${platformId}::uuid AND is_active = true
      ORDER BY confidence DESC, support_count DESC
      LIMIT 50
    `;
  } catch {
    return [];
  }
}

export async function recordReviewFeedbackEvents(prisma, {
  platformId,
  batchId,
  fileId,
  decisions = [],
  includeImplicit = false,
}) {
  if (!decisions.length) return { inserted: 0 };
  let inserted = 0;
  for (const d of decisions) {
    const decisionSource = String(d.decisionSource || 'explicit').toLowerCase();
    if (!includeImplicit && decisionSource !== 'explicit') continue;
    const originalText = normalizeText(d.tagText);
    const correctedText = normalizeText(d.correctedText || d.tagText);
    const originalType = String(d.originalType || '').toLowerCase() || null;
    const correctedType = String(d.correctedType || d.originalType || '').toLowerCase() || null;
    try {
      await prisma.$executeRaw`
        INSERT INTO ocr_feedback_event (
          platform_id, batch_id, batch_file_id,
          action, original_text, corrected_text, original_type, corrected_type, notes
        ) VALUES (
          ${platformId}::uuid, ${batchId}::uuid, ${fileId}::uuid,
          ${d.action || 'unknown'}, ${originalText}, ${correctedText}, ${originalType}, ${correctedType}, ${d.notes || null}
        )
      `;
      inserted++;
    } catch {
      // best-effort logging path
    }
  }
  return { inserted };
}

export async function promoteLearnedPatternsFromFeedback(prisma, platformId, minSupport = 3) {
  let events = [];
  try {
    events = await prisma.$queryRaw`
      SELECT corrected_text, corrected_type
      FROM ocr_feedback_event
      WHERE platform_id = ${platformId}::uuid
        AND action IN ('approve', 'edit')
        AND corrected_text IS NOT NULL
    `;
  } catch {
    return { promoted: 0 };
  }

  const stats = new Map();
  for (const e of events) {
    const pat = inferPattern(e.corrected_text);
    if (!pat) continue;
    const type = String(e.corrected_type || 'unknown').toLowerCase();
    const key = `${pat.prefix}|${type}|${pat.regex}`;
    stats.set(key, (stats.get(key) || 0) + 1);
  }

  let promoted = 0;
  for (const [key, supportCount] of stats.entries()) {
    if (supportCount < minSupport) continue;
    const [patternKey, targetType, regexPattern] = key.split('|');
    const confidence = Math.min(0.99, +(0.6 + (supportCount * 0.05)).toFixed(2));
    try {
      await prisma.$executeRaw`
        INSERT INTO ocr_learned_pattern (
          platform_id, pattern_key, regex_pattern, target_type, support_count, confidence, source
        ) VALUES (
          ${platformId}::uuid, ${patternKey}, ${regexPattern}, ${targetType}, ${supportCount}, ${confidence}, 'review_feedback'
        )
        ON CONFLICT (platform_id, pattern_key, target_type) DO UPDATE SET
          regex_pattern = EXCLUDED.regex_pattern,
          support_count = GREATEST(ocr_learned_pattern.support_count, EXCLUDED.support_count),
          confidence = GREATEST(ocr_learned_pattern.confidence, EXCLUDED.confidence),
          is_active = true,
          updated_at = NOW()
      `;
      promoted++;
    } catch {
      // best effort
    }
  }

  return { promoted };
}

/**
 * Record an atom-role labelling decision from the grouping diagnostic UI.
 * Mirrors into ocr_feedback_event with action='atom_label' so platform-level
 * promotion (vocabulary, threshold tuning, arbitration priors) can later
 * aggregate them per-platform without changing schema.
 *
 * params:
 *   platformId, batchId, fileId, atomIdx, role, text, decidedBy
 */
export async function recordAtomLabelEvent(prisma, {
  platformId,
  batchId,
  fileId,
  atomIdx,
  role,
  text,
  decidedBy = null,
} = {}) {
  if (!platformId || !batchId || !fileId) return { inserted: 0 };
  const normText = normalizeText(text);
  const normRole = String(role || '').toLowerCase();
  if (!normRole) return { inserted: 0 };
  try {
    await prisma.$executeRaw`
      INSERT INTO ocr_feedback_event (
        platform_id, batch_id, batch_file_id,
        action, original_text, corrected_text, original_type, corrected_type, notes
      ) VALUES (
        ${platformId}::uuid, ${batchId}::uuid, ${fileId}::uuid,
        'atom_label',
        ${normText || null}, ${normText || null},
        ${null}, ${normRole},
        ${`atomIdx=${atomIdx} decidedBy=${decidedBy || 'anon'}`}
      )
    `;
    return { inserted: 1 };
  } catch {
    return { inserted: 0 };
  }
}

export function formatLearnedPatternsForPrompt(patterns = []) {
  if (!patterns.length) return '';
  return patterns
    .map(p => `- ${p.pattern_key} -> ${p.target_type} (support=${p.support_count}, conf=${p.confidence}) regex:${p.regex_pattern}`)
    .join('\n');
}

