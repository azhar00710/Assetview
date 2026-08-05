import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStage2Response } from './OcrPipeline.js';

// ── Phase 1.5 — Stage 2 response parser hardening ──
// Claude's Stage 2 reply has been observed in four shapes in production. Lock
// each one in a test so a future "fix" can't regress us back to fragile parsing.

test('parses raw JSON object', () => {
  const out = parseStage2Response('{"tags":[{"text":"V-1001"}],"noise":[],"uncertain":[]}');
  assert.equal(out.tags.length, 1);
  assert.equal(out.tags[0].text, 'V-1001');
});

test('parses fenced ```json ... ```', () => {
  const fenced = '```json\n{"tags":[{"text":"V-1001"}],"noise":[],"uncertain":[]}\n```';
  const out = parseStage2Response(fenced);
  assert.equal(out.tags[0].text, 'V-1001');
});

test('parses fenced ``` (no language tag) ```', () => {
  const fenced = '```\n{"tags":[],"noise":[],"uncertain":[]}\n```';
  const out = parseStage2Response(fenced);
  assert.equal(Array.isArray(out.tags), true);
});

test('parses prose preamble + raw JSON (the bug we hit)', () => {
  const prose = `Looking at the OCR words and pre-assembled candidates, I'll identify and classify engineering tags:

{"tags":[{"text":"G-2802","type":"equipment"}],"noise":[],"uncertain":[]}`;
  const out = parseStage2Response(prose);
  assert.equal(out.tags[0].text, 'G-2802');
  assert.equal(out.tags[0].type, 'equipment');
});

test('parses prose preamble + fenced JSON', () => {
  const wrapped = `Looking at the OCR words, here are the tags:

\`\`\`json
{"tags":[{"text":"PT-340201"}],"noise":[],"uncertain":[]}
\`\`\``;
  const out = parseStage2Response(wrapped);
  assert.equal(out.tags[0].text, 'PT-340201');
});

test('handles JSON containing braces inside string values', () => {
  // The walking-brace fallback must respect string escaping.
  const tricky = `Sure! Here's the result:
{"tags":[{"text":"V-1001","reason":"Pattern { with brace } inside"}],"noise":[],"uncertain":[]}`;
  const out = parseStage2Response(tricky);
  assert.equal(out.tags[0].text, 'V-1001');
  assert.match(out.tags[0].reason, /with brace/);
});

test('throws clearly on totally invalid response', () => {
  assert.throws(
    () => parseStage2Response('I cannot help with this request.'),
    /Could not extract JSON/
  );
});

test('throws clearly on empty response', () => {
  assert.throws(() => parseStage2Response(''), /Empty response/);
});

// ── Phase 1.5 — truncation repair ──
// When Claude hits max_tokens mid-response we want to salvage what completed
// instead of throwing the whole chunk away.

test('repairs JSON truncated mid-array with a partial trailing item', () => {
  // Two complete tag items, then a third that got cut off mid-string.
  // The closing brace of the object and the closing bracket of the array
  // are also missing.
  const truncated = `{"tags":[{"text":"V-1001","type":"equipment"},{"text":"PT-340201","type":"instrument"},{"text":"X`;
  const out = parseStage2Response(truncated);
  assert.equal(Array.isArray(out.tags), true, 'tags must be an array');
  assert.equal(out.tags.length, 2, 'expected 2 complete items rescued, partial dropped');
  assert.equal(out.tags[0].text, 'V-1001');
  assert.equal(out.tags[1].text, 'PT-340201');
});

test('repairs JSON truncated mid-array with a partial trailing object', () => {
  const truncated = `{"tags":[{"text":"V-1001"},{"text":"PT-340201"},{"text":"FT-1`;
  const out = parseStage2Response(truncated);
  assert.equal(out.tags.length, 2);
});

test('repairs JSON truncated with incomplete second top-level array', () => {
  const truncated = `{"tags":[{"text":"V-1001"}],"noise":[{"text":"REV"},{"text":"`;
  const out = parseStage2Response(truncated);
  assert.equal(out.tags.length, 1);
  assert.equal(Array.isArray(out.noise), true);
  assert.equal(out.noise.length, 1);
});

test('truncation repair reproduces the production failure pattern', () => {
  // Exact shape of the error you saw in dev: '{ "tags": [, ...'
  // After the bracket, Claude started a string that never closed.
  const truncated = `{ "tags": [{"text": "G-2802", "type": "equipment", "subType": "generator", "confidence": 1.0, "reason": "Matches G-XXXX pattern", "wordIndices": [10, 11, 12]}, {"text": "V-28195", "type": "equipment", "s`;
  const out = parseStage2Response(truncated);
  assert.equal(out.tags.length, 1);
  assert.equal(out.tags[0].text, 'G-2802');
});

test('salvages a minimal root-truncated JSON body', () => {
  const truncated = '{ "tags": [';
  const out = parseStage2Response(truncated);
  assert.deepEqual(out, { tags: [], noise: [], uncertain: [] });
});

test('salvages complete tag items when root object never closes', () => {
  const truncated = `{
    "tags": [
      { "text": "V-1001", "type": "equipment", "wordIndices": [1] },
      { "text": "PT-340201", "type": "instrument", "wordIndices": [2] }
    ],
    "noise": [
      { "text": "TITLE BLOCK", "reason": "annotation", "wordIndices": [99] }
    ],
    "uncertain": [
      { "text": "A-1234", "reason": "ambiguous", "wordIndices": [77] }
    ]`;
  const out = parseStage2Response(truncated);
  assert.equal(out.tags.length, 2);
  assert.equal(out.noise.length, 1);
  assert.equal(out.uncertain.length, 1);
});
