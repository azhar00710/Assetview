import fs from 'node:fs';

const s = fs.readFileSync('frontend/src/components/ocr-pipeline/ReviewCanvas.jsx', 'utf8');
const lines = s.split(/\r?\n/);
const re = /\\u[0-9a-fA-F]{4}/g;  // literal backslash + u + 4 hex
let count = 0;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(re);
  if (m) {
    console.log((i + 1) + ': ' + m.join(', ') + '  |  ' + lines[i].trim().slice(0, 140));
    count += m.length;
  }
}
console.log('---');
console.log('total literal escapes:', count);
