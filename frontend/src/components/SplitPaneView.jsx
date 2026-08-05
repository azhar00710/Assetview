import { useState, useCallback, useRef, useEffect } from 'react';
import { md, alpha } from '../lib/theme';
import useSelectionSync from '../hooks/useSelectionSync';
import SystemCanvas from './canvas/SystemCanvas';

/**
 * SplitPaneView — Resizable split pane with 2D canvas (left) and 3D viewer placeholder (right).
 *
 * Features:
 *   - Draggable divider to resize panes
 *   - Toggle buttons to maximize either pane
 *   - Selection sync: click in 2D → highlights in 3D (and vice versa)
 *   - Echo-loop prevention via SelectionBus source tracking
 *
 * Props:
 *   systemId     — active system ID for the 2D canvas
 *   platformId   — active platform ID
 *   onSystemSelect — callback when system changes
 *   onClose      — callback to exit split pane view
 */
export default function SplitPaneView({
  systemId,
  platformId,
  onSystemSelect,
  onClose,
}) {
  // Split ratio (0–1, fraction of width allocated to left pane)
  const [splitRatio, setSplitRatio] = useState(0.6);
  // Which pane is maximized: null | '2d' | '3d'
  const [maximized, setMaximized] = useState(null);

  const containerRef = useRef(null);
  const isDragging = useRef(false);

  // ─── 2D selection sync ───
  const {
    selectedTag: selected2D,
    hoveredTag: hovered2D,
  } = useSelectionSync('2d');

  // ─── 3D selection sync ───
  const {
    selectedTag: selected3D,
    selectTag: selectTag3D,
    hoveredTag: hovered3D,
  } = useSelectionSync('3d', {
    onSelect: ({ tag }) => {
      // When 2D selects something, 3D receives it here
      // In a real 3D viewer, this would trigger camera fly-to + highlight
    },
  });

  // ─── Drag resize handler ───
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      // Clamp between 20% and 80%
      setSplitRatio(Math.max(0.2, Math.min(0.8, ratio)));
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Compute pane widths
  const leftWidth = maximized === '3d' ? '0%'
    : maximized === '2d' ? '100%'
    : `${splitRatio * 100}%`;

  const rightWidth = maximized === '2d' ? '0%'
    : maximized === '3d' ? '100%'
    : `${(1 - splitRatio) * 100}%`;

  // The active selected tag (from either view)
  const activeTag = selected2D || selected3D;

  return (
    <div className="flex flex-col h-full w-full" style={{ background: md.surface }}>
      {/* ─── Toolbar ─── */}
      <div
        className="flex items-center px-3 py-2 gap-3 shrink-0"
        style={{
          background: md.surfaceContainer,
          borderBottom: `1px solid ${md.outlineVariant}`,
        }}
      >
        {onClose && (
          <>
            <button
              onClick={onClose}
              className="text-sm hover:opacity-80"
              style={{ color: md.onSurfaceVariant }}
            >
              &larr; Back
            </button>
            <div style={{ width: 1, height: 16, background: md.outlineVariant }} />
          </>
        )}

        <span style={{ fontSize: 13, fontWeight: 600, color: md.onSurface }}>
          Split View
        </span>
        <span style={{ fontSize: 11, color: md.onSurfaceVariant }}>
          2D Canvas + 3D Model
        </span>

        <div className="flex-1" />

        {/* Active tag indicator */}
        {activeTag && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded"
            style={{ background: alpha(md.primary, 0.15) }}
          >
            <span style={{ fontSize: 9, color: md.onSurfaceVariant }}>Selected:</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: md.primary }}>{activeTag}</span>
          </div>
        )}

        {/* Maximize toggles */}
        <div className="flex gap-1">
          <button
            onClick={() => setMaximized(maximized === '2d' ? null : '2d')}
            className="px-2 py-1 rounded text-xs hover:opacity-80"
            style={{
              background: maximized === '2d' ? alpha(md.secondary, 0.3) : alpha(md.secondary, 0.1),
              color: md.secondary,
              fontWeight: 600,
            }}
            title="Maximize 2D canvas"
          >
            2D {maximized === '2d' ? '▼' : '▲'}
          </button>
          <button
            onClick={() => setMaximized(maximized === '3d' ? null : '3d')}
            className="px-2 py-1 rounded text-xs hover:opacity-80"
            style={{
              background: maximized === '3d' ? alpha(md.tertiary, 0.3) : alpha(md.tertiary, 0.1),
              color: md.tertiary,
              fontWeight: 600,
            }}
            title="Maximize 3D viewer"
          >
            3D {maximized === '3d' ? '▼' : '▲'}
          </button>
        </div>
      </div>

      {/* ─── Split Panes ─── */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
        {/* Left Pane: 2D System Canvas */}
        <div
          style={{
            width: leftWidth,
            transition: maximized != null ? 'width 0.3s ease' : 'none',
            overflow: 'hidden',
            display: maximized === '3d' ? 'none' : 'flex',
            flexDirection: 'column',
          }}
        >
          <SystemCanvas
            systemId={systemId}
            platformId={platformId}
            onSystemSelect={onSystemSelect}
          />
        </div>

        {/* Drag Handle */}
        {!maximized && (
          <div
            onMouseDown={handleMouseDown}
            style={{
              width: 6,
              cursor: 'col-resize',
              background: md.surfaceContainer,
              borderLeft: `1px solid ${md.outlineVariant}`,
              borderRight: `1px solid ${md.outlineVariant}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              zIndex: 10,
            }}
          >
            <div
              style={{
                width: 2,
                height: 32,
                borderRadius: 1,
                background: md.outline,
              }}
            />
          </div>
        )}

        {/* Right Pane: 3D Viewer Placeholder */}
        <div
          style={{
            width: rightWidth,
            transition: maximized != null ? 'width 0.3s ease' : 'none',
            overflow: 'hidden',
            display: maximized === '2d' ? 'none' : 'flex',
            flexDirection: 'column',
          }}
        >
          <Viewer3DPlaceholder
            activeTag={activeTag}
            hoveredTag={hovered2D || hovered3D}
            onTagClick={selectTag3D}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Viewer3DPlaceholder — Placeholder for the Three.js 3D viewer (Phase 2).
 *
 * Shows the selection state and provides clickable mock equipment tags
 * to demonstrate the 3D→2D sync flow.
 */
function Viewer3DPlaceholder({ activeTag, hoveredTag, onTagClick }) {
  // Mock equipment tags for demo
  const mockTags = [
    { tag: 'XT-019', label: 'Christmas Tree', x: 35, y: 30 },
    { tag: 'CV-019S', label: 'Choke Valve', x: 55, y: 45 },
    { tag: 'PSV-01901', label: 'Safety Valve', x: 25, y: 60 },
    { tag: 'SDV-019', label: 'Shutdown Valve', x: 65, y: 25 },
    { tag: 'FCV-019', label: 'Flow Control Valve', x: 45, y: 70 },
  ];

  return (
    <div
      className="flex flex-col h-full w-full"
      style={{ background: md.surfaceContainerLow }}
    >
      {/* Header */}
      <div
        className="flex items-center px-3 py-1.5 gap-2 shrink-0"
        style={{
          background: alpha(md.tertiary, 0.08),
          borderBottom: `1px solid ${md.outlineVariant}`,
        }}
      >
        <span
          className="material-symbols-outlined text-[16px]"
          style={{ color: md.tertiary }}
        >
          view_in_ar
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: md.tertiary }}>
          3D Model Viewer
        </span>
        <span style={{ fontSize: 9, color: md.onSurfaceVariant }}>
          (Phase 2 — Three.js)
        </span>
      </div>

      {/* 3D Viewport mock */}
      <div className="flex-1 relative overflow-hidden">
        {/* Grid lines for depth effect */}
        <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.08 }}>
          {Array.from({ length: 12 }, (_, i) => (
            <line
              key={`h${i}`}
              x1="0" y1={`${(i + 1) * 8}%`}
              x2="100%" y2={`${(i + 1) * 8}%`}
              stroke={md.onSurface}
              strokeWidth="0.5"
            />
          ))}
          {Array.from({ length: 12 }, (_, i) => (
            <line
              key={`v${i}`}
              x1={`${(i + 1) * 8}%`} y1="0"
              x2={`${(i + 1) * 8}%`} y2="100%"
              stroke={md.onSurface}
              strokeWidth="0.5"
            />
          ))}
        </svg>

        {/* Clickable mock equipment markers */}
        {mockTags.map((item) => {
          const isActive = activeTag === item.tag;
          const isHovered = hoveredTag === item.tag;
          return (
            <button
              key={item.tag}
              onClick={() => onTagClick(item.tag)}
              className="absolute flex flex-col items-center gap-0.5 cursor-pointer transition-transform"
              style={{
                left: `${item.x}%`,
                top: `${item.y}%`,
                transform: `translate(-50%, -50%) ${isActive ? 'scale(1.15)' : ''}`,
              }}
              title={`${item.tag} — ${item.label} (Click to select in 2D)`}
            >
              {/* Marker dot */}
              <div
                style={{
                  width: isActive ? 16 : 12,
                  height: isActive ? 16 : 12,
                  borderRadius: '50%',
                  background: isActive
                    ? md.primary
                    : isHovered
                    ? alpha(md.primary, 0.7)
                    : alpha(md.tertiary, 0.5),
                  border: `2px solid ${isActive ? md.primary : 'transparent'}`,
                  boxShadow: isActive ? `0 0 12px ${alpha(md.primary, 0.5)}` : 'none',
                  transition: 'all 0.2s ease',
                }}
              />
              {/* Label */}
              <span
                style={{
                  fontSize: 9,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? md.primary : md.onSurfaceVariant,
                  background: alpha(md.surface, 0.85),
                  padding: '1px 4px',
                  borderRadius: 3,
                  whiteSpace: 'nowrap',
                }}
              >
                {item.tag}
              </span>
            </button>
          );
        })}

        {/* Center info */}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ opacity: activeTag ? 0.3 : 0.6 }}
        >
          <div className="flex flex-col items-center gap-2">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 48, color: md.outline }}
            >
              view_in_ar
            </span>
            <span style={{ fontSize: 11, color: md.outline }}>
              Three.js viewer — click markers to sync with 2D
            </span>
          </div>
        </div>

        {/* Active selection highlight overlay */}
        {activeTag && (
          <div
            className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded"
            style={{
              background: alpha(md.primaryContainer, 0.9),
              border: `1px solid ${alpha(md.primary, 0.3)}`,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: md.primary,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            <span style={{ fontSize: 11, fontWeight: 600, color: md.onPrimaryContainer }}>
              {activeTag}
            </span>
            <style>{`
              @keyframes pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.6; transform: scale(0.85); }
              }
            `}</style>
          </div>
        )}
      </div>
    </div>
  );
}
