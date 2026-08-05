// Inspect raw OCR for the AKK4 test file. Prints, for the prefixes we care about
// (XS, ZSC, ZLO, ZLC, XA, ZSO, HS, TSHH, TT, TG), every atom in the OCR with
// pixel center, then for each '289910' / '289920' / '289901' number atom prints
// the candidate prefixes within ±50px sideways and ±70px above.
//
// Run:  node scripts/inspect_raw_ocr.mjs <path-to-raw-ocr.json>
import fs from 'node:fs';

const path = process.argv[2] || 'C:/Users/Admin/PID_assetview/raw_ocr.json';
let raw = fs.readFileSync(path, 'utf-8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
const j = JSON.parse(raw);
const words = j.data?.words || j.words || [];
const pageW = j.data?.pageWidth || j.pageWidth;
const pageH = j.data?.pageHeight || j.pageHeight;
console.log(`Total atoms: ${words.length} | Page: ${pageW} x ${pageH}\n`);

function center(v) {
  const xs = (v||[]).map(p=>p.x||0), ys=(v||[]).map(p=>p.y||0);
  return {
    cx: Math.round((Math.min(...xs)+Math.max(...xs))/2),
    cy: Math.round((Math.min(...ys)+Math.max(...ys))/2),
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    h: Math.max(...ys)-Math.min(...ys),
  };
}

const PREFIX_RE = /^(XS|ZSC|ZLO|ZLC|XA|ZSO|HS|TSHH|TT|TG|PSL|PSH|PAL|PAH|PSV|LSL|LSH|TSH|TSL|FE|FT|PT|TT|TW|TG|HV|PG|PI|TI|LI|LT|FI|FY|LIT|PIT|FIT|TIT|VHP|LAL|LAH|PAL|PAH|TAH|TAL|VHV|VLV|CSO|CSC|CEM|CI|PSHH|PSLL|PALL|PSI|HV)$/;
const NUMBER_RE = /^\d{3,7}$/;
const SUFFIX_RE = /^[A-Z]{1,3}\d{0,2}$/;

const enriched = words.map((w, idx) => ({ idx, text: w.text, conf: w.confidence, ...center(w.vertices) }));

console.log('=== ALL PREFIX-PATTERN ATOMS ===');
for (const a of enriched) {
  if (PREFIX_RE.test(String(a.text||'').trim().toUpperCase())) {
    console.log(`#${String(a.idx).padStart(4)}  "${a.text.padEnd(6)}"  cx=${String(a.cx).padStart(4)} cy=${String(a.cy).padStart(4)}  h=${a.h}  conf=${a.conf}`);
  }
}

console.log('\n=== ALL "289910" / "289920" / "289930" / "289921" / "289961" / "289972" / "289901" / "281090" NUMBER ATOMS, with prefix candidates within X±60, Y above by 5..90 ===');
const interestingNums = ['289910','289920','289930','289921','289961','289972','289901','281090','281010','281020','281053','281054','289960'];
for (const a of enriched) {
  const t = String(a.text||'').trim();
  if (!interestingNums.includes(t)) continue;
  console.log(`\n--- mid #${a.idx} "${t}" cx=${a.cx} cy=${a.cy} ---`);
  const above = enriched.filter(b =>
    b.idx !== a.idx &&
    PREFIX_RE.test(String(b.text||'').trim().toUpperCase()) &&
    b.cy < a.cy &&
    (a.cy - b.cy) >= 4 && (a.cy - b.cy) <= 100 &&
    Math.abs(b.cx - a.cx) <= 80
  ).map(b => ({ ...b, xOff: Math.abs(b.cx - a.cx), yGap: a.cy - b.cy }))
    .sort((x,y) => (x.xOff+x.yGap) - (y.xOff+y.yGap));
  if (!above.length) { console.log('  (NO prefix candidates within X±80, Y -100..-4)'); continue; }
  for (const c of above.slice(0, 6)) {
    console.log(`  prefix candidate #${String(c.idx).padStart(4)}  "${c.text.padEnd(6)}"  xOff=${String(c.xOff).padStart(3)}  yGap=${String(c.yGap).padStart(3)}  cx=${c.cx} cy=${c.cy}`);
  }
}
