import { useState, useMemo } from 'react';
import { C, CC, STC, M3 } from '../data/constants';
import { useRegister } from '../hooks/useApi';

/* ═══ Map API register responses to UI field names ═══ */
const regMappers = {
  systems: (d) => ({ id: d.code, code: d.code, name: d.name, sysType: d.sysType }),
  pnids: (d) => ({
    id: d.drawingNumber, name: d.drawingNumber, title: d.title,
    primarySystem: d.primarySystem, rev: d.revision, status: d.status,
    systems: d.allSystems, systemCount: d.systemCount,
  }),
  lines: (d) => ({
    id: d.lineNumber, name: d.lineNumber, service: d.service, size: d.size,
    pipeClass: d.pipeClass, material: d.material, dp: d.dp, dt: d.dt,
    systemCode: d.systemCode, pnids: d.pnids, pnidCount: d.pnidCount,
  }),
  equipment: (d) => ({
    id: d.tag, tag: d.tag, eqType: d.type, desc: d.description,
    systemCode: d.system, criticality: d.criticality, sil: d.sil,
    insp: d.inspGroup, cl: d.corrLoop, line: d.line || "(standalone)",
  }),
  instruments: (d) => ({
    id: d.tag, tag: d.tag, iType: d.type, desc: d.description,
    range: d.range, scada: d.scadaTag, systemCode: d.system, lineName: d.line || "",
  }),
};

function SortIcon({ col, regSort }) {
  return regSort.col === col
    ? <span className="ml-0.5 text-[8px]">{regSort.asc ? "\u25B2" : "\u25BC"}</span>
    : null;
}

