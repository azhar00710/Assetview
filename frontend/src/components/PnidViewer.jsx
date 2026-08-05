import { useState, useRef, useCallback, useEffect } from 'react';
import { C, CC, STC, SC, CANVAS_BG } from '../data/constants';

export default function PnidViewer({ pnid, systems, annotations, onClose, onSelectEquipment }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredTag, setHoveredTag] = useState(null);
  const [selectedTag, setSelectedTag] = useState(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const containerRef = useRef(null);

  const imagePath = pnid.imagePath || `/pnid-images/pid-${pnid.drawingNumber.split('-D-')[1] || '15101'}.jpg`;

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.min(5, Math.max(0.5, z + delta)));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  const handleMouseDown = (e) => {
    if (e.target.closest('[data-annotation]')) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setDragging(false);

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const zoomIn = () => setZoom(z => Math.min(5, z + 0.25));
  const zoomOut = () => setZoom(z => Math.max(0.5, z - 0.25));

  const allItems = [
    ...(annotations?.equipment || []).map(e => ({ ...e, _type: 'equipment', tag: e.tag })),
    ...(annotations?.instruments || []).map(i => ({ ...i, _type: 'instrument', tag: i.tag })),
  ];

  const selectedItem = allItems.find(a => a.tag === selectedTag);
  const primarySys = systems?.find(s => s.isPrimary);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: C.bg }}>
      {/* Viewer Top Bar */}
      <div className="flex items-center px-4 py-2 bg-md-surface-container border-b border-white/[0.08] gap-3 shrink-0">
        <button onClick={onClose} className="px-3 py-1 bg-md-surface-container-high border border-white/[0.1] rounded-md text-md-on-surface text-[11px] cursor-pointer hover:bg-white/5">
          ← Back
        </button>
        <div className="w-px h-5 bg-white/[0.08]" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-md-on-surface">{pnid.drawingNumber}</span>
            <span className="text-[8px] px-1.5 rounded-full" style={{ background: `${statusColor(pnid.status)}15`, color: statusColor(pnid.status) }}>
              {(pnid.status || '').replace(/_/g, ' ')}
            </span>
            {pnid.revision && <span className="text-[9px] text-md-on-surface-variant">Rev {pnid.revision}</span>}
          </div>
          <div className="text-[11px] text-md-on-surface-variant truncate">{pnid.title}</div>
        </div>

        {/* Systems */}
        <div className="flex gap-1">
          {systems?.map(s => (
            <span key={s.id} className="text-[9px] px-1.5 py-0.5 rounded-md" style={{
              background: s.isPrimary ? `${sysColor(s.sysType)}20` : `${sysColor(s.sysType)}08`,
              color: sysColor(s.sysType),
              border: s.isPrimary ? `1px solid ${sysColor(s.sysType)}44` : '1px solid transparent',
            }}>
              {s.code}
            </span>
          ))}
        </div>

        <div className="w-px h-5 bg-white/[0.08]" />

        {/* Controls */}
        <button onClick={() => setShowAnnotations(!showAnnotations)} className={`px-2 py-1 rounded-md text-[10px] cursor-pointer border ${showAnnotations ? 'bg-md-primary/10 border-md-primary/25 text-md-primary' : 'bg-md-surface-container-high border-white/[0.07] text-md-on-surface-variant'}`}>
          Annotations
        </button>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="w-7 h-7 bg-md-surface-container-high border border-white/[0.1] rounded text-md-on-surface text-sm cursor-pointer hover:bg-white/5">−</button>
          <span className="text-[10px] text-md-on-surface-variant w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} className="w-7 h-7 bg-md-surface-container-high border border-white/[0.1] rounded text-md-on-surface text-sm cursor-pointer hover:bg-white/5">+</button>
          <button onClick={resetView} className="px-2 h-7 bg-md-surface-container-high border border-white/[0.1] rounded text-md-on-surface-variant text-[10px] cursor-pointer hover:bg-white/5 ml-1">Reset</button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing relative"
          style={{ background: CANVAS_BG }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}>
            <div className="relative inline-block">
              <img
                src={imagePath}
                alt={pnid.drawingNumber}
                className="max-w-full max-h-full select-none"
                draggable={false}
                style={{ display: 'block' }}
              />

              {/* Annotation Overlays */}
              {showAnnotations && allItems.map(item => (
                <div
                  key={item.tag}
                  data-annotation
                  className="absolute cursor-pointer transition-all duration-150"
                  style={{
                    left: `${item.xPct}%`,
                    top: `${item.yPct}%`,
                    width: `${item.wPct}%`,
                    height: `${item.hPct}%`,
                    border: `2px solid ${item._type === 'equipment' ? C.g : C.b}${selectedTag === item.tag ? 'cc' : hoveredTag === item.tag ? '88' : '55'}`,
                    background: `${item._type === 'equipment' ? C.g : C.b}${selectedTag === item.tag ? '25' : hoveredTag === item.tag ? '15' : '08'}`,
                    borderRadius: 3,
                    zIndex: selectedTag === item.tag ? 10 : hoveredTag === item.tag ? 5 : 1,
                  }}
                  onMouseEnter={() => setHoveredTag(item.tag)}
                  onMouseLeave={() => setHoveredTag(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTag(selectedTag === item.tag ? null : item.tag);
                  }}
                >
                  {/* Tag label */}
                  <div className="absolute -top-5 left-0 whitespace-nowrap pointer-events-none" style={{
                    fontSize: Math.max(9, 11 / zoom),
                    fontWeight: 600,
                    color: item._type === 'equipment' ? C.g : C.b,
                    textShadow: '0 0 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.5)',
                    opacity: (hoveredTag === item.tag || selectedTag === item.tag || zoom >= 1.5) ? 1 : 0.7,
                  }}>
                    {item.tag}
                  </div>

                  {/* Type indicator dot */}
                  <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{
                    background: item._type === 'equipment' ? C.g : C.b,
                    boxShadow: `0 0 4px ${item._type === 'equipment' ? C.g : C.b}`,
                  }} />
                </div>
              ))}
            </div>
          </div>

          {/* Hover tooltip */}
          {hoveredTag && !selectedTag && (
            <div className="absolute bottom-4 left-4 px-3 py-2 rounded-lg border border-white/[0.1] shadow-xl pointer-events-none" style={{ background: C.bg }}>
              <div className="text-xs font-bold text-md-on-surface">{hoveredTag}</div>
              {(() => {
                const item = allItems.find(a => a.tag === hoveredTag);
                return item ? (
                  <div className="text-[10px] mt-0.5" style={{ color: item._type === 'equipment' ? C.g : C.b }}>
                    {item._type === 'equipment' ? 'Equipment' : 'Instrument'}
                  </div>
                ) : null;
              })()}
            </div>
          )}

          {/* Zoom hint */}
          <div className="absolute bottom-4 right-4 text-[9px] text-md-on-surface-variant/50 pointer-events-none">
            Scroll to zoom · Drag to pan
          </div>
        </div>

        {/* Side Panel — Annotation List */}
        <div className="w-64 bg-md-surface-container border-l border-white/[0.06] flex flex-col overflow-hidden shrink-0">
          <div className="px-3 py-2 border-b border-white/[0.06] shrink-0">
            <div className="text-[10px] font-bold text-md-primary tracking-wide">ANNOTATIONS</div>
            <div className="text-[9px] text-md-on-surface-variant mt-0.5">
              {annotations?.equipment?.length || 0} equipment · {annotations?.instruments?.length || 0} instruments
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {/* Equipment section */}
            {annotations?.equipment?.length > 0 && (
              <div className="px-2 pt-2">
                <div className="text-[9px] font-bold text-md-primary/60 uppercase tracking-wider px-1 mb-1">Equipment</div>
                {annotations.equipment.map(eq => (
                  <div
                    key={eq.tag}
                    className="px-2 py-1.5 my-0.5 rounded cursor-pointer"
                    style={{
                      background: selectedTag === eq.tag ? `${C.g}15` : hoveredTag === eq.tag ? `${C.t}06` : 'transparent',
                      borderLeft: `3px solid ${selectedTag === eq.tag ? C.g : 'transparent'}`,
                    }}
                    onClick={() => {
                      setSelectedTag(selectedTag === eq.tag ? null : eq.tag);
                      setHoveredTag(null);
                    }}
                    onMouseEnter={() => setHoveredTag(eq.tag)}
                    onMouseLeave={() => setHoveredTag(null)}
                  >
                    <div className="text-[11px] font-semibold text-md-on-surface">{eq.tag}</div>
                    <div className="text-[9px] text-md-on-surface-variant">
                      ({Number(eq.xPct).toFixed(0)}%, {Number(eq.yPct).toFixed(0)}%)
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Instruments section */}
            {annotations?.instruments?.length > 0 && (
              <div className="px-2 pt-2">
                <div className="text-[9px] font-bold text-md-secondary/60 uppercase tracking-wider px-1 mb-1">Instruments</div>
                {annotations.instruments.map(inst => (
                  <div
                    key={inst.tag}
                    className="px-2 py-1.5 my-0.5 rounded cursor-pointer"
                    style={{
                      background: selectedTag === inst.tag ? `${C.b}15` : hoveredTag === inst.tag ? `${C.t}06` : 'transparent',
                      borderLeft: `3px solid ${selectedTag === inst.tag ? C.b : 'transparent'}`,
                    }}
                    onClick={() => {
                      setSelectedTag(selectedTag === inst.tag ? null : inst.tag);
                      setHoveredTag(null);
                    }}
                    onMouseEnter={() => setHoveredTag(inst.tag)}
                    onMouseLeave={() => setHoveredTag(null)}
                  >
                    <div className="text-[11px] font-semibold text-md-on-surface">{inst.tag}</div>
                    <div className="text-[9px] text-md-on-surface-variant">
                      ({Number(inst.xPct).toFixed(0)}%, {Number(inst.yPct).toFixed(0)}%)
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(!annotations?.equipment?.length && !annotations?.instruments?.length) && (
              <div className="px-3 py-6 text-center text-[11px] text-md-on-surface-variant">
                No annotations on this P&ID
              </div>
            )}
          </div>

          {/* Selected Item Detail */}
          {selectedItem && (
            <div className="border-t border-white/[0.08] px-3 py-2 shrink-0" style={{ background: `${selectedItem._type === 'equipment' ? C.g : C.b}08` }}>
              <div className="text-xs font-bold text-md-on-surface">{selectedItem.tag}</div>
              <div className="text-[10px] mt-0.5" style={{ color: selectedItem._type === 'equipment' ? C.g : C.b }}>
                {selectedItem._type === 'equipment' ? 'Equipment' : 'Instrument'}
              </div>
              <div className="text-[9px] text-md-on-surface-variant mt-1">
                Position: {Number(selectedItem.xPct).toFixed(1)}% x {Number(selectedItem.yPct).toFixed(1)}%
              </div>
              <div className="text-[9px] text-md-on-surface-variant">
                Size: {Number(selectedItem.wPct).toFixed(1)}% x {Number(selectedItem.hPct).toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function statusColor(status) {
  return STC[status] || C.m;
}

function sysColor(type) {
  return SC[type] || C.m;
}
