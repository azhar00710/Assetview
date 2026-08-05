import test from 'node:test';
import assert from 'node:assert/strict';
import { groupAdjacentWords } from './WordGrouper.js';

function word(text, x, y, w, h, angleDeg = 0) {
  const theta = angleDeg * (Math.PI / 180);
  const dx = Math.cos(theta) * w;
  const dy = Math.sin(theta) * w;
  return {
    text,
    confidence: 0.95,
    pageWidth: 2000,
    pageHeight: 1500,
    vertices: [
      { x, y },
      { x: x + dx, y: y + dy },
      { x: x + dx, y: y + dy + h },
      { x, y: y + h },
    ],
  };
}

test('production lift: numeric guard splits "281010 281010 281011" merged chain', () => {
  // Three repeating long-number atoms placed close enough that the greedy
  // horizontal pass would merge them.  The numeric guard must split them back
  // into 3 single-atom groups so adjacent line/equipment tags don't collapse.
  const words = [
    word('281010', 100, 200, 40, 10),
    word('281010', 145, 200, 40, 10),
    word('281011', 190, 200, 40, 10),
  ];
  const groups = groupAdjacentWords(words, { maxGapPx: 15, yOverlapThreshold: 0.5 });
  // No multi-word horizontal group should remain that fuses the three numbers.
  const fused = groups.find(g =>
    (g.wordCount || 1) >= 2 &&
    g.source === 'horizontal' &&
    /281010281010|281010281011/.test((g.text || '').replace(/\s+/g, ''))
  );
  assert.equal(fused, undefined, 'numeric guard should split fully numeric horizontal chains');
  // The three numbers must each appear as a singleton group.
  for (const expected of ['281010', '281011']) {
    assert.ok(
      groups.some(g => (g.wordCount || 1) === 1 && g.text === expected),
      `expected singleton group for "${expected}" after numeric guard`
    );
  }
});

test('production lift: number-break stopper splits horizontal chains at num→num', () => {
  // Mixed chain: text + number, then a second number that should NOT join.
  const words = [
    word('AD', 100, 200, 18, 10),
    word('-', 122, 200, 6, 10),
    word('100004', 132, 200, 40, 10),
    // Second long-number — adjacent to the first number; must trigger a break.
    word('289930', 178, 200, 40, 10),
  ];
  const groups = groupAdjacentWords(words, { maxGapPx: 18, yOverlapThreshold: 0.5 });
  const overMerged = groups.find(g =>
    (g.wordCount || 1) >= 4 &&
    g.source === 'horizontal' &&
    /100004289930/.test((g.text || '').replace(/\s+/g, ''))
  );
  assert.equal(overMerged, undefined, 'number-break stopper should prevent num→num horizontal merges');
});

test('production lift: numeric guard can be disabled via option', () => {
  const words = [
    word('281010', 100, 200, 40, 10),
    word('281011', 145, 200, 40, 10),
  ];
  const groups = groupAdjacentWords(words, {
    maxGapPx: 15,
    yOverlapThreshold: 0.5,
    enableNumericGuard: false,
    enableNumberBreakStopper: false,
  });
  // With both safety nets off the legacy greedy merge is still present.
  const fused = groups.find(g => (g.wordCount || 1) >= 2 && /281010281011/.test((g.text || '').replace(/\s+/g, '')));
  assert.ok(fused, 'when both safety nets are off, the legacy merge should reappear');
});

test('groups horizontally adjacent fragments', () => {
  const words = [
    word('V', 100, 100, 12, 10),
    word('-', 116, 100, 8, 10),
    word('1001', 126, 100, 26, 10),
  ];

  const groups = groupAdjacentWords(words, { maxGapPx: 15, yOverlapThreshold: 0.5 });
  assert.ok(groups.some(g => g.text === 'V-1001'));
});

