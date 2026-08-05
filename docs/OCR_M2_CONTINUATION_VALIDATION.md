# OCR Milestone 2 Continuation Reference Validation

Milestone: Continuation connector extraction  
Branch: `feature/ocr-accuracy-program`  
Date: 2026-04-06

## What Was Added

- New detector: `backend/src/services/ocr/ContinuationReferenceService.js`
- Stage 2 integration: `runStage2_AiClassify()` now returns `continuationReferences` and `continuationReferenceCount`.
- Unit harness: `backend/src/services/ocr/ContinuationReferenceService.test.js`

## Detection Contract

Each detected reference follows:

```json
{
  "type": "continuation_reference",
  "targetDrawing": "AD-28-D-100005-SHT-001",
  "connectorId": "1126",
  "lineNumber": "8\"-H-28-12-0121-J85S-N",
  "direction": "from",
  "confidence": 0.85
}
```

## Validation Command

```bash
cd backend
node --test src/services/ocr/ContinuationReferenceService.test.js
```

## Current Test Evidence

- 1 synthetic triad scenario passes:
  - drawing cross-reference
  - connector numeric ID
  - nearby line-like number

## Next-Step Field Validation

Run Stage 2 on real AD-28 callout drawings, then inspect the cleaned output JSON:

- Confirm `continuationReferences` exists.
- Confirm `targetDrawing` and `connectorId` match known arrows.
- Measure precision before enabling any automated downstream linking.
