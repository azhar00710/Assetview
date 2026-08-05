import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { SC, M3, EC } from '../data/constants';

const TYPE_COLORS = {
  platform: M3.primary,
  system: {
    process: SC.process,
    utility: SC.utility,
    safety: SC.safety,
    instrument: SC.instrument,
  },
  pnid: M3.sil,
  line: EC.line,
  equipment: EC.equipment,
  instrument: EC.instrument,
};

function getColor(d) {
  if (d.data.type === 'system') {
    return TYPE_COLORS.system[d.data.sysType] || M3.primary;
  }
  return TYPE_COLORS[d.data.type] || M3.outline;
}

export default function SunburstChart({ data, width = 700, height = 700, onSelect, isDark }) {
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);

  const render = useCallback(() => {
    if (!data || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const radius = Math.min(width, height) / 2;

    // Create hierarchy
    const root = d3.hierarchy(data)
      .sum(d => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    // If all leaves have value=0 or hierarchy has no values, assign equal values
    if (root.value === 0) {
      root.each(d => {
        if (!d.children || d.children.length === 0) {
          d.value = 1;
        }
      });
      root.sum(d => d.value || 0);
    }

    const partition = d3.partition()
      .size([2 * Math.PI, radius]);

    partition(root);

    // Arc generator
    const arc = d3.arc()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(radius / 2)
      .innerRadius(d => d.y0)
      .outerRadius(d => d.y1 - 1);

    const g = svg.append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    // Current focus for zoom
    let currentFocus = root;

    // Target accessor for zoom transitions
    function arcVisible(d) {
      return d.y1 <= radius && d.y0 >= 0 && d.x1 > d.x0;
    }

    function labelVisible(d) {
      return d.y1 <= radius && d.y0 >= 0 && (d.y1 - d.y0) * (d.x1 - d.x0) > 0.03;
    }

    function labelTransform(d) {
      const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
      const y = (d.y0 + d.y1) / 2;
      return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
    }

    // Draw arcs
    const path = g.selectAll('path')
      .data(root.descendants().filter(d => d.depth > 0))
      .join('path')
      .attr('fill', d => {
        const color = getColor(d);
        // Slightly reduce opacity for deeper levels
        return d3.color(color).copy({ opacity: 1 - d.depth * 0.08 });
      })
      .attr('fill-opacity', d => arcVisible(d) ? (d.children ? 0.85 : 0.65) : 0)
      .attr('pointer-events', d => arcVisible(d) ? 'auto' : 'none')
      .attr('d', arc)
      .attr('stroke', isDark ? M3.surface : M3.onSurface)
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer');

    // Labels
    const label = g.selectAll('text')
      .data(root.descendants().filter(d => d.depth > 0))
      .join('text')
      .attr('dy', '0.35em')
      .attr('fill', isDark ? '#fff' : '#111')
      .attr('fill-opacity', d => +labelVisible(d))
      .attr('text-anchor', 'middle')
      .attr('transform', d => labelTransform(d))
      .attr('font-size', d => {
        const arcLen = (d.x1 - d.x0) * (d.y0 + d.y1) / 2;
        return Math.min(11, Math.max(7, arcLen * 2)) + 'px';
      })
      .attr('font-weight', d => d.depth <= 2 ? '600' : '400')
      .attr('pointer-events', 'none')
      .text(d => {
        const name = d.data.name;
        const arcLen = (d.x1 - d.x0) * (d.y0 + d.y1) / 2;
        const maxChars = Math.floor(arcLen / 5);
        return name.length > maxChars ? name.substring(0, maxChars) + '…' : name;
      });

    // Center circle
    const centerGroup = g.append('g')
      .style('cursor', 'pointer');

    centerGroup.append('circle')
      .attr('r', root.y1)
      .attr('fill', 'none')
      .attr('pointer-events', 'all');

    const centerText = centerGroup.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', isDark ? M3.primary : M3.surfaceContainer)
      .attr('font-size', '14px')
      .attr('font-weight', '700')
      .text(data.name);

    const centerSubtext = centerGroup.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.8em')
      .attr('fill', isDark ? M3.outline : M3.outline)
      .attr('font-size', '10px')
      .text('Click to zoom');

    // Tooltip
    const tooltip = d3.select(tooltipRef.current);

    path.on('mouseover', function (event, d) {
      const typeLabel = d.data.type.charAt(0).toUpperCase() + d.data.type.slice(1);
      tooltip
        .style('opacity', 1)
        .html(`
          <div style="font-weight:700;font-size:13px;margin-bottom:2px">${d.data.fullName || d.data.name}</div>
          <div style="font-size:11px;opacity:0.7">${typeLabel}${d.data.sysType ? ' · ' + d.data.sysType : ''}${d.data.service ? ' · ' + d.data.service : ''}</div>
          ${d.children ? `<div style="font-size:10px;opacity:0.5;margin-top:2px">${d.children.length} children</div>` : ''}
        `)
        .style('left', (event.offsetX + 15) + 'px')
        .style('top', (event.offsetY - 10) + 'px');

      d3.select(this).attr('fill-opacity', 1).attr('stroke-width', 2);
    })
    .on('mousemove', function (event) {
      tooltip
        .style('left', (event.offsetX + 15) + 'px')
        .style('top', (event.offsetY - 10) + 'px');
    })
    .on('mouseout', function (event, d) {
      tooltip.style('opacity', 0);
      d3.select(this)
        .attr('fill-opacity', d.children ? 0.85 : 0.65)
        .attr('stroke-width', 0.5);
    });

    // Click to zoom
    function clicked(event, p) {
      if (!p) p = root;

      currentFocus = p;
      centerText.text(p.data.name);
      centerSubtext.text(p.parent ? '↩ Click center to go back' : 'Click to zoom');

      if (onSelect) onSelect(p.data);

      root.each(d => {
        d.target = {
          x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
          x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
          y0: Math.max(0, d.y0 - p.y0),
          y1: Math.max(0, d.y1 - p.y0),
        };
      });

      const t = g.transition().duration(600);

      path.transition(t)
        .tween('data', d => {
          const i = d3.interpolate(
            { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 },
            d.target
          );
          return t => {
            const val = i(t);
            d.x0 = val.x0;
            d.x1 = val.x1;
            d.y0 = val.y0;
            d.y1 = val.y1;
          };
        })
        .filter(function (d) {
          return +this.getAttribute('fill-opacity') || arcVisible(d.target);
        })
        .attr('fill-opacity', d => arcVisible(d.target) ? (d.children ? 0.85 : 0.65) : 0)
        .attr('pointer-events', d => arcVisible(d.target) ? 'auto' : 'none')
        .attrTween('d', d => () => arc(d));

      label.transition(t)
        .filter(function (d) {
          return +this.getAttribute('fill-opacity') || labelVisible(d.target);
        })
        .attr('fill-opacity', d => +labelVisible(d.target))
        .attrTween('transform', d => () => labelTransform(d));
    }

    path.on('click', clicked);
    centerGroup.on('click', (event) => {
      if (currentFocus.parent) {
        clicked(event, currentFocus.parent);
      }
    });

  }, [data, width, height, isDark, onSelect]);

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
          background: isDark ? 'rgba(22,53,43,0.95)' : 'rgba(255,255,255,0.95)',
          color: isDark ? M3.onSurface : '#111',
          padding: '8px 12px',
          borderRadius: '8px',
          border: `1px solid ${isDark ? 'rgba(59,228,148,0.2)' : 'rgba(0,0,0,0.1)'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          maxWidth: '250px',
          zIndex: 50,
          fontSize: '12px',
        }}
      />
    </div>
  );
}
