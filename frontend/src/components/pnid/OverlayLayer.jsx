import { useMemo } from 'react';
import { md, systemColor } from '../../lib/theme';

// Fixed entity-type colors (M3 design tokens)
const ENTITY_COLORS = {
  equipment: '#4FE2B0',
  instrument: '#8AB4FF',
  line: '#FFB068',
};

const TYPE_ICONS = {
  'Christmas Tree': 'XT',
  'Choke Valve': 'CV',
  'Safety Valve': 'SV',
  'Spectacle Blind': 'SB',
  'Header': 'HD',
  'Package': 'PK',
  'Vessel': 'VS',
  pressure: 'PT',
  temperature: 'TT',
  flow: 'FT',
  level: 'LT',
  safety_valve: 'PSV',
  control_valve: 'CV',
  analyzer: 'AT',
};

const EQUIPMENT_SHAPE = {
  'Vessel': 'rounded',
  'Package': 'rounded',
  'Header': 'rounded',
  'Christmas Tree': 'diamond',
  'Choke Valve': 'circle',
  'Safety Valve': 'circle',
  'Spectacle Blind': 'circle',
};

function getShapeStyle(equipmentType) {
  const shape = EQUIPMENT_SHAPE[equipmentType] || 'rect';
  switch (shape) {
    case 'circle': return 'rounded-full';
    case 'rounded': return 'rounded-lg';
    case 'diamond': return 'rounded-sm';
    default: return 'rounded-sm';
  }
}

