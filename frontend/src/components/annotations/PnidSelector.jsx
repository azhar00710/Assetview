import { useState, useRef, useEffect } from 'react';
import { useAnnotationSummary } from '../../hooks/useAnnotationSearch';
import useAnnotationWorkspace from '../../hooks/useAnnotationWorkspace';

export default function PnidSelector({ pnids = [], systems = [] }) {
  const [open, setOpen] = useState(false);
  const [filterSystem, setFilterSystem] = useState(null);
  const dropdownRef = useRef(null);

  const { selectedPnidId, selectedPnidInfo, selectPnid } = useAnnotationWorkspace();

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredPnids = filterSystem
    ? pnids.filter(p => p.primarySystemId === filterSystem || p.systemIds?.includes(filterSystem))
    : pnids;

  const currentPnid = pnids.find(p => p.id === selectedPnidId);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#16352B] border border-[#919A9B]/20 hover:border-[#3BE494]/40 transition-colors max-w-xs"
      >
        <span className="material-symbols-outlined text-[16px] text-[#8AB4FF]">description</span>
        <div className="text-left min-w-0">
          {currentPnid ? (
            <>
              <div className="text-[11px] font-mono font-semibold text-[#D3DFE2] truncate">
                {currentPnid.drawingNumber?.split('-D-')[1] || currentPnid.drawingNumber}
              </div>
              <div className="text-[9px] text-[#919A9B] truncate">{currentPnid.title}</div>
            </>
          ) : (
            <div className="text-[11px] text-[#919A9B]">Select P&ID</div>
          )}
        </div>
        <span className="material-symbols-outlined text-[14px] text-[#919A9B]">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-80 bg-[#111D14] border border-[#919A9B]/20 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col">
          {/* System filter */}
          {systems.length > 1 && (
            <div className="px-3 py-2 border-b border-[#919A9B]/10 flex gap-1 flex-wrap">
              <button
                onClick={() => setFilterSystem(null)}
                className={`text-[9px] px-1.5 py-0.5 rounded font-semibold transition-colors ${
                  !filterSystem ? 'bg-[#3BE494]/20 text-[#3BE494]' : 'text-[#919A9B] hover:text-[#D3DFE2]'
                }`}
              >
                All
              </button>
              {systems.map(sys => (
                <button
                  key={sys.id}
                  onClick={() => setFilterSystem(filterSystem === sys.id ? null : sys.id)}
                  className={`text-[9px] px-1.5 py-0.5 rounded font-semibold transition-colors ${
                    filterSystem === sys.id ? 'bg-[#3BE494]/20 text-[#3BE494]' : 'text-[#919A9B] hover:text-[#D3DFE2]'
                  }`}
                >
                  {sys.code}
                </button>
              ))}
            </div>
          )}

          {/* P&ID list */}
          <div className="flex-1 overflow-y-auto">
            {filteredPnids.map(pnid => (
              <PnidRow
                key={pnid.id}
                pnid={pnid}
                isSelected={pnid.id === selectedPnidId}
                onSelect={() => {
                  selectPnid(pnid.id, {
                    id: pnid.id,
                    drawingNumber: pnid.drawingNumber,
                    title: pnid.title,
                  });
                  setOpen(false);
                }}
              />
            ))}
            {filteredPnids.length === 0 && (
              <div className="px-3 py-4 text-center text-[11px] text-[#919A9B]">No P&IDs found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PnidRow({ pnid, isSelected, onSelect }) {
  const { data: summary } = useAnnotationSummary(pnid.id);

  const total = summary?.total || 0;
  const positioned = summary?.positioned || 0;
  const coverage = total > 0 ? Math.round((positioned / total) * 100) : 0;

  return (
    <button
      onClick={onSelect}
      className={`w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-white/5 transition-colors ${
        isSelected ? 'bg-[#3BE494]/10 border-l-2 border-[#3BE494]' : 'border-l-2 border-transparent'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-semibold text-[#D3DFE2] truncate">
            {pnid.drawingNumber?.split('-D-')[1] || pnid.drawingNumber}
          </span>
          {pnid.primarySystemCode && (
            <span className="text-[9px] font-semibold text-[#A855F7]">{pnid.primarySystemCode}</span>
          )}
        </div>
        <div className="text-[9px] text-[#919A9B] truncate mt-0.5">{pnid.title}</div>
      </div>
      {total > 0 && (
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-[9px] text-[#919A9B]">
            {positioned}/{total}
          </div>
          <div className="w-12 h-1.5 rounded-full bg-[#919A9B]/20 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${coverage}%`,
                background: coverage === 100 ? '#3BE494' : coverage > 50 ? '#FFD466' : '#FF897A',
              }}
            />
          </div>
          <span className="text-[9px] font-semibold" style={{
            color: coverage === 100 ? '#3BE494' : coverage > 50 ? '#FFD466' : '#FF897A',
          }}>
            {coverage}%
          </span>
        </div>
      )}
    </button>
  );
}
