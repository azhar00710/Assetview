import { useAdminEquipment, useEquipmentMutation, useImport, useExportUrl } from '../../hooks/useAdminApi';
import EntityManager from './EntityManager';

const CRITICALITY_COLORS = {
  high: '#FF897A',
  medium: '#FFD666',
  low: '#4FE2B0',
  High: '#FF897A',
  Medium: '#FFD666',
  Low: '#4FE2B0',
};

const STATUS_COLORS = {
  'As-Built': '#34a853',
  'as_built': '#34a853',
  'Future': '#f9ab00',
  'future': '#f9ab00',
};

const TAG_TYPE_COLORS = {
  M: '#1a73e8',
  E: '#f9ab00',
  I: '#34a853',
  A: '#FF897A',
  S: '#CDB4FF',
};

const COLUMNS = [
  // Identification
  { key: 'system_code', label: 'System Code', shortLabel: 'Sys', editable: false, minWidth: 50 },
  { key: 'tag', label: 'Tag No.', shortLabel: 'Tag No', editable: true, minWidth: 120 },
  { key: 'equipment_type', label: 'Equipment Type', shortLabel: 'Type', editable: true, minWidth: 80 },
  { key: 'description', label: 'Description', shortLabel: 'Description', editable: true, minWidth: 160 },
  {
    key: 'criticality',
    label: 'Criticality',
    shortLabel: 'Crit',
    editable: true,
    type: 'select',
    options: [
      { value: 'high', label: 'High' },
      { value: 'medium', label: 'Medium' },
      { value: 'low', label: 'Low' },
    ],
    colorMap: CRITICALITY_COLORS,
    minWidth: 60,
  },
  // Location & References
  { key: 'line_number', label: 'Line Number', shortLabel: 'Line', editable: false, minWidth: 100 },
  { key: 'sil_level', label: 'SIL Level', shortLabel: 'SIL', editable: true, minWidth: 40 },
  { key: 'inspection_group', label: 'Inspection Group', shortLabel: 'Insp Grp', editable: true, minWidth: 60 },
  { key: 'corrosion_loop', label: 'Corrosion Loop', shortLabel: 'Corr Loop', editable: true, minWidth: 60 },
  // Performance (stored in metadata)
  { key: 'set_point', label: 'Set Point', shortLabel: 'Set Pt', editable: true, minWidth: 60 },
  { key: 'range', label: 'Range', shortLabel: 'Range', editable: true, minWidth: 60 },
  { key: 'unit', label: 'Unit', shortLabel: 'Unit', editable: true, minWidth: 50 },
  { key: 'installed_power', label: 'Installed Power', shortLabel: 'Power', editable: true, minWidth: 60 },
  { key: 'size_lwh', label: 'Size LxWxH', shortLabel: 'Size', editable: true, minWidth: 80 },
  // Weight & Design
  { key: 'weight_kg', label: 'Weight (kg)', shortLabel: 'Weight', editable: true, minWidth: 60 },
  { key: 'design_pressure', label: 'Design Pressure', shortLabel: 'Des P', editable: true, minWidth: 60 },
  { key: 'design_temp', label: 'Design Temperature', shortLabel: 'Des T', editable: true, minWidth: 60 },
  { key: 'operating_pressure', label: 'Operating Pressure', shortLabel: 'Op P', editable: true, minWidth: 60 },
  { key: 'operating_temp', label: 'Operating Temperature', shortLabel: 'Op T', editable: true, minWidth: 60 },
  // Manufacturer
  { key: 'manufacturer', label: 'Manufacturer', shortLabel: 'Mfr', editable: true, minWidth: 100 },
  { key: 'model_number', label: 'Model No.', shortLabel: 'Model', editable: true, minWidth: 80 },
  { key: 'serial_number', label: 'Serial No.', shortLabel: 'Serial', editable: true, minWidth: 80 },
  // Control Systems (stored in metadata)
  { key: 'is_calculation', label: 'IS Calculation', shortLabel: 'IS Calc', editable: true, minWidth: 50 },
  { key: 'rtu_esd_io', label: 'RTU ESD I/O', shortLabel: 'RTU ESD', editable: true, minWidth: 50 },
  { key: 'scada_io', label: 'SCADA I/O', shortLabel: 'SCADA', editable: true, minWidth: 50 },
  { key: 'fg_io', label: 'F & G I/O', shortLabel: 'F&G', editable: true, minWidth: 50 },
  // Dates
  { key: 'commissioning_date', label: 'Commissioning Date', shortLabel: 'Comm Date', editable: true, minWidth: 80 },
  { key: 'last_inspection', label: 'Last Inspection', shortLabel: 'Last Insp', editable: true, minWidth: 80 },
  { key: 'next_inspection', label: 'Next Inspection', shortLabel: 'Next Insp', editable: true, minWidth: 80 },
  // Classification (stored in metadata)
  { key: 'transmittal_ref', label: 'Transmittal Reference', shortLabel: 'Transmittal', editable: true, minWidth: 100 },
  { key: 'revision', label: 'Revision', shortLabel: 'Rev', editable: true, minWidth: 40 },
  { key: 'revision_date', label: 'Rev Date', shortLabel: 'Rev Date', editable: true, minWidth: 80 },
  { key: 'remarks', label: 'Remarks', shortLabel: 'Remarks', editable: true, minWidth: 120 },
];

const COLUMN_GROUPS = [
  { label: 'Identification', span: 5, color: '#1a73e8' },
  { label: 'Location & References', span: 4, color: '#8AB4FF' },
  { label: 'Performance', span: 5, color: '#34a853' },
  { label: 'Weight & Design', span: 5, color: '#e37400' },
  { label: 'Manufacturer', span: 3, color: '#FF897A' },
  { label: 'Control Systems', span: 4, color: '#CDB4FF' },
  { label: 'Dates', span: 3, color: '#f9ab00' },
  { label: 'Document & Status', span: 4, color: '#FFD666' },
];

export default function EquipmentManager({ platformId }) {
  const { data: equipData } = useAdminEquipment(platformId);
  const mutation = useEquipmentMutation();
  const importMut = useImport('equipment', platformId);
  const exportUrl = useExportUrl('equipment', platformId);

  const equipment = equipData?.equipment || equipData?.data || equipData || [];

  const handleAdd = async (item) => {
    try { await mutation.create({ ...item, platformId }); } catch (err) { console.error('Failed to create equipment:', err); }
  };
  const handleUpdate = async (id, item) => {
    try { await mutation.update(id, item); } catch (err) { console.error('Failed to update equipment:', err); }
  };
  const handleDelete = async (id) => {
    try { await mutation.remove(id); } catch (err) { console.error('Failed to delete equipment:', err); }
  };
  const handleImport = async (csvText) => {
    try { await importMut.mutateAsync(csvText); } catch (err) { console.error('Failed to import equipment:', err); }
  };

  return (
    <EntityManager
      title="Equipment List"
      icon="precision_manufacturing"
      accentHex="#4FE2B0"
      columns={COLUMNS}
      columnGroups={COLUMN_GROUPS}
      data={Array.isArray(equipment) ? equipment : []}
      onAdd={handleAdd}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      onImport={handleImport}
      exportUrl={exportUrl}
    />
  );
}