export default function OverlayLayer({
  overlay,
  filter,
  systemColors,
  onEntityClick,
  selectedEntityId,
  highlightEntityId,
  relatedHighlightIds = [],
  annotations = [],
  colorMode = 'entity', // 'entity' = fixed M3 colors per type | 'system' = system-type colors
  displayMode = 'both', // 'both' | 'shapes' | 'text'
  onSheetNavigate, // (pnidId) => navigate to another P&ID sheet
  showUnpositionedLineList = true,
  hideLinkedEntities = false,
}) {
  const showShapes = displayMode !== 'text';
  const showText = displayMode !== 'shapes';
  const showEquipment = filter === 'all' || filter === 'equipment';
  const showInstruments = filter === 'all' || filter === 'instruments';
  const showLines = filter === 'all' || filter === 'lines';

  // Build set of linked entity IDs and approval status from annotations
  const linkedEntityIds = useMemo(() => {
    const ids = new Set();
    annotations.forEach(a => {
      if (a.linkedEntityId) ids.add(a.linkedEntityId);
    });
    return ids;
  }, [annotations]);

  // Map entity ID → approval status (approved if ANY linked annotation is approved)
  const entityApprovalMap = useMemo(() => {
    const map = {};
    annotations.forEach(a => {
      if (a.linkedEntityId) {
        if (a.approvalStatus === 'approved') {
          map[a.linkedEntityId] = 'approved';
        } else if (!map[a.linkedEntityId]) {
          map[a.linkedEntityId] = 'draft';
        }
      }
    });
    return map;
  }, [annotations]);

  return (
    <div className="absolute inset-0" style={{ minWidth: '1200px', minHeight: '800px' }}>
      {/* Highlight pulse animation styles */}
      {highlightEntityId && (
        <style>{`
          @keyframes overlay-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,215,0,0.7); } 50% { box-shadow: 0 0 16px 6px rgba(255,215,0,0.4); } }
          [data-entity-id="${highlightEntityId}"] > div:first-child { animation: overlay-pulse 0.8s ease-in-out 3 !important; }
        `}</style>
      )}
      {relatedHighlightIds.length > 0 && (
        <style>{`
          ${relatedHighlightIds.map((id) => `
            [data-entity-id="${id}"] > div:first-child {
              box-shadow: 0 0 10px 3px rgba(45,51,224,0.55) !important;
              border-color: #2D33E0 !important;
            }
          `).join('')}
        `}</style>
      )}

      {/* Equipment hotspots */}
      {showEquipment && overlay.equipment?.map(eq => {
        if (hideLinkedEntities && linkedEntityIds.has(eq.id)) return null;
        const borderShape = getShapeStyle(eq.equipmentType);
        const isDiamond = EQUIPMENT_SHAPE[eq.equipmentType] === 'diamond';
        const color = colorMode === 'entity' ? ENTITY_COLORS.equipment : (systemColors[eq.systemType] || md.primary);
        const isSelected = selectedEntityId === eq.id;
        const isHighlighted = highlightEntityId === eq.id;
        const isLinked = linkedEntityIds.has(eq.id);
        const approvalState = entityApprovalMap[eq.id];
        const sourceIsAI = eq.source === 'ai';

        return (
          <div
            key={`eq-${eq.id}`}
            data-overlay="equipment"
            data-entity-id={eq.id}
            className={`absolute cursor-pointer group ${isSelected || isHighlighted ? 'z-20' : 'z-10'}`}
            style={{
              left: `${eq.xPct}%`,
              top: `${eq.yPct}%`,
              width: `${eq.wPct}%`,
              height: `${eq.hPct}%`,
              ...(eq.rotation ? { transform: `rotate(${eq.rotation}deg)`, transformOrigin: 'center' } : {}),
            }}
            onClick={(e) => { e.stopPropagation(); onEntityClick('equipment', eq); }}
          >
            {/* Hotspot border with selection glow + verification styling */}
            {showShapes && (
            <div
              className={`w-full h-full border-2 ${borderShape} transition-all ${
                isSelected || isHighlighted ? 'opacity-100' : 'opacity-40 group-hover:opacity-80'
              }`}
              style={{
                borderColor: eq.positionVerified ? '#22c55e' : color,
                borderStyle: eq.positionVerified ? 'solid' : 'dashed',
                backgroundColor: isSelected || isHighlighted ? color + '25' : color + '08',
                boxShadow: isSelected ? `0 0 12px ${color}80, inset 0 0 8px ${color}30` : isHighlighted ? `0 0 16px rgba(255,215,0,0.6)` : 'none',
                ...(isDiamond ? { transform: 'rotate(45deg)', transformOrigin: 'center' } : {}),
              }}
            />
            )}
            {/* Tag label with linked/approval status indicator */}
            {showText && (
            <div
              className={`absolute -top-6 left-0 px-2 py-1 text-[9px] font-bold rounded whitespace-nowrap transition-opacity flex items-center gap-0.5 pointer-events-none ${
                isSelected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'
              }`}
              style={{
                backgroundColor: color,
                color: md.onPrimary,
                outline: approvalState === 'approved' ? '2px solid #22c55e' : 'none',
                outlineOffset: '1px',
              }}
            >
              {TYPE_ICONS[eq.equipmentType] || 'EQ'} {eq.tag}
              <span style={{ fontSize: '7px', marginLeft: '2px' }}>
                {approvalState === 'approved' ? '\u2714' : isLinked ? '\u2713' : '\u25CB'}
              </span>
            </div>
            )}
            {/* Tooltip */}
            <div className="hidden group-hover:block absolute z-50 top-full left-0 mt-1 bg-md-surface-container-high border border-md-outline-variant/30 rounded p-2 text-[10px] text-md-on-surface shadow-xl min-w-[160px]">
              <div className="font-bold text-xs mb-1" style={{ color }}>{eq.tag}</div>
              <div className="text-md-on-surface-variant">{eq.equipmentType}</div>
              <div className="text-md-on-surface-variant">{eq.description}</div>
              {eq.criticality && (
                <div className="mt-1">
                  <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${
                    eq.criticality === 'high' ? 'bg-red-500/20 text-red-400' :
                    eq.criticality === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {eq.criticality.toUpperCase()}
                  </span>
                </div>
              )}
              <div className="text-md-on-surface-variant mt-1">System: {eq.systemCode}</div>
              <div className={`text-[8px] mt-1 font-bold ${isLinked ? 'text-green-400' : 'text-amber-400'}`}>
                {isLinked ? 'Linked' : 'Not linked'}
              </div>
              {approvalState && (
                <div className={`text-[8px] font-bold ${approvalState === 'approved' ? 'text-green-400' : 'text-amber-400'}`}>
                  {approvalState === 'approved' ? 'Approved' : 'Draft'}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Instrument hotspots */}
      {showInstruments && overlay.instruments?.map(inst => {
        if (hideLinkedEntities && linkedEntityIds.has(inst.id)) return null;
        const color = colorMode === 'entity' ? ENTITY_COLORS.instrument : (systemColors[inst.systemType] || systemColor('instrument'));
        const isSelected = selectedEntityId === inst.id;
        const isHighlighted = highlightEntityId === inst.id;
        const isLinked = linkedEntityIds.has(inst.id);
        const approvalState = entityApprovalMap[inst.id];

        return (
          <div
            key={`inst-${inst.id}`}
            data-overlay="instrument"
            data-entity-id={inst.id}
            className={`absolute cursor-pointer group ${isSelected || isHighlighted ? 'z-20' : 'z-10'}`}
            style={{
              left: `${inst.xPct}%`,
              top: `${inst.yPct}%`,
              width: `${inst.wPct}%`,
              height: `${inst.hPct}%`,
              ...(inst.rotation ? { transform: `rotate(${inst.rotation}deg)`, transformOrigin: 'center' } : {}),
            }}
            onClick={(e) => { e.stopPropagation(); onEntityClick('instrument', inst); }}
          >
            {showShapes && (
            <div
              className={`w-full h-full rounded-full border-2 transition-all ${
                isSelected || isHighlighted ? 'opacity-100' : 'opacity-40 group-hover:opacity-80'
              }`}
              style={{
                borderColor: inst.positionVerified ? '#22c55e' : color,
                borderStyle: inst.positionVerified ? 'solid' : 'dashed',
                backgroundColor: isSelected || isHighlighted ? color + '25' : color + '08',
                boxShadow: isSelected ? `0 0 12px ${color}80, inset 0 0 8px ${color}30` : isHighlighted ? `0 0 16px rgba(255,215,0,0.6)` : 'none',
              }}
            />
            )}
            {/* Tag with linked/approval indicator */}
            {showText && (
            <div
              className={`absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-1 text-[9px] font-bold rounded whitespace-nowrap transition-opacity flex items-center gap-0.5 pointer-events-none ${
                isSelected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'
              }`}
              style={{
                backgroundColor: color,
                color: md.onPrimary,
                outline: approvalState === 'approved' ? '2px solid #22c55e' : 'none',
                outlineOffset: '1px',
              }}
            >
              {inst.tag}
              <span style={{ fontSize: '7px', marginLeft: '2px' }}>
                {approvalState === 'approved' ? '\u2714' : isLinked ? '\u2713' : '\u25CB'}
              </span>
            </div>
            )}
            {/* Tooltip */}
            <div className="hidden group-hover:block absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 bg-md-surface-container-high border border-md-outline-variant/30 rounded p-2 text-[10px] text-md-on-surface shadow-xl min-w-[160px]">
              <div className="font-bold text-xs mb-1" style={{ color }}>{inst.tag}</div>
              <div className="text-md-on-surface-variant">{inst.instrumentType}</div>
              <div className="text-md-on-surface-variant">{inst.description}</div>
              {inst.rangeMin && inst.rangeMax && (
                <div className="text-md-on-surface-variant">Range: {inst.rangeMin}-{inst.rangeMax} {inst.rangeUnit}</div>
              )}
              {inst.scadaTag && <div className="text-md-on-surface-variant">SCADA: {inst.scadaTag}</div>}
              {inst.lineNumber && <div className="text-md-on-surface-variant">Line: {inst.lineNumber}</div>}
              <div className={`text-[8px] mt-1 font-bold ${isLinked ? 'text-green-400' : 'text-amber-400'}`}>
                {isLinked ? 'Linked' : 'Not linked'}
              </div>
              {approvalState && (
                <div className={`text-[8px] font-bold ${approvalState === 'approved' ? 'text-green-400' : 'text-amber-400'}`}>
                  {approvalState === 'approved' ? 'Approved' : 'Draft'}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Line labels — positioned at OCR coordinates when available, otherwise in sidebar list */}
      {showLines && overlay.lines?.length > 0 && (() => {
        const visibleLines = hideLinkedEntities
          ? overlay.lines.filter(ln => !linkedEntityIds.has(ln.id))
          : overlay.lines;
        const positioned = visibleLines.filter(ln => ln.xPct != null && ln.yPct != null && (ln.xPct > 0 || ln.yPct > 0));
        const unpositioned = visibleLines.filter(ln => !ln.xPct && !ln.yPct);

        return (
          <>
            {/* Lines with OCR coordinates — render at their position (text-based, hide in shapes-only) */}
            {showText && positioned.map(ln => {
              const color = colorMode === 'entity' ? ENTITY_COLORS.line : (systemColors[ln.systemType] || md.primary);
              const isSelected = selectedEntityId === ln.id;
              const isHighlighted = highlightEntityId === ln.id;
              const isLinked = linkedEntityIds.has(ln.id);
              const approvalState = entityApprovalMap[ln.id];

              // Position at center of detection box when dimensions are available,
              // otherwise fall back to the raw position (legacy point annotations).
              const displayX = ln.wPct ? ln.xPct + ln.wPct / 2 : ln.xPct;
              const displayY = ln.hPct ? ln.yPct + ln.hPct / 2 : ln.yPct;

              return (
                <div
                  key={`ln-${ln.id}`}
                  data-overlay="line"
                  data-entity-id={ln.id}
                  className={`absolute cursor-pointer group ${isSelected || isHighlighted ? 'z-20' : 'z-10'}`}
                  style={{
                    left: `${displayX}%`,
                    top: `${displayY}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onClick={(e) => { e.stopPropagation(); onEntityClick('line', ln); }}
                >
                  <div
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded whitespace-nowrap transition-all ${
                      isSelected
                        ? 'border-2'
                        : 'border-b-2 opacity-60 group-hover:opacity-100'
                    }`}
                    style={{
                      backgroundColor: isSelected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)',
                      backdropFilter: 'blur(1px)',
                      borderColor: isSelected ? color : color + '80',
                      boxShadow: isSelected ? `0 0 8px ${color}50` : 'none',
                    }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: isLinked ? md.primary : md.error + '80' }}
                    />
                    <span className="text-[8px] font-mono font-bold" style={{ color: isSelected ? color : undefined }}>
                      {ln.lineNumber}
                    </span>
                    {approvalState && (
                      <span className="text-[7px]" style={{ color: approvalState === 'approved' ? '#22c55e' : md.primary }}>
                        {approvalState === 'approved' ? '\u2714' : '\u2713'}
                      </span>
                    )}
                    {ln.isContinuation && ln.continuationFromDrawing && (
                      <button
                        className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[7px] font-bold bg-[#E67E22]/20 text-[#E67E22] hover:bg-[#E67E22]/30 cursor-pointer"
                        title={`Continues from ${ln.continuationFromDrawing}${ln.sheetEntryPoint ? ' at ' + ln.sheetEntryPoint : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSheetNavigate?.(ln.continuationFromPnidId);
                        }}
                      >
                        <span className="material-symbols-outlined text-[10px]">arrow_back</span>
                        {ln.continuationFromDrawing}
                      </button>
                    )}
                    {ln.sheetExitPoint && !ln.isContinuation && (
                      <span
                        className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[7px] font-bold bg-[#8AB4FF]/20 text-[#8AB4FF]"
                        title={`Continues to another sheet at ${ln.sheetExitPoint}`}
                      >
                        <span className="material-symbols-outlined text-[10px]">arrow_forward</span>
                        {ln.sheetExitPoint}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Lines without coordinates — compact sidebar list */}
            {showUnpositionedLineList && unpositioned.length > 0 && (
              <div className="absolute top-2 left-2 flex flex-col gap-0.5 max-h-[30%] overflow-y-auto z-10 bg-md-surface-container/90 rounded-lg p-1.5 border border-md-outline-variant/20">
                <div className="text-[8px] font-bold text-md-on-surface-variant px-1 mb-0.5">
                  Unpositioned Lines ({unpositioned.length})
                </div>
                {unpositioned.map(ln => {
                  const color = colorMode === 'entity' ? ENTITY_COLORS.line : (systemColors[ln.systemType] || md.primary);
                  const isSelected = selectedEntityId === ln.id;
                  const isLinked = linkedEntityIds.has(ln.id);

                  return (
                    <div
                      key={`ln-${ln.id}`}
                      data-overlay="line"
                      data-entity-id={ln.id}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer text-[8px] transition-all ${
                        isSelected ? 'bg-md-primary/15 font-bold' : 'hover:bg-md-surface-container-high'
                      }`}
                      style={isSelected ? { color } : {}}
                      onClick={(e) => { e.stopPropagation(); onEntityClick('line', ln); }}
                    >
                      <div
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: isLinked ? md.primary : md.error + '80' }}
                      />
                      <span className="font-mono">{ln.lineNumber}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
