import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { C, SC, CC, STC, M3 } from '../data/constants';
import { useHierarchy, usePlatforms } from '../hooks/useApi';

// ── Icons for each node type ──
const ICONS = {
  platform: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="10" width="12" height="4" rx="1" fill="currentColor" opacity="0.8" />
      <rect x="4" y="6" width="8" height="4" rx="1" fill="currentColor" opacity="0.5" />
      <rect x="6" y="2" width="4" height="4" rx="1" fill="currentColor" opacity="0.3" />
    </svg>
  ),
  system: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      <circle cx="7" cy="7" r="2" fill="currentColor" />
    </svg>
  ),
  line: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="2" cy="7" r="1.5" fill="currentColor" />
      <circle cx="12" cy="7" r="1.5" fill="currentColor" />
    </svg>
  ),
  equipment: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="3" width="10" height="6" rx="2" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
      <circle cx="6" cy="6" r="1.5" fill="currentColor" />
    </svg>
  ),
  instrument: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.1" />
      <path d="M6 3v3l2 1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  ),
};

// ── Build the tree data ──
function buildTree(platform, systems, lines, equipment, instruments) {
  if (!platform) return null;

  return {
    id: platform.id,
    name: platform.name,
    code: platform.code,
    type: 'platform',
    children: systems.map(sys => {
      const sysLines = lines.filter(l => l.systemId === sys.id);
      const standaloneEquip = equipment.filter(e => e.systemId === sys.id && !e.lineId);

      return {
        id: sys.id,
        name: sys.name,
        code: sys.code,
        type: 'system',
        sysType: sys.sysType,
        data: sys,
        children: [
          ...sysLines.map(line => {
            const lineEquip = equipment.filter(e => e.lineId === line.id);
            const lineInst = instruments.filter(i => i.lineId === line.id);
            return {
              id: line.id,
              name: line.name,
              type: 'line',
              service: line.service,
              size: line.size,
              data: line,
              parentSysType: sys.sysType,
              children: [
                ...lineEquip.map(eq => ({
                  id: eq.id, name: eq.tag, type: 'equipment',
                  desc: eq.desc, eqType: eq.eqType, criticality: eq.criticality, sil: eq.sil,
                  data: eq, parentSysType: sys.sysType, children: [],
                })),
                ...lineInst.map(inst => ({
                  id: inst.id, name: inst.tag, type: 'instrument',
                  desc: inst.desc, iType: inst.iType, range: inst.range, scada: inst.scada,
                  data: inst, parentSysType: sys.sysType, children: [],
                })),
              ],
            };
          }),
          ...standaloneEquip.map(eq => ({
            id: eq.id, name: eq.tag, type: 'equipment',
            desc: eq.desc, eqType: eq.eqType, criticality: eq.criticality, sil: eq.sil,
            data: eq, parentSysType: sys.sysType, standalone: true, children: [],
          })),
        ],
      };
    }),
  };
}

// ── Compute all cross-references ──
function computeXrefs(systems, pnidSystems, pnidLines, lines, pnids) {
  const sysIds = systems.map(s => s.id);
  const xrefs = [];
  const getSysName = (id) => systems.find(s => s.id === id)?.code || '';

  // Lines that appear on P&IDs of other systems
  pnidLines.forEach(pl => {
    const line = lines.find(l => l.id === pl.lineId);
    if (!line || !sysIds.includes(line.systemId)) return;

    const pnid = pnids.find(p => p.id === pl.pnidId);
    if (!pnid) return;

    const primarySys = pnidSystems.find(ps => ps.pnidId === pl.pnidId && ps.isPrimary);
    if (primarySys && primarySys.systemId !== line.systemId) {
      xrefs.push({
        type: 'line-on-foreign-pnid',
        lineId: line.id,
        lineName: line.name,
        lineOwnerSysId: line.systemId,
        lineOwnerSysCode: getSysName(line.systemId),
        pnidId: pnid.id,
        pnidName: pnid.name,
        pnidPrimarySysId: primarySys.systemId,
        pnidPrimarySysCode: getSysName(primarySys.systemId),
        isContinuation: pl.isCont || false,
      });
    }
  });

  // Systems that share P&IDs (secondary references)
  pnidSystems.filter(ps => !ps.isPrimary && sysIds.includes(ps.systemId)).forEach(ps => {
    const pnid = pnids.find(p => p.id === ps.pnidId);
    const primary = pnidSystems.find(r => r.pnidId === ps.pnidId && r.isPrimary);
    if (pnid && primary) {
      xrefs.push({
        type: 'system-on-pnid',
        systemId: ps.systemId,
        systemCode: getSysName(ps.systemId),
        pnidId: pnid.id,
        pnidName: pnid.name,
        pnidPrimarySysId: primary.systemId,
        pnidPrimarySysCode: getSysName(primary.systemId),
      });
    }
  });

  return xrefs;
}

