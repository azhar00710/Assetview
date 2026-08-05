import { memo } from 'react';
import { Group, Rect, Text } from 'react-konva';
import { pct } from './KonvaShapeRenderer';

/**
 * Renders OCR-suggested entity positions as ghost overlays.
 * Click a ghost to auto-place the entity at that position.
 * Highlighted items (from detection list click) pulse brighter.
 */
function KonvaOcrGhosts({ suggestions, onAccept, stageWidth, stageHeight }) {
  if (!suggestions?.length) return null;

  return (
    <>
      {suggestions.map(sug => {
        const x = pct(sug.suggestedXPct, stageWidth);
        const y = pct(sug.suggestedYPct, stageHeight);
        const w = pct(sug.suggestedWPct || 4, stageWidth);
        const h = pct(sug.suggestedHPct || 3, stageHeight);
        const isInstrument = sug.entityType === 'instrument';
        const isHighlighted = sug._highlighted;

        const baseColor = isInstrument ? '#F39C12' : '#3BE494';
        const color = isHighlighted ? '#FFFFFF' : baseColor;

        // Confidence tier styling
        const tier = sug.tier || 'ghost';
        const tierOpacity = isHighlighted ? 1.0 : tier === 'auto' ? 0.8 : tier === 'ghost' ? 0.6 : 0.3;
        const tierDash = isHighlighted ? null : tier === 'auto' ? null : [4, 3];
        const fillOpacity = isHighlighted ? 0.22 : tier === 'auto' ? 0.12 : 0.08;
        const strokeWidth = isHighlighted ? 2.5 : 1.5;

        return (
          <Group
            key={sug.entityId}
            onClick={() => onAccept?.(sug)}
            onTap={() => onAccept?.(sug)}
          >
            <Rect
              x={x} y={y} width={w} height={h}
              fill={isHighlighted ? baseColor : color}
              opacity={fillOpacity}
              stroke={color}
              strokeWidth={strokeWidth}
              dash={tierDash}
              cornerRadius={isInstrument ? Math.min(w, h) / 2 : 2}
            />
            {/* Ghost border at tier opacity */}
            <Rect
              x={x} y={y} width={w} height={h}
              fill="transparent"
              stroke={color}
              strokeWidth={strokeWidth}
              dash={tierDash}
              opacity={tierOpacity}
              cornerRadius={isInstrument ? Math.min(w, h) / 2 : 2}
            />
            {/* Tag label */}
            <Text
              text={sug.tag || ''}
              x={x}
              y={y + h / 2 - 5}
              width={w}
              align="center"
              fontSize={isHighlighted ? 10 : 8}
              fontStyle="600"
              fontFamily="monospace"
              fill={color}
              opacity={tierOpacity * 0.9}
            />
            {/* Tier badge */}
            {tier === 'auto' && (
              <Text
                text="AUTO"
                x={x + w - 22}
                y={y + 2}
                fontSize={6}
                fontStyle="bold"
                fill={color}
                opacity={0.9}
              />
            )}
          </Group>
        );
      })}
    </>
  );
}

export default memo(KonvaOcrGhosts);