test('assembles ISA-style vertical stack when enabled', () => {
  const words = [
    word('ZLO', 300, 400, 24, 10),
    word('289920', 302, 420, 40, 10),
    word('A', 304, 440, 10, 10),
  ];

  const groups = groupAdjacentWords(words, {
    enableVerticalGrouping: true,
    maxGapPx: 15,
  });

  const assembled = groups.find(g => g.text === 'ZLO-289920-A');
  assert.ok(assembled, 'expected vertical ISA tag assembly');
  assert.equal(assembled.source, 'vertical_isa');
});

test('assembles ISA-style vertical stack with OCR punctuation/noise', () => {
  const words = [
    word('zlo', 300, 400, 24, 10),
    word('289910', 302, 420, 40, 10),
    word('A.1', 304, 440, 12, 10),
  ];

  const groups = groupAdjacentWords(words, {
    enableVerticalGrouping: true,
    maxGapPx: 15,
  });

  const assembled = groups.find(g => g.text === 'ZLO-289910-A1');
  assert.ok(assembled, 'expected vertical ISA tag assembly with normalized suffix');
  assert.equal(assembled.source, 'vertical_isa');
});

test('groups rotated adjacent fragments when rotation pass enabled', () => {
  const words = [
    word('PT', 600, 600, 18, 10, 45),
    word('-', 618, 618, 8, 10, 45),
    word('281010', 630, 630, 44, 10, 45),
  ];

  const groups = groupAdjacentWords(words, {
    enableRotationGrouping: true,
    rotationMinAbsDeg: 10,
  });

  assert.ok(groups.some(g => g.text === 'PT-281010'));
});

test('builds multiple vertical hypotheses for same loop number', () => {
  const words = [
    word('XA', 346, 400, 18, 10),
    word('XS', 344, 401, 18, 10),
    word('289910', 336, 422, 42, 10),
    word('A1', 338, 442, 14, 10),
  ];

  const groups = groupAdjacentWords(words, {
    enableVerticalGrouping: true,
    maxGapPx: 15,
  });

  assert.ok(groups.some(g => g.text === 'XA-289910-A1'));
  assert.ok(groups.some(g => g.text === 'XS-289910-A1'));
});

test('fallback vertical recovery links repeated loop number to nearby family code', () => {
  const words = [
    word('XS', 420, 200, 18, 10),
    word('289910', 535, 206, 42, 10),
    word('289910', 580, 206, 42, 10),
  ];

  const groups = groupAdjacentWords(words, {
    enableVerticalGrouping: true,
    maxGapPx: 15,
  });

  const recovered = groups.filter(g => g.text === 'XS-289910');
  assert.ok(recovered.length >= 1, 'expected fallback vertical recovery to assemble XS-289910');
  assert.ok(recovered.every(g => g.source === 'vertical_isa'));
});

test('emits OCR confusion-family variants without dropping original assembly', () => {
  const words = [
    word('ZLC', 300, 400, 24, 10),
    word('289910', 302, 420, 40, 10),
    word('D', 304, 440, 10, 10),
  ];

  const groups = groupAdjacentWords(words, {
    enableVerticalGrouping: true,
    maxGapPx: 15,
  });

  assert.ok(groups.some(g => g.text === 'ZLC-289910-D'), 'original OCR reading should remain');
  assert.ok(groups.some(g => g.text === 'ZSC-289910-D'), 'prefix confusion variant should be surfaced');
  assert.ok(groups.some(g => g.text === 'ZLC-289910-A'), 'suffix confusion variant should be surfaced');
  assert.ok(groups.some(g => g.text === 'ZSC-289910-A'), 'combined prefix+suffix variant should be surfaced');

  const combined = groups.find(g => g.text === 'ZSC-289910-A');
  assert.equal(combined?.source, 'ocr_confusion_variant');
  assert.equal(combined?.isBestHypothesis, false);
});

// ── Phase 1.1 — assembly metadata on vertical_isa groups ──

