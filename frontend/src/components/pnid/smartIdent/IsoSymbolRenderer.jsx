import { Circle, Line, Rect, Path } from 'react-konva';
import { ISO_VIEWBOX } from './iso15519Graphics';

/**
 * Render ISO vector symbol primitives inside Konva (transparent background).
 */
export function IsoKonvaElements({
  elements,
  width,
  height,
  color = '#1a1a1a',
  strokeWidth = 2,
  opacity = 1,
}) {
  if (!elements?.length || !width || !height) return null;

  const scale = Math.min(width, height) / ISO_VIEWBOX;
  const padX = (width - ISO_VIEWBOX * scale) / 2;
  const padY = (height - ISO_VIEWBOX * scale) / 2;
  const sx = (x) => padX + x * scale;
  const sy = (y) => padY + y * scale;
  const sw = Math.max(1.2, strokeWidth * scale * (ISO_VIEWBOX / 48));

  return elements.map((el, i) => {
    const key = `${el.t}-${i}`;
    const stroke = color;
    const fill = el.fill === 'none' || !el.fill ? 'transparent' : el.fill;

    if (el.t === 'circle') {
      return (
        <Circle
          key={key}
          x={sx(el.cx)}
          y={sy(el.cy)}
          radius={el.r * scale}
          stroke={stroke}
          strokeWidth={sw}
          fill={fill}
          opacity={opacity}
          listening={false}
        />
      );
    }
    if (el.t === 'line') {
      return (
        <Line
          key={key}
          points={[sx(el.x1), sy(el.y1), sx(el.x2), sy(el.y2)]}
          stroke={stroke}
          strokeWidth={sw}
          opacity={opacity}
          listening={false}
        />
      );
    }
    if (el.t === 'rect') {
      return (
        <Rect
          key={key}
          x={sx(el.x)}
          y={sy(el.y)}
          width={el.w * scale}
          height={el.h * scale}
          cornerRadius={(el.rx || 0) * scale}
          stroke={stroke}
          strokeWidth={sw}
          fill={fill}
          opacity={opacity}
          listening={false}
        />
      );
    }
    if (el.t === 'poly') {
      const pts = el.points.flatMap(([x, y]) => [sx(x), sy(y)]);
      return (
        <Line
          key={key}
          points={pts}
          closed
          stroke={stroke}
          strokeWidth={sw}
          fill={fill}
          opacity={opacity}
          listening={false}
        />
      );
    }
    if (el.t === 'path') {
      return (
        <Path
          key={key}
          data={el.d}
          x={padX}
          y={padY}
          scaleX={scale}
          scaleY={scale}
          stroke={stroke}
          strokeWidth={sw / scale}
          fill={fill}
          opacity={opacity}
          listening={false}
        />
      );
    }
    return null;
  });
}

/**
 * SVG preview for pickers — transparent background, crisp vectors.
 */
export function IsoSymbolSvg({
  elements,
  size = 36,
  width,
  height,
  color = 'currentColor',
  strokeWidth = 2,
  className = '',
}) {
  if (!elements?.length) return null;

  const w = width ?? size;
  const h = height ?? size;

  return (
    <svg
      viewBox={`0 0 ${ISO_VIEWBOX} ${ISO_VIEWBOX}`}
      width={w}
      height={h}
      className={className}
      style={{ background: 'transparent', display: 'block' }}
      aria-hidden
    >
      {elements.map((el, i) => {
        const key = `${el.t}-${i}`;
        const fill = el.fill === 'none' || !el.fill ? 'none' : el.fill;
        const sw = strokeWidth;

        if (el.t === 'circle') {
          return (
            <circle
              key={key}
              cx={el.cx}
              cy={el.cy}
              r={el.r}
              stroke={color}
              strokeWidth={sw}
              fill={fill}
            />
          );
        }
        if (el.t === 'line') {
          return (
            <line
              key={key}
              x1={el.x1}
              y1={el.y1}
              x2={el.x2}
              y2={el.y2}
              stroke={color}
              strokeWidth={sw}
            />
          );
        }
        if (el.t === 'rect') {
          return (
            <rect
              key={key}
              x={el.x}
              y={el.y}
              width={el.w}
              height={el.h}
              rx={el.rx || 0}
              stroke={color}
              strokeWidth={sw}
              fill={fill}
            />
          );
        }
        if (el.t === 'poly') {
          return (
            <polygon
              key={key}
              points={el.points.map(([x, y]) => `${x},${y}`).join(' ')}
              stroke={color}
              strokeWidth={sw}
              fill={fill}
            />
          );
        }
        if (el.t === 'path') {
          return (
            <path
              key={key}
              d={el.d}
              stroke={color}
              strokeWidth={sw}
              fill={fill}
            />
          );
        }
        return null;
      })}
    </svg>
  );
}
