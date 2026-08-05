const BATCH = 'c9e1151b-493a-451d-8cd2-a1c9a3521918';
const FILE = '0bafeb0d-6e4e-46ae-9c07-8afbda54efa9';
const url = `http://localhost:3001/api/v1/ocr-pipeline/batches/${BATCH}/files/${FILE}/grouping-diagnostic?arbitration=priority_lock&vertical_relaxed=1&stoppers=median_gap,number_break`;
const res = await fetch(url);
const j = await res.json();
const d = j.diagnostic;
console.log('=== Overall coverage ===');
console.log('total atoms:', d.stats.totalRawWords);
console.log('total groups:', d.stats.totalGroups);
console.log('multi-word:', d.stats.multiWordGroups);
console.log('ungrouped atoms:', d.stats.ungroupedAtoms);
console.log('coverage:', d.stats.coveragePct + '%');
console.log('conflicts:', d.stats.conflictAtoms);
console.log('\n=== Per-source ===');
for (const s of d.sourceBreakdown) {
  console.log(`  ${s.source.padEnd(28)} total=${s.groupCount}  multi=${s.multiWordCount}  m-conf=${s.meanConfidence}`);
}
console.log('\n=== Pipeline impact ===');
console.log('baseline:     ', JSON.stringify(d.pipeline.baseline));
console.log('afterStoppers:', JSON.stringify(d.pipeline.afterStoppers));
console.log('afterBipartite:', JSON.stringify(d.pipeline.afterBipartite));
console.log('final:        ', JSON.stringify(d.pipeline.final));