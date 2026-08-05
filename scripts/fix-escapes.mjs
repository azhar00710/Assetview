import fs from 'node:fs';

const path = 'frontend/src/components/ocr-pipeline/ReviewCanvas.jsx';
let s = fs.readFileSync(path, 'utf8');

// Replace literal "\u2026" with actual ellipsis, etc.
// We use String.raw + new RegExp to match the LITERAL backslash-u sequence.
const replacements = [
  [String.raw`\u2026`, '\u2026'],
  [String.raw`\u00b7`, '\u00b7'],
  [String.raw`\u00B7`, '\u00b7'],
  [String.raw`\u2014`, '\u2014'],
  [String.raw`\u2190`, '\u2190'],
  [String.raw`\u2192`, '\u2192'],
];

let changes = 0;
for (const [from, to] of replacements) {
  const re = new RegExp(from.replace(/\\/g, '\\\\'), 'g');
  const before = s;
  s = s.replace(re, to);
  if (s !== before) {
    const n = (before.match(re) || []).length;
    console.log('replaced ' + n + ' x ' + from + ' -> ' + JSON.stringify(to));
    changes += n;
  }
}

fs.writeFileSync(path, s, 'utf8');

const after = fs.readFileSync(path);
console.log('---');
console.log('first6:', Array.from(after.slice(0,6)).map(x=>x.toString(16).padStart(2,'0')).join(' '));
console.log('total replacements:', changes);
