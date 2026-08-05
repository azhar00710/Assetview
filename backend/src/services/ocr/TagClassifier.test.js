import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDictionaryMap, classifyTag } from './TagClassifier.js';

test('classifyTag detects drawing reference tags', () => {
  const a = classifyTag('100001-SHT-001');
  const b = classifyTag('AD219-490-D-15101');
  assert.equal(a?.type, 'drawing_ref');
  assert.equal(b?.type, 'drawing_ref');
});

test('classifyTag still detects instrument and line tags', () => {
  const ins = classifyTag('PT-340201');
  const line = classifyTag('8"-H-28-12-0104-J16-P');
  assert.equal(ins?.type, 'instrument');
  assert.equal(line?.type, 'line');
});

test('dictionary prefixes do not classify bare fragments as complete tags', () => {
  const built = buildDictionaryMap([
    { function_code: 'ZSC', entity_type: 'instrument', discipline: 'instrumentation', description: 'Position switch closed' },
    { function_code: 'A', entity_type: 'equipment', discipline: 'mechanical', description: 'Equipment family A' },
  ]);
  const barePrefix = classifyTag('ZSC', { dictionary: built.map, patterns: built.patterns });
  const bareSuffix = classifyTag('A', { dictionary: built.map, patterns: built.patterns });
  const fullTag = classifyTag('ZSC-289910-A', { dictionary: built.map, patterns: built.patterns });
  assert.equal(barePrefix, null);
  assert.equal(bareSuffix, null);
  assert.equal(fullTag?.type, 'instrument');
});
