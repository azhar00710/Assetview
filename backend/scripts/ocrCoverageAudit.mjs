#!/usr/bin/env node
/**
 * OCR Coverage Audit — Phase 1 lossless-recall guard.
 *
 * Reads one or more Stage 2 classified JSON outputs (the files written under
 * `ocr-stages/{batchId}/classified/{filename}_classified.json`) and asserts:
 *
 *   1. coverageReport.unexplainedDrops === 0  (mass conservation)
 *   2. every reason_code in coverageReport.byReason is in the canonical set
 *   3. no candidateLedger row carries a non-canonical reason_code
 *   4. (optional, when --golden=path/to/expected.json is provided)
 *      every expected tag for each drawing landed in `kept` or `uncertain`
 *
 * Exit code 0 = pass. Non-zero = fail with a per-file diagnosis.
 *
 * Usage:
 *   node scripts/ocrCoverageAudit.mjs <classified1.json> [<classified2.json> ...]
 *   node scripts/ocrCoverageAudit.mjs --golden expected.json <classified.json>
 *   node scripts/ocrCoverageAudit.mjs --dir path/to/classified/folder
 *
 * Wire into CI via:
 *   - run a tiny fixture batch
 *   - download the classified JSONs
 *   - invoke this script with --dir
 */

import fs from 'node:fs';
import path from 'node:path';

const CANONICAL_REASON_CODES = new Set([
  'KEPT_DETERMINISTIC_STRONG',
  'KEPT_AI_CONFIRMED',
  'UNCERTAIN_LOW_CONFIDENCE',
  'UNCERTAIN_COMPETING_HYPOTHESES',
  'REJECT_PATTERN_INVALID',
  'REJECT_PARTIAL_FRAGMENT',
  'REJECT_ZONE_SUPPRESSED',
  'REJECT_AI_REJECTED',
  'REJECT_DEDUP_SUPERSEDED',
  'REJECT_ASSEMBLY_CONFLICT',
  'REJECT_NO_GEOMETRY',
]);

function usage() {
  console.log('Usage: node scripts/ocrCoverageAudit.mjs [--golden expected.json] [--dir folder] file1.json [file2.json ...]');
  console.log('');
  console.log('Asserts (per file):');
  console.log('  - coverageReport.unexplainedDrops === 0');
  console.log('  - all reason codes are in the canonical set');
  console.log('  - (with --golden) every expected tag landed in kept or uncertain');
}

function loadJson(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function listJsonFiles(dirPath) {
  const abs = path.resolve(process.cwd(), dirPath);
  return fs.readdirSync(abs)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => path.join(abs, name));
}

function parseArgs(argv) {
  const args = { files: [], goldenPath: null, dir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--golden') {
      args.goldenPath = argv[++i];
    } else if (a.startsWith('--golden=')) {
      args.goldenPath = a.split('=', 2)[1];
    } else if (a === '--dir') {
      args.dir = argv[++i];
    } else if (a.startsWith('--dir=')) {
      args.dir = a.split('=', 2)[1];
    } else if (a === '-h' || a === '--help') {
      usage();
      process.exit(0);
    } else {
      args.files.push(a);
    }
  }
  if (args.dir) {
    args.files.push(...listJsonFiles(args.dir));
  }
  return args;
}

