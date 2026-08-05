import { useStagingTraceability } from '../../hooks/useOcrPipelineV2';

const STEP_COLORS = {
  ocr: '#8AB4FF',
  review: '#F39C12',
  staging: '#A855F7',
  apply: '#3BE494',
  entity: '#3BE494',
  annotation: '#FF6B6B',
};

function TimelineStep({ icon, color, title, subtitle, detail, isLast }) {
  return (
    <div className="flex gap-2">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `${color}20`, border: `2px solid ${color}` }}
        >
          <span className="material-symbols-outlined text-[14px]" style={{ color }}>{icon}</span>
        </div>
        {!isLast && (
          <div className="w-0.5 flex-1 min-h-[16px]" style={{ background: `${color}30` }} />
        )}
      </div>
      {/* Content */}
      <div className="pb-3 flex-1 min-w-0">
        <div className="text-[11px] font-bold text-md-on-surface">{title}</div>
        {subtitle && <div className="text-[10px] text-md-on-surface-variant">{subtitle}</div>}
        {detail && (
          <div className="mt-1 text-[9px] text-md-on-surface-variant bg-md-surface-container/50 rounded px-2 py-1 font-mono">
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function TagTraceabilityPanel({ platformId, itemId, onClose }) {
  const { data, isLoading, isError, error } = useStagingTraceability(platformId, itemId);

  if (!itemId) return null;

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-[#A855F7]">timeline</span>
          <span className="text-label-sm font-bold text-md-on-surface">Tag Traceability</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="md-icon-btn w-6 h-6">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-[11px] text-md-on-surface-variant py-4 justify-center">
          <span className="material-symbols-outlined animate-spin">progress_activity</span>
          Loading traceability chain…
        </div>
      )}

      {isError && (
        <div className="text-[11px] text-red-400 py-2">{error?.message || 'Failed to load traceability'}</div>
      )}

      {data && (
        <div className="space-y-0">
          {/* Step 1: P&ID Source */}
          {data.pnid && (
            <TimelineStep
              icon="description"
              color={STEP_COLORS.ocr}
              title={`P&ID: ${data.pnid.drawingNumber}`}
              subtitle={`${data.pnid.title || 'Untitled'} · Rev ${data.pnid.revision || '—'} · Status: ${data.pnid.status}`}
              detail={`pnid_id: ${data.pnid.id}`}
            />
          )}

          {/* Step 2: OCR Extraction */}
          {data.extraction && (
            <TimelineStep
              icon="document_scanner"
              color={STEP_COLORS.ocr}
              title={`OCR Extraction: "${data.extraction.text}"`}
              subtitle={[
                `Type: ${data.extraction.tagType}`,
                `Confidence: ${(data.extraction.confidence * 100).toFixed(0)}%`,
                `Match: ${data.extraction.matchMethod || '—'} (${(data.extraction.matchConfidence * 100).toFixed(0)}%)`,
                `Status: ${data.extraction.status}`,
              ].join(' · ')}
              detail={[
                `extraction_id: ${data.extraction.id}`,
                `bbox: (${data.extraction.bbox.xPct}%, ${data.extraction.bbox.yPct}%) ${data.extraction.bbox.wPct}×${data.extraction.bbox.hPct}`,
                data.extraction.ocrJob ? `job: ${data.extraction.ocrJob.id.slice(0, 8)}… (${data.extraction.ocrJob.status})` : null,
                data.extraction.reviewedBy ? `reviewed by: ${data.extraction.reviewedBy} at ${formatDate(data.extraction.reviewedAt)}` : null,
              ].filter(Boolean).join('\n')}
            />
          )}

          {/* Step 3: Register Staging */}
          <TimelineStep
            icon="inventory_2"
            color={STEP_COLORS.staging}
            title={`Staging: ${data.stagingItem.actionType.replace('_', ' ')} (${data.stagingItem.entityKind})`}
            subtitle={[
              `Batch: ${data.stagingItem.batchName || '—'}`,
              `Drawing: ${data.stagingItem.drawingNumber || '—'}`,
              `Status: ${data.stagingItem.status}`,
              `Created: ${formatDate(data.stagingItem.createdAt)}`,
            ].join(' · ')}
            detail={`staging_item_id: ${data.stagingItem.id}`}
          />

          {/* Step 4: Apply Run */}
          {data.applyRun && (
            <TimelineStep
              icon="play_circle"
              color={STEP_COLORS.apply}
              title={`Applied by ${data.applyRun.appliedBy}`}
              subtitle={[
                `At: ${formatDate(data.applyRun.createdAt)}`,
                data.applyRun.summary?.applied != null ? `Applied: ${data.applyRun.summary.applied}` : null,
                data.applyRun.summary?.annotationBatchesMarked ? `Annotation batches: ${data.applyRun.summary.annotationBatchesMarked}` : null,
              ].filter(Boolean).join(' · ')}
              detail={`apply_run_id: ${data.applyRun.id}`}
            />
          )}

          {/* Step 5: Entity in Register */}
          {data.entity && (
            <TimelineStep
              icon={data.entity.kind === 'equipment' ? 'precision_manufacturing' : data.entity.kind === 'instrument' ? 'sensors' : data.entity.kind === 'line' ? 'linear_scale' : 'hub'}
              color={STEP_COLORS.entity}
              title={`${data.entity.kind}: ${data.entity.tag}`}
              subtitle={[
                data.entity.system_code ? `System: ${data.entity.system_code}` : null,
                data.entity.equipment_type || data.entity.instrument_type || data.entity.service || null,
                data.entity.description || null,
              ].filter(Boolean).join(' · ')}
              detail={`entity_id: ${data.entity.id}`}
            />
          )}

          {/* Step 6: Junction Position */}
          {data.junctionPosition && (
            <TimelineStep
              icon="pin_drop"
              color={STEP_COLORS.entity}
              title="Position on P&ID"
              subtitle={[
                `(${data.junctionPosition.xPct?.toFixed(1)}%, ${data.junctionPosition.yPct?.toFixed(1)}%)`,
                data.junctionPosition.wPct ? `${data.junctionPosition.wPct?.toFixed(1)}×${data.junctionPosition.hPct?.toFixed(1)}` : null,
                data.junctionPosition.positionVerified ? 'Verified ✓' : 'Unverified',
              ].filter(Boolean).join(' · ')}
            />
          )}

          {/* Step 7: Annotation */}
          {data.annotation && (
            <TimelineStep
              icon="draw"
              color={STEP_COLORS.annotation}
              title={`Annotation: ${data.annotation.label || '—'}`}
              subtitle={[
                `Color: ${data.annotation.color}`,
                `Status: ${data.annotation.approvalStatus}`,
                `Created: ${formatDate(data.annotation.createdAt)}`,
              ].join(' · ')}
              detail={`annotation_id: ${data.annotation.id}`}
              isLast={data.changeLogs.length === 0}
            />
          )}

          {/* Change Log */}
          {data.changeLogs.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] font-bold text-md-on-surface-variant uppercase tracking-wide mb-1">
                Change History ({data.changeLogs.length})
              </div>
              <div className="space-y-1 max-h-28 overflow-auto">
                {data.changeLogs.map((cl, i) => (
                  <div key={i} className="flex items-start gap-2 text-[9px] text-md-on-surface-variant">
                    <span className="text-[8px] opacity-50 whitespace-nowrap">{formatDate(cl.createdAt)}</span>
                    <span className="font-mono">{cl.action}</span>
                    <span className="opacity-60">by {cl.createdBy || '—'}</span>
                    <span className="opacity-40">({cl.source})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No data indicators */}
          {!data.extraction && !data.entity && (
            <TimelineStep
              icon="help"
              color="#919A9B"
              title="Limited traceability"
              subtitle="No OCR extraction or entity linked to this staging item"
              isLast
            />
          )}
        </div>
      )}
    </div>
  );
}
