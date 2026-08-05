/**
 * Tag classification for P&ID drawings.
 * Identifies equipment tags, instrument tags, line numbers, valves, etc.
 * from OCR-extracted text using oil & gas naming conventions.
 *
 * Classification priority:
 *  1. Client-specific tag dictionary (if provided) — function code lookup
 *  2. Hardcoded generic ISA / equipment rules (fallback)
 */

// Known equipment prefixes (single or double letter codes)
const EQUIPMENT_PREFIXES = new Set([
  'V', 'P', 'E', 'C', 'TK', 'AG', 'HE', 'R', 'D', 'F', 'K', 'T', 'S', 'B', 'H',
  'M', 'G', 'N', 'W', 'X', 'J', 'SEP', 'FLT', 'DRM',
  'Q', 'GP', 'AF', 'KW', 'DBBT', 'FA',
]);

// ISA S5.1 first-letter codes for instrument measured variables
const ISA_FIRST_LETTERS = new Set([
  'F', 'L', 'P', 'T', 'A', 'S', 'H', 'Z', 'I', 'D', 'W', 'M', 'N', 'O', 'R', 'U', 'X', 'Y',
]);

// Equipment tag: 1-5 letter prefix + dash + 1-7 digit number + optional dot-suffix + optional dash-suffix
// Matches: V-28195, P-2802.A, GP-2802, AF-09, HV-289920.A-01, Q-2801, ZLO-281053-C
const EQUIPMENT_REGEX = /^([A-Z]{1,5})-(\d{1,7})(?:\.[A-Z0-9]+)?(?:-[A-Z0-9]{1,3}){0,3}$/;

// Instrument tag: 2-5 letter ISA prefix + dash + 3-7 digit number + optional dot-suffix + optional dash-suffix
// Matches: PT-281010, DGTC-287700.04, PT-281010.C, PSHH-289942, FT-281010.A, FI-281010.B2, ZLO-281053-C
const INSTRUMENT_REGEX = /^([A-Z]{2,5})-(\d{3,7})(?:\.[A-Z0-9]{1,3})?(?:-[A-Z0-9]{1,3}){0,3}$/;

// Line number: starts with pipe size (integer, fractional, or dual), then fluid-area-system-seq-class-insulation
// Matches: 8"-H-28-12-0104-J16-P, 1-1/2"-H-28-12-0105-J16-N, 1/2"-N-28-21-0202-B10-N, 1",2"-V-28-22-0203-B10-N
// Also handles: 14"-H-28-12-0322-J20SPL-P (extended pipe class), 1"-VT-28-99-GP-2802-J26S-N (equipment ref in VT lines)
const LINE_REGEX = /^(?:\d{1,2}(?:-\d\/\d)?(?:",\d{1,2}")?"?|\d\/\d"?)-?[A-Z]{1,4}-\d{1,3}(?:-\d{1,3}){1,2}-\d{4}(?:-[A-Z0-9-]+)?-[A-Z0-9]{2,6}-[A-Z]$/;

// Extended line format: LOCATION-SIZE-PRODUCT-NUMBER-PIPECLASS-INSULATION (NOC-style)
// e.g., ASAB-10"-WF-380002-AR1-H
const EXTENDED_LINE_REGEX = /^[A-Z]{2,5}-(?:\d{1,2}(?:-\d\/\d)?|\d\/\d)(?:\s?\d\/\d)?"?-?[A-Z]{1,4}-\d{4,8}-[A-Z0-9]{2,6}-[A-Z]$/;

// Generic tag pattern: LETTERS-DIGITS with optional dot/dash suffixes
const GENERIC_TAG_REGEX = /^[A-Z]{1,5}-\d{1,7}(?:\.[A-Z0-9]+)?(?:-[A-Z0-9]{1,3}){0,3}$/;

// Extended tag pattern: LOCATION-FUNCTION-NUMBER (NOC-style with 5-char location code)
// e.g., ASBAA-PT-340201A
const LOCATION_TAG_REGEX = /^[A-Z]{4,5}\d?-([A-Z]{1,5})-\d{4,9}[A-Z]?$/;

// Drawing / sheet identifiers often shown in boxed callouts
// Matches: AD219-490-D-15101, 100001-SHT-001, DWG-12345-A
const DRAWING_TAG_REGEX = /^(?:[A-Z0-9]{1,8}-){2,7}[A-Z0-9]{1,8}$/;
const SHEET_DRAWING_HINT_REGEX = /(SHT|SHEET|DWG|DRG)/;

/**
 * Build a lookup map from a tag dictionary array.
 * Also compiles tag_pattern values into regex objects for pattern-based matching.
 *
 * @param {Array<{function_code: string, entity_type: string, discipline?: string, description?: string, tag_pattern?: string}>} dictionary
 * @returns {{ map: Map<string, object>, patterns: Array<{regex: RegExp, functionCode: string, entityType: string, discipline: string, description: string}> }}
 */