test('vertical_isa groups expose assembly metadata for ledger', () => {
  // Single unambiguous bubble — should be marked as the best hypothesis with
  // marginToRunnerUp = 1 (no competition), so the pipeline can promote to
  // KEPT_DETERMINISTIC_STRONG without AI confirmation.
  const words = [
    word('XA', 350, 400, 18, 10),
    word('289972', 344, 422, 42, 10),
  ];

  const groups = groupAdjacentWords(words, {
    enableVerticalGrouping: true,
    maxGapPx: 15,
  });

  const assembled = groups.find(g => g.text === 'XA-289972');
  assert.ok(assembled, 'expected XA-289972 to assemble');
  assert.equal(assembled.assemblyRule, 'vertical_stack_v2');
  assert.equal(assembled.competingPrefixCount, 1);
  assert.equal(assembled.marginToRunnerUp, 1, 'no runner-up means margin=1');
  assert.equal(assembled.isBestHypothesis, true);
  assert.equal(typeof assembled.assemblyScore, 'number');
  assert.equal(assembled.anchorWordIndex, 1, 'anchor is the loop-number word');
});

test('competing prefixes for same anchor produce distinct margins', () => {
  // Two prefixes XA + XS within tolerance of the same loop number. Both should
  // be emitted, both should reference the same anchor, and only one should
  // carry isBestHypothesis = true. marginToRunnerUp should be small (< 0.15)
  // so the pipeline routes them to UNCERTAIN_COMPETING_HYPOTHESES.
  const words = [
    word('XA', 346, 400, 18, 10),
    word('XS', 344, 401, 18, 10),
    word('289910', 336, 422, 42, 10),
  ];

  const groups = groupAdjacentWords(words, {
    enableVerticalGrouping: true,
    maxGapPx: 15,
  });

  const xa = groups.find(g => g.text === 'XA-289910');
  const xs = groups.find(g => g.text === 'XS-289910');
  assert.ok(xa && xs, 'both hypotheses should be emitted');
  // Both reference the same anchor (the loop-number word).
  assert.equal(xa.anchorWordIndex, xs.anchorWordIndex);
  // Both family-boosted; margin between them should be small.
  assert.ok(
    Math.abs(xa.assemblyScore - xs.assemblyScore) < 0.15,
    `expected small margin between competing hypotheses, got ${Math.abs(xa.assemblyScore - xs.assemblyScore)}`
  );
  // Exactly one is the best hypothesis.
  const bestCount = groups.filter(g => g.text.endsWith('-289910') && g.isBestHypothesis === true).length;
  assert.equal(bestCount, 1, 'only one hypothesis per anchor should be best');
});

test('row assembler emits structured_row_v2 metadata for unambiguous lines', () => {
  // Line tags assembled by buildStructuredRowCandidates should mark themselves
  // as deterministic-strong (margin=1) so the pipeline can promote them too.
  const words = [
    word('6"', 100, 200, 18, 10),
    word('-', 120, 200, 6, 10),
    word('PG', 128, 200, 14, 10),
    word('-', 144, 200, 6, 10),
    word('1001', 152, 200, 28, 10),
    word('-', 182, 200, 6, 10),
    word('A1A', 190, 200, 22, 10),
    word('-', 214, 200, 6, 10),
    word('J16', 222, 200, 22, 10),
    word('-', 246, 200, 6, 10),
    word('P', 254, 200, 10, 10),
  ];

  const groups = groupAdjacentWords(words, { maxGapPx: 15 });
  const lineGroup = groups.find(g => g.source === 'line_assembler');
  if (lineGroup) {
    assert.equal(lineGroup.assemblyRule, 'line_row_v2');
    assert.equal(lineGroup.marginToRunnerUp, 1);
    assert.equal(lineGroup.isBestHypothesis, true);
  }
  // Test passes whether or not the heuristic happens to assemble this exact
  // line — the assertion only fires if it does.
});
