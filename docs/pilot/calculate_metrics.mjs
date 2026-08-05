import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('docs/pilot/ai_annotation_pilot_results.csv');
if (!fs.existsSync(filePath)) {
  console.error(`Missing file: ${filePath}`);
  process.exit(1);
}

const raw = fs.readFileSync(filePath, 'utf8').trim();
const [headerLine, ...rows] = raw.split(/\r?\n/).filter(Boolean);
const headers = headerLine.split(',');

const parsed = rows
  .map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (values[i] || '').trim();
    });
    return obj;
  })
  .filter(r => r.run_mode && (r.run_mode === 'baseline' || r.run_mode === 'ai_native'));

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function average(items, key) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + number(item[key]), 0) / items.length;
}

const baseline = parsed.filter(r => r.run_mode === 'baseline');
const aiNative = parsed.filter(r => r.run_mode === 'ai_native');

const baselineTime = average(baseline, 'review_time_seconds');
const aiTime = average(aiNative, 'review_time_seconds');
const baselineEffort = average(baseline, 'reviewer_decisions');
const aiEffort = average(aiNative, 'reviewer_decisions');

const aiAccepted = aiNative.reduce((sum, r) => sum + number(r.accepted), 0);
const aiRejected = aiNative.reduce((sum, r) => sum + number(r.rejected), 0);
const aiUncertain = aiNative.reduce((sum, r) => sum + number(r.uncertain), 0);
const aiTotal = aiNative.reduce((sum, r) => sum + number(r.total_detections), 0);

const timeDelta = baselineTime > 0 ? ((baselineTime - aiTime) / baselineTime) * 100 : 0;
const effortDelta = baselineEffort > 0 ? ((baselineEffort - aiEffort) / baselineEffort) * 100 : 0;
const precision = aiAccepted + aiRejected > 0 ? aiAccepted / (aiAccepted + aiRejected) : 0;
const uncertainRatio = aiTotal > 0 ? aiUncertain / aiTotal : 0;

console.log('--- AI Annotation Pilot Metrics ---');
console.log(`baseline_avg_review_time_s: ${baselineTime.toFixed(2)}`);
console.log(`ai_avg_review_time_s: ${aiTime.toFixed(2)}`);
console.log(`time_delta_pct: ${timeDelta.toFixed(2)}`);
console.log(`baseline_avg_reviewer_decisions: ${baselineEffort.toFixed(2)}`);
console.log(`ai_avg_reviewer_decisions: ${aiEffort.toFixed(2)}`);
console.log(`effort_delta_pct: ${effortDelta.toFixed(2)}`);
console.log(`ai_precision: ${precision.toFixed(4)}`);
console.log(`ai_uncertain_ratio: ${uncertainRatio.toFixed(4)}`);