export default function RegisterView({ type, platform, onExit, onSelectItem, apiPlatformId }) {
  const [regSort, setRegSort] = useState({ col: null, asc: true });
  const [regFilter, setRegFilter] = useState({});

  // Fetch register data from API
  const { data: regData, isLoading } = useRegister(type, apiPlatformId);

  // Map API register data to UI field names
  const apiData = useMemo(() => {
    if (!regData?.data) return [];
    const mapper = regMappers[type];
    return mapper ? regData.data.map(mapper) : [];
  }, [regData, type]);

  const toggleSort = (col) => setRegSort(prev => ({ col, asc: prev.col === col ? !prev.asc : true }));

  const sortData = (data) => {
    if (!regSort.col) return data;
    return [...data].sort((a, b) => {
      const va = (a[regSort.col] || "").toString().toLowerCase();
      const vb = (b[regSort.col] || "").toString().toLowerCase();
      return regSort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  };

  const configs = {
    systems: { title: "Systems Register", color: C.g, cols: [{ key: "code", label: "Code", w: 80 }, { key: "name", label: "Name", w: 220 }, { key: "sysType", label: "Type", w: 100 }] },
    pnids: { title: "P&ID Register", color: C.b, cols: [{ key: "name", label: "Drawing No.", w: 180 }, { key: "title", label: "Title", w: 250 }, { key: "primarySystem", label: "Primary System", w: 100 }, { key: "rev", label: "Rev", w: 40 }, { key: "status", label: "Status", w: 70 }, { key: "systems", label: "All Systems", w: 150 }, { key: "systemCount", label: "Sys#", w: 40 }] },
    lines: { title: "Line List Register", color: C.o, cols: [{ key: "name", label: "Line Number", w: 220 }, { key: "service", label: "Service", w: 150 }, { key: "size", label: "Size", w: 50 }, { key: "pipeClass", label: "Class", w: 80 }, { key: "material", label: "Material", w: 60 }, { key: "dp", label: "DP (psi)", w: 60 }, { key: "dt", label: "DT (\u00b0C)", w: 60 }, { key: "systemCode", label: "System", w: 60 }, { key: "pnids", label: "P&IDs", w: 120 }, { key: "pnidCount", label: "#P&ID", w: 40 }] },
    equipment: { title: "Equipment Register", color: C.g, cols: [{ key: "tag", label: "Tag", w: 100 }, { key: "eqType", label: "Type", w: 110 }, { key: "desc", label: "Description", w: 150 }, { key: "systemCode", label: "System", w: 60 }, { key: "criticality", label: "Crit.", w: 60 }, { key: "sil", label: "SIL", w: 50 }, { key: "insp", label: "Insp Group", w: 80 }, { key: "cl", label: "Corr Loop", w: 70 }, { key: "line", label: "Line/Location", w: 140 }] },
    instruments: { title: "Instrument Index", color: C.b, cols: [{ key: "tag", label: "Tag", w: 90 }, { key: "iType", label: "Type", w: 90 }, { key: "desc", label: "Description", w: 150 }, { key: "range", label: "Range", w: 100 }, { key: "scada", label: "SCADA Tag", w: 100 }, { key: "systemCode", label: "System", w: 60 }, { key: "lineName", label: "Line", w: 180 }] },
  };

  const cfg = configs[type];
  if (!cfg) return null;

  let data = sortData(apiData);
  Object.entries(regFilter).forEach(([key, val]) => {
    if (val) {
      const q = val.toLowerCase();
      data = data.filter(d => (d[key] || "").toString().toLowerCase().includes(q));
    }
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden animate-md-register-enter">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-md-outline-variant/30 flex items-center gap-3 shrink-0" style={{ background: `${cfg.color}10` }}>
        <div className="w-1 h-5 rounded-md-full" style={{ background: cfg.color }} />
        <span className="text-title-sm font-bold text-md-on-surface">{cfg.title}</span>
        <span className="text-label-md text-md-on-surface-variant">
          {isLoading ? 'Loading...' : `${data.length} items`}
        </span>
        <div className="flex-1" />
        <button onClick={onExit} className="md-btn-tonal text-label-md">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back to Columns
        </button>
      </div>

      {/* Filter row */}
      <div className="flex border-b border-md-outline-variant/30 shrink-0 bg-md-surface-container-low">
        {cfg.cols.map(col => (
          <div key={col.key} className="px-1.5 py-1.5 shrink-0" style={{ width: col.w }}>
            <input
              value={regFilter[col.key] || ""}
              onChange={e => setRegFilter(p => ({ ...p, [col.key]: e.target.value }))}
              placeholder="Filter..."
              className="md-input w-full px-2 py-1 text-label-sm rounded-md-sm"
              style={{ borderRadius: '8px', padding: '4px 8px' }}
            />
          </div>
        ))}
      </div>

      {/* Column headers */}
      <div className="flex border-b border-md-outline-variant/30 shrink-0" style={{ background: `${cfg.color}08` }}>
        {cfg.cols.map(col => (
          <div
            key={col.key}
            onClick={() => toggleSort(col.key)}
            className="px-1.5 py-2 text-label-md font-bold cursor-pointer select-none flex items-center shrink-0"
            style={{ width: col.w, color: cfg.color }}
          >
            {col.label}<SortIcon col={col.key} regSort={regSort} />
          </div>
        ))}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-md-on-surface-variant text-body-sm">
            Loading register data...
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-md-on-surface-variant text-body-sm">
            No data available
          </div>
        ) : (
          data.map((row, ri) => (
            <div
              key={row.id || ri}
              className="flex border-b border-md-outline-variant/10 cursor-pointer md-list-item"
              style={{ background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}
              onClick={() => onSelectItem(row)}
            >
              {cfg.cols.map(col => {
                const val = (row[col.key] || "").toString();
                let color = undefined;
                if (col.key === "criticality") color = CC[val];
                if (col.key === "status") color = STC[val];
                if (col.key === "sil" && val) color = M3.sil;
                if (col.key === "scada" && val) color = C.b;
                return (
                  <div
                    key={col.key}
                    className="px-1.5 py-2 text-body-sm overflow-hidden text-ellipsis whitespace-nowrap shrink-0"
                    style={{ width: col.w, color }}
                    title={val}
                  >
                    {val.replace(/_/g, " ")}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
