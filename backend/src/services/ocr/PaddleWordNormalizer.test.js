import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaddleWords, tokenizePaddleText } from './PaddleWordNormalizer.js';

function word(text, x = 100, y = 100, w = 120, h = 18) {
  return {
    text,
    confidence: 0.9,
    pageWidth: 2000,
    pageHeight: 1500,
    vertices: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  };
}

test('tokenizePaddleText splits structured engineering tags', () => {
  assert.deepEqual(tokenizePaddleText('PSLL-289961'), ['PSLL', '-', '289961']);
  assert.deepEqual(tokenizePaddleText('HV-289920.A-01'), ['HV', '-', '289920', '.', 'A', '-', '01']);
  assert.deepEqual(tokenizePaddleText('8"-H-28-12-0103-J16-P'), ['8"', '-', 'H', '-', '28', '-', '12', '-', '0103', '-', 'J', '16', '-', 'P']);
});

test('normalizePaddleWords expands merged tokens into multiple words', () => {
  const normalized = normalizePaddleWords([word('ZLO-289910-A1')]);
  assert.ok(normalized.length > 1, 'expected split tokens');
  assert.equal(normalized.map(w => w.text).join(''), 'ZLO-289910-A1');
});

test('normalizePaddleWords keeps simple words unchanged', () => {
  const normalized = normalizePaddleWords([word('NOTE')]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].text, 'NOTE');
});