// ── Get relationships for a selected node ──
function getRelationships(node, xrefs, data) {
  if (!node) return { pnids: [], connectedSystems: [], relatedItems: [] };

  const { systems, pnidSystems, pnidLines, pnids, equipment, instruments } = data;
  const getSys = (id) => systems.find(s => s.id === id);
  const getSysName = (id) => systems.find(s => s.id === id)?.code || '';

  const result = { pnids: [], connectedSystems: [], relatedItems: [], xrefLines: [] };

  if (node.type === 'system') {
    // P&IDs for this system
    const sysPnids = pnidSystems.filter(r => r.systemId === node.id);
    result.pnids = sysPnids.map(r => {
      const p = pnids.find(pn => pn.id === r.pnidId);
      return p ? { ...p, isPrimary: r.isPrimary } : null;
    }).filter(Boolean);

    // Connected systems via shared P&IDs
    const pnidIds = sysPnids.map(r => r.pnidId);
    const connectedSysIds = new Set();
    pnidIds.forEach(pid => {
      pnidSystems.filter(r => r.pnidId === pid && r.systemId !== node.id).forEach(r => {
        connectedSysIds.add(r.systemId);
      });
    });
    result.connectedSystems = [...connectedSysIds].map(id => getSys(id)).filter(Boolean);

    // Lines from other systems that appear on this system's P&IDs
    result.xrefLines = xrefs.filter(x =>
      x.type === 'line-on-foreign-pnid' && x.pnidPrimarySysId === node.id
    );
  }

  if (node.type === 'line') {
    // P&IDs this line appears on
    const linePnids = pnidLines.filter(r => r.lineId === node.id);
    result.pnids = linePnids.map(r => {
      const p = pnids.find(pn => pn.id === r.pnidId);
      const primarySys = pnidSystems.find(ps => ps.pnidId === r.pnidId && ps.isPrimary);
      return p ? { ...p, isCont: r.isCont, primarySysCode: primarySys ? getSysName(primarySys.systemId) : '' } : null;
    }).filter(Boolean);

    // Connected systems (systems of P&IDs this line appears on)
    const connSysIds = new Set();
    linePnids.forEach(r => {
      pnidSystems.filter(ps => ps.pnidId === r.pnidId).forEach(ps => {
        if (ps.systemId !== node.data?.systemId) connSysIds.add(ps.systemId);
      });
    });
    result.connectedSystems = [...connSysIds].map(id => getSys(id)).filter(Boolean);

    // Equipment and instruments on this line
    result.relatedItems = [
      ...equipment.filter(e => e.lineId === node.id).map(e => ({ ...e, itemType: 'equipment' })),
      ...instruments.filter(i => i.lineId === node.id).map(i => ({ ...i, itemType: 'instrument' })),
    ];
  }

  if (node.type === 'equipment') {
    const eq = node.data;
    // P&IDs where this equipment appears (via its line or system)
    if (eq.lineId) {
      result.pnids = pnidLines.filter(r => r.lineId === eq.lineId).map(r => pnids.find(p => p.id === r.pnidId)).filter(Boolean);
    } else {
      result.pnids = pnidSystems.filter(r => r.systemId === eq.systemId && r.isPrimary).map(r => pnids.find(p => p.id === r.pnidId)).filter(Boolean);
    }
    // Other equipment on same line
    if (eq.lineId) {
      result.relatedItems = [
        ...equipment.filter(e => e.lineId === eq.lineId && e.id !== eq.id).map(e => ({ ...e, itemType: 'equipment' })),
        ...instruments.filter(i => i.lineId === eq.lineId).map(i => ({ ...i, itemType: 'instrument' })),
      ];
    }
    result.connectedSystems = [getSys(eq.systemId)].filter(Boolean);
  }

  if (node.type === 'instrument') {
    const inst = node.data;
    if (inst.lineId) {
      result.pnids = pnidLines.filter(r => r.lineId === inst.lineId).map(r => pnids.find(p => p.id === r.pnidId)).filter(Boolean);
      result.relatedItems = [
        ...equipment.filter(e => e.lineId === inst.lineId).map(e => ({ ...e, itemType: 'equipment' })),
        ...instruments.filter(i => i.lineId === inst.lineId && i.id !== inst.id).map(i => ({ ...i, itemType: 'instrument' })),
      ];
    }
    result.connectedSystems = [getSys(inst.systemId)].filter(Boolean);
  }

  return result;
}

// ── Search: find matching node IDs and their ancestor paths ──
function searchTree(node, query, path = []) {
  if (!query) return { matches: new Set(), expanded: new Set() };

  const results = { matches: new Set(), expanded: new Set() };
  const q = query.toLowerCase();
  const currentPath = [...path, node.id];

  const name = (node.name || '').toLowerCase();
  const code = (node.code || '').toLowerCase();
  const tag = (node.data?.tag || '').toLowerCase();
  const desc = (node.desc || node.data?.desc || '').toLowerCase();
  const service = (node.service || '').toLowerCase();

  if (name.includes(q) || code.includes(q) || tag.includes(q) || desc.includes(q) || service.includes(q)) {
    results.matches.add(node.id);
    currentPath.forEach(id => results.expanded.add(id));
  }

  if (node.children) {
    node.children.forEach(child => {
      const childResults = searchTree(child, query, currentPath);
      childResults.matches.forEach(id => results.matches.add(id));
      childResults.expanded.forEach(id => results.expanded.add(id));
    });
  }

  return results;
}

