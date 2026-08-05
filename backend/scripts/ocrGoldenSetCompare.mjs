#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.log('Usage: node scripts/ocrGoldenSetCompare.mjs <baseline.json> <candidate.json>');
  console.log('Both files should contain an array of drawing records with { drawing, tags, noise, uncertain }.');
}

function loadJson(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function toRecordMap(data) {
  const map = new Map();
  for (const row of data) {
    map.set(row.drawing, row);
  }
  return map;
}

function normalizeTagSet(tags = []) {
  return new Set(tags.map(t => String(t).trim().toUpperCase()));
}

function main() {
  const [baselinePath, candidatePath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath) {
    usage();
    process.exit(1);
  }

  const baseline = loadJson(baselinePath);
  const candidate = loadJson(candidatePath);
  const baseMap = toRecordMap(baseline);
  const candMap = toRecordMap(candidate);

  let totalBaseTags = 0;
  let totalCandTags = 0;
  let totalBaseNoise = 0;
  let totalCandNoise = 0;
  let recoveredTags = 0;
  let regressions = 0;

  for (const [drawing, base] of baseMap.entries()) {
    const cand = candMap.get(drawing);
    if (!cand) continue;
    const baseTags = normalizeTagSet(base.tags || []);
    const candTags = normalizeTagSet(cand.tags || []);

    totalBaseTags += baseTags.size;
    totalCandTags += candTags.size;
    totalBaseNoise += Number(base.noise || 0);
    totalCandNoise += Number(cand.noise || 0);

    for (const t of candTags) {
      if (!baseTags.has(t)) recoveredTags++;
    }
    for (const t of baseTags) {
      if (!candTags.has(t)) regressions++;
    }
  }

  const summary = {
    baselineTagCount: totalBaseTags,
    candidateTagCount: totalCandTags,
    tagDelta: totalCandTags - totalBaseTags,
    baselineNoiseCount: totalBaseNoise,
    candidateNoiseCount: totalCandNoise,
    noiseDelta: totalCandNoise - totalBaseNoise,
    recoveredTags,
    regressions,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
