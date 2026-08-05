export default function AIConfidenceSlider({ value, onChange, min = 0.1, max = 0.95, step = 0.05 }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[#919A9B]">Confidence</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className="w-28 accent-[#3BE494]"
      />
      <span className="text-[10px] text-[#D3DFE2] w-9 text-right">{Math.round(value * 100)}%</span>
    </div>
  );
}

