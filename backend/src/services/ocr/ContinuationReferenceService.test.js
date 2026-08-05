import test from 'node:test';
import assert from 'node:assert/strict';
import { detectContinuationReferences } from './ContinuationReferenceService.js';

test('detects continuation reference triad near drawing callout', () => {
  const items = [
    {
      text: 'AD-28-D-100005-SHT-001',
      boundingBox: { minX: 1000, minY: 500, maxX: 1240, maxY: 530 },
      wordIndices: [10, 11, 12],
    },
    {
      text: '1126',
      boundingBox: { minX: 1260, minY: 500, maxX: 1300, maxY: 530 },
      wordIndices: [13],
    },
    {
      text: '8"-H-28-12-0121-J85S-N',
      boundingBox: { minX: 990, minY: 560, maxX: 1280, maxY: 590 },
      wordIndices: [14, 15, 16],
    },
  ];

  const refs = detectContinuationReferences(items);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].targetDrawing, 'AD-28-D-100005-SHT-001');
  assert.equal(refs[0].connectorId, '1126');
  assert.equal(refs[0].lineNumber, '8"-H-28-12-0121-J85S-N');
  assert.equal(refs[0].type, 'continuation_reference');
});

