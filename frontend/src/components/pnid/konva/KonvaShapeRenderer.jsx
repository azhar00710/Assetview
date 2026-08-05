import { memo } from 'react';
import { Group, Rect, Ellipse, Circle, Line, Arrow, Text } from 'react-konva';

// Flatten symbols for quick lookup — import from toolbar
import { PID_SYMBOL_CATEGORIES } from '../AnnotationToolbar';
import PidKonvaSymbol from '../smartIdent/PidKonvaSymbol';

const PID_SYMBOLS = PID_SYMBOL_CATEGORIES
  ? PID_SYMBOL_CATEGORIES.flatMap(c => c.symbols).reduce((acc, s) => { acc[s.id] = s; return acc; }, {})
  : {};

const CONNECTION_COLORS = {
  process: '#3BE494',
  utility: '#2D33E0',
  signal: '#F39C12',
  boundary: '#E74C3C',
};

/**
 * Convert annotation percentage coords to pixel coords.
 */
function pct(val, size) {
  return ((val || 0) / 100) * size;
}

/**
 * Render a single annotation shape in Konva.
 */
function KonvaShapeRenderer({ annotation, isSelected, onClick, interactive, stageWidth, stageHeight, showLabel = true, dragOffset }) {
  const { shape, xPct, yPct, wPct, hPct, x2Pct, y2Pct, color, strokeWidth: sw, status, approvalStatus, metadata, fillOpacity, strokeStyle, showLabel: annShowLabel } = annotation;
  const isApproved = approvalStatus === 'approved';
  const opacity = status === 'resolved' ? 0.4 : isApproved ? 1.0 : 0.8;
  const strokeWidth = sw || 2;
  const isConnection = metadata?.isConnection;
  const resolvedFillOpacity = fillOpacity ?? metadata?.fillOpacity ?? 0.15;
  const resolvedStrokeStyle = strokeStyle || metadata?.strokeStyle || 'solid';
  const strokeDash = resolvedStrokeStyle === 'dashed' ? [6, 4] : resolvedStrokeStyle === 'dotted' ? [2, 3] : undefined;
  const canShowLabel = showLabel && annShowLabel !== false && metadata?.showLabel !== false;

  // Apply drag offset if dragging this annotation
  const dxPct = dragOffset?.dx || 0;
  const dyPct = dragOffset?.dy || 0;

  const handleClick = (evt) => {
    if (interactive && onClick) onClick(annotation, evt);
  };

  // P&ID Symbol shapes
  if (shape?.startsWith('sym_')) {
    const sym = PID_SYMBOLS[shape];
    const x = pct(xPct + dxPct, stageWidth);
    const y = pct(yPct + dyPct, stageHeight);
    const w = pct(wPct || 4, stageWidth);
    const h = pct(hPct || 4, stageHeight);

    return (
      <Group
        x={x} y={y}
        listening={interactive}
        onClick={handleClick}
        onTap={handleClick}
      >
        {/* Hit area */}
        <Rect width={w} height={h} fill="transparent" />
        {sym?.elements ? (
          <PidKonvaSymbol symbol={sym} width={w} height={h} color={color || '#111827'} strokeWidth={2.8} opacity={opacity} />
        ) : null}
        {/* Label */}
        {canShowLabel && annotation.text && (
          <Text
            text={annotation.text}
            x={0} y={h * 0.72}
            width={w}
            align="center"
            fontSize={Math.max(7, Math.min(10, w * 0.15))}
            fontStyle="bold"
            fill={color}
          />
        )}
        {/* Approved border */}
        {isApproved && (
          <Rect width={w} height={h} fill="transparent" stroke="#22c55e" strokeWidth={2} cornerRadius={3} />
        )}
        {/* Selection highlight */}
        {isSelected && (
          <Rect width={w} height={h} fill="transparent" stroke="white" strokeWidth={1.5} dash={[4, 4]} cornerRadius={3} />
        )}
      </Group>
    );
  }

  switch (shape) {
    case 'pin': {
      const cx = pct(xPct + dxPct, stageWidth);
      const cy = pct(yPct + dyPct, stageHeight);
      return (
        <Group listening={interactive} onClick={handleClick} onTap={handleClick}>
          {isSelected && <Circle x={cx} y={cy} radius={12} fill="white" opacity={0.3} />}
          <Circle
            x={cx} y={cy} radius={8}
            fill={color} opacity={opacity}
            stroke={isApproved ? '#22c55e' : (isSelected ? '#FFFFFF' : undefined)}
            strokeWidth={isApproved ? 2 : (isSelected ? 2 : 0)}
          />
          <Circle x={cx} y={cy} radius={3} fill="white" opacity={0.9} />
          {canShowLabel && annotation.text && (
            <Text
              text={annotation.text.substring(0, 20)}
              x={cx - 40} y={cy - 22}
              width={80}
              align="center"
              fontSize={10}
              fontStyle="bold"
              fill={color}
            />
          )}
          {isApproved && (
            <Text text="✓" x={cx - 4} y={cy - 5} fontSize={8} fontStyle="bold" fill="white" />
          )}
        </Group>
      );
    }

    case 'line': {
      const x1 = pct(xPct + dxPct, stageWidth);
      const y1 = pct(yPct + dyPct, stageHeight);
      const x2 = pct((x2Pct ?? xPct) + dxPct, stageWidth);
      const y2 = pct((y2Pct ?? yPct) + dyPct, stageHeight);
      const lineStroke = isApproved ? '#22c55e' : color;
      const lineWidth = isConnection ? Math.max(strokeWidth, 3) : (isApproved ? strokeWidth + 1 : strokeWidth);

      return (
        <Group listening={interactive} onClick={handleClick} onTap={handleClick}>
          {/* Fat invisible hit area */}
          <Line points={[x1, y1, x2, y2]} stroke="transparent" strokeWidth={10} />
          {/* Visible line */}
          {isConnection ? (
            <Arrow
              points={[x1, y1, x2, y2]}
              stroke={lineStroke}
              strokeWidth={lineWidth}
              opacity={opacity}
              lineCap="round"
              pointerLength={8}
              pointerWidth={6}
              fill={lineStroke}
              dash={strokeDash}
            />
          ) : (
            <Line
              points={[x1, y1, x2, y2]}
              stroke={lineStroke}
              strokeWidth={lineWidth}
              opacity={opacity}
              lineCap="round"
              dash={strokeDash}
            />
          )}
          {/* Connection type label */}
          {canShowLabel && isConnection && metadata?.connectionType && (
            <Text
              text={metadata.connectionType}
              x={(x1 + x2) / 2 - 20}
              y={(y1 + y2) / 2 - 12}
              width={40}
              align="center"
              fontSize={7}
              fontStyle="600"
              fill={color}
              opacity={0.8}
            />
          )}
          {/* Selection endpoint handles */}
          {isSelected && (
            <>
              <Circle x={x1} y={y1} radius={5} fill="#00E5FF" stroke="white" strokeWidth={1.5} shadowColor="#00E5FF" shadowBlur={8} />
              <Circle x={x2} y={y2} radius={5} fill="#00E5FF" stroke="white" strokeWidth={1.5} shadowColor="#00E5FF" shadowBlur={8} />
            </>
          )}
        </Group>
      );
    }

    case 'rectangle': {
      const x = pct(xPct + dxPct, stageWidth);
      const y = pct(yPct + dyPct, stageHeight);
      const w = pct(wPct, stageWidth);
      const h = pct(hPct, stageHeight);
      return (
        <Group listening={interactive} onClick={handleClick} onTap={handleClick}>
          <Rect
            x={x} y={y} width={w} height={h}
            fill={color} opacity={isApproved ? 0.15 : resolvedFillOpacity}
            stroke={isApproved ? '#22c55e' : color}
            strokeWidth={isApproved ? strokeWidth + 1 : strokeWidth}
            dash={strokeDash}
            cornerRadius={2}
          />
          {/* Stroke-only rect at full shape opacity */}
          <Rect
            x={x} y={y} width={w} height={h}
            fill="transparent"
            stroke={isApproved ? '#22c55e' : color}
            strokeWidth={isApproved ? strokeWidth + 1 : strokeWidth}
            opacity={opacity}
            dash={strokeDash}
            cornerRadius={2}
          />
          {isSelected && (
            <Rect
              x={x} y={y} width={w} height={h}
              fill="transparent"
              stroke="#00E5FF"
              strokeWidth={2}
              shadowColor="#00E5FF"
              shadowBlur={10}
              shadowOpacity={0.8}
              cornerRadius={2}
            />
          )}
        </Group>
      );
    }

    case 'circle': {
      const cx = pct(xPct + dxPct + (wPct || 0) / 2, stageWidth);
      const cy = pct(yPct + dyPct + (hPct || 0) / 2, stageHeight);
      const rx = pct((wPct || 0) / 2, stageWidth);
      const ry = pct((hPct || 0) / 2, stageHeight);
      const r = Math.max(1, Math.min(rx, ry));
      return (
        <Group listening={interactive} onClick={handleClick} onTap={handleClick}>
          <Circle
            x={cx} y={cy} radius={r}
            fill={color} opacity={isApproved ? 0.15 : resolvedFillOpacity}
            stroke={isApproved ? '#22c55e' : color}
            strokeWidth={isApproved ? strokeWidth + 1 : strokeWidth}
            dash={strokeDash}
          />
          <Circle
            x={cx} y={cy} radius={r}
            fill="transparent"
            stroke={isApproved ? '#22c55e' : color}
            strokeWidth={isApproved ? strokeWidth + 1 : strokeWidth}
            opacity={opacity}
            dash={strokeDash}
          />
          {isSelected && (
            <Circle
              x={cx} y={cy} radius={r}
              fill="transparent"
              stroke="#00E5FF"
              strokeWidth={2}
              shadowColor="#00E5FF"
              shadowBlur={10}
              shadowOpacity={0.8}
            />
          )}
        </Group>
      );
    }

    case 'diamond': {
      const cx = pct(xPct + dxPct + (wPct || 0) / 2, stageWidth);
      const cy = pct(yPct + dyPct + (hPct || 0) / 2, stageHeight);
      const hw = pct((wPct || 0) / 2, stageWidth);
      const hh = pct((hPct || 0) / 2, stageHeight);
      const points = [cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy];
      return (
        <Group listening={interactive} onClick={handleClick} onTap={handleClick}>
          <Line
            points={points} closed
            fill={color} opacity={resolvedFillOpacity}
            stroke={color} strokeWidth={strokeWidth}
            dash={strokeDash}
          />
          <Line
            points={points} closed
            fill="transparent"
            stroke={color} strokeWidth={strokeWidth}
            opacity={opacity}
            dash={strokeDash}
          />
          {isSelected && (
            <Line
              points={points} closed
              fill="transparent"
              stroke="#00E5FF"
              strokeWidth={2}
              shadowColor="#00E5FF"
              shadowBlur={10}
              shadowOpacity={0.8}
            />
          )}
        </Group>
      );
    }

    default: {
      // Fallback for unknown shapes
      if (wPct && hPct) {
        const x = pct(xPct + dxPct, stageWidth);
        const y = pct(yPct + dyPct, stageHeight);
        const w = pct(wPct, stageWidth);
        const h = pct(hPct, stageHeight);
        return (
          <Group listening={interactive} onClick={handleClick} onTap={handleClick}>
            <Rect
              x={x} y={y} width={w} height={h}
              fill={color || '#3BE494'} opacity={0.15}
              stroke={color || '#3BE494'} strokeWidth={strokeWidth}
            />
          </Group>
        );
      }
      const cx = pct(xPct + dxPct, stageWidth);
      const cy = pct(yPct + dyPct, stageHeight);
      return (
        <Group listening={interactive} onClick={handleClick} onTap={handleClick}>
          <Circle x={cx} y={cy} radius={6} fill={color || '#3BE494'} opacity={opacity} />
        </Group>
      );
    }
  }
}

export default memo(KonvaShapeRenderer);
export { CONNECTION_COLORS, pct, PID_SYMBOLS };
