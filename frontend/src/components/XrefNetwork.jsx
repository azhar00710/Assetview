import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { SC, M3, C } from '../data/constants';

const SYS_COLORS = {
  process: SC.process,
  utility: SC.utility,
  safety: SC.safety,
  instrument: SC.instrument,
};

export default function XrefNetwork({ data, width = 700, height = 550, isDark, onSelectSystem }) {
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);

  const render = useCallback(() => {
    if (!data || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { nodes, edges } = data;
    if (!nodes.length) return;

    // Create nodes with positions (radial layout)
    const angleStep = (2 * Math.PI) / nodes.length;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 60;

    const simNodes = nodes.map((n, i) => ({
      ...n,
      x: cx + radius * Math.cos(angleStep * i - Math.PI / 2),
      y: cy + radius * Math.sin(angleStep * i - Math.PI / 2),
      index: i,
    }));

    const nodeMap = {};
    simNodes.forEach(n => { nodeMap[n.code] = n; });

    // Aggregate edges (count shared P&IDs between system pairs)
    const edgeMap = {};
    for (const e of edges) {
      const key = [e.source, e.target].sort().join('|');
      if (!edgeMap[key]) {
        edgeMap[key] = { source: e.source, target: e.target, pnids: [], count: 0 };
      }
      edgeMap[key].pnids.push(e.pnid);
      edgeMap[key].count++;
    }
    const simEdges = Object.values(edgeMap);

    const g = svg.append('g');

    // Draw edges as curved lines
    const link = g.selectAll('.link')
      .data(simEdges)
      .join('path')
      .attr('class', 'link')
      .attr('d', d => {
        const s = nodeMap[d.source];
        const t = nodeMap[d.target];
        if (!s || !t) return '';
        // Curved path through center offset
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dr = Math.sqrt(dx * dx + dy * dy) * 0.8;
        return `M${s.x},${s.y}A${dr},${dr} 0 0,1 ${t.x},${t.y}`;
      })
      .attr('fill', 'none')
      .attr('stroke', isDark ? `${M3.primary}26` : `${M3.secondary}26`)
      .attr('stroke-width', d => Math.min(d.count * 2, 6))
      .attr('stroke-dasharray', d => d.count === 1 ? '4,4' : 'none');

    // Draw nodes
    const node = g.selectAll('.node')
      .data(simNodes)
      .join('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .style('cursor', 'pointer');

    // Node circles
    node.append('circle')
      .attr('r', d => {
        // Size by number of connections
        const connections = simEdges.filter(e => e.source === d.code || e.target === d.code).length;
        return Math.max(18, 12 + connections * 4);
      })
      .attr('fill', d => SYS_COLORS[d.sys_type] || M3.outline)
      .attr('fill-opacity', 0.2)
      .attr('stroke', d => SYS_COLORS[d.sys_type] || M3.outline)
      .attr('stroke-width', 2);

    // Node inner dot
    node.append('circle')
      .attr('r', 5)
      .attr('fill', d => SYS_COLORS[d.sys_type] || M3.outline);

    // Node labels
    node.append('text')
      .attr('dy', d => {
        const angle = Math.atan2(d.y - cy, d.x - cx);
        return angle > -Math.PI / 4 && angle < Math.PI / 4 ? 0 : (d.y > cy ? 30 : -25);
      })
      .attr('dx', d => {
        const angle = Math.atan2(d.y - cy, d.x - cx);
        if (angle > -Math.PI / 4 && angle < Math.PI / 4) return 30;
        if (angle > 3 * Math.PI / 4 || angle < -3 * Math.PI / 4) return -30;
        return 0;
      })
      .attr('text-anchor', d => {
        const angle = Math.atan2(d.y - cy, d.x - cx);
        if (angle > -Math.PI / 4 && angle < Math.PI / 4) return 'start';
        if (angle > 3 * Math.PI / 4 || angle < -3 * Math.PI / 4) return 'end';
        return 'middle';
      })
      .attr('fill', isDark ? M3.onSurface : M3.surface)
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .text(d => d.code);

    // System type label
    node.append('text')
      .attr('dy', d => {
        const angle = Math.atan2(d.y - cy, d.x - cx);
        return angle > -Math.PI / 4 && angle < Math.PI / 4 ? 13 : (d.y > cy ? 43 : -12);
      })
      .attr('dx', d => {
        const angle = Math.atan2(d.y - cy, d.x - cx);
        if (angle > -Math.PI / 4 && angle < Math.PI / 4) return 30;
        if (angle > 3 * Math.PI / 4 || angle < -3 * Math.PI / 4) return -30;
        return 0;
      })
      .attr('text-anchor', d => {
        const angle = Math.atan2(d.y - cy, d.x - cx);
        if (angle > -Math.PI / 4 && angle < Math.PI / 4) return 'start';
        if (angle > 3 * Math.PI / 4 || angle < -3 * Math.PI / 4) return 'end';
        return 'middle';
      })
      .attr('fill', d => SYS_COLORS[d.sys_type] || M3.outline)
      .attr('font-size', '9px')
      .attr('font-weight', '500')
      .attr('opacity', 0.6)
      .text(d => d.sys_type);

    // Tooltip
    const tooltip = d3.select(tooltipRef.current);

    // Hover interactions
    node.on('mouseover', function (event, d) {
      // Highlight connected edges
      link.attr('stroke', e => {
        if (e.source === d.code || e.target === d.code) {
          return isDark ? `${M3.primary}99` : `${M3.secondary}99`;
        }
        return isDark ? `${M3.primary}0d` : `${M3.secondary}0d`;
      }).attr('stroke-width', e => {
        if (e.source === d.code || e.target === d.code) {
          return Math.min(e.count * 3, 8);
        }
        return 1;
      });

      // Dim unconnected nodes
      const connected = new Set();
      connected.add(d.code);
      simEdges.forEach(e => {
        if (e.source === d.code) connected.add(e.target);
        if (e.target === d.code) connected.add(e.source);
      });

      node.attr('opacity', n => connected.has(n.code) ? 1 : 0.2);

      // Tooltip with connected systems
      const connectedEdges = simEdges.filter(e => e.source === d.code || e.target === d.code);
      tooltip
        .style('opacity', 1)
        .html(`
          <div style="font-weight:700;font-size:13px;margin-bottom:4px">${d.name}</div>
          <div style="font-size:11px;opacity:0.7;margin-bottom:6px">${d.sys_type} system · ${d.code}</div>
          ${connectedEdges.length > 0 ? `
            <div style="font-size:10px;font-weight:600;margin-bottom:3px">Cross-references:</div>
            ${connectedEdges.map(e => {
              const other = e.source === d.code ? e.target : e.source;
              return `<div style="font-size:10px;opacity:0.8">→ ${other} (${e.pnids.join(', ')})</div>`;
            }).join('')}
          ` : '<div style="font-size:10px;opacity:0.5">No cross-references</div>'}
        `)
        .style('left', (event.offsetX + 20) + 'px')
        .style('top', (event.offsetY - 10) + 'px');
    })
    .on('mousemove', function (event) {
      tooltip
        .style('left', (event.offsetX + 20) + 'px')
        .style('top', (event.offsetY - 10) + 'px');
    })
    .on('mouseout', function () {
      link
        .attr('stroke', isDark ? `${M3.primary}26` : `${M3.secondary}26`)
        .attr('stroke-width', d => Math.min(d.count * 2, 6));
      node.attr('opacity', 1);
      tooltip.style('opacity', 0);
    })
    .on('click', function (event, d) {
      if (onSelectSystem) onSelectSystem(d.code);
    });

    // Center label
    svg.append('text')
      .attr('x', cx)
      .attr('y', cy)
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.5em')
      .attr('fill', isDark ? M3.primary : M3.surfaceContainer)
      .attr('font-size', '14px')
      .attr('font-weight', '700')
      .text('System');

    svg.append('text')
      .attr('x', cx)
      .attr('y', cy)
      .attr('text-anchor', 'middle')
      .attr('dy', '1em')
      .attr('fill', isDark ? M3.primary : M3.surfaceContainer)
      .attr('font-size', '14px')
      .attr('font-weight', '700')
      .text('Cross-References');

    svg.append('text')
      .attr('x', cx)
      .attr('y', cy)
      .attr('text-anchor', 'middle')
      .attr('dy', '2.5em')
      .attr('fill', isDark ? M3.outline : M3.outline)
      .attr('font-size', '10px')
      .text(`${simEdges.length} connections via shared P&IDs`);

  }, [data, width, height, isDark, onSelectSystem]);

  useEffect(() => {
    render();
  }, [render]);

  return (
    <div className="relative">
      <svg ref={svgRef} width={width} height={height} />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none opacity-0 transition-opacity duration-150"
        style={{
          background: isDark ? `${M3.surfaceContainer}f2` : 'rgba(255,255,255,0.95)',
          color: isDark ? M3.onSurface : M3.surface,
          padding: '10px 14px',
          borderRadius: '8px',
          border: `1px solid ${isDark ? `${M3.primary}33` : 'rgba(0,0,0,0.1)'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          maxWidth: '300px',
          zIndex: 50,
          fontSize: '12px',
        }}
      />
    </div>
  );
}
