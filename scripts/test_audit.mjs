// Hit the diagnostic endpoint with full chain enabled and dump the new
// ocrMissAudit section so we can verify the DHSV row is correctly classified
// as 'prefix_dropped'.
import fs from 'node:fs';

const BASE = 'http://localhost:3001/api/v1';
const BATCH = 'c9e1151b-493a-451d-8cd2-a1c9a3521918';
const FILE = '0bafeb0d-6e4e-46ae-9c07-8afbda54efa9';

const url = `${BASE}/ocr-pipeline/batches/${BATCH}/files/${FILE}/grouping-diagnostic` +
  `?arbitration=priority_lock&vertical_relaxed=1&stoppers=median_gap,number_break`;

console.log('Fetching:', url);
const res = await fetch(url);
if (!res.ok) {
  console.error('HTTP', res.status, await res.text());
  process.exit(1);
}
const j = await res.json();
const audit = j.diagnostic?.ocrMissAudit;
if (!audit) { console.error('no ocrMissAudit in response'); process.exit(1); }

console.log('\n=== OCR-MISS AUDIT SUMMARY ===');
console.log('Total ISA mids unpaired:', audit.reports.length);
for (const [cls, cnt] of Object.entries(audit.counts)) {
  console.log(`  ${cls.padEnd(32)} ${cnt}`);
}
console.log('Suggested re-pass regions:', audit.suggestedRepassRegions.length);

console.log('\n=== DHSV row middle bubbles (cy 195-220, cx 480-720) ===');
const dhsv = audit.reports.filter(r =>
  r.midCoords.cy >= 195 && r.midCoords.cy <= 220 &&
  r.midCoords.cx >= 480 && r.midCoords.cx <= 720
);
console.log(`Found ${dhsv.length} unpaired mid(s) in this region:\n`);
for (const r of dhsv) {
  console.log(`  mid #${r.midWordIndex} "${r.midText}" cx=${r.midCoords.cx} cy=${r.midCoords.cy}`);
  console.log(`    classification: ${r.classification}`);
  console.log(`    detail: ${r.detail}`);
  console.log(`    bubbleRegion: x=${r.bubbleRegion_px.x} y=${r.bubbleRegion_px.y} w=${r.bubbleRegion_px.w} h=${r.bubbleRegion_px.h}`);
  if (r.neighborsAbove.length) {
    console.log(`    atoms ABOVE (top 3):`);
    for (const n of r.neighborsAbove.slice(0, 3)) {
      console.log(`      #${n.idx} "${n.text}"  xOff=${n.xOff.toFixed(0)} yOff=${n.yOff.toFixed(0)} prefix?=${n.looksLikePrefix} conf=${n.confidence}`);
    }
  } else console.log(`    atoms ABOVE: NONE`);
  if (r.neighborsBelow.length) {
    console.log(`    atoms BELOW (top 3):`);
    for (const n of r.neighborsBelow.slice(0, 3)) {
      console.log(`      #${n.idx} "${n.text}"  xOff=${n.xOff.toFixed(0)} yOff=${n.yOff.toFixed(0)} suffix?=${n.looksLikeSuffix} conf=${n.confidence}`);
    }
  } else console.log(`    atoms BELOW: NONE`);
  console.log('');
}

// Save full audit for inspection
fs.writeFileSync('C:/Users/Admin/PID_assetview/audit_full.json', JSON.stringify(audit, null, 2));
console.log(`\nFull audit saved to audit_full.json (${(fs.statSync('C:/Users/Admin/PID_assetview/audit_full.json').size / 1024).toFixed(1)} KB)`);
