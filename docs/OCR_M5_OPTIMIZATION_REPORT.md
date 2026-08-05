# OCR Milestone 5 Optimization And Automation Controls

Date: 2026-04-06  
Branch: `feature/ocr-accuracy-program`

## Implemented Optimizations

## 1) Token control knobs for Stage 2 classify

Added runtime controls in `runStage2_AiClassify()`:

- `OCR_STAGE2_MAX_WORDS_PER_CALL` (default `1000`)
- `OCR_STAGE2_MAX_FULLTEXT_CHARS` (default `3000`)

These reduce token cost risk on large drawings without changing baseline behavior unless configured.

## 2) Confidence-tier automation metadata

Added confidence-tier decisions (metadata only; no direct DB auto-approve side effects):

- `auto_approve` if `confidence >= OCR_AUTO_APPROVE_CONFIDENCE` (default `0.95`)
- `human_review` if `OCR_REVIEW_CONFIDENCE_MIN <= confidence < auto-approve` (default `0.70`)
- `auto_reject` if below review threshold

Result fields now include:

- `tag.automationDecision`
- `uncertain.automationDecision`
- `stats.automation` summary counts

## 3) Stage 2 progress monitoring expansion

`/ocr-pipeline/batches/:batchId/stage2-progress` now reports:

- `totalContinuationRefs`
- `automation.autoApprove`
- `automation.humanReview`
- `automation.autoReject`

Per-file progress now carries the same counters.

## 4) Prompt enrichment from learned knowledge

Stage 2 classify and cleanup now include learned pattern context from prior review feedback where available.

## Verification

Run unit tests:

```bash
cd backend
node --test src/services/ocr/WordGrouper.test.js src/services/ocr/ContinuationReferenceService.test.js
```

Confirm Stage 2 live progress payload includes automation totals.
