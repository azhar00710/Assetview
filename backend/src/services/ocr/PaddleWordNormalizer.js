function toText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeQuotes(text) {
  return String(text || '')
    .replace(/[“”]/g, '"')
    .replace(/[’`]/g, "'");
}

function bboxFromVertices(vertices = []) {
  const xs = vertices.map(v => Number(v?.x) || 0);
  const ys = vertices.map(v => Number(v?.y) || 0);
  if (xs.length === 0 || ys.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function verticesFromSpan(bbox, axisStart, axisEnd, isHorizontal = true) {
  if (isHorizontal) {
    return [
      { x: axisStart, y: bbox.minY },
      { x: axisEnd, y: bbox.minY },
      { x: axisEnd, y: bbox.maxY },
      { x: axisStart, y: bbox.maxY },
    ];
  }
  return [
    { x: bbox.minX, y: axisStart },
    { x: bbox.maxX, y: axisStart },
    { x: bbox.maxX, y: axisEnd },
    { x: bbox.minX, y: axisEnd },
  ];
}

function splitByTransitions(part) {
  if (!part) return [];
  return part
    .split(/(?<=\d)(?=[A-Z])|(?<=[A-Z])(?=\d)/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function tokenizePaddleText(rawText) {
  const text = normalizeQuotes(toText(rawText));
  if (!text) return [];

  const rawParts = text.split(/\s+/).filter(Boolean);
  const out = [];

  for (const rawPart of rawParts) {
    const pieces = rawPart.split(/([\-./:])/).filter(Boolean);
    for (const p of pieces) {
      if (/^[\-./:]$/.test(p)) {
        out.push(p);
        continue;
      }
      if (/^\d+(?:-\d\/\d)?["']$/.test(p) || /^\d\/\d["']$/.test(p)) {
        out.push(p);
        continue;
      }
      out.push(...splitByTransitions(p));
    }
  }

  return out.filter(Boolean);
}

function splitWordIntoTokenWords(word, tokens) {
  if (!Array.isArray(tokens) || tokens.length <= 1) return [word];
  if (tokens.length > 20) return [word];

  const bbox = bboxFromVertices(word.vertices || []);
  const isHorizontal = bbox.width >= (bbox.height * 1.2);
  const axisLength = isHorizontal ? bbox.width : bbox.height;
  if (axisLength <= 1) return [word];

  const charWeights = tokens.map(t => Math.max(1, String(t).length));
  const totalWeight = charWeights.reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) return [word];

  let cursor = isHorizontal ? bbox.minX : bbox.minY;
  const endLimit = isHorizontal ? bbox.maxX : bbox.maxY;

  return tokens.map((token, idx) => {
    const remainingWeight = charWeights.slice(idx).reduce((s, w) => s + w, 0);
    const span = idx === tokens.length - 1
      ? (endLimit - cursor)
      : Math.max(1, Math.round((axisLength * charWeights[idx]) / totalWeight));
    const maxSpan = idx === tokens.length - 1
      ? (endLimit - cursor)
      : Math.max(1, endLimit - cursor - (remainingWeight - charWeights[idx]));
    const boundedSpan = Math.max(1, Math.min(span, maxSpan));
    const tokenStart = cursor;
    const tokenEnd = idx === tokens.length - 1 ? endLimit : Math.min(endLimit, cursor + boundedSpan);
    cursor = tokenEnd;

    return {
      ...word,
      text: token,
      vertices: verticesFromSpan(bbox, tokenStart, tokenEnd, isHorizontal),
    };
  });
}

export function normalizePaddleWords(words = []) {
  if (!Array.isArray(words) || words.length === 0) return [];

  const normalized = [];
  for (const word of words) {
    const cleanedText = toText(word?.text);
    if (!cleanedText) continue;

    const tokens = tokenizePaddleText(cleanedText);
    if (tokens.length <= 1) {
      normalized.push({ ...word, text: cleanedText });
      continue;
    }

    normalized.push(...splitWordIntoTokenWords({ ...word, text: cleanedText }, tokens));
  }
  return normalized;
}

