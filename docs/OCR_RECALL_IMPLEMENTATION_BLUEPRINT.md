# OCR Recall Reliability Blueprint (File-by-File)

Date: 2026-04-16  
Owner: OCR Pipeline Team  
Scope: Deterministic-first structured tag extraction with full candidate ledger and no hidden drops.

## 1) What This Blueprint Changes

Current issue: important tags are still dropped between raw OCR and cleaned output, and many misses collapse into generic `regex_failed`.

Target state:

- deterministic structured extraction first
- AI only for ambiguity/disambiguation
- every candidate gets one terminal outcome
- explicit provenance + confidence per candidate
- coverage accounting uses one consistent universe

This blueprint maps exact changes to:

- `backend/src/services/ocr/OcrPipeline.js`
- `backend/src/services/ocr/WordGrouper.js`
- `frontend/src/components/ocr-pipeline/BatchReviewPanel.jsx`
- DB schema/migrations for candidate ledger + reason codes

---

## 2) Canonical Stage Contracts

All contracts below are the canonical interface between stages.

## 2.1 Shared Types

```ts
type CandidateType = 'instrument' | 'equipment' | 'line' | 'drawing_ref' | 'valve' | 'unknown';

type CandidateSource =
  | 'raw_single'
  | 'horizontal_group'
  | 'vertical_stack'
  | 'rotated_group'
  | 'structured_row'
  | 'symbol_region_fusion'
  | 'ai_disambiguation';

type TerminalOutcome = 'kept' | 'uncertain' | 'rejected';

type ReasonCode =
  | 'KEPT_DETERMINISTIC_STRONG'
  | 'KEPT_AI_CONFIRMED'
  | 'UNCERTAIN_LOW_CONFIDENCE'
  | 'UNCERTAIN_COMPETING_HYPOTHESES'
  | 'REJECT_PATTERN_INVALID'
  | 'REJECT_PARTIAL_FRAGMENT'
  | 'REJECT_ZONE_SUPPRESSED'
  | 'REJECT_AI_REJECTED'
  | 'REJECT_DEDUP_SUPERSEDED'
  | 'REJECT_ASSEMBLY_CONFLICT'
  | 'REJECT_NO_GEOMETRY';

type CandidateLedgerEntry = {
  candidate_id: string;                // stable UUID
  run_id: string;                      // OCR run/job reference
  drawing_id: string;
  text_raw: string;
  text_normalized: string;
  type_predicted: CandidateType;
  source: CandidateSource;
  source_stage: 'S1' | 'S1_5' | 'S2_DET' | 'S2_AI' | 'S2_POST';
  assembly_rule: string | null;        // e.g. vertical_stack_v2
  token_word_indices: number[];        // from OCR words
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  confidence_det: number | null;       // deterministic score
  confidence_ai: number | null;        // AI score if used
  confidence_final: number;            // final score used by UI
  terminal_outcome: TerminalOutcome;
  reason_code: ReasonCode;
  reason_detail: string | null;
  superseded_by_candidate_id: string | null;
  created_at: string;
};
```

## 2.2 Stage Interface: S1 -> S2_DET

`S1` output contract (already mostly present):

```ts
type Stage1Output = {
  words: Array<{ text: string; confidence?: number; vertices: Array<{x:number;y:number}> }>;
  fullText: string;
  pageWidth: number;
  pageHeight: number;
  symbolRegions: Array<{ id: string; label: string; score: number; bbox: {x:number;y:number;w:number;h:number} }>;
  provider: string;
};
```

`S2_DET` input must be exactly `Stage1Output` plus dictionary.

## 2.3 Stage Interface: S2_DET -> S2_AI

AI receives only ambiguous candidates, not full raw universe:

```ts
type AiDisambiguationInput = {
  drawingNumber: string;
  candidates: Array<{
    candidate_id: string;
    text_normalized: string;
    type_predicted: CandidateType;
    source: CandidateSource;
    bbox: { minX:number; minY:number; maxX:number; maxY:number } | null;
    confidence_det: number;
    competing_with_candidate_ids: string[];
  }>;
  dictionaryHints: Array<{ function_code: string; entity_type: string; tag_pattern?: string }>;
};
```

Output:

