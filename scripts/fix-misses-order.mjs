/**
 * Fix temporal-dead-zone error: `misses` was added as a dep of `queue`'s
 * useMemo but is declared AFTER `queue`.  Move the `misses` useMemo (and
 * the helper `statusOf` it sits next to) to BEFORE the `queue` useMemo.
 */
import fs from 'node:fs';

const path = 'frontend/src/components/ocr-pipeline/ReviewCanvas.jsx';
let src = fs.readFileSync(path, 'utf8');

// 1) Capture the misses block (comment + useMemo).
const missesBlockRe = /\n  \/\/ Coverage \/ visual-audit suggested misses\.[\s\S]+?\}, \[classified\]\);\n/;
const missesMatch = src.match(missesBlockRe);
if (!missesMatch) throw new Error('Could not locate misses useMemo block');
const missesBlock = missesMatch[0];

// 2) Capture the statusOf block.  It depends on isPending which is declared
//    earlier, so it can move with misses safely.
const statusOfBlockRe = /\n  \/\/ Status string used for icons \+ tooltips[\s\S]+?\}, \[decisions, isPending\]\);\n/;
const statusOfMatch = src.match(statusOfBlockRe);
if (!statusOfMatch) throw new Error('Could not locate statusOf useCallback block');
const statusOfBlock = statusOfMatch[0];

// 3) Remove both blocks from their current location.
src = src.replace(missesBlock, '\n');
src = src.replace(statusOfBlock, '\n');

// 4) Reinsert both blocks BEFORE the queue useMemo.
const queueAnchor = '  // ── Build the queue (visible items, ordered by user choice) ────────────';
if (!src.includes(queueAnchor)) throw new Error('Queue anchor not found');
src = src.replace(
  queueAnchor,
  missesBlock.trimEnd() + '\n\n' + statusOfBlock.trimEnd() + '\n\n' + queueAnchor,
);

fs.writeFileSync(path, src, 'utf8');

// Verify ordering: misses must appear before queue; queue must appear before
// the focusTag computation.
const idxMisses  = src.indexOf('const misses = useMemo');
const idxStatus  = src.indexOf('const statusOf = useCallback');
const idxQueue   = src.indexOf('const queue = useMemo');
const idxFocus   = src.indexOf('const focusTag = queue[');
console.log('order:',
  '\n  misses     @', idxMisses,
  '\n  statusOf   @', idxStatus,
  '\n  queue      @', idxQueue,
  '\n  focusTag   @', idxFocus,
);
if (!(idxMisses < idxQueue && idxStatus < idxQueue && idxQueue < idxFocus)) {
  throw new Error('Ordering check failed');
}

const after = fs.readFileSync(path);
console.log('first6:', Array.from(after.slice(0, 6)).map(x => x.toString(16).padStart(2, '0')).join(' '));
console.log('OK: misses now declared before queue');
