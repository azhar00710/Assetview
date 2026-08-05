import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSymbolRegions, fuseSymbolRegionWords } from './SymbolRegionDetector.js';

function word(text, x = 100, y = 100, w = 50, h = 18) {
  return {
    text,
    confidence: 0.9,
    vertices: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  };
}

test('detectSymbolRegions falls back to OCR heuristics', async () => {
  const words = [word('ZLO', 300, 200, 35, 12), word('289910', 300, 216, 48, 12), word('A1', 300, 232, 22, 12)];
  const result = await detectSymbolRegions({
    words,
    pageWidth: 1200,
    pageHeight: 900,
    options: { symbolDetectProvider: 'grounding_dino' },
  });

  assert.ok(Array.isArray(result.regions));
  assert.ok(result.regions.length >= 1);
});

test('fuseSymbolRegionWords creates synthetic merged token near region', () => {
  const words = [word('ZLO', 300, 200, 35, 12), word('289910', 300, 216, 48, 12), word('A1', 300, 232, 22, 12)];
  const symbolRegions = [{ id: 'sym_1', label: 'instrument', bbox: { x: 290, y: 190, w: 80, h: 70 } }];
  const fused = fuseSymbolRegionWords(words, symbolRegions, 1200, 900);
  assert.ok(fused.words.some(w => w.text === 'ZLO-289910-A1' || w.text === 'ZLO289910A1'));
  assert.ok(fused.addedWords >= 1);
});

test('detectSymbolRegions identifies drawing reference blocks', async () => {
  const words = [
    word('100001', 500, 300, 52, 14),
    word('SHT', 558, 300, 28, 14),
    word('001', 592, 300, 24, 14),
  ];
  const result = await detectSymbolRegions({
    words,
    pageWidth: 1400,
    pageHeight: 900,
    options: { symbolDetectProvider: 'heuristic' },
  });
  assert.ok(result.regions.some(r => r.label === 'drawing_ref'));
});
