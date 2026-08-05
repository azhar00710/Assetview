import { useState, useEffect, useCallback } from 'react';
import { md, alpha } from '../../lib/theme';
import useEntityDetail from '../../hooks/useEntityDetail';
import useCanvasStore from '../../canvas/store/useCanvasStore';

const PANEL_WIDTH = 320;
const CC = { high: '#FF897A', medium: '#FFD666', low: '#4FE2B0' };
const API = import.meta.env.VITE_API_URL || '/api/v1';

function Badge({ label, color }) {
  if (!label) return null;
  const bg = color || md.surfaceContainerHigh;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 9999,
        background: alpha(bg, 0.2),
        color: bg,
        letterSpacing: '0.02em',
      }}
    >
      {label}
    </span>
  );
}

function Field({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 11, color: md.onSurfaceVariant, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: md.onSurface, fontFamily: 'monospace', textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: md.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {title}
      </span>
      {children}
    </div>
  );
}

function ActionButton({ label, onClick, loading, color }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '6px 12px',
        borderRadius: 6,
        border: `1px solid ${color || md.outlineVariant}`,
        background: loading ? md.surfaceContainer : md.surfaceContainerHigh,
        color: loading ? md.onSurfaceVariant : (color || md.onSurface),
        cursor: loading ? 'wait' : 'pointer',
        textAlign: 'left',
        transition: 'background 0.15s',
        opacity: loading ? 0.7 : 1,
      }}
      onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = md.surfaceBright; }}
      onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = md.surfaceContainerHigh; }}
    >
      {loading ? `${label}...` : label}
    </button>
  );
}

