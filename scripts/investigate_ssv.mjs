const BATCH = 'c9e1151b-493a-451d-8cd2-a1c9a3521918';
const FILE = '0bafeb0d-6e4e-46ae-9c07-8afbda54efa9';
const url = `http://localhost:3001/api/v1/ocr-pipeline/batches/${BATCH}/files/${FILE}/grouping-diagnostic?arbitration=nms_best&vertical_relaxed=1&stoppers=median_gap,number_break`;
const j = await (await fetch(url)).json();
const d = j.diagnostic;

console.log('=== SSV ROW (cy 245-275, cx 480-720) — what OCR returned ===');
const allInRow = (d.rawWords || []).filter(w =>
  w.bbox && w.bbox.minY >= 240 && w.bbox.maxY <= 275 &&
  w.bbox.minX >= 480 && w.bbox.maxX <= 720
).sort((a,b) => a.bbox.minX - b.bbox.minX);
for (const w of allInRow) {
  const cx = Math.round((w.bbox.minX + w.bbox.maxX)/2);
  const cy = Math.round((w.bbox.minY + w.bbox.maxY)/2);
  console.log(`  #${String(w.idx).padStart(4)} "${(w.text||'').padEnd(10)}"  cx=${cx} cy=${cy}  conf=${w.confidence?.toFixed(2) ?? '-'}`);
}

console.log('\n=== Audit for SSV-row 289920 mids ===');
const audit = d.ocrMissAudit || { reports: [] };
const ssvMids = audit.reports.filter(r =>
  r.midText === '289920' &&
  r.midCoords.cy >= 245 && r.midCoords.cy <= 275 &&
  r.midCoords.cx >= 480 && r.midCoords.cx <= 720
);
console.log(`Found ${ssvMids.length} unpaired 289920 in SSV row:`);
for (const r of ssvMids) {
  console.log(`\n  mid #${r.midWordIndex} "${r.midText}" cx=${Math.round(r.midCoords.cx)} cy=${Math.round(r.midCoords.cy)}`);
  console.log(`    -> classification: ${r.classification}`);
  console.log(`    -> ${r.detail}`);
  if (r.neighborsAbove?.length) {
    for (const n of r.neighborsAbove.slice(0,3)) {
      console.log(`    above: #${n.idx} "${n.text}" xOff=${n.xOff?.toFixed(0)} yOff=${n.yOff?.toFixed(0)} prefix?=${n.looksLikePrefix}`);
    }
  } else { console.log('    above: NONE'); }
}

console.log('\n=== Are 289920 #351,#352,#353 in any group? ===');
for (const idx of [351,352,353]) {
  const groups = (d.groups || []).filter(g => g.componentWordIndices?.includes(idx));
  console.log(`  atom #${idx} is in ${groups.length} group(s):`);
  for (const g of groups) {
    console.log(`    [${g.source}] "${g.text}" wordCount=${g.wordCount}`);
  }
}