// ── Get IDs of nodes related to selected (for highlighting across branches) ──
function getRelatedNodeIds(selectedNode, xrefs, data) {
  const ids = new Set();
  if (!selectedNode) return ids;

  const { pnidSystems, pnidLines, equipment, instruments } = data;

  if (selectedNode.type === 'system') {
    // Highlight lines from other systems that appear on this system's P&IDs
    xrefs.filter(x => x.type === 'line-on-foreign-pnid' && x.pnidPrimarySysId === selectedNode.id)
      .forEach(x => ids.add(x.lineId));
    // Highlight connected systems
    const sysPnids = pnidSystems.filter(r => r.systemId === selectedNode.id).map(r => r.pnidId);
    sysPnids.forEach(pid => {
      pnidSystems.filter(r => r.pnidId === pid && r.systemId !== selectedNode.id)
        .forEach(r => ids.add(r.systemId));
    });
  }

  if (selectedNode.type === 'line') {
    // Highlight other systems' P&IDs this line appears on
    const linePnids = pnidLines.filter(r => r.lineId === selectedNode.id).map(r => r.pnidId);
    linePnids.forEach(pid => {
      pnidSystems.filter(ps => ps.pnidId === pid && ps.isPrimary && ps.systemId !== selectedNode.data?.systemId)
        .forEach(ps => ids.add(ps.systemId));
    });
    // Highlight equipment/instruments on this line
    equipment.filter(e => e.lineId === selectedNode.id).forEach(e => ids.add(e.id));
    instruments.filter(i => i.lineId === selectedNode.id).forEach(i => ids.add(i.id));
  }

  if (selectedNode.type === 'equipment' || selectedNode.type === 'instrument') {
    const lineId = selectedNode.data?.lineId;
    if (lineId) {
      ids.add(lineId);
      equipment.filter(e => e.lineId === lineId).forEach(e => ids.add(e.id));
      instruments.filter(i => i.lineId === lineId).forEach(i => ids.add(i.id));
    }
    ids.add(selectedNode.data?.systemId);
  }

  return ids;
}

// ── Node color ──
function getNodeColor(node) {
  if (node.type === 'platform') return C.g;
  if (node.type === 'system') return SC[node.sysType] || C.g;
  if (node.type === 'line') return C.o;
  if (node.type === 'equipment') return C.g;
  if (node.type === 'instrument') return C.b;
  return C.t;
}