function buildDictionaryMap(dictionary) {
  const map = new Map();
  const patterns = [];
  if (!dictionary?.length) return { map, patterns };

  for (const entry of dictionary) {
    map.set(entry.function_code.toUpperCase(), {
      entityType: entry.entity_type,
      discipline: entry.discipline,
      description: entry.description,
      source: 'dictionary',
    });

    // Compile tag_pattern into regex if present
    if (entry.tag_pattern) {
      try {
        const regex = new RegExp(entry.tag_pattern, 'i');
        patterns.push({
          regex,
          functionCode: entry.function_code.toUpperCase(),
          entityType: entry.entity_type,
          discipline: entry.discipline,
          description: entry.description,
        });
      } catch {
        // Invalid regex — skip silently
      }
    }
  }

  // Sort patterns: longest function code first for specificity
  patterns.sort((a, b) => b.functionCode.length - a.functionCode.length);

  return { map, patterns };
}

/**
 * Extract possible function code prefixes from a tag text.
 * Handles multiple formats:
 *  - Simple: "PT-340201" → ["PT"]
 *  - With location: "ASBAA-PT-340201" → ["PT", "ASBAA"]
 *  - Multi-part: "PDCV-340201" → ["PDCV"]
 *
 * @param {string} cleaned - Uppercased, trimmed text
 * @returns {string[]} Candidate function codes, longest match first
 */
function extractPrefixes(cleaned) {
  const parts = cleaned.split('-');
  const candidates = [];

  // For LOCATION-FUNCTION-NUMBER format: try the second part first
  if (parts.length >= 3) {
    const locationMatch = cleaned.match(LOCATION_TAG_REGEX);
    if (locationMatch) {
      candidates.push(locationMatch[1]); // The function code group
    }
  }

  // Try each alphabetic segment as a potential function code
  for (const part of parts) {
    if (/^[A-Z]{1,5}$/.test(part)) {
      candidates.push(part);
    }
  }

  // Also try multi-part prefixes (for codes like "PDCV" in "PDCV-340201")
  // Already covered above, but also try combining adjacent letter parts
  if (parts.length >= 2 && /^[A-Z]+$/.test(parts[0]) && /^\d/.test(parts[1])) {
    candidates.push(parts[0]);
  }

  // Deduplicate while preserving order
  return [...new Set(candidates)];
}

function isStructuredDictionaryCandidate(cleaned = '') {
  if (!cleaned) return false;
  return GENERIC_TAG_REGEX.test(cleaned) || LOCATION_TAG_REGEX.test(cleaned);
}

/**
 * Classify an OCR-extracted text string.
 *
 * @param {string} text - The text to classify
 * @param {{ dictionary?: Map<string, object>, patterns?: Array<{regex: RegExp, entityType: string, discipline: string, description: string}> }} options
 * @returns {{ type: string, text: string, discipline?: string, description?: string, source: string } | null}
 */
