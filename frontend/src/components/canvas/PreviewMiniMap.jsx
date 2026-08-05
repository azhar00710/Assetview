import { useRef, useEffect, memo } from 'react';
import { md } from '../../lib/theme';

const EDGE_COLORS = {
  process: '#3BE494',
  utility: '#2D33E0',
  signal: '#F39C12',
  boundary: '#E74C3C',
};

const ENTITY_COLORS = {
  equipment: '#3BE494',
  instrument: '#F39C12',
};

/**
 * Small canvas-based preview of the generated layout.
 * Renders entity positions as dots and connections as lines.
 * Uses HTML Canvas 2D API (not React Flow — too heavy for preview).
 */
function PreviewMiniMap({ positions, edges, width = 280, height = 180 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !positions?.length) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = md.surfaceContainerLow || '#111D14';
    ctx.fillRect(0, 0, width, height);

    // Compute bounds for auto-scaling
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pos of positions) {
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y > maxY) maxY = pos.y;
    }

    const dataW = maxX - minX || 1;
    const dataH = maxY - minY || 1;
    const padding = 16;
    const scaleX = (width - padding * 2) / dataW;
    const scaleY = (height - padding * 2) / dataH;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = padding + ((width - padding * 2) - dataW * scale) / 2;
    const offsetY = padding + ((height - padding * 2) - dataH * scale) / 2;

    const toScreen = (x, y) => ({
      sx: offsetX + (x - minX) * scale,
      sy: offsetY + (y - minY) * scale,
    });

    // Build position map for edge drawing
    const posMap = new Map();
    for (const pos of positions) {
      posMap.set(pos.entityId, pos);
    }

    // Draw edges
    if (edges?.length) {
      for (const edge of edges) {
        const from = posMap.get(edge.fromEntityId);
        const to = posMap.get(edge.toEntityId);
        if (!from || !to) continue;

        const { sx: fx, sy: fy } = toScreen(from.x, from.y);
        const { sx: tx, sy: ty } = toScreen(to.x, to.y);

        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = EDGE_COLORS[edge.edgeType] || '#3BE494';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.4;
        ctx.stroke();
      }
    }

    // Draw entity dots
    ctx.globalAlpha = 1;
    for (const pos of positions) {
      const { sx, sy } = toScreen(pos.x, pos.y);
      const color = ENTITY_COLORS[pos.entityType] || '#3BE494';
      const radius = pos.entityType === 'instrument' ? 2.5 : 3.5;

      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Outer ring
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 1, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Legend
    ctx.font = '8px monospace';
    ctx.fillStyle = '#3BE494';
    ctx.fillRect(8, height - 16, 6, 6);
    ctx.fillText('Equipment', 18, height - 10);

    ctx.fillStyle = '#F39C12';
    ctx.fillRect(78, height - 16, 6, 6);
    ctx.fillText('Instrument', 88, height - 10);

    ctx.fillStyle = md.onSurfaceVariant || '#919A9B';
    ctx.fillText(`${positions.length} nodes, ${edges?.length || 0} edges`, width - 120, height - 10);
  }, [positions, edges, width, height]);

  if (!positions?.length) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        borderRadius: 4,
        border: `1px solid ${md.outlineVariant}`,
      }}
    />
  );
}

export default memo(PreviewMiniMap);