function auditOne(filePath, goldenByDrawing) {
  const data = loadJson(filePath);
  const cr = data.coverageReport || {};
  const ledger = Array.isArray(data.candidateLedger)
    ? data.candidateLedger
    : Array.isArray(cr.candidateLedger) ? cr.candidateLedger : [];
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const uncertain = Array.isArray(data.uncertain) ? data.uncertain : [];

  const fileLabel = path.basename(filePath);
  const failures = [];
  const warnings = [];

  // Check 1 — mass conservation.
  const universe = Number(cr.candidateUniverseCount ?? 0);
  const kept = Number(cr.keptCount ?? 0);
  const unc = Number(cr.uncertainCount ?? 0);
  const rej = Number(cr.rejectedCount ?? 0);
  const drops = Number(cr.unexplainedDrops ?? Math.max(0, universe - (kept + unc + rej)));
  if (drops > 0) {
    failures.push(`unexplainedDrops=${drops} (universe=${universe}, kept=${kept}, uncertain=${unc}, rejected=${rej})`);
  }

  // Check 2 — non-canonical reason codes in coverage byReason.
  const byReason = cr.byReason && typeof cr.byReason === 'object' ? cr.byReason : {};
  const nonCanonInByReason = Object.keys(byReason).filter(r => !CANONICAL_REASON_CODES.has(r));
  if (nonCanonInByReason.length > 0) {
    failures.push(`non-canonical reason codes in byReason: ${nonCanonInByReason.join(', ')}`);
  }
  // Coverage report can also expose this directly (Phase 1.5).
  if (Array.isArray(cr.nonCanonicalReasons) && cr.nonCanonicalReasons.length > 0) {
    failures.push(`coverageReport.nonCanonicalReasons: ${cr.nonCanonicalReasons.join(', ')}`);
  }

  // Check 3 — ledger rows must all have canonical reason codes.
  const ledgerOffenders = ledger
    .filter(row => !CANONICAL_REASON_CODES.has(String(row?.reason_code || '')))
    .map(row => `${row?.text || '?'} → ${row?.reason_code || 'MISSING'}`)
    .slice(0, 8);
  if (ledgerOffenders.length > 0) {
    failures.push(`ledger rows with non-canonical reason_code (showing up to 8): ${ledgerOffenders.join('; ')}`);
  }

  // Check 4 — golden expected tags landed in kept or uncertain.
  let goldenStats = null;
  if (goldenByDrawing) {
    const drawing = String(data?.documentMetadata?.drawingNumber || data?.drawingNumber || fileLabel).toUpperCase();
    const expected = goldenByDrawing.get(drawing);
    if (expected) {
      const acceptedTexts = new Set([
        ...tags.map(t => String(t.text || '').toUpperCase()),
        ...uncertain.map(t => String(t.text || '').toUpperCase()),
      ]);
      const expectedTexts = new Set((expected.tags || []).map(t => String(t).toUpperCase()));
      const missed = [...expectedTexts].filter(t => !acceptedTexts.has(t));
      const recall = expectedTexts.size === 0 ? 1 : (expectedTexts.size - missed.length) / expectedTexts.size;
      goldenStats = {
        drawing,
        expected: expectedTexts.size,
        accepted: [...expectedTexts].filter(t => acceptedTexts.has(t)).length,
        missed: missed.length,
        recall: +(recall * 100).toFixed(2),
        sampleMissed: missed.slice(0, 8),
      };
      const minRecall = expected.minRecall ?? 0.99;
      if (recall < minRecall) {
        failures.push(`golden recall ${(recall * 100).toFixed(2)}% < required ${(minRecall * 100).toFixed(2)}% (missed: ${missed.slice(0, 8).join(', ')}${missed.length > 8 ? '…' : ''})`);
      }
    }
  }

  // Soft warnings (not failures) — useful diagnostics.
  if (universe > 0 && kept / universe < 0.5) {
    warnings.push(`low keep ratio: kept=${kept}/${universe} (${(kept / universe * 100).toFixed(1)}%)`);
  }

  return { fileLabel, failures, warnings, goldenStats, summary: { universe, kept, uncertain: unc, rejected: rej, drops } };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.files.length === 0) {
    usage();
    process.exit(1);
  }

  let goldenByDrawing = null;
  if (args.goldenPath) {
    try {
      const goldenRaw = loadJson(args.goldenPath);
      goldenByDrawing = new Map();
      const arr = Array.isArray(goldenRaw) ? goldenRaw : Array.isArray(goldenRaw.drawings) ? goldenRaw.drawings : [];
      for (const row of arr) {
        const key = String(row.drawing || row.drawingNumber || '').toUpperCase();
        if (key) goldenByDrawing.set(key, row);
      }
    } catch (err) {
      console.error(`Failed to load golden file ${args.goldenPath}: ${err.message}`);
      process.exit(2);
    }
  }

  let totalFailures = 0;
  let totalWarnings = 0;
  const reportRows = [];

  for (const filePath of args.files) {
    let result;
    try {
      result = auditOne(filePath, goldenByDrawing);
    } catch (err) {
      console.error(`✖ ${path.basename(filePath)}: failed to audit (${err.message})`);
      totalFailures++;
      continue;
    }
    const { fileLabel, failures, warnings, goldenStats, summary } = result;
    reportRows.push({ fileLabel, ...summary, failures: failures.length, warnings: warnings.length, goldenStats });

    if (failures.length === 0 && warnings.length === 0) {
      console.log(`✓ ${fileLabel}  universe=${summary.universe} kept=${summary.kept} uncertain=${summary.uncertain} rejected=${summary.rejected}${goldenStats ? `  golden recall=${goldenStats.recall}%` : ''}`);
    } else {
      if (failures.length > 0) {
        console.log(`✖ ${fileLabel}  universe=${summary.universe} kept=${summary.kept} uncertain=${summary.uncertain} rejected=${summary.rejected}`);
        for (const f of failures) console.log(`    FAIL: ${f}`);
        totalFailures++;
      } else {
        console.log(`! ${fileLabel}  universe=${summary.universe} kept=${summary.kept} uncertain=${summary.uncertain} rejected=${summary.rejected}`);
      }
      for (const w of warnings) {
        console.log(`    warn: ${w}`);
        totalWarnings++;
      }
      if (goldenStats) {
        console.log(`    golden: ${goldenStats.accepted}/${goldenStats.expected} (${goldenStats.recall}%) — missed ${goldenStats.missed}`);
      }
    }
  }

  console.log('');
  console.log(`Files audited: ${args.files.length}`);
  console.log(`Failures: ${totalFailures}`);
  console.log(`Warnings: ${totalWarnings}`);

  if (totalFailures > 0) process.exit(1);
}

main();
