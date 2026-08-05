import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { SC, M3, EC } from '../data/constants';

const SYS_COLORS = {
  process: SC.process,
  utility: SC.utility,
  safety: SC.safety,
  instrument: SC.instrument,
};

const TYPE_COLORS = {
  line: EC.line,
  equipment: EC.equipment,
  instrument: EC.instrument,
};

const DEPTH_LABELS = ['', 'SYSTEMS', 'LINES', 'EQUIPMENT & INSTRUMENTS'];

/**
 * ConstellationMap — A radial hierarchical visualization with donut metric glyphs,
 * integrated counts, cross-reference chords, and animated interactions.
 * Replaces the flat Sankey/Flow Map with a true orbital hierarchy view.
 */
export default function ConstellationMap({ data, xrefData, width = 960, height = 680, isDark, onSelect }) {
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);

  const render = useCallback(() => {
    if (!data?.children || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(cx, cy) - 50;

    // ── Data Processing ──────────────────────────────────────────────────

    const root = d3.hierarchy(data);

    // Per-system metrics
    const sysMetrics = {};
    if (root.children) {
      root.children.forEach(sysNode => {
        const m = { lines: 0, equipment: 0, instruments: 0 };
        function walk(n) {
          if (n.data.type === 'line') m.lines++;
          if (n.data.type === 'equipment') m.equipment++;
          if (n.data.type === 'instrument') m.instruments++;
          if (n.children) n.children.forEach(walk);
        }
        walk(sysNode);
        m.total = m.lines + m.equipment + m.instruments;
        sysMetrics[sysNode.data.name] = m;
      });
    }

    // Aggregate xref edges
    const xrefEdges = [];
    if (xrefData?.edges) {
      const agg = {};
      for (const e of xrefData.edges) {
        const key = [e.source, e.target].sort().join('|');
        if (!agg[key]) agg[key] = { source: e.source, target: e.target, pnids: [], count: 0 };
        agg[key].pnids.push(e.pnid);
        agg[key].count++;
      }
      xrefEdges.push(...Object.values(agg));
    }

    // ── Tree Layout ──────────────────────────────────────────────────────

    const treeLayout = d3.tree()
      .size([2 * Math.PI, maxRadius])
      .separation((a, b) => {
        if (a.depth <= 1 && b.depth <= 1) return 2.5;
        return (a.parent === b.parent ? 1 : 1.8) / a.depth;
      });

    treeLayout(root);

    // Custom depth radii for controlled spacing
    const depthRadii = [0, maxRadius * 0.28, maxRadius * 0.58, maxRadius * 0.88];
    root.descendants().forEach(d => {
      d.y = depthRadii[Math.min(d.depth, depthRadii.length - 1)] || d.y;
    });

    // Radial → cartesian
    const project = (angle, radius) => {
      const a = angle - Math.PI / 2;
      return [radius * Math.cos(a), radius * Math.sin(a)];
    };

    // ── SVG Setup ────────────────────────────────────────────────────────

    const defs = svg.append('defs');

    // Glow filter
    const glow = defs.append('filter')
      .attr('id', 'cmap-glow')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur').attr('stdDeviation', '3.5').attr('result', 'blur');
    const glowMerge = glow.append('feMerge');
    glowMerge.append('feMergeNode').attr('in', 'blur');
    glowMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Hub glow (softer, wider)
    const hubGlow = defs.append('filter')
      .attr('id', 'cmap-hub-glow')
      .attr('x', '-100%').attr('y', '-100%')
      .attr('width', '300%').attr('height', '300%');
    hubGlow.append('feGaussianBlur').attr('stdDeviation', '10').attr('result', 'blur');
    const hubMerge = hubGlow.append('feMerge');
    hubMerge.append('feMergeNode').attr('in', 'blur');
    hubMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Radial gradient for hub aura
    const hubGrad = defs.append('radialGradient').attr('id', 'cmap-hub-grad');
    hubGrad.append('stop').attr('offset', '0%').attr('stop-color', M3.primary).attr('stop-opacity', 0.12);
    hubGrad.append('stop').attr('offset', '70%').attr('stop-color', M3.primary).attr('stop-opacity', 0.03);
    hubGrad.append('stop').attr('offset', '100%').attr('stop-color', M3.primary).attr('stop-opacity', 0);

    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    // ── 1. Depth Rings (radar-style concentric rings) ────────────────────

    for (let d = 1; d < depthRadii.length; d++) {
      const r = depthRadii[d];

      // Ring band (very subtle fill between rings)
      if (d < depthRadii.length - 1) {
        g.append('circle')
          .attr('r', (depthRadii[d] + depthRadii[d + 1]) / 2)
          .attr('fill', 'none')
          .attr('stroke', 'rgba(255,255,255,0.02)')
          .attr('stroke-width', depthRadii[d + 1] - depthRadii[d]);
      }

      // Ring circle
      g.append('circle')
        .attr('r', r)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255,255,255,0.06)')
        .attr('stroke-width', 0.5)
        .attr('stroke-dasharray', '3,5');

      // Ring label (at top)
      g.append('text')
        .attr('x', 0)
        .attr('y', -r - 8)
        .attr('text-anchor', 'middle')
        .attr('fill', 'rgba(255,255,255,0.4)')
        .attr('font-size', '7px')
        .attr('font-weight', '700')
        .attr('letter-spacing', '0.15em')
        .text(DEPTH_LABELS[d]);
    }

    // Subtle tick marks on the outer ring (compass style)
    const outerR = depthRadii[depthRadii.length - 1] + 15;
    for (let i = 0; i < 72; i++) {
      const angle = (i * 5) * Math.PI / 180;
      const tickLen = i % 9 === 0 ? 4 : 1.5;
      const [x1, y1] = project(angle + Math.PI / 2, outerR);
      const [x2, y2] = project(angle + Math.PI / 2, outerR + tickLen);
      g.append('line')
        .attr('x1', x1).attr('y1', y1)
        .attr('x2', x2).attr('y2', y2)
        .attr('stroke', `rgba(255,255,255,${i % 9 === 0 ? 0.08 : 0.03})`)
        .attr('stroke-width', i % 9 === 0 ? 1 : 0.5);
    }

    // ── 2. Tree Links ────────────────────────────────────────────────────

    const linkGen = d3.linkRadial()
      .angle(d => d.x)
      .radius(d => d.y);

    const allLinks = root.links();

    const linkPaths = g.selectAll('.cmap-link')
      .data(allLinks)
      .join('path')
      .attr('class', 'cmap-link')
      .attr('d', linkGen)
      .attr('fill', 'none')
      .attr('stroke', d => {
        // Color by the system ancestor
        let node = d.source;
        while (node.depth > 1 && node.parent) node = node.parent;
        if (node.depth === 1) return SYS_COLORS[node.data.sysType] || M3.outline;
        return M3.primary;
      })
      .attr('stroke-opacity', 0.15)
      .attr('stroke-width', d => Math.max(0.8, 2.5 - d.source.depth * 0.7));

    // ── 3. Cross-Reference Chords ────────────────────────────────────────

    // System position lookup
    const sysPositions = {};
    if (root.children) {
      root.children.forEach(sysNode => {
        const [px, py] = project(sysNode.x, sysNode.y);
        sysPositions[sysNode.data.name] = { x: px, y: py, angle: sysNode.x, node: sysNode };
      });
    }

    const chordPaths = g.selectAll('.cmap-chord')
      .data(xrefEdges)
      .join('path')
      .attr('class', 'cmap-chord')
      .attr('d', d => {
        const s = sysPositions[d.source];
        const t = sysPositions[d.target];
        if (!s || !t) return '';
        // Chord curves through the center area
        const cpX = (s.x + t.x) * 0.08;
        const cpY = (s.y + t.y) * 0.08;
        return `M${s.x},${s.y} Q${cpX},${cpY} ${t.x},${t.y}`;
      })
      .attr('fill', 'none')
      .attr('stroke', M3.tertiary)
      .attr('stroke-opacity', 0.25)
      .attr('stroke-width', d => Math.max(1.5, d.count * 1.5))
      .attr('stroke-linecap', 'round');

    // ── 4. Leaf Nodes (lines, equipment, instruments) ────────────────────

    const leaves = root.descendants().filter(d => d.depth >= 2);

    const leafGroups = g.selectAll('.cmap-leaf')
      .data(leaves)
      .join('g')
      .attr('class', 'cmap-leaf')
      .attr('transform', d => {
        const [x, y] = project(d.x, d.y);
        return `translate(${x},${y})`;
      })
      .style('cursor', 'pointer');

    // Leaf circles
    leafGroups.append('circle')
      .attr('r', d => {
        if (d.data.type === 'line') return d.children ? 5 : 4;
        return 3;
      })
      .attr('fill', d => TYPE_COLORS[d.data.type] || M3.outline)
      .attr('fill-opacity', d => d.data.type === 'line' ? 0.75 : 0.5)
      .attr('stroke', d => TYPE_COLORS[d.data.type] || M3.outline)
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', 0.4);

    // Line labels (rotated to follow radial direction)
    leafGroups.filter(d => d.data.type === 'line')
      .append('text')
      .attr('dy', '0.31em')
      .attr('transform', d => {
        const angleDeg = (d.x * 180 / Math.PI) - 90;
        const flip = angleDeg > 90 || angleDeg < -90;
        return `rotate(${flip ? angleDeg + 180 : angleDeg})`;
      })
      .attr('x', d => {
        const angleDeg = (d.x * 180 / Math.PI) - 90;
        const flip = angleDeg > 90 || angleDeg < -90;
        return flip ? -9 : 9;
      })
      .attr('text-anchor', d => {
        const angleDeg = (d.x * 180 / Math.PI) - 90;
        const flip = angleDeg > 90 || angleDeg < -90;
        return flip ? 'end' : 'start';
      })
      .attr('fill', isDark ? `${M3.onSurface}d9` : `${M3.surface}b3`)
      .attr('font-size', '7px')
      .attr('font-weight', '500')
      .text(d => {
        const name = d.data.name;
        return name.length > 24 ? name.substring(0, 24) + '\u2026' : name;
      });

    // ── 5. System Nodes (donut glyphs with metrics) ──────────────────────

    const systemNodes = root.children || [];
    const sysNodeR = 20;
    const donutInner = sysNodeR;
    const donutOuter = sysNodeR + 6;

    const sysGroups = g.selectAll('.cmap-sys')
      .data(systemNodes)
      .join('g')
      .attr('class', 'cmap-sys')
      .attr('transform', d => {
        const [x, y] = project(d.x, d.y);
        return `translate(${x},${y})`;
      })
      .style('cursor', 'pointer');

    // System background circle
    sysGroups.append('circle')
      .attr('r', sysNodeR)
      .attr('fill', d => SYS_COLORS[d.data.sysType] || M3.outline)
      .attr('fill-opacity', 0.1)
      .attr('stroke', d => SYS_COLORS[d.data.sysType] || M3.outline)
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.4);

    // Donut glyph (composition breakdown ring)
    const pieGen = d3.pie().value(d => d.value).sort(null).padAngle(0.12);
    const arcGen = d3.arc().innerRadius(donutInner).outerRadius(donutOuter).cornerRadius(2);

    sysGroups.each(function (sysD) {
      const metrics = sysMetrics[sysD.data.name];
      if (!metrics || metrics.total === 0) return;

      const segments = [
        { key: 'lines', value: metrics.lines, color: TYPE_COLORS.line },
        { key: 'equipment', value: metrics.equipment, color: TYPE_COLORS.equipment },
        { key: 'instruments', value: metrics.instruments, color: TYPE_COLORS.instrument },
      ].filter(s => s.value > 0);

      if (segments.length === 0) return;

      const pieData = pieGen(segments);

      d3.select(this).selectAll('.cmap-donut-arc')
        .data(pieData)
        .join('path')
        .attr('class', 'cmap-donut-arc')
        .attr('d', arcGen)
        .attr('fill', d => d.data.color)
        .attr('fill-opacity', 0.65)
        .attr('stroke', d => d.data.color)
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.2);
    });

    // System code label (inside the node)
    sysGroups.append('text')
      .attr('dy', '-0.1em')
      .attr('text-anchor', 'middle')
      .attr('fill', M3.onSurface)
      .attr('font-size', '8px')
      .attr('font-weight', '800')
      .attr('letter-spacing', '0.02em')
      .text(d => {
        const name = d.data.name;
        return name.length > 8 ? name.substring(0, 8) : name;
      });

    // System type label (small, inside node)
    sysGroups.append('text')
      .attr('dy', '1.1em')
      .attr('text-anchor', 'middle')
      .attr('fill', d => SYS_COLORS[d.data.sysType] || M3.outline)
      .attr('font-size', '6px')
      .attr('font-weight', '600')
      .attr('opacity', 0.7)
      .text(d => (d.data.sysType || '').toUpperCase());

    // Metric counts label (below the donut, shows L/E/I counts)
    sysGroups.append('text')
      .attr('y', donutOuter + 12)
      .attr('text-anchor', 'middle')
      .attr('font-size', '7.5px')
      .attr('font-weight', '700')
      .each(function (d) {
        const m = sysMetrics[d.data.name];
        if (!m) return;
        const el = d3.select(this);
        if (m.lines > 0) {
          el.append('tspan').attr('fill', TYPE_COLORS.line).text(`${m.lines}L `);
        }
        if (m.equipment > 0) {
          el.append('tspan').attr('fill', TYPE_COLORS.equipment).text(`${m.equipment}E `);
        }
        if (m.instruments > 0) {
          el.append('tspan').attr('fill', TYPE_COLORS.instrument).text(`${m.instruments}I`);
        }
      });

    // Full name label (below counts)
    sysGroups.append('text')
      .attr('y', donutOuter + 23)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.6)')
      .attr('font-size', '6.5px')
      .attr('font-weight', '500')
      .text(d => {
        const name = d.data.fullName || d.data.name;
        return name.length > 22 ? name.substring(0, 22) + '\u2026' : name;
      });

    // ── 6. Center Hub ────────────────────────────────────────────────────

    // Hub aura
    g.append('circle')
      .attr('r', 55)
      .attr('fill', 'url(#cmap-hub-grad)')
      .attr('filter', 'url(#cmap-hub-glow)');

    // Hub circle
    g.append('circle')
      .attr('r', 30)
      .attr('fill', isDark ? M3.surfaceContainer : M3.onSurface)
      .attr('stroke', M3.primary)
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.5);

    // Inner ring decoration
    g.append('circle')
      .attr('r', 26)
      .attr('fill', 'none')
      .attr('stroke', M3.primary)
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', 0.2)
      .attr('stroke-dasharray', '2,3');

    // Platform name
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.15em')
      .attr('fill', M3.primary)
      .attr('font-size', '14px')
      .attr('font-weight', '800')
      .text(data.name);

    // Platform subtitle
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.3em')
      .attr('fill', M3.outline)
      .attr('font-size', '7px')
      .attr('font-weight', '600')
      .attr('letter-spacing', '0.1em')
      .text((data.fullName && data.fullName !== data.name ? data.fullName : 'PLATFORM').toUpperCase());

    // Rotating scan ring (radar sweep effect)
    const scanRing = g.append('circle')
      .attr('r', outerR + 8)
      .attr('fill', 'none')
      .attr('stroke', `${M3.primary}0f`)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', `${maxRadius * 0.4}, ${maxRadius * 6}`);

    scanRing.append('animateTransform')
      .attr('attributeName', 'transform')
      .attr('type', 'rotate')
      .attr('from', '0')
      .attr('to', '360')
      .attr('dur', '25s')
      .attr('repeatCount', 'indefinite');

    // ── 7. Interactions ──────────────────────────────────────────────────

    const tooltip = d3.select(tooltipRef.current);

    // System hover
    sysGroups
      .on('mouseover', function (event, d) {
        const descendantSet = new Set(d.descendants());

        // Dim non-related elements
        leafGroups.attr('opacity', n => descendantSet.has(n) ? 1 : 0.08);
        sysGroups.attr('opacity', n => n === d ? 1 : 0.12);
        linkPaths.attr('stroke-opacity', l =>
          descendantSet.has(l.source) || descendantSet.has(l.target) ? 0.45 : 0.02
        );
        chordPaths.attr('stroke-opacity', l =>
          l.source === d.data.name || l.target === d.data.name ? 0.55 : 0.03
        );

        // Glow the hovered system
        d3.select(this).select('circle').attr('filter', 'url(#cmap-glow)');

        // Rich tooltip
        const m = sysMetrics[d.data.name] || {};
        const xrefs = xrefEdges.filter(e => e.source === d.data.name || e.target === d.data.name);
        const sysColor = SYS_COLORS[d.data.sysType] || M3.primary;

        let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">`;
        html += `<div style="width:10px;height:10px;border-radius:3px;background:${sysColor}"></div>`;
        html += `<div style="font-weight:800;font-size:14px;color:${sysColor}">${d.data.name}</div>`;
        html += `</div>`;
        html += `<div style="font-size:11px;opacity:0.7;margin-bottom:8px">${d.data.fullName || ''}</div>`;

        // Metric bars
        const maxCount = Math.max(m.lines || 0, m.equipment || 0, m.instruments || 0, 1);
        const barW = 120;
        html += `<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px">`;
        [
          { label: 'Lines', count: m.lines || 0, color: TYPE_COLORS.line, icon: '━' },
          { label: 'Equipment', count: m.equipment || 0, color: TYPE_COLORS.equipment, icon: '◆' },
          { label: 'Instruments', count: m.instruments || 0, color: TYPE_COLORS.instrument, icon: '◉' },
        ].forEach(item => {
          const pct = (item.count / maxCount) * 100;
          html += `<div style="display:flex;align-items:center;gap:6px;font-size:10px">`;
          html += `<span style="color:${item.color};width:10px;text-align:center">${item.icon}</span>`;
          html += `<span style="width:65px;opacity:0.7">${item.label}</span>`;
          html += `<div style="flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;min-width:${barW}px">`;
          html += `<div style="width:${pct}%;height:100%;background:${item.color};border-radius:3px;opacity:0.7"></div>`;
          html += `</div>`;
          html += `<span style="font-weight:700;min-width:18px;text-align:right;color:${item.color}">${item.count}</span>`;
          html += `</div>`;
        });
        html += `</div>`;

        if (xrefs.length > 0) {
          html += `<div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:6px">`;
          html += `<div style="font-size:8px;font-weight:700;letter-spacing:0.1em;color:${M3.tertiary};margin-bottom:4px">CROSS-REFERENCES</div>`;
          xrefs.forEach(x => {
            const other = x.source === d.data.name ? x.target : x.source;
            html += `<div style="font-size:10px;opacity:0.7;display:flex;align-items:center;gap:4px">`;
            html += `<span style="color:${M3.tertiary}">\u2192</span> ${other}`;
            html += `<span style="opacity:0.4;font-size:9px">(${x.count} P&ID${x.count > 1 ? 's' : ''})</span>`;
            html += `</div>`;
          });
          html += `</div>`;
        }

        tooltip.style('opacity', 1).html(html);
      })
      .on('mousemove', function (event) {
        // Clamp tooltip within SVG bounds
        const tx = Math.min(event.offsetX + 20, width - 320);
        const ty = Math.max(event.offsetY - 10, 10);
        tooltip.style('left', tx + 'px').style('top', ty + 'px');
      })
      .on('mouseout', function () {
        leafGroups.attr('opacity', 1);
        sysGroups.attr('opacity', 1);
        linkPaths.attr('stroke-opacity', 0.15);
        chordPaths.attr('stroke-opacity', 0.25);
        d3.select(this).select('circle').attr('filter', null);
        tooltip.style('opacity', 0);
      })
      .on('click', function (event, d) {
        if (onSelect) onSelect(d.data);
      });

    // Leaf node hover
    leafGroups
      .on('mouseover', function (event, d) {
        const ancestors = d.ancestors();
        const ancestorSet = new Set(ancestors);

        leafGroups.attr('opacity', n => n === d ? 1 : 0.08);
        sysGroups.attr('opacity', n => ancestorSet.has(n) ? 1 : 0.12);
        linkPaths.attr('stroke-opacity', l =>
          ancestorSet.has(l.source) && ancestorSet.has(l.target) ? 0.55 : 0.02
        );
        chordPaths.attr('stroke-opacity', 0.03);

        // Enlarge + glow
        d3.select(this).select('circle')
          .attr('r', d.data.type === 'line' ? 7 : 5)
          .attr('filter', 'url(#cmap-glow)')
          .attr('fill-opacity', 1);

        // Tooltip
        const nodeColor = TYPE_COLORS[d.data.type] || M3.onSurface;
        let html = `<div style="font-weight:700;font-size:13px;color:${nodeColor};margin-bottom:3px">${d.data.name}</div>`;
        if (d.data.fullName && d.data.fullName !== d.data.name) {
          html += `<div style="font-size:11px;opacity:0.7;margin-bottom:4px">${d.data.fullName}</div>`;
        }
        html += `<div style="font-size:10px;color:${nodeColor};text-transform:capitalize;margin-bottom:2px">${d.data.type}</div>`;

        if (d.data.service) html += `<div style="font-size:10px;opacity:0.6">Service: ${d.data.service}</div>`;
        if (d.data.size) html += `<div style="font-size:10px;opacity:0.6">Size: ${d.data.size}</div>`;
        if (d.data.equipType) html += `<div style="font-size:10px;opacity:0.6">Type: ${d.data.equipType}</div>`;
        if (d.data.instType) html += `<div style="font-size:10px;opacity:0.6">Type: ${d.data.instType}</div>`;
        if (d.data.criticality) {
          const critColor = d.data.criticality === 'high' ? M3.error : d.data.criticality === 'medium' ? M3.warning : M3.primary;
          html += `<div style="font-size:10px"><span style="opacity:0.6">Criticality:</span> <span style="color:${critColor};font-weight:600">${d.data.criticality}</span></div>`;
        }

        // Children count
        if (d.children && d.children.length > 0) {
          html += `<div style="font-size:10px;opacity:0.6;margin-top:2px">${d.children.length} child${d.children.length > 1 ? 'ren' : ''}</div>`;
        }

        // Path breadcrumb
        const chain = ancestors.slice(0).reverse().map(a => a.data.name).join(' \u203A ');
        html += `<div style="font-size:8px;opacity:0.3;margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:4px">${chain}</div>`;

        tooltip.style('opacity', 1).html(html);
      })
      .on('mousemove', function (event) {
        const tx = Math.min(event.offsetX + 20, width - 300);
        const ty = Math.max(event.offsetY - 10, 10);
        tooltip.style('left', tx + 'px').style('top', ty + 'px');
      })
      .on('mouseout', function (event, d) {
        leafGroups.attr('opacity', 1);
        sysGroups.attr('opacity', 1);
        linkPaths.attr('stroke-opacity', 0.15);
        chordPaths.attr('stroke-opacity', 0.25);
        d3.select(this).select('circle')
          .attr('r', d.data.type === 'line' ? (d.children ? 5 : 4) : 3)
          .attr('filter', null)
          .attr('fill-opacity', d.data.type === 'line' ? 0.75 : 0.5);
        tooltip.style('opacity', 0);
      })
      .on('click', function (event, d) {
        if (onSelect) onSelect(d.data);
      });

    // ── 8. Entrance Animation ────────────────────────────────────────────

    // Links draw in
    linkPaths.each(function () {
      const len = this.getTotalLength();
      if (len > 0) {
        d3.select(this)
          .attr('stroke-dasharray', len)
          .attr('stroke-dashoffset', len)
          .transition()
          .duration(1500)
          .ease(d3.easeCubicOut)
          .attr('stroke-dashoffset', 0)
          .on('end', function () {
            d3.select(this).attr('stroke-dasharray', null);
          });
      }
    });

    // System nodes fade in with stagger
    sysGroups
      .attr('opacity', 0)
      .transition()
      .delay((d, i) => 300 + i * 60)
      .duration(600)
      .ease(d3.easeCubicOut)
      .attr('opacity', 1);

    // Leaf nodes fade in (later)
    leafGroups
      .attr('opacity', 0)
      .transition()
      .delay((d, i) => 800 + i * 20)
      .duration(400)
      .ease(d3.easeCubicOut)
      .attr('opacity', 1);

    // Chords sweep in last
    chordPaths.each(function () {
      const len = this.getTotalLength();
      if (len > 0) {
        d3.select(this)
          .attr('stroke-dasharray', len)
          .attr('stroke-dashoffset', len)
          .transition()
          .delay(1200)
          .duration(1000)
          .ease(d3.easeCubicOut)
          .attr('stroke-dashoffset', 0)
          .on('end', function () {
            d3.select(this).attr('stroke-dasharray', '6,4');
          });
      }
    });

    // ── 9. Summary legend (bottom left corner) ───────────────────────────

    const legendG = svg.append('g')
      .attr('transform', `translate(16,${height - 60})`);

    const legendItems = [
      { color: TYPE_COLORS.line, label: 'Lines', icon: '━' },
      { color: TYPE_COLORS.equipment, label: 'Equipment', icon: '◆' },
      { color: TYPE_COLORS.instrument, label: 'Instruments', icon: '◉' },
      { color: M3.tertiary, label: 'Cross-Ref', icon: '⤸' },
    ];

    legendItems.forEach((item, i) => {
      const ly = i * 14;
      legendG.append('text')
        .attr('x', 0).attr('y', ly)
        .attr('fill', item.color)
        .attr('font-size', '9px')
        .attr('font-weight', '600')
        .text(item.icon);
      legendG.append('text')
        .attr('x', 14).attr('y', ly)
        .attr('fill', 'rgba(255,255,255,0.7)')
        .attr('font-size', '8px')
        .attr('font-weight', '500')
        .text(item.label);
    });

  }, [data, xrefData, width, height, isDark, onSelect]);

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
          padding: '12px 16px',
          borderRadius: '10px',
          border: `1px solid ${isDark ? `${M3.primary}26` : 'rgba(0,0,0,0.1)'}`,
          boxShadow: isDark
            ? `0 8px 32px rgba(0,0,0,0.5), 0 0 20px ${M3.primary}0d`
            : '0 8px 24px rgba(0,0,0,0.15)',
          maxWidth: '340px',
          zIndex: 50,
          fontSize: '12px',
          backdropFilter: 'blur(12px)',
        }}
      />
    </div>
  );
}
