import { useMemo } from 'react';
import { md, systemColor } from '../../lib/theme';

const TAG_TYPE_COLORS = {
  equipment: systemColor('process'),
  instrument: systemColor('instrument'),
  line: systemColor('utility'),
  unknown: '#919A9B',
};

const STATUS_COLORS = {
  pending: null, // uses tag type color
  approved: '#22c55e',
  rejected: '#ef4444',
};

/**
 * Renders OCR bounding boxes on the P&ID canvas.
 * Uses percentage-based coordinates matching the overlay system.
 */
export default function OcrCanvasOverlay({ extractions, selectedId, onSelect }) {
  if (!extractions?.length) return null;

  return (
    <div className="absolute inset-0" style={{ minWidth: '1200px', minHeight: '800px' }}>
      {extractions.map(ext => {
        const isSelected = selectedId === ext.id;
        const isMatched = !!ext.matchedEntityId;
        const tagColor = TAG_TYPE_COLORS[ext.tagType] || '#919A9B';
        const statusColor = STATUS_COLORS[ext.status];
        const borderColor = statusColor || (isMatched ? tagColor : '#ef4444');

        // Determine opacity based on match status
        const opacity = ext.status === 'rejected' ? 0.2 :
                        ext.status === 'approved' ? 0.9 :
                        isMatched ? 0.7 : 0.5;

        return (
          <div
            key={ext.id}
            className={`absolute cursor-pointer group transition-all ${isSelected ? 'z-20' : 'z-10'}`}
            style={{
              left: `${ext.bboxXPct}%`,
              top: `${ext.bboxYPct}%`,
              width: `${Math.max(ext.bboxWPct, 2)}%`,
              height: `${Math.max(ext.bboxHPct, 1)}%`,
            }}
            onClick={(e) => { e.stopPropagation(); onSelect?.(ext); }}
          >
            {/* Bounding box */}
            <div
              className={`w-full h-full border-2 rounded-sm transition-all ${
                isSelected ? 'opacity-100' : `group-hover:opacity-100`
              }`}
              style={{
                borderColor,
                backgroundColor: isSelected ? borderColor + '20' : 'transparent',
                boxShadow: isSelected ? `0 0 8px ${borderColor}60` : 'none',
                opacity,
              }}
            />

            {/* Tag label above box */}
            <div
              className={`absolute -top-5 left-0 px-1 py-0.5 text-[8px] font-bold rounded whitespace-nowrap transition-opacity ${
                isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              style={{
                backgroundColor: borderColor,
                color: md.onPrimary,
              }}
            >
              {ext.extractedText}
              {isMatched && ext.matchConfidence < 1 && (
                <span className="ml-1 opacity-70">
                  {Math.round(ext.matchConfidence * 100)}%
                </span>
              )}
            </div>

            {/* Status indicator dot */}
            {ext.status !== 'pending' && (
              <div
                className="absolute -top-1 -right-1 w-3 h-3 rounded-full border border-white/50 flex items-center justify-center text-[6px] font-bold"
                style={{
                  backgroundColor: statusColor,
                  color: '#fff',
                }}
              >
                {ext.status === 'approved' ? '\u2713' : '\u2717'}
              </div>
            )}

            {/* Match status indicator */}
            {ext.status === 'pending' && !isMatched && (
              <div
                className="absolute -top-1 -right-1 w-3 h-3 rounded-full border border-white/50"
                style={{ backgroundColor: '#ef4444' }}
                title="No match"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