```ts
type AiDisambiguationOutput = Array<{
  candidate_id: string;
  decision: 'keep' | 'uncertain' | 'reject';
  reason_code: 'KEPT_AI_CONFIRMED' | 'UNCERTAIN_COMPETING_HYPOTHESES' | 'REJECT_AI_REJECTED';
  confidence_ai: number;
  explanation: string;
}>;
```

## 2.4 Final Contract: Stage2 Classified JSON

Replace ad-hoc counters with ledger-derived summary:

```ts
type Stage2ClassifiedOutput = {
  tags: Array<any>;
  uncertain: Array<any>;
  noise: Array<any>;
  ledger: CandidateLedgerEntry[];      // optional full (or capped list + storage reference)
  coverageReport: {
    candidateUniverseCount: number;
    keptCount: number;
    uncertainCount: number;
    rejectedCount: number;
    byReason: Record<ReasonCode, number>;
    byType: Record<CandidateType, { kept: number; uncertain: number; rejected: number }>;
    unexplainedDrops: number;           // must be 0
  };
};
```

---

## 3) File-by-File Implementation Plan

## 3.1 `backend/src/services/ocr/WordGrouper.js`

### Change goals

- make vertical/stacked assembly deterministic and conflict-safe
- prevent wrong prefix-number pairing in nearby bubbles
- produce assembly metadata for ledger

### Required updates

1. Add `groupStructuredCandidates(words, options)` returning candidate objects (not only merged text groups).
2. Replace top-first vertical matching with number-anchored matching.
3. Add conflict resolution when multiple prefixes compete for same number token.
4. Emit `assembly_rule`, `assembly_score`, `componentWordIndices`.

### New function contract

```ts
export function groupStructuredCandidates(
  words: OCRWord[],
  options: {
    enableVerticalGrouping: boolean;
    enableRotationGrouping: boolean;
    maxGapPx: number;
    yOverlapThreshold: number;
  }
): Array<{
  text: string;
  normalizedText: string;
  candidateTypeHint: CandidateType | 'unknown';
  source: CandidateSource;
  assemblyRule: string;
  assemblyScore: number;
  componentWordIndices: number[];
  vertices: Array<{x:number;y:number}>;
}>;
```

### Vertical grouping redesign (mandatory)

- anchor on numeric token (`^\d{3,7}$`)
- score prefix/suffix candidates by:
  - x-center alignment
  - y-order validity
  - gap consistency
  - lexical fit (`^[A-Z]{2,5}$` prefix, `^[A-Z0-9]{1,3}$` suffix)
- build top-N hypotheses per number
- keep best if margin >= `VERTICAL_MIN_MARGIN`, else mark competing hypotheses for AI

### Unit tests to add

- near stacks with competing prefixes (`XA`, `XS`, `ZLC` around same loop number)
- missing suffix and noisy suffix
- rotated vertical stacks
- duplicate token prevention (no token reused across accepted stacks without explicit conflict)

---

## 3.2 `backend/src/services/ocr/OcrPipeline.js`

### Change goals

- make deterministic pipeline primary
- AI only for ambiguous candidates
- replace fallback `regex_failed` with explicit reason codes
- emit candidate ledger and exact coverage accounting

### Required refactor blocks

1. Add deterministic candidate builder phase (`buildDeterministicCandidates`).
2. Add candidate validator phase (`validateStructuredCandidate`).
3. Add terminalizer (`finalizeCandidateOutcome`) that guarantees one terminal reason.
4. Replace current `missingFromCleaned` logic with ledger-derived report.

### New internal functions

```ts
function buildDeterministicCandidates(stage1: Stage1Output, dictionary: TagDictionary[]): CandidateLedgerEntry[];
function validateStructuredCandidate(c: CandidateLedgerEntry): { valid: boolean; reasonCode?: ReasonCode };
function resolveCandidateConflicts(candidates: CandidateLedgerEntry[]): CandidateLedgerEntry[];
function runAiDisambiguation(input: AiDisambiguationInput): Promise<AiDisambiguationOutput>;
function finalizeLedger(candidates: CandidateLedgerEntry[], aiOut: AiDisambiguationOutput): CandidateLedgerEntry[];
function buildCoverageFromLedger(ledger: CandidateLedgerEntry[]): Stage2ClassifiedOutput['coverageReport'];
```

### Mandatory behavior changes

- Remove default fallback reason assignment (`let reason = 'regex_failed'`).
- Any rejected candidate must carry explicit `reason_code`.
- `coverageReport.unexplainedDrops` computed as:
  - `candidateUniverseCount - (keptCount + uncertainCount + rejectedCount)` and must be 0.
