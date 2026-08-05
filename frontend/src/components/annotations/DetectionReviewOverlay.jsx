function confidenceClass(confidence) {
  if (confidence >= 0.85) return 'text-[#3BE494]';
  if (confidence >= 0.7) return 'text-[#FFD466]';
  return 'text-[#FF897A]';
}

export default function DetectionReviewOverlay({
  detections,
  decisionMap,
  onToggleAccept,
  highlightedIndex = null,
  onHighlight,
}) {
  return (
    <div className="max-h-64 overflow-auto border border-[#919A9B]/20 rounded bg-[#0D1F17] backdrop-blur-sm">
      <div className="sticky top-0 bg-[#0D1F17] px-3 py-1.5 border-b border-[#919A9B]/20 flex items-center justify-between">
        <span className="text-[10px] text-[#919A9B]">
          {detections.length} detection{detections.length !== 1 ? 's' : ''}
        </span>
        <span className="text-[9px] text-[#919A9B]/60">Click row to highlight on drawing</span>
      </div>
      {detections.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-[#919A9B]">No detections above threshold.</div>
      ) : (
        detections.map(item => {
          const isHighlighted = highlightedIndex === item.index;
          const isRejected = decisionMap[item.index] === false;
          return (
            <div
              key={item.index}
              className={`px-3 py-1.5 border-b border-[#919A9B]/10 last:border-b-0 flex items-center gap-2 cursor-pointer transition-colors
                ${isHighlighted ? 'bg-[#3BE494]/15' : 'hover:bg-[#919A9B]/10'}
                ${isRejected ? 'opacity-40' : ''}`}
              onClick={() => onHighlight?.(item.index)}
            >
              <input
                type="checkbox"
                checked={decisionMap[item.index] !== false}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleAccept?.(item.index);
                }}
                className="accent-[#3BE494]"
              />
              <span className={`text-[11px] font-semibold truncate max-w-32 ${item.tagText ? 'text-[#D3DFE2]' : 'text-[#919A9B] italic'}`}>
                {item.tagText || '(no text)'}
              </span>
              <span className="text-[10px] text-[#919A9B] uppercase">{item.entityType}</span>
              <span className={`text-[10px] ml-auto whitespace-nowrap ${confidenceClass(item.confidence)}`}>
                {Math.round(item.confidence * 100)}%
              </span>
              {isHighlighted && (
                <span className="text-[8px] text-[#3BE494]">&#9679;</span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
