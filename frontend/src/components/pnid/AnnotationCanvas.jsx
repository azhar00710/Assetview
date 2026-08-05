import { useState, useRef, useCallback } from 'react';
import { md } from '../../lib/theme';
import { PID_SYMBOL_CATEGORIES } from './AnnotationToolbar';
import { IsoSymbolSvg } from './smartIdent/IsoSymbolRenderer';

// Flatten symbols for quick lookup
const PID_SYMBOLS = PID_SYMBOL_CATEGORIES
  ? PID_SYMBOL_CATEGORIES.flatMap(c => c.symbols).reduce((acc, s) => { acc[s.id] = s; return acc; }, {})
  : {};

// Convert client coordinates to percentage of canvas
function toPercent(clientX, clientY, svgEl) {
  const rect = svgEl.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

// ── Connection mode helpers ──
const SNAP_THRESHOLD = 5; // percentage distance for entity snapping

function distPct(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function annCenter(ann) {
  if (ann.shape === 'line') {
    return { x: ((ann.xPct || 0) + (ann.x2Pct || 0)) / 2, y: ((ann.yPct || 0) + (ann.y2Pct || 0)) / 2 };
  }
  return {
    x: (ann.xPct || 0) + (ann.wPct || 0) / 2,
    y: (ann.yPct || 0) + (ann.hPct || 0) / 2,
  };
}

function findNearestLinkedAnnotation(x, y, annotations) {
  let best = null;
  let bestDist = Infinity;
  for (const ann of annotations) {
    if (!ann.linkedEntityId && !ann.linked_entity_id) continue;
    const c = annCenter(ann);
    const d = distPct(x, y, c.x, c.y);
    if (d < bestDist && d <= SNAP_THRESHOLD) {
      bestDist = d;
      best = ann;
    }
  }
  return best;
}

const CONNECTION_COLORS = {
  process: '#3BE494',
  utility: '#2D33E0',
  signal: '#F39C12',
  boundary: '#E74C3C',
};

export default function AnnotationCanvas({
  annotations,
  activeTool,
  activeColor,
  activeStroke,
  selectedAnnotation,
  onCreateAnnotation,
  onSelectAnnotation,
  ocrSuggestions,
  onAcceptSuggestion,
  zoom,
}) {
  const svgRef = useRef(null);
  const [drawing, setDrawing] = useState(null); // in-progress shape
  const [connectionFrom, setConnectionFrom] = useState(null); // source entity for connection mode
  const [connectionType, setConnectionType] = useState(null); // show type picker
  const [pendingConnection, setPendingConnection] = useState(null); // waiting for type selection

  const isSymbolTool = activeTool?.startsWith('sym_');
  const isConnectionTool = activeTool === 'connection';

  const handleMouseDown = useCallback((e) => {
    if (activeTool === 'select' || !svgRef.current) return;
    e.stopPropagation();
    const pt = toPercent(e.clientX, e.clientY, svgRef.current);

    // Pin — single click placement
    if (activeTool === 'pin') {
      onCreateAnnotation({
        annotationType: 'pin',
        shape: 'pin',
        xPct: pt.x,
        yPct: pt.y,
        text: '',
      });
      return;
    }

    // P&ID Symbol — single click placement (symbol at click position with default size)
    if (isSymbolTool) {
      const sym = PID_SYMBOLS[activeTool];
      if (sym) {
        onCreateAnnotation({
          annotationType: 'symbol',
          shape: activeTool,
          xPct: pt.x - 2, // Center the symbol on click
          yPct: pt.y - 2,
          wPct: 4,
          hPct: 4,
          text: sym.abbr,
          metadata: { symbolId: activeTool, label: sym.label },
        });
      }
      return;
    }

    // Connection mode — snap to nearest linked entity annotation
    if (isConnectionTool) {
      const nearest = findNearestLinkedAnnotation(pt.x, pt.y, annotations);
      if (nearest) {
        const c = annCenter(nearest);
        setConnectionFrom(nearest);
        setDrawing({
          shape: 'connection',
          x1: c.x,
          y1: c.y,
          x2: pt.x,
          y2: pt.y,
        });
      }
      return;
    }

    // Drag-draw shapes
    setDrawing({
      shape: activeTool,
      x1: pt.x,
      y1: pt.y,
      x2: pt.x,
      y2: pt.y,
    });
  }, [activeTool, isSymbolTool, isConnectionTool, annotations, onCreateAnnotation]);

  const handleMouseMove = useCallback((e) => {
    if (!drawing || !svgRef.current) return;
    const pt = toPercent(e.clientX, e.clientY, svgRef.current);
    setDrawing(prev => ({ ...prev, x2: pt.x, y2: pt.y }));
  }, [drawing]);

  const handleMouseUp = useCallback(() => {
    if (!drawing) return;
    const { shape, x1, y1, x2, y2 } = drawing;

    // Connection mode — find target entity and show type picker
    if (shape === 'connection' && connectionFrom) {
      const nearest = findNearestLinkedAnnotation(x2, y2, annotations);
      if (nearest && (nearest.linkedEntityId || nearest.linked_entity_id) !== (connectionFrom.linkedEntityId || connectionFrom.linked_entity_id)) {
        const toCenter = annCenter(nearest);
        setPendingConnection({
          from: connectionFrom,
          to: nearest,
          fromCenter: { x: x1, y: y1 },
          toCenter: toCenter,
        });
        setConnectionType('picker'); // show picker
      }
      setDrawing(null);
      setConnectionFrom(null);
      return;
    }

    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    if (shape !== 'line' && dx < 1 && dy < 1) {
      setDrawing(null);
      return;
    }
    if (shape === 'line' && dx < 0.5 && dy < 0.5) {
      setDrawing(null);
      return;
    }

    if (shape === 'line') {
      onCreateAnnotation({
        annotationType: 'highlight',
        shape: 'line',
        xPct: x1,
        yPct: y1,
        x2Pct: x2,
        y2Pct: y2,
      });
    } else {
      const minX = Math.min(x1, x2);
      const minY = Math.min(y1, y2);
      onCreateAnnotation({
        annotationType: 'highlight',
        shape,
        xPct: minX,
        yPct: minY,
        wPct: dx,
        hPct: dy,
      });
    }
    setDrawing(null);
  }, [drawing, connectionFrom, annotations, onCreateAnnotation]);

  const handleSelectConnectionType = useCallback((type) => {
    if (!pendingConnection) return;
    const { from, to, fromCenter, toCenter } = pendingConnection;
    const fromEntityId = from.linkedEntityId || from.linked_entity_id;
    const toEntityId = to.linkedEntityId || to.linked_entity_id;

    onCreateAnnotation({
      annotationType: 'highlight',
      shape: 'line',
      xPct: fromCenter.x,
      yPct: fromCenter.y,
      x2Pct: toCenter.x,
      y2Pct: toCenter.y,
      color: CONNECTION_COLORS[type] || '#3BE494',
      strokeWidth: 3,
      metadata: {
        isConnection: true,
        fromEntityId,
        toEntityId,
        connectionType: type,
      },
    });

    setPendingConnection(null);
    setConnectionType(null);
  }, [pendingConnection, onCreateAnnotation]);

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      style={{ minWidth: '1200px', minHeight: '800px', pointerEvents: activeTool === 'select' ? 'none' : 'all' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Arrow marker for connection lines */}
      <defs>
        <marker id="arrow-marker" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity="0.8" />
        </marker>
      </defs>

      {/* OCR ghost suggestions — semi-transparent dashed rects for unplaced entities */}
      {ocrSuggestions?.map(sug => (
        <g
          key={sug.entityId}
          style={{ cursor: 'pointer', pointerEvents: 'all' }}
          onClick={(e) => {
            e.stopPropagation();
            onAcceptSuggestion?.(sug);
          }}
        >
          <rect
            x={`${sug.suggestedXPct}%`}
            y={`${sug.suggestedYPct}%`}
            width={`${sug.suggestedWPct || 4}%`}
            height={`${sug.suggestedHPct || 3}%`}
            fill={sug.entityType === 'instrument' ? '#F39C12' : '#3BE494'}
            fillOpacity={0.08}
            stroke={sug.entityType === 'instrument' ? '#F39C12' : '#3BE494'}
            strokeWidth={1.5}
            strokeDasharray="4,3"
            opacity={0.6}
            rx={sug.entityType === 'instrument' ? 8 : 2}
          />
          <text
            x={`${sug.suggestedXPct + (sug.suggestedWPct || 4) / 2}%`}
            y={`${sug.suggestedYPct + (sug.suggestedHPct || 3) / 2}%`}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="8"
            fontWeight="600"
            fontFamily="monospace"
            fill={sug.entityType === 'instrument' ? '#F39C12' : '#3BE494'}
            opacity={0.7}
          >
            {sug.tag}
          </text>
        </g>
      ))}

      {/* Existing annotations */}
      {annotations.map(ann => (
        <AnnotationShape
          key={ann.id}
          annotation={ann}
          isSelected={selectedAnnotation?.id === ann.id}
          onClick={(e) => {
            e.stopPropagation();
            onSelectAnnotation(ann);
          }}
          interactive={activeTool === 'select'}
          isConnection={ann.metadata?.isConnection}
        />
      ))}

      {/* In-progress drawing */}
      {drawing && (
        <DrawingPreview
          drawing={drawing}
          color={drawing.shape === 'connection' ? '#3BE494' : activeColor}
          strokeWidth={drawing.shape === 'connection' ? 3 : activeStroke}
        />
      )}

      {/* Connection snapped-from entity highlight */}
      {connectionFrom && drawing && (
        <circle
          cx={`${drawing.x1}%`}
          cy={`${drawing.y1}%`}
          r="6"
          fill="none"
          stroke="#3BE494"
          strokeWidth="2"
          opacity={0.8}
        />
      )}

      {/* Connection type picker popup */}
      {connectionType === 'picker' && pendingConnection && (
        <foreignObject
          x={`${(pendingConnection.fromCenter.x + pendingConnection.toCenter.x) / 2 - 5}%`}
          y={`${(pendingConnection.fromCenter.y + pendingConnection.toCenter.y) / 2 - 3}%`}
          width="10%"
          height="8%"
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              background: '#1a1a2e',
              borderRadius: 6,
              padding: 4,
              border: '1px solid #333',
            }}
          >
            {Object.entries(CONNECTION_COLORS).map(([type, color]) => (
              <button
                key={type}
                onClick={(e) => { e.stopPropagation(); handleSelectConnectionType(type); }}
                style={{
                  background: 'transparent',
                  border: `1px solid ${color}`,
                  borderRadius: 3,
                  color,
                  fontSize: 8,
                  fontWeight: 600,
                  padding: '2px 4px',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {type}
              </button>
            ))}
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

function AnnotationShape({ annotation, isSelected, onClick, interactive, isConnection }) {
  const { shape, xPct, yPct, wPct, hPct, x2Pct, y2Pct, color, strokeWidth, status, approvalStatus } = annotation;
  const isApproved = approvalStatus === 'approved';
  const opacity = status === 'resolved' ? 0.4 : isApproved ? 1.0 : 0.8;
  const selStroke = isSelected ? '#FFFFFF' : 'transparent';
  const selWidth = isSelected ? 2 : 0;
  const approvedStroke = isApproved ? '#22c55e' : null;

  const commonProps = {
    'data-annotation': annotation.id,
    style: { pointerEvents: interactive ? 'all' : 'none', cursor: interactive ? 'pointer' : 'default' },
    onClick,
  };

  // Check if this is a P&ID symbol
  if (shape?.startsWith('sym_')) {
    const sym = PID_SYMBOLS[shape];
    return (
      <g {...commonProps}>
        {/* Hit area */}
        <rect
          x={`${xPct}%`} y={`${yPct}%`}
          width={`${wPct || 4}%`} height={`${hPct || 4}%`}
          fill="transparent"
        />
        {/* Symbol rendered via foreignObject for proper scaling */}
        <foreignObject
          x={`${xPct}%`} y={`${yPct}%`}
          width={`${wPct || 4}%`} height={`${hPct || 4}%`}
        >
          <div xmlns="http://www.w3.org/1999/xhtml" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
            {sym?.elements ? (
              <div style={{ width: '88%', height: '88%', opacity }}>
                <IsoSymbolSvg elements={sym.elements} width="100%" height="100%" color={color || '#1a1a1a'} strokeWidth={2.5} />
              </div>
            ) : null}
            {annotation.text && (
              <span style={{ fontSize: '7px', fontWeight: 'bold', color, marginTop: '-2px', textAlign: 'center' }}>
                {annotation.text}
              </span>
            )}
          </div>
        </foreignObject>
        {/* Approved border */}
        {isApproved && (
          <rect
            x={`${xPct}%`} y={`${yPct}%`}
            width={`${wPct || 4}%`} height={`${hPct || 4}%`}
            fill="none" stroke="#22c55e" strokeWidth="2"
            rx="3"
          />
        )}
        {/* Selection highlight */}
        {isSelected && (
          <rect
            x={`${xPct}%`} y={`${yPct}%`}
            width={`${wPct || 4}%`} height={`${hPct || 4}%`}
            fill="none" stroke="white" strokeWidth="1.5" strokeDasharray="4,4"
            rx="3"
          />
        )}
      </g>
    );
  }

  switch (shape) {
    case 'pin':
      return (
        <g {...commonProps}>
          <circle cx={`${xPct}%`} cy={`${yPct}%`} r="12" fill={selStroke} opacity={isSelected ? 0.3 : 0} />
          <circle cx={`${xPct}%`} cy={`${yPct}%`} r="8" fill={color} opacity={opacity} stroke={isApproved ? '#22c55e' : selStroke} strokeWidth={isApproved ? 2 : selWidth} />
          <circle cx={`${xPct}%`} cy={`${yPct}%`} r="3" fill="white" opacity={0.9} />
          {annotation.text && (
            <text
              x={`${xPct}%`}
              y={`${yPct - 2}%`}
              textAnchor="middle"
              fontSize="10"
              fill={color}
              fontWeight="bold"
              dy="-6"
            >
              {annotation.text.substring(0, 20)}
            </text>
          )}
          {isApproved && (
            <text x={`${xPct}%`} y={`${yPct}%`} textAnchor="middle" dominantBaseline="central" fontSize="8" fill="white" fontWeight="bold">
              &#x2713;
            </text>
          )}
        </g>
      );

    case 'line':
      return (
        <g {...commonProps}>
          <line
            x1={`${xPct}%`} y1={`${yPct}%`}
            x2={`${x2Pct ?? xPct}%`} y2={`${y2Pct ?? yPct}%`}
            stroke="transparent" strokeWidth="10"
          />
          <line
            x1={`${xPct}%`} y1={`${yPct}%`}
            x2={`${x2Pct ?? xPct}%`} y2={`${y2Pct ?? yPct}%`}
            stroke={isApproved ? '#22c55e' : color}
            strokeWidth={isConnection ? Math.max(strokeWidth, 3) : (isApproved ? strokeWidth + 1 : strokeWidth)}
            opacity={opacity}
            strokeLinecap="round"
            markerEnd={isConnection ? 'url(#arrow-marker)' : undefined}
          />
          {/* Connection type label */}
          {isConnection && annotation.metadata?.connectionType && (
            <text
              x={`${((xPct || 0) + (x2Pct || xPct || 0)) / 2}%`}
              y={`${((yPct || 0) + (y2Pct || yPct || 0)) / 2 - 1}%`}
              textAnchor="middle"
              fontSize="7"
              fontWeight="600"
              fill={color}
              opacity={0.8}
            >
              {annotation.metadata.connectionType}
            </text>
          )}
          {isSelected && (
            <>
              <circle cx={`${xPct}%`} cy={`${yPct}%`} r="4" fill="white" stroke={color} strokeWidth="1.5" />
              <circle cx={`${x2Pct ?? xPct}%`} cy={`${y2Pct ?? yPct}%`} r="4" fill="white" stroke={color} strokeWidth="1.5" />
            </>
          )}
        </g>
      );

    case 'rectangle':
      return (
        <g {...commonProps}>
          <rect
            x={`${xPct}%`} y={`${yPct}%`}
            width={`${wPct}%`} height={`${hPct}%`}
            fill={color} fillOpacity={isApproved ? 0.15 : 0.1}
            stroke={isApproved ? '#22c55e' : color} strokeWidth={isApproved ? strokeWidth + 1 : strokeWidth} opacity={opacity}
            rx="2"
          />
          {isSelected && (
            <rect
              x={`${xPct}%`} y={`${yPct}%`}
              width={`${wPct}%`} height={`${hPct}%`}
              fill="none" stroke="white" strokeWidth="1" strokeDasharray="4,4"
              rx="2"
            />
          )}
        </g>
      );

    case 'circle': {
      const cx = xPct + (wPct || 0) / 2;
      const cy = yPct + (hPct || 0) / 2;
      const rx = (wPct || 0) / 2;
      const ry = (hPct || 0) / 2;
      return (
        <g {...commonProps}>
          <ellipse
            cx={`${cx}%`} cy={`${cy}%`}
            rx={`${rx}%`} ry={`${ry}%`}
            fill={color} fillOpacity={isApproved ? 0.15 : 0.08}
            stroke={isApproved ? '#22c55e' : color} strokeWidth={isApproved ? strokeWidth + 1 : strokeWidth} opacity={opacity}
          />
          {isSelected && (
            <ellipse
              cx={`${cx}%`} cy={`${cy}%`}
              rx={`${rx}%`} ry={`${ry}%`}
              fill="none" stroke="white" strokeWidth="1.5" strokeDasharray="4,4"
            />
          )}
        </g>
      );
    }

    case 'diamond': {
      const cx = xPct + (wPct || 0) / 2;
      const cy = yPct + (hPct || 0) / 2;
      const hw = (wPct || 0) / 2;
      const hh = (hPct || 0) / 2;
      return (
        <g {...commonProps}>
          <DiamondSvg
            cx={cx} cy={cy} hw={hw} hh={hh}
            color={color} strokeWidth={strokeWidth}
            fillOpacity={0.1} opacity={opacity}
          />
          {isSelected && (
            <DiamondSvg
              cx={cx} cy={cy} hw={hw} hh={hh}
              color="white" strokeWidth={1.5}
              fillOpacity={0} opacity={1}
              dashed
            />
          )}
        </g>
      );
    }

    default:
      // Fallback for 'highlight' or unknown shapes
      if (wPct && hPct) {
        return (
          <g {...commonProps}>
            <rect
              x={`${xPct}%`} y={`${yPct}%`}
              width={`${wPct}%`} height={`${hPct}%`}
              fill={color || md.primary} fillOpacity={0.15}
              stroke={color || md.primary} strokeWidth={strokeWidth || 2} opacity={opacity}
            />
          </g>
        );
      }
      return (
        <g {...commonProps}>
          <circle cx={`${xPct}%`} cy={`${yPct}%`} r="6" fill={color || md.primary} opacity={opacity} />
        </g>
      );
  }
}

function DrawingPreview({ drawing, color, strokeWidth }) {
  const { shape, x1, y1, x2, y2 } = drawing;
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);

  switch (shape) {
    case 'connection':
    case 'line':
      return (
        <line
          x1={`${x1}%`} y1={`${y1}%`}
          x2={`${x2}%`} y2={`${y2}%`}
          stroke={color} strokeWidth={shape === 'connection' ? 3 : strokeWidth}
          strokeDasharray="6,3" opacity={0.7}
          strokeLinecap="round"
          markerEnd={shape === 'connection' ? 'url(#arrow-marker)' : undefined}
        />
      );
    case 'rectangle':
      return (
        <rect
          x={`${minX}%`} y={`${minY}%`}
          width={`${w}%`} height={`${h}%`}
          fill={color} fillOpacity={0.05}
          stroke={color} strokeWidth={strokeWidth}
          strokeDasharray="6,3" opacity={0.7} rx="2"
        />
      );
    case 'circle': {
      const cx = minX + w / 2;
      const cy = minY + h / 2;
      return (
        <ellipse
          cx={`${cx}%`} cy={`${cy}%`}
          rx={`${w / 2}%`} ry={`${h / 2}%`}
          fill={color} fillOpacity={0.05}
          stroke={color} strokeWidth={strokeWidth}
          strokeDasharray="6,3" opacity={0.7}
        />
      );
    }
    case 'diamond': {
      const cx = minX + w / 2;
      const cy = minY + h / 2;
      return (
        <DiamondSvg
          cx={cx} cy={cy} hw={w / 2} hh={h / 2}
          color={color} strokeWidth={strokeWidth}
          fillOpacity={0.05} opacity={0.7}
          dashed
        />
      );
    }
    default:
      return null;
  }
}

function DiamondSvg({ cx, cy, hw, hh, color, strokeWidth, fillOpacity = 0.05, opacity = 0.7, dashed }) {
  const top = { x: cx, y: cy - hh };
  const right = { x: cx + hw, y: cy };
  const bottom = { x: cx, y: cy + hh };
  const left = { x: cx - hw, y: cy };

  const d = `M ${top.x}% ${top.y}% L ${right.x}% ${right.y}% L ${bottom.x}% ${bottom.y}% L ${left.x}% ${left.y}% Z`;
  return (
    <path
      d={d}
      fill={color} fillOpacity={fillOpacity}
      stroke={color} strokeWidth={strokeWidth}
      strokeDasharray={dashed ? "4,4" : "none"}
      opacity={opacity}
    />
  );
}