- `retained/uncertain/missing` counts must come from same universe (`ledger`), not global text sets.

### Compatibility

Keep `tags/noise/uncertain` arrays for UI compatibility; add `ledger` and new `coverageReport`.

---

## 3.3 `frontend/src/components/ocr-pipeline/BatchReviewPanel.jsx`

### Change goals

- show reason-code accurate coverage
- avoid misleading bucket labels (`regex_failed`)
- support drilldown by terminal reason and provenance

### Required updates

1. Replace current reason pill generation from `missingFromCleaned.reason` with `coverageReport.byReason`.
2. Add explicit legend for terminal outcomes:
   - kept
   - uncertain
   - rejected (by reason code)
3. Add per-candidate provenance chips in missing/reject panel:
   - source (`vertical_stack`, `raw_single`, etc.)
   - assembly rule
   - confidence final
4. Add "explain drop" action: open ledger detail modal for selected candidate.

### UI data contract

```ts
type CoveragePanelData = {
  candidateUniverseCount: number;
  keptCount: number;
  uncertainCount: number;
  rejectedCount: number;
  byReason: Record<string, number>;
  byType: Record<string, { kept: number; uncertain: number; rejected: number }>;
  unexplainedDrops: number;
};
```

### Guardrails in UI

- if `unexplainedDrops > 0`, show red integrity banner
- do not display `regex_failed` as a bucket (remove after backend migration)

---

## 3.4 `backend/src/routes/ocrPipeline.js`

### Change goals

- expose ledger-backed coverage payload
- add optional endpoint to fetch full ledger rows

### API additions

1. Extend existing stage-file response for `cleaned` to include new `coverageReport`.
2. Add endpoint:
   - `GET /api/v1/ocr-pipeline/files/:fileId/candidate-ledger?outcome=&reason=&limit=&offset=`

Response:

```json
{
  "items": [],
  "total": 0,
  "limit": 100,
  "offset": 0
}
```

---

## 3.5 DB Schema: Candidate Ledger + Reason Codes

Create migration file: `database/migrations/017_ocr_candidate_ledger.sql`

### Tables

```sql
CREATE TABLE IF NOT EXISTS ocr_candidate_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ocr_job_id UUID NOT NULL REFERENCES ocr_job(id) ON DELETE CASCADE,
  pnid_id UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
  extraction_stage VARCHAR(16) NOT NULL DEFAULT 'stage2',
  candidate_text_raw TEXT NOT NULL,
  candidate_text_norm TEXT NOT NULL,
  candidate_type VARCHAR(32) NOT NULL,
  source VARCHAR(64) NOT NULL,
  source_stage VARCHAR(16) NOT NULL,
  assembly_rule VARCHAR(64),
  assembly_score NUMERIC(6,4),
  word_indices JSONB NOT NULL DEFAULT '[]'::jsonb,
  bbox JSONB,
  confidence_det NUMERIC(6,4),
  confidence_ai NUMERIC(6,4),
  confidence_final NUMERIC(6,4) NOT NULL,
  terminal_outcome VARCHAR(16) NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  reason_detail TEXT,
  superseded_by_candidate_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_candidate_ledger_job ON ocr_candidate_ledger(ocr_job_id);
CREATE INDEX IF NOT EXISTS idx_ocr_candidate_ledger_pnid ON ocr_candidate_ledger(pnid_id);
CREATE INDEX IF NOT EXISTS idx_ocr_candidate_ledger_outcome ON ocr_candidate_ledger(terminal_outcome, reason_code);
CREATE INDEX IF NOT EXISTS idx_ocr_candidate_ledger_text ON ocr_candidate_ledger(candidate_text_norm);
```

### Reason code registry (optional but recommended)

```sql
CREATE TABLE IF NOT EXISTS ocr_reason_code (
  code VARCHAR(64) PRIMARY KEY,
  terminal_outcome VARCHAR(16) NOT NULL,
  description TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
```

Seed mandatory reason codes listed in Section 2.1.

---

## 4) Reason Taxonomy (Production Set v1)

Remove ambiguous buckets. Use only these terminal reason codes in production:

