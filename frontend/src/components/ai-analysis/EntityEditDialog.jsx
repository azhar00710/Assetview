import { useState } from 'react';
import { md } from '../../lib/theme';
import { useEditAiEntity, useApproveAiEntity } from '../../hooks/useAiAnalysis';

const FIELD_CONFIGS = {
  line: [
    { key: 'lineNumber', label: 'Line Number', required: true },
    { key: 'service', label: 'Service Code' },
    { key: 'nominalSize', label: 'Nominal Size' },
    { key: 'pipeClass', label: 'Pipe Class' },
    { key: 'fluidCode', label: 'Fluid Code' },
    { key: 'systemCode', label: 'System Code' },
    { key: 'fromConnection', label: 'From Connection' },
    { key: 'toConnection', label: 'To Connection' },
  ],
  equipment: [
    { key: 'tag', label: 'Tag', required: true },
    { key: 'equipmentType', label: 'Equipment Type' },
    { key: 'description', label: 'Description' },
    { key: 'systemCode', label: 'System Code' },
    { key: 'lineNumber', label: 'Line Number' },
  ],
  instrument: [
    { key: 'tag', label: 'Tag', required: true },
    { key: 'instrumentType', label: 'Instrument Type' },
    { key: 'description', label: 'Description' },
    { key: 'measuredVariable', label: 'Measured Variable' },
    { key: 'function', label: 'Function' },
    { key: 'systemCode', label: 'System Code' },
    { key: 'lineNumber', label: 'Line Number' },
  ],
  system: [
    { key: 'code', label: 'System Code', required: true },
    { key: 'name', label: 'System Name', required: true },
    { key: 'type', label: 'Type (process/utility/safety/instrument)' },
    { key: 'reason', label: 'Reason for Suggestion' },
  ],
};

export default function EntityEditDialog({ entity, onClose }) {
  const editMutation = useEditAiEntity();
  const approveMutation = useApproveAiEntity();

  const initialData = entity.suggestedData || {};
  const [formData, setFormData] = useState({ ...initialData });

  const fields = FIELD_CONFIGS[entity.entityType] || [];

  const handleSave = () => {
    editMutation.mutate(
      { entityId: entity.id, suggestedData: formData },
      { onSuccess: () => onClose() }
    );
  };

  const handleSaveAndApprove = () => {
    editMutation.mutate(
      { entityId: entity.id, suggestedData: formData },
      {
        onSuccess: () => {
          approveMutation.mutate({ entityId: entity.id }, { onSuccess: () => onClose() });
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="w-[480px] max-h-[600px] bg-md-surface-container rounded-lg shadow-xl border border-md-outline-variant/30 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-md-outline-variant/30 flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-[20px] text-purple-400">edit</span>
          <span className="text-body-md font-bold text-md-on-surface">
            Edit {entity.entityType}: {entity.suggestedTag}
          </span>
          <div className="flex-1" />
          <button onClick={onClose} className="text-md-on-surface-variant hover:text-md-on-surface">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {fields.map(field => (
            <div key={field.key}>
              <label className="block text-[10px] font-bold text-md-on-surface-variant uppercase mb-1">
                {field.label}
                {field.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              <input
                value={formData[field.key] || ''}
                onChange={e => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                className="w-full px-3 py-1.5 rounded bg-md-on-surface/5 border border-md-outline-variant/30 text-sm text-md-on-surface placeholder:text-md-on-surface-variant/40 focus:border-purple-400/50 focus:outline-none transition-colors"
                placeholder={field.label}
              />
            </div>
          ))}

          {/* Confidence display */}
          <div className="flex items-center gap-2 pt-2 text-[10px] text-md-on-surface-variant">
            <span>Confidence:</span>
            <span className="font-bold" style={{
              color: entity.confidence >= 0.9 ? '#3BE494' :
                entity.confidence >= 0.7 ? '#F39C12' : '#E74C3C'
            }}>
              {Math.round(entity.confidence * 100)}%
            </span>
            {entity.sourcePnidIds?.length > 0 && (
              <span>Found on {entity.sourcePnidIds.length} P&ID(s)</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-md-outline-variant/30 flex gap-2 justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded text-body-sm font-semibold text-md-on-surface-variant hover:bg-md-on-surface/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={editMutation.isPending}
            className="px-4 py-1.5 rounded text-body-sm font-bold bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors disabled:opacity-50"
          >
            {editMutation.isPending ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleSaveAndApprove}
            disabled={editMutation.isPending || approveMutation.isPending}
            className="px-4 py-1.5 rounded text-body-sm font-bold bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors disabled:opacity-50"
          >
            Save & Approve
          </button>
        </div>
      </div>
    </div>
  );
}