function useLineDetail(lineId) {
  const [data, setData] = useState({ line: null, pnids: [], equipment: [], instruments: [], ownerSystem: null, loading: false });
  useEffect(() => {
    if (!lineId) return;
    setData((d) => ({ ...d, loading: true }));
    let cancelled = false;
    fetch(`${API}/lines/${lineId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((result) => {
        if (cancelled || !result) return;
        setData({ line: result.line, pnids: result.pnids || [], equipment: result.equipment || [], instruments: result.instruments || [], ownerSystem: result.ownerSystem, loading: false });
      })
      .catch(() => { if (!cancelled) setData((d) => ({ ...d, loading: false })); });
    return () => { cancelled = true; };
  }, [lineId]);
  return data;
}

export default function NodeDetailPanel({ node, onClose }) {
  const nodeData = node?.data || {};
  const nodeType = node?.type;
  const entityId = node?.id;
  const isLine = nodeType === 'line';
  const entityType = nodeType === 'instrument' ? 'instrument' : 'equipment';

  const { entity, pnids, line, system, loading } = useEntityDetail(isLine ? null : entityId, isLine ? null : entityType);
  const lineDetail = useLineDetail(isLine ? entityId : null);
  const selectNodeAction = useCanvasStore((s) => s.selectNode);
  const setSelectedNodeAction = useCanvasStore((s) => s.setSelectedNode);
  const setTraceResult = useCanvasStore((s) => s.setTraceResult);
  const setIsolationResult = useCanvasStore((s) => s.setIsolationResult);
  const setVisibleCrossSystems = useCanvasStore((s) => s.setVisibleCrossSystems);

  const [tracing, setTracing] = useState(false);
  const [isolating, setIsolating] = useState(false);

  const handleKeyDown = useCallback(
    (e) => { if (e.key === 'Escape') onClose(); },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const d = entity ? { ...nodeData, ...entity } : nodeData;
  const isInstrument = entityType === 'instrument';

  // ─── Trace handler ───
  const handleTrace = useCallback(async (direction) => {
    if (!entityId) return;
    setTracing(true);
    try {
      const res = await fetch(`${API}/topology/${direction}/${entityId}?maxDepth=50`);
      if (!res.ok) { setTracing(false); return; }
      const data = await res.json();

      const pathIds = [entityId, ...(data.visitedIds || data.path?.map((p) => p.entityId) || [])];
      const pathDetails = data.path || [];

      // Detect cross-system nodes
      const currentSystemId = nodeData.systemId || d.systemId;
      const crossSystemIds = [];
      for (const item of pathDetails) {
        if (item.metadata?.target_system_id && item.metadata.target_system_id !== currentSystemId) {
          crossSystemIds.push(item.metadata.target_system_id);
        }
      }
      if (crossSystemIds.length > 0) {
        setVisibleCrossSystems([...new Set(crossSystemIds)]);
      }

      setTraceResult({
        startNodeId: entityId,
        direction,
        path: pathIds,
        pathDetails,
        boundary: [],
        crossSystemIds,
      });
    } catch (err) {
      console.error(`Trace ${direction} failed:`, err);
    } finally {
      setTracing(false);
    }
  }, [entityId, nodeData.systemId, d.systemId, setTraceResult, setVisibleCrossSystems]);

  // ─── Isolation handler ───
  const handleIsolation = useCallback(async () => {
    if (!entityId) return;
    setIsolating(true);
    try {
      const res = await fetch(`${API}/topology/isolation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipmentId: entityId }),
      });
      if (!res.ok) { setIsolating(false); return; }
      const data = await res.json();
      setIsolationResult(data);
    } catch (err) {
      console.error('Find isolation failed:', err);
    } finally {
      setIsolating(false);
    }
  }, [entityId, setIsolationResult]);

  // ─── Highlight line handler ───
  const selectLine = useCanvasStore((s) => s.selectLine);
  const handleHighlightLine = useCallback(() => {
    const lineId = d.lineId || d.line_id || line?.id;
    if (lineId) selectLine(lineId);
  }, [d.lineId, d.line_id, line, selectLine]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.3)',
          zIndex: 50,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: PANEL_WIDTH,
          background: '#111D14',
          borderLeft: `1px solid ${md.outlineVariant}`,
          zIndex: 51,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInRight 0.2s ease-out',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: `1px solid ${md.outlineVariant}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: isLine ? '#3BE494' : isInstrument ? '#FFD466' : md.primary,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 700, color: md.onSurface, fontFamily: 'monospace' }}>
              {isLine ? (lineDetail.line?.lineNumber || nodeData.lineTag || 'Line') : (d.tag || 'Unknown')}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: md.onSurfaceVariant,
              fontSize: 18,
              cursor: 'pointer',
              padding: '2px 6px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {loading && (
            <span style={{ fontSize: 11, color: md.onSurfaceVariant }}>Loading details...</span>
          )}

          {/* Type + badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: md.onSurface, fontWeight: 600 }}>
              {d.equipmentType || d.instrumentType || d.eqType || d.iType || 'Unknown Type'}
            </span>
            {d.criticality && (
              <Badge label={d.criticality} color={CC[d.criticality?.toLowerCase()] || md.onSurfaceVariant} />
            )}
            {(d.silLevel || d.sil) && (
              <Badge label={`SIL ${d.silLevel || d.sil}`} color={md.silPurple} />
            )}
          </div>

          {/* Equipment fields */}
          {!isInstrument && (
            <Section title="Equipment Details">
              <Field label="Tag" value={d.tag} />
              <Field label="Type" value={d.equipmentType || d.eqType} />
              <Field label="Criticality" value={d.criticality} />
              <Field label="SIL Level" value={d.silLevel || d.sil} />
              <Field label="Line" value={line?.lineNumber || d.lineNumber} />
              <Field label="System" value={system?.code || d.systemCode} />
              <Field label="Corrosion Loop" value={d.corrosionLoop} />
              <Field label="Inspection Group" value={d.inspectionGroup} />
            </Section>
          )}

          {/* Instrument fields */}
          {isInstrument && (
            <Section title="Instrument Details">
              <Field label="Tag" value={d.tag} />
              <Field label="Type" value={d.instrumentType || d.iType} />
              <Field
                label="Range"
                value={
                  d.rangeMin != null && d.rangeMax != null
                    ? `${d.rangeMin}–${d.rangeMax} ${d.rangeUnit || ''}`
                    : null
                }
              />
              <Field label="Set Point" value={d.setPoint} />
              <Field label="SCADA Tag" value={d.scadaTag} />
              <Field label="Loop Number" value={d.loopNumber} />
              <Field label="Signal Type" value={d.signalType} />
              <Field label="Line" value={line?.lineNumber || d.lineNumber} />
              <Field label="System" value={system?.code || d.systemCode} />
            </Section>
          )}

          {/* P&IDs */}
          {pnids.length > 0 && (
            <Section title="P&ID Appearances">
              {pnids.map((p) => (
                <span
                  key={p.id}
                  style={{ fontSize: 11, color: md.secondary, fontFamily: 'monospace' }}
                >
                  {p.drawingNumber}
                </span>
              ))}
            </Section>
          )}

          {/* Actions (equipment/instrument only) */}
          {!isLine && (
            <Section title="Actions">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <ActionButton
                  label="Trace Upstream"
                  loading={tracing}
                  onClick={() => handleTrace('upstream')}
                />
                <ActionButton
                  label="Trace Downstream"
                  loading={tracing}
                  onClick={() => handleTrace('downstream')}
                />
                <ActionButton
                  label="Find Isolation"
                  loading={isolating}
                  onClick={handleIsolation}
                  color="#E74C3C"
                />
                <ActionButton label="Show on P&ID" onClick={() => {}} />
                <ActionButton label="Highlight Line" onClick={handleHighlightLine} />
              </div>
            </Section>
          )}

          {/* ─── Line Detail View ─── */}
          {isLine && lineDetail.loading && (
            <span style={{ fontSize: 11, color: md.onSurfaceVariant }}>Loading line details...</span>
          )}

          {isLine && lineDetail.line && (
            <>
              <Section title="Line Details">
                <Field label="Line Number" value={lineDetail.line.lineNumber} />
                <Field label="Service" value={lineDetail.line.service} />
                <Field label="Nominal Size" value={lineDetail.line.nominalSize} />
                <Field label="Pipe Class" value={lineDetail.line.pipeClass} />
                <Field label="Material" value={lineDetail.line.material} />
                <Field label="Design Pressure" value={lineDetail.line.designPressure} />
                <Field label="Design Temp" value={lineDetail.line.designTemperature} />
                <Field label="From" value={lineDetail.line.fromEquipmentTag} />
                <Field label="To" value={lineDetail.line.toEquipmentTag} />
              </Section>

              {lineDetail.ownerSystem && (
                <Section title="Owner System">
                  <Field label="Code" value={lineDetail.ownerSystem.code} />
                  <Field label="Name" value={lineDetail.ownerSystem.name} />
                </Section>
              )}

              {lineDetail.equipment.length > 0 && (
                <Section title={`Equipment (${lineDetail.equipment.length})`}>
                  {lineDetail.equipment.map((eq) => (
                    <button
                      key={eq.id}
                      onClick={() => {
                        selectNodeAction(eq.id);
                        setSelectedNodeAction({ id: eq.id, type: 'equipment', data: eq });
                      }}
                      style={{
                        fontSize: 11, color: md.secondary, fontFamily: 'monospace',
                        background: 'none', border: 'none', cursor: 'pointer',
                        textAlign: 'left', padding: '2px 0',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                    >
                      {eq.tag} — {eq.equipmentType}
                    </button>
                  ))}
                </Section>
              )}

              {lineDetail.instruments.length > 0 && (
                <Section title={`Instruments (${lineDetail.instruments.length})`}>
                  {lineDetail.instruments.map((inst) => (
                    <button
                      key={inst.id}
                      onClick={() => {
                        selectNodeAction(inst.id);
                        setSelectedNodeAction({ id: inst.id, type: 'instrument', data: inst });
                      }}
                      style={{
                        fontSize: 11, color: '#FFD466', fontFamily: 'monospace',
                        background: 'none', border: 'none', cursor: 'pointer',
                        textAlign: 'left', padding: '2px 0',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                    >
                      {inst.tag} — {inst.instrumentType}
                    </button>
                  ))}
                </Section>
              )}

              {lineDetail.pnids.length > 0 && (
                <Section title={`P&IDs (${lineDetail.pnids.length})`}>
                  {lineDetail.pnids.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: md.secondary, fontFamily: 'monospace' }}>
                        {p.drawingNumber}
                      </span>
                      {p.isContinuation && (
                        <Badge label="Continuation" color="#F39C12" />
                      )}
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      </div>

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(${PANEL_WIDTH}px); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
