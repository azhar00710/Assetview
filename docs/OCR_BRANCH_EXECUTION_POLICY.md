# OCR Accuracy Program Branch Execution Policy

## Objective

Ship OCR accuracy improvements without impacting `main` until milestone validation completes.

## Branch Model

- Umbrella branch: `feature/ocr-accuracy-program`
- Milestone branches (branch from umbrella):
  - `feature/ocr-multiline-rotation-grouping`
  - `feature/ocr-continuation-reference`
  - `feature/ocr-noise-zone-filtering`
  - `feature/ocr-feedback-learning-kb`
  - `feature/ocr-prompt-optimization-automation`

## Merge Flow

1. Milestone branch -> umbrella branch
2. Repeat for all milestones
3. Umbrella branch -> `main` after UAT signoff

## Required Gates Per Milestone PR

- Feature flags default to OFF.
- Baseline vs branch golden-set comparison attached.
- No regression on existing extraction/classification paths.
- Rollback path confirmed (flag disable).

## Feature Flag Convention

- Prefix: `OCR_ENABLE_`
- New logic must be guarded by flags and preserve legacy behavior when OFF.

## Test and UAT Expectations

- Golden set includes AKK4 sample P&IDs and known multi-line instrument tags.
- Validate at minimum:
  - Instrument recall
  - Bubble assembly recovery count
  - Noise ratio
  - Human edits per drawing

## Rollout

- Deploy with all OCR program flags OFF.
- Enable incrementally in staging.
- Enable per platform cohort in production.
- Disable flags immediately on metric drift.
