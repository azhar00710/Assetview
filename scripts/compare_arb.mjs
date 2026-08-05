const BATCH = 'c9e1151b-493a-451d-8cd2-a1c9a3521918';
const FILE = '0bafeb0d-6e4e-46ae-9c07-8afbda54efa9';
for (const arb of ['none', 'priority_lock', 'nms_best', 'cluster']) {
  const url = `http://localhost:3001/api/v1/ocr-pipeline/batches/${BATCH}/files/${FILE}/grouping-diagnostic?arbitration=${arb}&vertical_relaxed=1&stoppers=median_gap,number_break`;
  const res = await fetch(url);
  const j = await res.json();
  const d = j.diagnostic;
  const audit = d.ocrMissAudit || { reports: [] };
  console.log(`[${arb.padEnd(14)}] groups=${d.stats.totalGroups}  multi=${d.stats.multiWordGroups}  ungrouped=${d.stats.ungroupedAtoms}  cov=${d.stats.coveragePct}%  conflicts=${d.stats.conflictAtoms}  unpaired-mids=${audit.reports.length}  v_paired=${(d.sourceBreakdown.find(s=>s.source==="vertical_paired")||{}).multiWordCount||0}`);
}