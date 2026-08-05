/**
 * Matches OCR-extracted tags against existing database entities.
 * Supports exact and fuzzy matching.
 */

/**
 * Simple Levenshtein distance for fuzzy matching.
 */
function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  matrix[0] = Array.from({ length: a.length + 1 }, (_, i) => i);

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j - 1][i] + 1,
        matrix[j][i - 1] + 1,
        matrix[j - 1][i - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score (0-1) between two strings.
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Find the best match for a tag in a list of entities.
 * @param {string} tagText - The OCR-extracted tag text
 * @param {Array} entities - Database entities with a tag/line_number field
 * @param {string} tagField - The field name to compare (e.g., 'tag' or 'line_number')
 * @param {number} minScore - Minimum similarity to consider a match (0-1)
 * @returns {{ entity: object, score: number, method: string } | null}
 */
function findBestMatch(tagText, entities, tagField, minScore = 0.7) {
  if (!entities || entities.length === 0) return null;

  // Try exact match first
  const exact = entities.find(e => e[tagField]?.toUpperCase() === tagText.toUpperCase());
  if (exact) {
    return { entity: exact, score: 1.0, method: 'exact' };
  }

  // Fuzzy match
  let bestMatch = null;
  let bestScore = 0;

  for (const entity of entities) {
    const entityTag = entity[tagField]?.toUpperCase() || '';
    const score = similarity(tagText.toUpperCase(), entityTag);
    if (score > bestScore && score >= minScore) {
      bestScore = score;
      bestMatch = entity;
    }
  }

  if (bestMatch) {
    return { entity: bestMatch, score: bestScore, method: 'fuzzy' };
  }

  return null;
}

/**
 * Match classified tags against database entities for a given P&ID.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} pnidId - P&ID UUID
 * @param {Array} classifiedTags - Tags with { text, type, confidence, vertices }
 * @returns {Promise<Array>} Tags with match info added
 */
export async function matchTagsToEntities(prisma, pnidId, classifiedTags) {
  // Get systems associated with this P&ID
  const pnidSystems = await prisma.pnid_system.findMany({
    where: { pnid_id: pnidId },
    select: { system_id: true },
  });
  const systemIds = pnidSystems.map(ps => ps.system_id);

  if (systemIds.length === 0) {
    return classifiedTags.map(tag => ({
      ...tag,
      matchedEntityId: null,
      matchConfidence: 0,
      matchMethod: null,
    }));
  }

  // Fetch all candidate entities from these systems
  const [equipment, instruments, lines] = await Promise.all([
    prisma.equipment.findMany({
      where: { system_id: { in: systemIds }, deleted_at: null },
      select: { id: true, tag: true, equipment_type: true, description: true, system_id: true },
    }),
    prisma.instrument.findMany({
      where: { system_id: { in: systemIds }, deleted_at: null },
      select: { id: true, tag: true, instrument_type: true, description: true, system_id: true },
    }),
    prisma.line.findMany({
      where: { system_id: { in: systemIds }, deleted_at: null },
      select: { id: true, line_number: true, service: true, system_id: true },
    }),
  ]);

  // Also get lines from pnid_line junction (may include cross-referenced lines)
  const pnidLines = await prisma.pnid_line.findMany({
    where: { pnid_id: pnidId },
    include: {
      line: {
        select: { id: true, line_number: true, service: true, system_id: true },
      },
    },
  });
  const additionalLines = pnidLines.map(pl => pl.line).filter(Boolean);
  const allLines = [...lines];
  for (const line of additionalLines) {
    if (!allLines.find(l => l.id === line.id)) {
      allLines.push(line);
    }
  }

  return classifiedTags.map(tag => {
    let match = null;

    if (tag.type === 'equipment') {
      match = findBestMatch(tag.text, equipment, 'tag');
    } else if (tag.type === 'instrument') {
      match = findBestMatch(tag.text, instruments, 'tag');
    } else if (tag.type === 'line') {
      match = findBestMatch(tag.text, allLines, 'line_number');
    } else if (tag.type === 'unknown') {
      // Try equipment first, then instruments
      match = findBestMatch(tag.text, equipment, 'tag');
      if (!match) {
        match = findBestMatch(tag.text, instruments, 'tag');
      }
      if (match) {
        // Reclassify based on what matched
        const isEquipment = equipment.find(e => e.id === match.entity.id);
        tag.type = isEquipment ? 'equipment' : 'instrument';
      }
    }

    return {
      ...tag,
      matchedEntityId: match?.entity?.id || null,
      matchedEntityTag: match?.entity?.tag || match?.entity?.line_number || null,
      matchConfidence: match?.score || 0,
      matchMethod: match?.method || null,
    };
  });
}
