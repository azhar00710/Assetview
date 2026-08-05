import { useEffect, useMemo, useState } from 'react';
import { useStageFile, useSaveReview } from '../../hooks/useOcrPipelineV2';

/**
 * ReviewTriage
 * Phase 1 of the new end-user Review workflow. Shown BEFORE the user enters
 * the heavy detailed-review canvas so they always know "how much work do I
 * actually have to do here?".
 */

function pctOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1.5) return Math.min(100, Math.max(0, n));
  return Math.min(100, Math.max(0, n * 100));
}

function isConflictTag(tag) {
  if (!tag) return false;
  if (tag.conflictWith && Array.isArray(tag.conflictWith) && tag.conflictWith.length > 0) return true;
  const reason = String(tag.reasonCode || tag.reason_code || '').toLowerCase();
  if (reason.startsWith('conflict')) return true;
  if (!tag.type || tag.type === 'unknown') return true;
  return false;
}

export default function ReviewTriage({
  batchId,
  file,
  onClose,
  onOpenDetailedReview,
}) {
  const { data, isLoading, error, refetch } = useStageFile(batchId, file?.id, 'cleaned');
  const saveReview = useSaveReview();

  const [threshold, setThreshold] = useState(92);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  useEffect(() => {
    setThreshold(92);
    setBulkResult(null);
  }, [file?.id]);

  const classified = data?.data || null;
  const allTags = useMemo(() => classified?.tags || [], [classified]);
  const allUncertain = useMemo(() => classified?.uncertain || [], [classified]);
  const allNoise = useMemo(() => classified?.noise || [], [classified]);
  const reviewable = useMemo(
    () => [...allTags, ...allUncertain, ...allNoise],
    [allTags, allUncertain, allNoise],
  );
  const requiredCount = allTags.length + allUncertain.length;

  const counts = useMemo(() => {
    let autoAccept = 0;
    let needDecide = 0;
    let conflicts = 0;
    const autoAcceptIndices = [];
    for (let i = 0; i < requiredCount; i++) {
      const tag = reviewable[i];
      const conf = pctOf(tag?.confidence);
      const isConflict = isConflictTag(tag);
      if (isConflict) {
        conflicts += 1;
        needDecide += 1;
        continue;
      }
      if (conf != null && conf >= threshold) {
        autoAccept += 1;
        autoAcceptIndices.push(i);
      } else {
        needDecide += 1;
      }
    }
    const suggestedMissing = Array.isArray(classified?.coverageReport?.missingFromCleaned)
      ? classified.coverageReport.missingFromCleaned.length
      : (Array.isArray(classified?.visualAudit?.misses) ? classified.visualAudit.misses.length : 0);
    return { autoAccept, needDecide, conflicts, suggestedMissing, autoAcceptIndices };
  }, [reviewable, requiredCount, threshold, classified]);

  const handleBulkAccept = async () => {
    if (!batchId || !file?.id || counts.autoAcceptIndices.length === 0) return;
    setBulkRunning(true);
    setBulkResult(null);
    try {
      const decisions = counts.autoAcceptIndices.map((i) => {
        const tag = reviewable[i];
        return {
          index: i,
          tagText: tag?.text || '',
          originalType: tag?.type || 'unknown',
          action: 'approve',
          decisionSource: 'bulk_auto_accept',
          notes: `auto-accepted at >=${threshold}%`,
        };
      });
      const res = await saveReview.mutateAsync({ batchId, fileId: file.id, decisions });
      setBulkResult({ ok: true, count: decisions.length, raw: res });
      await refetch();
    } catch (e) {
      setBulkResult({ ok: false, error: e?.message || String(e) });
    } finally {
      setBulkRunning(false);
    }
  };

  const handleStartReview = () => {
    onOpenDetailedReview?.({ threshold });
  };

  if (isLoading) {
    return (
      <Shell title={file?.filename} onClose={onClose}>
        <div className="p-6 text-[12px] text-md-on-surface-variant">Loading classified tags…</div>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell title={file?.filename} onClose={onClose}>
        <div className="p-6 text-[12px] text-red-400">Triage error: {String(error?.message || error)}</div>
      </Shell>
    );
  }

  const totalReviewable = requiredCount;
  const autoAcceptPct = totalReviewable > 0 ? Math.round((counts.autoAccept / totalReviewable) * 100) : 0;

  return (
    <Shell title={file?.filename} onClose={onClose}>
      <div className="px-5 pt-4 pb-2 text-[11px] text-md-on-surface-variant">
        <span className="font-bold text-md-on-surface">{totalReviewable}</span> tags classified
        {' \u00B7 '}
        <span className="text-yellow-300">{counts.conflicts}</span> conflict{counts.conflicts === 1 ? '' : 's'}
        {' \u00B7 '}
        <span className="text-orange-300">{allUncertain.length}</span> uncertain
        {' \u00B7 '}
        <span className="text-md-on-surface-variant">{allNoise.length}</span> noise
      </div>

      <div className="px-5 pt-3 pb-4 border-b border-md-outline-variant/20">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] uppercase tracking-wide font-bold text-md-on-surface-variant">
            Auto-accept threshold
          </label>
          <div className="flex items-center gap-2">
            <span className="text-md-on-surface text-[14px] font-bold">{threshold}%</span>
            <button
              onClick={handleBulkAccept}
              disabled={bulkRunning || counts.autoAccept === 0}
              className="px-3 py-1 rounded text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/25 disabled:opacity-50"
              title={counts.autoAccept === 0
                ? 'No tags meet the threshold yet'
                : `Approve all ${counts.autoAccept} tags at >=${threshold}% in one click`}
            >
              {bulkRunning ? (
                <>
                  <span className="material-symbols-outlined text-[12px] align-middle mr-1 animate-spin">progress_activity</span>
                  approving&hellip;
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[12px] align-middle mr-1">done_all</span>
                  Bulk auto-accept ({counts.autoAccept})
                </>
              )}
            </button>
          </div>
        </div>
        <input
          type="range"
          min={70}
          max={100}
          step={1}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full accent-emerald-400"
        />
        <div className="flex justify-between text-[9px] text-md-on-surface-variant mt-0.5">
          <span>70 &mdash; review more, less risk</span>
          <span>100 &mdash; review nothing, max risk</span>
        </div>
      </div>

      <div className="px-5 py-4 grid grid-cols-2 gap-3 border-b border-md-outline-variant/20">
        <CountCard
          icon="check_circle"
          color="text-emerald-400"
          label="Will auto-accept"
          value={counts.autoAccept}
          sub={`${autoAcceptPct}% of all tags \u00b7 >=${threshold}%, no conflict`}
        />
        <CountCard
          icon="rate_review"
          color="text-orange-300"
          label="Need quick decide"
          value={counts.needDecide}
          sub="below threshold or uncertain"
        />
        <CountCard
          icon="warning"
          color="text-yellow-300"
          label="Conflicts (must resolve)"
          value={counts.conflicts}
          sub="ambiguous classification or competing groups"
        />
        <CountCard
          icon="add_box"
          color="text-cyan-300"
          label="Suggested missing"
          value={counts.suggestedMissing}
          sub="from coverage / visual audit"
        />
      </div>

      {bulkResult && (
        <div className={`mx-5 my-3 px-3 py-2 rounded text-[11px] ${bulkResult.ok ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-400/30' : 'bg-red-500/10 text-red-300 border border-red-400/30'}`}>
          {bulkResult.ok
            ? <>Auto-accepted <strong>{bulkResult.count}</strong> tag{bulkResult.count === 1 ? '' : 's'}. Open detailed review for the rest.</>
            : <>Bulk accept failed: {bulkResult.error}</>
          }
        </div>
      )}

      <div className="px-5 py-4 flex items-center justify-end gap-2 border-t border-md-outline-variant/20 bg-md-surface-container/40">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded text-[11px] font-bold text-md-on-surface-variant hover:bg-md-on-surface/10"
        >
          Cancel
        </button>
        <button
          onClick={handleStartReview}
          className="px-3 py-1.5 rounded text-[11px] font-bold bg-md-primary/20 text-md-primary border border-md-primary/40 hover:bg-md-primary/30"
          title="Open the detailed review surface for the items still needing a decision"
        >
          <span className="material-symbols-outlined text-[14px] align-middle mr-1">play_arrow</span>
          Start review ({counts.needDecide})
        </button>
      </div>
    </Shell>
  );
}

function Shell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-md-surface/95 backdrop-blur flex items-center justify-center p-6">
      <div className="w-[640px] max-w-full bg-md-surface-container rounded-lg border border-md-outline-variant/30 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-md-outline-variant/30 bg-md-surface-container-high/80">
          <span className="material-symbols-outlined text-[20px] text-md-primary">rate_review</span>
          <div className="flex-1 min-w-0">
            <div className="text-label-md font-bold text-md-on-surface truncate">
              Review triage &mdash; {title || 'unknown file'}
            </div>
            <div className="text-[10px] text-md-on-surface-variant">
              Decide how much of this drawing to auto-accept before opening the full review.
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-md-on-surface-variant hover:bg-md-on-surface/10"
            title="Close"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CountCard({ icon, color, label, value, sub }) {
  return (
    <div className="rounded border border-md-outline-variant/20 bg-md-surface-container-high/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`material-symbols-outlined text-[14px] ${color}`}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wide font-bold text-md-on-surface-variant">{label}</span>
      </div>
      <div className={`text-[22px] font-bold leading-none ${color}`}>{value}</div>
      <div className="text-[9px] text-md-on-surface-variant mt-1">{sub}</div>
    </div>
  );
}