export function classifyTag(text, options = {}) {
  if (!text || typeof text !== 'string') return null;

  const cleaned = text.trim().toUpperCase().replace(/\s+/g, '');
  if (cleaned.length < 3) return null;

  const dictMap = options.dictionary;
  const dictPatterns = options.patterns;

  // ── 1. Line number detection (pipe size at start) ──
  if (LINE_REGEX.test(cleaned) || EXTENDED_LINE_REGEX.test(cleaned)) {
    return { type: 'line', text: cleaned, source: 'pattern' };
  }

  // ── 1b. Drawing/sheet reference tags (boxed references/callouts) ──
  if (DRAWING_TAG_REGEX.test(cleaned)) {
    const segs = cleaned.split('-').filter(Boolean);
    const hasLetterSeg = segs.some(s => /[A-Z]/.test(s));
    const hasDigitSeg = segs.some(s => /\d/.test(s));
    const hasHint = SHEET_DRAWING_HINT_REGEX.test(cleaned);
    if ((hasHint || segs.length >= 4) && hasLetterSeg && hasDigitSeg) {
      return { type: 'drawing_ref', text: cleaned, source: 'drawing_pattern' };
    }
  }

  // ── 2. Pattern-based matching (compiled tag_pattern regexes) ──
  if (dictPatterns?.length > 0) {
    for (const pat of dictPatterns) {
      if (pat.regex.test(cleaned)) {
        return {
          type: pat.entityType,
          text: cleaned,
          discipline: pat.discipline,
          description: pat.description,
          source: 'dictionary_pattern',
        };
      }
    }
  }

  // ── 2b. Dictionary lookup (prefix/type hint only for complete structured tags) ──
  // Do not classify bare fragments like "ZSC" or "A" as real tags just because
  // the prefix exists in the platform dictionary. The candidate must already
  // look like a full structured tag before the dictionary can bless its type.
  if (dictMap && dictMap.size > 0 && isStructuredDictionaryCandidate(cleaned)) {
    const prefixes = extractPrefixes(cleaned);
    // Try longest prefix first for specificity (e.g., "PDCV" before "P")
    const sortedPrefixes = prefixes.sort((a, b) => b.length - a.length);

    for (const prefix of sortedPrefixes) {
      const entry = dictMap.get(prefix);
      if (entry) {
        return {
          type: entry.entityType,
          text: cleaned,
          discipline: entry.discipline,
          description: entry.description,
          source: 'dictionary',
        };
      }
    }
  }

  // ── 2c. Strong generic regex pass for structured tags ──
  if (INSTRUMENT_REGEX.test(cleaned)) {
    const m = cleaned.match(INSTRUMENT_REGEX);
    const prefix = m?.[1] || '';
    if (prefix && ISA_FIRST_LETTERS.has(prefix[0])) {
      return { type: 'instrument', text: cleaned, source: 'generic_regex' };
    }
  }
  if (EQUIPMENT_REGEX.test(cleaned)) {
    const m = cleaned.match(EQUIPMENT_REGEX);
    const prefix = m?.[1] || '';
    if (prefix && EQUIPMENT_PREFIXES.has(prefix)) {
      return { type: 'equipment', text: cleaned, source: 'generic_regex' };
    }
  }

  // ── 3. Fallback: generic ISA / equipment rules ──
  // Strip known suffix patterns (.A, .A-01, .04, /PT-281045.A) before prefix extraction
  const stripped = cleaned.replace(/(\.[A-Z0-9]+)?(?:-[A-Z0-9]{1,3})?(\/.*)?$/, '');
  const match = stripped.match(/^([A-Z]+)-(\d+)$/);
  if (!match) {
    // Try location-prefixed format
    const locMatch = cleaned.match(LOCATION_TAG_REGEX);
    if (locMatch) {
      const prefix = locMatch[1];
      if (EQUIPMENT_PREFIXES.has(prefix)) {
        return { type: 'equipment', text: cleaned, source: 'generic' };
      }
      if (prefix.length >= 2 && ISA_FIRST_LETTERS.has(prefix[0])) {
        return { type: 'instrument', text: cleaned, source: 'generic' };
      }
      return { type: 'unknown', text: cleaned, source: 'generic' };
    }
    return null;
  }

  const prefix = match[1];

  // Check equipment first (shorter prefixes)
  if (EQUIPMENT_PREFIXES.has(prefix)) {
    return { type: 'equipment', text: cleaned, source: 'generic' };
  }

  // Check instrument (2+ letter ISA prefix)
  if (prefix.length >= 2 && ISA_FIRST_LETTERS.has(prefix[0])) {
    return { type: 'instrument', text: cleaned, source: 'generic' };
  }

  // If matches generic tag pattern but not classified, mark as unknown
  if (GENERIC_TAG_REGEX.test(cleaned)) {
    return { type: 'unknown', text: cleaned, source: 'generic' };
  }

  return null;
}

/**
 * Batch classify multiple texts.
 * @param {Array<{ text: string, confidence: number, vertices: Array }>} words
 * @param {{ dictionary?: Array }} options - If dictionary is an array, it gets converted to a Map internally
 * @returns {Array<{ text: string, type: string, confidence: number, vertices: Array, source: string }>}
 */
export function classifyAll(words, options = {}) {
  // Convert dictionary array to Map + patterns if needed
  let dictData = options.dictionary;
  let dictMap;
  let dictPatterns = [];

  if (Array.isArray(dictData)) {
    const built = buildDictionaryMap(dictData);
    dictMap = built.map;
    dictPatterns = built.patterns;
  } else if (dictData && typeof dictData === 'object' && dictData.map) {
    // Already built: { map, patterns }
    dictMap = dictData.map;
    dictPatterns = dictData.patterns || [];
  } else {
    dictMap = dictData; // backward compat: raw Map passed directly
  }

  const classifyOptions = { dictionary: dictMap, patterns: dictPatterns };

  const results = [];
  for (const word of words) {
    const result = classifyTag(word.text, classifyOptions);
    if (result) {
      results.push({
        ...word,
        text: result.text,
        type: result.type,
        discipline: result.discipline,
        description: result.description,
        source: result.source,
      });
    }
  }
  return results;
}

export { EQUIPMENT_PREFIXES, ISA_FIRST_LETTERS, buildDictionaryMap };