// ── Tree Node Component ──
function TreeNode({
  node, depth = 0, expanded, toggleExpand, selectedNode, setSelectedNode,
  searchMatches, searchExpanded, isSearching, relatedIds, xrefs, data,
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = selectedNode?.id === node.id;
  const isMatch = searchMatches.has(node.id);
  const isRelated = relatedIds.has(node.id);
  const color = getNodeColor(node);

  // Dimming in search mode
  const isDimmed = isSearching && !isMatch && !searchExpanded.has(node.id);

  // Cross-reference badges for lines
  const { pnidLines: dataPnidLines, pnidSystems: dataPnidSystems, systems: dataSystems } = data || {};
  const lineXrefs = node.type === 'line'
    ? (dataPnidLines || []).filter(r => r.lineId === node.id).map(r => {
        const ps = (dataPnidSystems || []).find(s => s.pnidId === r.pnidId && s.isPrimary);
        return ps && ps.systemId !== node.data?.systemId ? ((dataSystems || []).find(s => s.id === ps.systemId)?.code || '') : null;
      }).filter(Boolean)
    : [];
  const uniqueXrefSystems = [...new Set(lineXrefs)];

  // Count children by type
  const childCounts = useMemo(() => {
    if (node.type !== 'system') return null;
    const lines = node.children.filter(c => c.type === 'line').length;
    const equip = node.children.filter(c => c.type === 'equipment').length +
      node.children.filter(c => c.type === 'line').reduce((sum, l) => sum + l.children.filter(c => c.type === 'equipment').length, 0);
    const inst = node.children.filter(c => c.type === 'line').reduce((sum, l) => sum + l.children.filter(c => c.type === 'instrument').length, 0);
    return { lines, equip, inst };
  }, [node]);

  return (
    <div
      style={{
        opacity: isDimmed ? 0.2 : 1,
        transition: 'opacity 0.3s ease',
      }}
    >
      {/* Node Row */}
      <div
        className="group flex items-center gap-1.5 cursor-pointer relative"
        style={{
          paddingLeft: `${depth * 20 + 8}px`,
          paddingRight: '8px',
          paddingTop: node.type === 'platform' ? '10px' : '4px',
          paddingBottom: node.type === 'platform' ? '10px' : '4px',
          background: isSelected
            ? `${color}18`
            : isRelated
            ? `${color}0A`
            : 'transparent',
          borderLeft: isSelected
            ? `3px solid ${color}`
            : isRelated
            ? `3px solid ${color}55`
            : '3px solid transparent',
          borderRadius: '4px',
          margin: '1px 4px',
        }}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedNode(isSelected ? null : node);
          if (hasChildren) toggleExpand(node.id);
        }}
        onMouseEnter={(e) => {
          if (!isSelected && !isRelated) e.currentTarget.style.background = `${M3.onSurface}08`;
        }}
        onMouseLeave={(e) => {
          if (!isSelected && !isRelated) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Tree connector lines */}
        {depth > 0 && (
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: `${(depth - 1) * 20 + 18}px`,
              width: '20px',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '1px',
                background: `${C.m}20`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: '50%',
                width: '12px',
                height: '1px',
                background: `${C.m}20`,
              }}
            />
          </div>
        )}

        {/* Expand/Collapse indicator */}
        {hasChildren ? (
          <span
            className="flex items-center justify-center w-4 h-4 rounded text-[10px] shrink-0"
            style={{
              color,
              background: `${color}15`,
              transition: 'transform 0.2s ease',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            &#9654;
          </span>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}

        {/* Icon */}
        <span style={{ color }} className="shrink-0">
          {ICONS[node.type]}
        </span>

        {/* Name */}
        <span
          className={`text-[11.5px] overflow-hidden text-ellipsis whitespace-nowrap ${
            isSelected ? 'font-bold text-md-on-surface' :
            isMatch ? 'font-semibold text-md-on-surface' :
            isRelated ? 'font-medium' : ''
          }`}
          style={{
            color: isSelected || isMatch ? C.w :
              isRelated ? color : C.t,
          }}
        >
          {node.type === 'platform' ? node.code :
           node.type === 'system' ? node.name :
           node.type === 'line' ? node.name :
           node.name}
        </span>

        {/* Search match highlight pulse */}
        {isMatch && isSearching && (
          <span
            className="w-2 h-2 rounded-full shrink-0 animate-pulse"
            style={{ background: color, boxShadow: `0 0 8px ${color}` }}
          />
        )}

        {/* Related indicator */}
        {isRelated && !isSelected && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: color, opacity: 0.7 }}
          />
        )}

        {/* Type-specific badges */}
        {node.type === 'system' && (
          <span
            className="text-[8px] px-1.5 py-[1px] rounded-full shrink-0"
            style={{ background: `${SC[node.sysType]}18`, color: SC[node.sysType], border: `1px solid ${SC[node.sysType]}30` }}
          >
            {node.sysType}
          </span>
        )}

        {node.type === 'line' && (
          <span className="text-[9px] text-md-on-surface-variant shrink-0">{node.size}</span>
        )}

        {node.type === 'equipment' && node.criticality === 'high' && (
          <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ background: C.r }} />
        )}

        {node.type === 'equipment' && node.sil && (
          <span className="text-[7px] px-1 py-[0.5px] rounded shrink-0" style={{ background: `${M3.sil}15`, color: M3.sil }}>{node.sil}</span>
        )}

        {node.type === 'equipment' && node.standalone && (
          <span className="text-[7px] px-1 py-[0.5px] rounded shrink-0" style={{ background: `${C.o}15`, color: C.o }}>standalone</span>
        )}

        {node.type === 'instrument' && node.iType && (
          <span className="text-[8px] px-1 py-[0.5px] rounded shrink-0" style={{ background: `${C.b}15`, color: C.b }}>
            {node.iType.replace(/_/g, ' ')}
          </span>
        )}

        {/* Child counts for systems */}
        {node.type === 'system' && childCounts && (
          <div className="flex gap-1 ml-auto shrink-0">
            {childCounts.lines > 0 && <span className="text-[7px] px-1 rounded" style={{ color: C.o, background: `${C.o}12` }}>{childCounts.lines}L</span>}
            {childCounts.equip > 0 && <span className="text-[7px] px-1 rounded" style={{ color: C.g, background: `${C.g}12` }}>{childCounts.equip}E</span>}
            {childCounts.inst > 0 && <span className="text-[7px] px-1 rounded" style={{ color: C.b, background: `${C.b}12` }}>{childCounts.inst}I</span>}
          </div>
        )}

        {/* Cross-reference badges for lines */}
        {uniqueXrefSystems.length > 0 && (
          <div className="flex gap-[2px] ml-1 shrink-0">
            {uniqueXrefSystems.map(sys => (
              <span key={sys} className="text-[7px] px-1 rounded" style={{ background: `${C.o}18`, color: C.o, border: `1px solid ${C.o}25` }}>
                {sys}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Subtitle for some types */}
      {isExpanded && node.type === 'line' && node.service && (
        <div
          className="text-[9px] text-md-on-surface-variant"
          style={{ paddingLeft: `${depth * 20 + 52}px`, marginTop: '-2px', marginBottom: '2px' }}
        >
          {node.service} &middot; {node.data?.pipeClass} &middot; {node.data?.material}
        </div>
      )}

      {/* Children */}
      {hasChildren && (
        <div
          style={{
            maxHeight: isExpanded ? '5000px' : '0',
            overflow: 'hidden',
            transition: isExpanded ? 'max-height 0.5s ease-in' : 'max-height 0.3s ease-out',
          }}
        >
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggleExpand={toggleExpand}
              selectedNode={selectedNode}
              setSelectedNode={setSelectedNode}
              searchMatches={searchMatches}
              searchExpanded={searchExpanded}
              isSearching={isSearching}
              relatedIds={relatedIds}
              xrefs={xrefs}
              data={data}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sidebar: Relationship Panel ──
function RelationshipSidebar({ node, relationships, xrefs, onNavigate, data }) {
  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-md-surface-container-high flex items-center justify-center mb-4">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="14" r="10" stroke={C.m} strokeWidth="1.5" strokeDasharray="3 3" />
            <circle cx="14" cy="14" r="3" fill={C.m} opacity="0.4" />
            <path d="M14 4v3M14 21v3M4 14h3M21 14h3" stroke={C.m} strokeWidth="1" opacity="0.3" />
          </svg>
        </div>
        <p className="text-[12px] text-md-on-surface-variant mb-1">Select a node</p>
        <p className="text-[10px] text-md-on-surface-variant/60">Click any item in the tree to see its properties and relationships</p>
      </div>
    );
  }

  const color = getNodeColor(node);
  const { pnids, connectedSystems, relatedItems, xrefLines } = relationships;

  // Build ancestry path
  const getAncestry = () => {
    const path = [];
    if (node.type === 'instrument' || node.type === 'equipment') {
      const sys = data.systems.find(s => s.id === node.data?.systemId);
      if (sys) path.push({ name: sys.code, type: 'system', color: SC[sys.sysType] });
      if (node.data?.lineId) {
        const line = data.lines.find(l => l.id === node.data.lineId);
        if (line) path.push({ name: line.name.split('-').slice(0, 3).join('-'), type: 'line', color: C.o });
      }
    } else if (node.type === 'line') {
      const sys = data.systems.find(s => s.id === node.data?.systemId);
      if (sys) path.push({ name: sys.code, type: 'system', color: SC[sys.sysType] });
    }
    path.push({ name: node.code || node.name, type: node.type, color });
    return path;
  };

  const ancestry = getAncestry();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.05]">
        {/* Ancestry breadcrumb */}
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          {ancestry.map((a, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-[8px] text-md-outline">&rsaquo;</span>}
              <span className="text-[9px] px-1.5 py-[1px] rounded" style={{ background: `${a.color}15`, color: a.color }}>
                {a.name}
              </span>
            </span>
          ))}
        </div>

        {/* Node name + type */}
        <div className="flex items-center gap-2">
          <span style={{ color }}>{ICONS[node.type]}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-md-on-surface truncate">{node.code || node.name}</div>
            {node.type === 'system' && <div className="text-[10px] text-md-on-surface-variant">{node.name}</div>}
            {node.desc && <div className="text-[10px] text-md-on-surface-variant">{node.desc}</div>}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4" style={{ scrollbarWidth: 'thin', scrollbarColor: `${C.m}30 transparent` }}>
        {/* Properties */}
        <Section title="Properties" color={color}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {node.type === 'system' && <>
              <Prop label="Type" value={node.sysType} color={SC[node.sysType]} />
              <Prop label="Code" value={node.code} />
              <Prop label="Lines" value={node.children?.filter(c => c.type === 'line').length} />
              <Prop label="Equipment" value={data.equipment.filter(e => e.systemId === node.id).length} />
            </>}
            {node.type === 'line' && <>
              <Prop label="Service" value={node.service} />
              <Prop label="Size" value={node.size} />
              <Prop label="Pipe Class" value={node.data?.pipeClass} />
              <Prop label="Material" value={node.data?.material} />
              {node.data?.dp && <Prop label="Design P" value={`${node.data.dp} psi`} />}
              {node.data?.dt && <Prop label="Design T" value={`${node.data.dt} °C`} />}
              <Prop label="Owner" value={data.systems.find(s => s.id === node.data?.systemId)?.code || ''} color={SC[data.systems.find(s => s.id === node.data?.systemId)?.sysType]} />
            </>}
            {node.type === 'equipment' && <>
              <Prop label="Tag" value={node.data?.tag} />
              <Prop label="Type" value={node.eqType} />
              <Prop label="Criticality" value={node.criticality} color={CC[node.criticality]} />
              {node.sil && <Prop label="SIL" value={node.sil} color={M3.sil} />}
              {node.data?.insp && <Prop label="Inspection" value={node.data.insp} />}
              {node.data?.cl && <Prop label="Corrosion Loop" value={node.data.cl} />}
            </>}
            {node.type === 'instrument' && <>
              <Prop label="Tag" value={node.data?.tag} />
              <Prop label="Type" value={node.iType?.replace(/_/g, ' ')} />
              <Prop label="Range" value={node.range} />
              {node.scada && <Prop label="SCADA" value={node.scada} color={C.b} />}
            </>}
          </div>
        </Section>

        {/* P&IDs */}
        {pnids.length > 0 && (
          <Section title={`P&IDs (${pnids.length})`} color={C.b}>
            <div className="space-y-1">
              {pnids.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded"
                  style={{ background: `${M3.onSurface}05` }}
                >
                  <span className="text-[9px]" style={{ color: C.b }}>&#9633;</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-md-on-surface truncate">
                      {p.name?.split('-D-')[1] || p.name}
                    </div>
                    <div className="text-[8px] text-md-on-surface-variant truncate">{p.title}</div>
                  </div>
                  {p.isPrimary === true && (
                    <span className="text-[7px] px-1 rounded" style={{ background: `${C.g}15`, color: C.g }}>primary</span>
                  )}
                  {p.isPrimary === false && (
                    <span className="text-[7px] px-1 rounded" style={{ background: `${C.o}15`, color: C.o }}>x-ref</span>
                  )}
                  {p.isCont && (
                    <span className="text-[7px] px-1 rounded" style={{ background: `${C.o}15`, color: C.o }}>cont.</span>
                  )}
                  {p.primarySysCode && (
                    <span className="text-[7px] px-1 rounded" style={{ background: `${C.m}15`, color: C.m }}>{p.primarySysCode}</span>
                  )}
                  <span
                    className="text-[7px] px-1 rounded"
                    style={{ background: `${STC[p.status]}15`, color: STC[p.status] }}
                  >
                    {p.status?.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Connected Systems */}
        {connectedSystems.length > 0 && (
          <Section title={`Connected Systems (${connectedSystems.length})`} color={C.o}>
            <div className="flex flex-wrap gap-1.5">
              {connectedSystems.map(sys => (
                <button
                  key={sys.id}
                  className="flex items-center gap-1 px-2 py-1 rounded cursor-pointer"
                  style={{
                    background: `${SC[sys.sysType]}12`,
                    border: `1px solid ${SC[sys.sysType]}25`,
                  }}
                  onClick={() => onNavigate(sys.id)}
                >
                  <span className="w-[5px] h-[5px] rounded-full" style={{ background: SC[sys.sysType] }} />
                  <span className="text-[9px]" style={{ color: SC[sys.sysType] }}>{sys.code}</span>
                  <span className="text-[8px] text-md-on-surface-variant">{sys.sysType}</span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Cross-reference Lines (for systems) */}
        {xrefLines && xrefLines.length > 0 && (
          <Section title={`X-Ref Lines (${xrefLines.length})`} color={C.o}>
            <div className="space-y-1">
              {xrefLines.map((x, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ background: `${M3.onSurface}05` }}>
                  <span className="text-[9px]" style={{ color: C.o }}>&#x2197;</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-md-on-surface truncate font-mono">{x.lineName}</div>
                  </div>
                  <span className="text-[7px] px-1 rounded" style={{ background: `${C.o}15`, color: C.o }}>
                    from {x.lineOwnerSysCode}
                  </span>
                  {x.isContinuation && (
                    <span className="text-[7px] px-1 rounded" style={{ background: `${C.y}15`, color: C.y }}>cont.</span>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Related Items */}
        {relatedItems.length > 0 && (
          <Section title={`Related Items (${relatedItems.length})`} color={C.g}>
            <div className="space-y-1">
              {relatedItems.map((item, i) => {
                const ic = item.itemType === 'equipment' ? C.g : C.b;
                return (
                  <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ background: `${M3.onSurface}05` }}>
                    <span style={{ color: ic }}>{ICONS[item.itemType]}</span>
                    <span className="text-[10px] text-md-on-surface">{item.tag}</span>
                    <span className="text-[8px] text-md-on-surface-variant flex-1">{item.eqType || item.iType?.replace(/_/g, ' ')}</span>
                    <span className="text-[7px] px-1 rounded" style={{ background: `${ic}15`, color: ic }}>
                      {item.itemType === 'equipment' ? 'eq' : 'inst'}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Relationship Map (mini visual) */}
        {(connectedSystems.length > 0 || pnids.length > 1) && (
          <Section title="Relationship Map" color={color}>
            <RelationshipMiniMap node={node} connectedSystems={connectedSystems} pnids={pnids} />
          </Section>
        )}
      </div>
    </div>
  );
}

// ── Section wrapper ──
function Section({ title, color, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-[3px] h-3 rounded-full" style={{ background: color }} />
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color }}>{title}</span>
        <div className="flex-1 h-px" style={{ background: `${color}15` }} />
      </div>
      {children}
    </div>
  );
}

// ── Property display ──
function Prop({ label, value, color: c }) {
  return (
    <div>
      <div className="text-[8px] text-md-on-surface-variant uppercase tracking-wider">{label}</div>
      <div className="text-[10px] font-medium" style={{ color: c || C.t }}>{value || '—'}</div>
    </div>
  );
}

// ── Mini relationship map (SVG) ──
function RelationshipMiniMap({ node, connectedSystems, pnids }) {
  const containerRef = useRef(null);
  const color = getNodeColor(node);
  const w = 240;
  const h = Math.max(120, (connectedSystems.length + pnids.length) * 15 + 40);
  const cx = w / 2;
  const cy = h / 2;

  // Arrange connected items in a semicircle around center
  const items = [
    ...connectedSystems.map(s => ({ label: s.code, color: SC[s.sysType], type: 'sys' })),
    ...pnids.slice(0, 8).map(p => ({ label: p.name?.split('-D-')[1] || p.name, color: C.b, type: 'pnid' })),
  ];

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} ref={containerRef}>
      {/* Center node */}
      <circle cx={cx} cy={cy} r={16} fill={`${color}20`} stroke={color} strokeWidth="1.5" />
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize="8" fontWeight="bold">
        {node.code || node.name?.substring(0, 6)}
      </text>

      {/* Radiating connections */}
      {items.map((item, i) => {
        const angle = (Math.PI / (items.length + 1)) * (i + 1) - Math.PI / 2;
        const radius = 65;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;

        // Curved path
        const midX = cx + Math.cos(angle) * (radius * 0.5);
        const midY = cy + Math.sin(angle) * (radius * 0.5);
        const ctrlX = midX + Math.cos(angle + 0.3) * 15;
        const ctrlY = midY + Math.sin(angle + 0.3) * 15;

        return (
          <g key={i}>
            {/* Connection line with glow */}
            <path
              d={`M ${cx} ${cy} Q ${ctrlX} ${ctrlY} ${x} ${y}`}
              fill="none"
              stroke={item.color}
              strokeWidth="1"
              opacity="0.4"
            />
            <path
              d={`M ${cx} ${cy} Q ${ctrlX} ${ctrlY} ${x} ${y}`}
              fill="none"
              stroke={item.color}
              strokeWidth="3"
              opacity="0.08"
            />
            {/* Node */}
            <circle cx={x} cy={y} r={10} fill={`${item.color}20`} stroke={item.color} strokeWidth="1" />
            <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" fill={item.color} fontSize="6" fontWeight="600">
              {item.label?.substring(0, 5)}
            </text>
            {/* Type indicator */}
            <text x={x} y={y + 18} textAnchor="middle" fill={C.m} fontSize="6">
              {item.type === 'sys' ? 'system' : 'P&ID'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Stats Bar ──
function StatsBar({ tree }) {
  const counts = useMemo(() => {
    if (!tree) return { systems: 0, lines: 0, equipment: 0, instruments: 0 };
    const systems = tree.children?.length || 0;
    let lines = 0, equipment = 0, instruments = 0;
    tree.children?.forEach(sys => {
      sys.children?.forEach(child => {
        if (child.type === 'line') {
          lines++;
          child.children?.forEach(gc => {
            if (gc.type === 'equipment') equipment++;
            if (gc.type === 'instrument') instruments++;
          });
        }
        if (child.type === 'equipment') equipment++;
      });
    });
    return { systems, lines, equipment, instruments };
  }, [tree]);

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.05]">
      <StatBadge label="Systems" count={counts.systems} color={C.g} />
      <StatBadge label="Lines" count={counts.lines} color={C.o} />
      <StatBadge label="Equipment" count={counts.equipment} color={C.g} />
      <StatBadge label="Instruments" count={counts.instruments} color={C.b} />
    </div>
  );
}

function StatBadge({ label, count, color }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-[10px] text-md-on-surface-variant">{label}</span>
      <span className="text-[11px] font-bold" style={{ color }}>{count}</span>
    </div>
  );
}

// ── Main HierarchyTree Component ──
export default function HierarchyTree({ platformId, onBack }) {
  const [expanded, setExpanded] = useState(new Set());
  const [selectedNode, setSelectedNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [platform, setPlatform] = useState(platformId);

  // Update platform when prop changes
  useEffect(() => {
    if (platformId) setPlatform(platformId);
  }, [platformId]);

  const { data: platforms } = usePlatforms();
  const { data: hierarchyData, isLoading } = useHierarchy(platform);

  // Extract arrays from hierarchy data
  const systems = hierarchyData?.systems || [];
  const lines = hierarchyData?.lines || [];
  const equipment = hierarchyData?.equipment || [];
  const instruments = hierarchyData?.instruments || [];
  const pnidSystems = hierarchyData?.pnidSystems || [];
  const pnidLines = hierarchyData?.pnidLines || [];
  const pnids = hierarchyData?.pnids || [];
  const platformObj = hierarchyData?.platform || null;

  // Data bundle passed to functions and components
  const data = useMemo(() => ({
    systems, lines, equipment, instruments, pnidSystems, pnidLines, pnids,
  }), [systems, lines, equipment, instruments, pnidSystems, pnidLines, pnids]);

  const tree = useMemo(() => buildTree(platformObj, systems, lines, equipment, instruments), [platformObj, systems, lines, equipment, instruments]);
  const xrefs = useMemo(() => computeXrefs(systems, pnidSystems, pnidLines, lines, pnids), [systems, pnidSystems, pnidLines, lines, pnids]);

  // Auto-expand platform on mount
  useEffect(() => {
    if (tree) {
      setExpanded(new Set([tree.id]));
    }
  }, [tree?.id]);

  // Search
  const { searchMatches, searchExpanded } = useMemo(() => {
    if (!tree || !searchQuery) return { searchMatches: new Set(), searchExpanded: new Set() };
    return searchTree(tree, searchQuery);
  }, [tree, searchQuery]);

  const isSearching = searchQuery.length > 0;

  // When searching, force expand to show matches
  useEffect(() => {
    if (isSearching && searchExpanded.size > 0) {
      setExpanded(prev => {
        const next = new Set(prev);
        searchExpanded.forEach(id => next.add(id));
        return next;
      });
    }
  }, [isSearching, searchExpanded]);

  // Related node IDs for cross-branch highlighting
  const relatedIds = useMemo(() => getRelatedNodeIds(selectedNode, xrefs, data), [selectedNode, xrefs, data]);

  // Relationships for sidebar
  const relationships = useMemo(() => getRelationships(selectedNode, xrefs, data), [selectedNode, xrefs, data]);

  const toggleExpand = useCallback((id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (!tree) return;
    const allIds = new Set();
    const collect = (node) => {
      allIds.add(node.id);
      node.children?.forEach(collect);
    };
    collect(tree);
    setExpanded(allIds);
  }, [tree]);

  const collapseAll = useCallback(() => {
    if (!tree) return;
    setExpanded(new Set([tree.id]));
  }, [tree]);

  // Navigate to a system (from sidebar)
  const navigateToSystem = useCallback((sysId) => {
    // Find and expand path to this system
    if (tree) {
      const sys = tree.children?.find(s => s.id === sysId);
      if (sys) {
        setExpanded(prev => {
          const next = new Set(prev);
          next.add(tree.id);
          next.add(sysId);
          return next;
        });
        setSelectedNode(sys);
      }
    }
  }, [tree]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-md-surface">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: `${C.g}40`, borderTopColor: 'transparent' }} />
          <span className="text-[12px] text-md-on-surface-variant">Loading hierarchy...</span>
        </div>
      </div>
    );
  }

  if (!tree) return <div className="text-md-on-surface-variant p-4">No data</div>;

  return (
    <div className="flex h-full w-full overflow-hidden bg-md-surface">
      {/* Left: Tree Panel */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-white/[0.05]">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.05] shrink-0">
          {onBack && (
            <button
              onClick={onBack}
              className="px-2 py-1 rounded text-[10px] cursor-pointer"
              style={{ background: `${C.m}15`, color: C.m, border: `1px solid ${C.m}20` }}
            >
              &larr; Back
            </button>
          )}

          <div className="w-5 h-5 rounded bg-gradient-to-br from-md-primary/30 to-md-secondary/30 flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 4h2M9 4h2M3 7h1.5M7.5 7H9" stroke={C.g} strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="6" cy="1" r="1" fill={C.g} />
              <circle cx="3" cy="4" r="1" fill={C.o} />
              <circle cx="9" cy="4" r="1" fill={C.o} />
              <circle cx="4.5" cy="7" r="0.8" fill={C.b} />
              <circle cx="7.5" cy="7" r="0.8" fill={C.b} />
              <circle cx="6" cy="11" r="1" fill={C.g} />
            </svg>
          </div>
          <span className="text-[12px] font-bold text-md-on-surface">Neural Tree</span>
          <span className="text-[8px] text-md-on-surface-variant tracking-wider">HIERARCHY</span>

          <div className="flex-1" />

          {/* Search */}
          <div className="relative">
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search tree..."
              className="w-48 px-2.5 py-[5px] pl-7 bg-md-surface-container-high border rounded-md text-md-on-surface text-[11px] outline-none"
              style={{ borderColor: searchQuery ? `${C.g}44` : `${M3.onSurface}12` }}
            />
            <svg className="absolute left-2 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="5" cy="5" r="3.5" stroke={searchQuery ? C.g : C.m} strokeWidth="1.2" />
              <path d="M8 8l2.5 2.5" stroke={searchQuery ? C.g : C.m} strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {searchQuery && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <span className="text-[8px] font-bold" style={{ color: C.g }}>{searchMatches.size} found</span>
                <button
                  onClick={() => setSearchQuery('')}
                  className="w-3.5 h-3.5 rounded-full flex items-center justify-center cursor-pointer"
                  style={{ background: `${C.r}20`, color: C.r }}
                >
                  <span className="text-[8px]">&times;</span>
                </button>
              </div>
            )}
          </div>

          {/* Expand/Collapse */}
          <button
            onClick={expandAll}
            className="px-2 py-1 rounded text-[9px] cursor-pointer"
            style={{ background: `${C.g}12`, color: C.g, border: `1px solid ${C.g}20` }}
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-2 py-1 rounded text-[9px] cursor-pointer"
            style={{ background: `${C.m}12`, color: C.m, border: `1px solid ${C.m}20` }}
          >
            Collapse
          </button>

          {/* Platform selector */}
          <select
            value={platform || ''}
            onChange={e => {
              setPlatform(e.target.value);
              setSelectedNode(null);
              setSearchQuery('');
            }}
            className="px-2 py-[5px] bg-md-surface-container-high border border-white/[0.07] rounded-md text-md-on-surface text-[11px] outline-none"
          >
            {(platforms || []).map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
        </div>

        {/* Stats */}
        <StatsBar tree={tree} />

        {/* Tree content */}
        <div
          className="flex-1 overflow-y-auto py-2"
          style={{ scrollbarWidth: 'thin', scrollbarColor: `${C.m}30 transparent` }}
        >
          <TreeNode
            node={tree}
            depth={0}
            expanded={expanded}
            toggleExpand={toggleExpand}
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
            searchMatches={searchMatches}
            searchExpanded={searchExpanded}
            isSearching={isSearching}
            relatedIds={relatedIds}
            xrefs={xrefs}
            data={data}
          />
        </div>
      </div>

      {/* Right: Relationship Sidebar */}
      <div className="w-[320px] shrink-0 flex flex-col overflow-hidden bg-md-surface-container">
        <RelationshipSidebar
          node={selectedNode}
          relationships={relationships}
          xrefs={xrefs}
          onNavigate={navigateToSystem}
          data={data}
        />
      </div>
    </div>
  );
}
