# OCR Milestone 1 Validation Report

Milestone: Multi-line + rotation-aware grouping  
Branch: `feature/ocr-accuracy-program`  
Date: 2026-04-06

## Scope Validated

- Vertical grouping pass for ISA-style stacked instrument tags.
- Rotation-aware grouping pass for angled text fragments.
- Feature-flag wiring from pipeline to grouping layer.
- Stage 2 prompt improvements for multiline/rotated assembly hints.

## Automated Test Evidence

Command:

```bash
cd backend
node --test src/services/ocr/WordGrouper.test.js
```

Result:
- Passed: 3
- Failed: 0
- Coverage in tests:
  - Horizontal merge (`V-1001`)
  - Vertical ISA assembly (`ZLO-289920-A`)
  - Rotated merge (`PT-281010`)

## Golden-Set Comparison Harness

A reusable comparison script was added:

```bash
cd backend
npm run validate:ocr-golden -- baseline.json candidate.json
```

Expected input format per drawing:

```json
[
  {
    "drawing": "AD-28-D-100000-SHT-001",
    "tags": ["ZLO-289920-A", "PT-281010"],
    "noise": 55,
    "uncertain": 12
  }
]
```

Output summary fields:
- `baselineTagCount`
- `candidateTagCount`
- `tagDelta`
- `baselineNoiseCount`
- `candidateNoiseCount`
- `noiseDelta`
- `recoveredTags`
- `regressions`

## Acceptance Gate for PR

- `test:ocr-grouping` must pass.
- `tagDelta >= 0`
- `recoveredTags > regressions`
- `noiseDelta <= 0` for pilot drawings (or documented exception with cause)

## Notes

- This repository snapshot does not include golden-set OCR artifacts in workspace storage, so script-based reproducibility and unit evidence are provided in this report.
- Run comparison after generating baseline/candidate extraction snapshots from staging batches.
