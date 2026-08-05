import { useMemo } from 'react';
import { orderedFlowPoints } from './flowDirection';
import { SMART_IDENT_COLORS } from '../../../hooks/useSmartIdentification';

const DEFAULT_FLOW_COLOR = '#00E5A0';
const MAX_ARROWS_PER_LINE = 4;

function toStage(xPct, yPct, w, h) {
  return { x: (xPct / 100) * w, y: (yPct / 100) * h };
}

function buildPath(orderedPct, stageWidth, stageHeight) {
  const pts = orderedPct.map((p) => toStage(p.xPct, p.yPct, stageWidth, stageHeight));
  if (pts.length < 2) return null;

  let total = 0;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    segs.push({ x0: pts[i].x, y0: pts[i].y, dx, dy, len, start: total });
    total += len;
  }
  if (total < 1 || segs.length === 0) return null;

  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return { d, segs, total };
}

function samplePath(path, dist) {
  let d = ((dist % path.total) + path.total) % path.total;
  for (const seg of path.segs) {
    if (d <= seg.start + seg.len) {
      const t = (d - seg.start) / seg.len;
      return {
        x: seg.x0 + seg.dx * t,
        y: seg.y0 + seg.dy * t,
        angle: Math.atan2(seg.dy, seg.dx),
      };
    }
  }
  const last = path.segs[path.segs.length - 1];
  return {
    x: last.x0 + last.dx,
    y: last.y0 + last.dy,
    angle: Math.atan2(last.dy, last.dx),
  };
}

function arrowPoints(sample, size = 12) {
  const tipX = sample.x + Math.cos(sample.angle) * size;
  const tipY = sample.y + Math.sin(sample.angle) * size;
  const leftX = sample.x - Math.cos(sample.angle) * size * 0.55 + Math.cos(sample.angle + Math.PI / 2) * size * 0.45;
  const leftY = sample.y - Math.sin(sample.angle) * size * 0.55 + Math.sin(sample.angle + Math.PI / 2) * size * 0.45;
  const rightX = sample.x - Math.cos(sample.angle) * size * 0.55 + Math.cos(sample.angle - Math.PI / 2) * size * 0.45;
  const rightY = sample.y - Math.sin(sample.angle) * size * 0.55 + Math.sin(sample.angle - Math.PI / 2) * size * 0.45;
  return `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`;
}

/**
 * Lightweight SVG flow overlay — CSS-animated dashes (no per-frame JS).
 * Avoids Konva shadow/particle RAF loops that freeze large P&ID canvases.
 */
export default function FlowAnimationOverlay({
  segments = [],
  stageWidth,
  stageHeight,
  active = false,
}) {
  const flows = useMemo(() => {
    if (!active || !stageWidth || !stageHeight) return [];
    return segments
      .filter((seg) => seg.segmentType === 'line')
      .map((seg) => {
        const ordered = orderedFlowPoints(seg);
        if (!ordered) return null;
        const path = buildPath(ordered, stageWidth, stageHeight);
        if (!path) return null;

        const arrowCount = Math.min(
          MAX_ARROWS_PER_LINE,
          Math.max(1, Math.round(path.total / 180)),
        );
        const arrows = [];
        for (let i = 0; i < arrowCount; i++) {
          // Static chevrons along the path (direction cue); motion comes from dashes
          const sample = samplePath(path, ((i + 0.65) / arrowCount) * path.total);
          arrows.push({
            key: `${seg.id}-a${i}`,
            points: arrowPoints(sample),
          });
        }

        const color = seg.displayColor
          || (seg.linkedEntityType && SMART_IDENT_COLORS[seg.linkedEntityType])
          || DEFAULT_FLOW_COLOR;
        return { id: seg.id, d: path.d, arrows, color };
      })
      .filter(Boolean);
  }, [segments, stageWidth, stageHeight, active]);

  if (!active || flows.length === 0 || !stageWidth || !stageHeight) return null;

  return (
    <svg
      width={stageWidth}
      height={stageHeight}
      viewBox={`0 0 ${stageWidth} ${stageHeight}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 28,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <defs>
        <style>{`
          @keyframes av-flow-dash {
            to { stroke-dashoffset: -68; }
          }
          .av-flow-dash {
            animation: av-flow-dash 0.7s linear infinite;
          }
          @keyframes av-flow-pulse {
            0%, 100% { opacity: 0.35; }
            50% { opacity: 0.55; }
          }
          .av-flow-glow {
            animation: av-flow-pulse 1.4s ease-in-out infinite;
          }
        `}</style>
      </defs>

      {flows.map((flow) => (
        <g key={flow.id}>
          {/* Soft glow trail */}
          <path
            className="av-flow-glow"
            d={flow.d}
            fill="none"
            stroke={flow.color}
            strokeWidth={12}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.35}
          />
          {/* Solid color core */}
          <path
            d={flow.d}
            fill="none"
            stroke={flow.color}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.55}
          />
          {/* Marching white dashes — primary motion cue */}
          <path
            className="av-flow-dash"
            d={flow.d}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="18 16"
            opacity={0.95}
            style={{ filter: `drop-shadow(0 0 4px ${flow.color})` }}
          />
          {/* Static direction chevrons */}
          {flow.arrows.map((a) => (
            <polygon
              key={a.key}
              points={a.points}
              fill={flow.color}
              stroke="#FFFFFF"
              strokeWidth={1}
              opacity={0.95}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
