# OCR Accuracy Program UAT and Rollout Checklist

Branch: `feature/ocr-accuracy-program`  
Date: 2026-04-06

## 1) Pre-UAT Setup

- [ ] Apply DB migrations including:
  - `database/migrations/009_ocr_zone_profile.sql`
  - `database/migrations/010_ocr_feedback_learning.sql`
- [ ] Confirm backend test pass:
  - `npm run test:ocr-grouping`
  - `node --test src/services/ocr/ContinuationReferenceService.test.js`
- [ ] Confirm no startup errors with new OCR tables missing (graceful fallback).

## 2) Feature Flag Matrix (Staging)

- [ ] `OCR_ENABLE_VERTICAL_GROUPING=true`
- [ ] `OCR_ENABLE_ROTATION_GROUPING=true`
- [ ] `OCR_ENABLE_ZONE_NOISE_FILTER=true`
- [ ] `OCR_STAGE2_MAX_WORDS_PER_CALL=1000` (or tuned value)
- [ ] `OCR_STAGE2_MAX_FULLTEXT_CHARS=3000` (or tuned value)
- [ ] `OCR_AUTO_APPROVE_CONFIDENCE=0.95`
- [ ] `OCR_REVIEW_CONFIDENCE_MIN=0.70`

## 3) Golden-Set UAT

- [ ] Run baseline and candidate batches on same P&IDs.
- [ ] Compare with:
  - `npm run validate:ocr-golden -- baseline.json candidate.json`
- [ ] Verify multiline ISA recovery:
  - `ZLO-289920-A`, `ZSC-281053-B` and similar samples.
- [ ] Verify continuation references appear in Stage 2 cleaned outputs.
- [ ] Verify noise ratio improvement on pilot drawings.

## 4) Monitoring During UAT

- [ ] Poll `/ocr-pipeline/batches/:batchId/stage2-progress` and confirm:
  - `totalContinuationRefs`
  - `automation.autoApprove`
  - `automation.humanReview`
  - `automation.autoReject`

## 5) Go/No-Go Gates

- [ ] No critical regressions in equipment/line extraction.
- [ ] Multiline recovery improvement confirmed.
- [ ] Noise trend improved or explained by known edge cases.
- [ ] Reviewer effort reduced across 3-5 guided P&IDs.

## 6) Rollout

- [ ] Merge milestone work into umbrella branch only after UAT pass.
- [ ] Deploy with conservative thresholds.
- [ ] Keep rollback path: disable OCR flags without redeploy.
- [ ] Prepare umbrella PR to `main` after signoff.

## 7) Signoff Record

- UAT owner: ____________________  
- Date: ____________________  
- Decision: Approve / Reject  
- Notes: ____________________
