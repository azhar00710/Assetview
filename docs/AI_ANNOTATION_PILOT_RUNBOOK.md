# AI Annotation Pilot Runbook (Option A, 3-5 P&IDs)

## 1) Freeze Scope and Sample Set

Use one fixed sample set for both control and treatment runs.

| Slot | Required profile | Candidate drawing | Selected |
|---|---|---|---|
| P1 | Clean drawing (low noise) |  |  |
| P2 | Noisy scan / skewed text |  |  |
| P3 | Dense instrumentation |  |  |
| P4 | Off-sheet continuation stress (optional) |  |  |
| P5 | Mixed symbology stress (optional) |  |  |

Rules:
- Keep drawing IDs frozen after kickoff.
- Use the same reviewer role for baseline and AI-native.
- Timebox per drawing (recommended: 20 min cap).

## 2) Pilot Enablement

Backend env:
- `AI_ANNOTATE_PILOT_ENABLED=true`

Frontend env:
- `VITE_AI_ANNOTATE_PILOT_ENABLED=true`

Optional provider flags:
- `TREX2_API_KEY=...`
- `TREX2_API_URL=...`
- `GROUNDING_DINO_API_URL=...`
- `GROUNDING_DINO_API_KEY=...` (optional, endpoint dependent)
- `ANTHROPIC_API_KEY=...`

API smoke checks:
- `GET /api/v1/ai/models`
- `POST /api/v1/ai/annotate`
- `POST /api/v1/ai/annotate/accept`

Important:
- Current pilot path is visual detection first (T-Rex2 preferred, GroundingDINO fallback) plus OCR-per-detection for tag extraction.
- If no visual provider endpoint is configured, `Find Similar` is intentionally disabled.

## 3) Success Criteria (Go/No-Go)

Primary:
- >=30% reduction in `review_time_seconds` vs OCR-first baseline.
- >=30% reduction in `reviewer_decisions` vs OCR-first baseline.
- `accepted / (accepted + rejected)` >= 0.95 for AI suggestions.

Secondary:
- `uncertain / total_detections` <= 0.15
- Non-zero useful new tag discovery.
- No blocking UX/API failures.

## 4) Execution Sequence

1. Baseline run (OCR-first)
2. AI-native run (few-shot -> detect -> review -> accept)
3. Consolidate metrics and rejection taxonomy
4. Decide Go / Iterate / Stop

## 5) Where to Capture Results

- Baseline and treatment rows: `docs/pilot/ai_annotation_pilot_results.csv`
- Rejection reasons: `docs/pilot/ai_annotation_rejection_taxonomy.csv`
- Decision summary: `docs/pilot/ai_annotation_go_no_go.md`

