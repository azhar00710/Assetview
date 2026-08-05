import { useRef, useEffect, useCallback } from 'react';
import { Group, Rect, Transformer } from 'react-konva';
import { getPidSymbol } from './pidSymbolCatalog';
import PidKonvaSymbol from './PidKonvaSymbol';
import { SMART_IDENT_COLORS, segmentStrokeColor } from '../../../hooks/useSmartIdentification';

function toStage(xPct, yPct, w, h) {
  return { x: (xPct / 100) * w, y: (yPct / 100) * h };
}

function toPct(x, y, w, h) {
  return {
    xPct: Math.round((x / w) * 10000) / 100,
    yPct: Math.round((y / h) * 10000) / 100,
  };
}

function SelectionHalo({ w, h }) {
  return (
    <Rect
      x={-6}
      y={-6}
      width={w + 12}
      height={h + 12}
      stroke={SMART_IDENT_COLORS.selected}
      strokeWidth={2}
      dash={[5, 4]}
      cornerRadius={4}
      listening={false}
    />
  );
}

/**
 * Selectable P&ID symbol with Konva Transformer (drag, resize, rotate).
 */
export default function SymbolTransformShape({
  seg,
  stageWidth,
  stageHeight,
  selected,
  editable,
  onSelect,
  onGeometryChange,
}) {
  const groupRef = useRef(null);
  const trRef = useRef(null);

  const symId = seg.metadata?.symbolId;
  const sym = getPidSymbol(symId);
  const g = seg.geometry || {};
  const w = Math.max(12, ((g.wPct || 2) / 100) * stageWidth);
  const h = Math.max(12, ((g.hPct || 2) / 100) * stageHeight);
  const rot = g.rotationDeg || 0;
  const tl = toStage(g.xPct ?? 0, g.yPct ?? 0, stageWidth, stageHeight);
  const cx = tl.x + w / 2;
  const cy = tl.y + h / 2;
  const color = segmentStrokeColor(seg, selected);

  useEffect(() => {
    const node = groupRef.current;
    if (!node) return;
    node.x(cx);
    node.y(cy);
    node.offsetX(w / 2);
    node.offsetY(h / 2);
    node.rotation(rot);
    node.scaleX(1);
    node.scaleY(1);
    node.getLayer()?.batchDraw();
  }, [cx, cy, w, h, rot, seg.id]);

  useEffect(() => {
    if (!selected || !editable || !trRef.current || !groupRef.current) return;
    trRef.current.nodes([groupRef.current]);
    trRef.current.getLayer()?.batchDraw();
  }, [selected, editable, w, h, rot, seg.id]);

  const commitGeometry = useCallback(() => {
    const node = groupRef.current;
    if (!node || !onGeometryChange) return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    const newW = Math.max(12, w * Math.abs(scaleX));
    const newH = Math.max(12, h * Math.abs(scaleY));
    const newRot = Math.round(node.rotation() * 10) / 10;
    const newCx = node.x();
    const newCy = node.y();
    const newTlX = newCx - newW / 2;
    const newTlY = newCy - newH / 2;
    const tlPct = toPct(newTlX, newTlY, stageWidth, stageHeight);
    const wPct = Math.round((newW / stageWidth) * 10000) / 100;
    const hPct = Math.round((newH / stageHeight) * 10000) / 100;

    node.offsetX(newW / 2);
    node.offsetY(newH / 2);

    onGeometryChange(seg, {
      ...g,
      xPct: tlPct.xPct,
      yPct: tlPct.yPct,
      wPct,
      hPct,
      rotationDeg: newRot,
      points: [{ xPct: tlPct.xPct + wPct / 2, yPct: tlPct.yPct + hPct / 2 }],
    }, { previousGeometry: g });
  }, [seg, g, w, h, stageWidth, stageHeight, onGeometryChange]);

  const handleSelect = (e) => {
    e.cancelBubble = true;
    onSelect?.(seg);
  };

  return (
    <>
      <Group
        ref={groupRef}
        name={`symbol-${seg.id}`}
        x={cx}
        y={cy}
        offsetX={w / 2}
        offsetY={h / 2}
        rotation={rot}
        draggable={selected && editable}
        onClick={handleSelect}
        onTap={handleSelect}
        onMouseDown={(e) => { e.cancelBubble = true; }}
        onDragEnd={commitGeometry}
        onTransformEnd={commitGeometry}
      >
        <Rect width={w} height={h} fill="transparent" />
        <Rect x={-10} y={-10} width={w + 20} height={h + 20} fill="transparent" />
        {selected && <SelectionHalo w={w} h={h} />}
        {sym?.elements ? (
          <PidKonvaSymbol symbol={sym} width={w} height={h} color="#111827" strokeWidth={2.8} />
        ) : (
          <Rect width={w} height={h} stroke={color} strokeWidth={2} />
        )}
      </Group>
      {selected && editable && (
        <Transformer
          ref={trRef}
          rotateEnabled
          keepRatio={false}
          enabledAnchors={[
            'top-left', 'top-center', 'top-right',
            'middle-left', 'middle-right',
            'bottom-left', 'bottom-center', 'bottom-right',
          ]}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 12 || newBox.height < 12) return oldBox;
            return newBox;
          }}
          anchorSize={8}
          anchorCornerRadius={2}
          borderStroke={SMART_IDENT_COLORS.selected}
          borderStrokeWidth={1.5}
        />
      )}
    </>
  );
}