- `KEPT_DETERMINISTIC_STRONG`
- `KEPT_AI_CONFIRMED`
- `UNCERTAIN_LOW_CONFIDENCE`
- `UNCERTAIN_COMPETING_HYPOTHESES`
- `REJECT_PATTERN_INVALID`
- `REJECT_PARTIAL_FRAGMENT`
- `REJECT_ZONE_SUPPRESSED`
- `REJECT_AI_REJECTED`
- `REJECT_DEDUP_SUPERSEDED`
- `REJECT_ASSEMBLY_CONFLICT`
- `REJECT_NO_GEOMETRY`

Policy:

- `regex_failed` and `grouping_failed` are deprecated labels and must not be emitted after migration.

---

## 5) Partial Fragment Guardrails

Guardrail rules for final outputs:

1. Tags shorter than 5 chars cannot be auto-kept as structured tags.
2. Prefix-only tokens (examples: `ZLC`, `LAL`, `PAL`, `XA`) always route to:
   - `REJECT_PARTIAL_FRAGMENT`, or
   - `UNCERTAIN_LOW_CONFIDENCE` if explicitly configured for review queue.
3. If candidate text is strict-structured invalid for predicted type -> `REJECT_PATTERN_INVALID`.
4. If candidate is superseded by stronger overlapping candidate -> `REJECT_DEDUP_SUPERSEDED`.

---

## 6) Migration Plan (3 Phases)

## Phase A: Quick Wins (Low Risk, 1 sprint)

- implement reason code taxonomy and deprecate `regex_failed`
- add ledger object in memory + classified JSON output
- update coverage panel to read `coverageReport.byReason`
- add integrity metric (`unexplainedDrops`)

Exit gate:

- unexplained drops = 0 on all test drawings
- no legacy reason codes emitted

## Phase B: Structural Simplification (1-2 sprints)

- move deterministic grouping/validation before AI
- ship number-anchored vertical stack assembler
- AI disambiguation only for conflicts/ambiguity
- persist ledger in `ocr_candidate_ledger`

Exit gate:

- instrument recall >= 99% on stacked-tag test set
- precision >= 96%

## Phase C: Hardening + Validation (ongoing)

- add conflict dashboards by prefix family (`XA/XS/ZLC`)
- per-type recall tracking in CI/UAT
- audit endpoint and reviewer explainability tooling

Exit gate:

- overall structured recall >= 98%
- max unexplained drops = 0
- stable metrics across 3 consecutive batches

---

## 7) Test Protocol and Acceptance Gates

Required acceptance metrics:

- recall target:
  - overall structured recall >= 98%
  - instrument recall >= 99% (stacked subset)
- precision floor:
  - overall precision >= 96%
- accounting integrity:
  - `unexplainedDrops = 0`
- per-type recall:
  - instrument >= 99%
  - equipment >= 97%
  - line >= 98%
  - drawing_ref >= 97%

Required regression cases:

- adjacent vertical bubbles with similar prefixes
- OCR-split tags across 2-4 tokens
- rotated/inclined tags
- dense title block/noise zones

---

## 8) Engineering Task Breakdown

Backend tasks:

1. `WordGrouper.js`: implement `groupStructuredCandidates` + conflict scoring.
2. `OcrPipeline.js`: deterministic-first orchestration + ledger finalization.
3. `ocrPipeline.js` route: return and paginate ledger.
4. Migration `017_ocr_candidate_ledger.sql`.

Frontend tasks:

1. coverage panel rewrite to reason-code summary.
2. candidate ledger drilldown UI.
3. integrity banner for unexplained drops.

QA tasks:

1. seed benchmark drawings including AD-28-D-100001-SHT-001.
2. validate per-type recall and reason-code integrity.

---

## 9) Rollback and Fallback

- feature flag: `OCR_LEDGER_MODE=true|false`
- feature flag: `OCR_AI_AMBIGUOUS_ONLY=true|false`
- if precision regression > 2 points:
  - keep deterministic candidate generation,
  - route low-margin candidates to uncertain,
  - temporarily relax auto-keep thresholds,
  - do not re-enable legacy generic reasons.

---

## 10) Definition of Done

Done means:

1. every candidate has one terminal outcome and one reason code
2. no hidden drops and `unexplainedDrops` is always 0
3. UI can explain exactly why any candidate was not kept
4. stacked bubble tags (XA/XS/ZLC family) pass recall gate
5. AI is only used for ambiguous candidates, not broad first-pass extraction

