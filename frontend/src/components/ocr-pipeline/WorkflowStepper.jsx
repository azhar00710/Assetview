/**
 * WorkflowStepper — Horizontal 5-step workflow indicator for the OCR pipeline.
 *
 * Steps: (1) Setup → (2) Select Files → (3) Process → (4) Review & Analyze → (5) Register & Annotate
 *
 * Replaces the old 3-tab buttons with a clear linear flow indicator.
 */

const STEPS = [
  { key: 1, label: 'Setup',               icon: 'tune',             doneIcon: 'check_circle' },
  { key: 2, label: 'Select Files',        icon: 'folder_open',      doneIcon: 'check_circle' },
  { key: 3, label: 'Process',             icon: 'play_circle',      doneIcon: 'check_circle' },
  { key: 4, label: 'Review & Analyze',    icon: 'analytics',        doneIcon: 'check_circle' },
  { key: 5, label: 'Register & Annotate', icon: 'inventory_2',      doneIcon: 'check_circle' },
];

const COLORS = {
  completed: '#3BE494',
  active:    '#3BE494',
  upcoming:  'rgba(145, 154, 155, 0.35)',
};

/**
 * @param {Object} props
 * @param {number} props.activeStep - Currently active step (1-5)
 * @param {number} props.completedUpTo - Highest completed step number (0-5)
 * @param {function} props.onStepClick - Called with step number when user clicks a step
 * @param {function} props.onSettingsClick - Called when step 1 (Setup) is clicked — opens drawer instead
 */
export default function WorkflowStepper({ activeStep, completedUpTo, onStepClick, onSettingsClick }) {
  return (
    <div className="flex items-center justify-center gap-0 px-6 py-2.5 bg-md-surface-container-low border-b border-md-outline-variant/15 shrink-0">
      {STEPS.map((step, i) => {
        const isCompleted = step.key <= completedUpTo;
        const isActive = step.key === activeStep;
        const isClickable = step.key <= completedUpTo + 1; // can click completed + next

        const circleColor = isActive ? COLORS.active
          : isCompleted ? COLORS.completed
          : COLORS.upcoming;

        const labelColor = isActive ? COLORS.active
          : isCompleted ? 'rgba(59, 228, 148, 0.7)'
          : 'rgba(145, 154, 155, 0.5)';

        const handleClick = () => {
          if (!isClickable) return;
          if (step.key === 1) {
            onSettingsClick?.();
          } else {
            onStepClick?.(step.key);
          }
        };

        return (
          <div key={step.key} className="flex items-center">
            {/* Connector line (before step, not on first) */}
            {i > 0 && (
              <div
                className="w-16 h-[2px] mx-1"
                style={{
                  background: isCompleted || isActive
                    ? `linear-gradient(to right, ${COLORS.completed}, ${isActive && !isCompleted ? COLORS.upcoming : COLORS.completed})`
                    : COLORS.upcoming,
                }}
              />
            )}

            {/* Step circle + label */}
            <button
              onClick={handleClick}
              disabled={!isClickable}
              className={`flex flex-col items-center gap-1 group ${
                isClickable ? 'cursor-pointer' : 'cursor-default opacity-60'
              }`}
              title={step.label}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                  isActive ? 'ring-2 ring-offset-1 ring-offset-[#111D14]' : ''
                } ${isClickable && !isActive ? 'group-hover:scale-110' : ''}`}
                style={{
                  background: isCompleted || isActive ? circleColor : 'transparent',
                  border: isCompleted || isActive ? 'none' : `2px solid ${COLORS.upcoming}`,
                  ringColor: isActive ? COLORS.active : undefined,
                }}
              >
                {isCompleted && !isActive ? (
                  <span className="material-symbols-outlined text-[16px] text-[#0D1F17] font-bold">check</span>
                ) : (
                  <span
                    className={`material-symbols-outlined text-[14px] ${isActive ? 'animate-pulse' : ''}`}
                    style={{ color: isCompleted || isActive ? '#0D1F17' : COLORS.upcoming }}
                  >
                    {step.icon}
                  </span>
                )}
              </div>
              <span
                className="text-[10px] font-semibold whitespace-nowrap select-none"
                style={{ color: labelColor }}
              >
                {step.label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
