import { useAdminInstruments, useInstrumentMutation, useImport, useExportUrl } from '../../hooks/useAdminApi';
import EntityManager from './EntityManager';

const IO_TYPE_COLORS = {
  AI: '#1a73e8',
  AO: '#34a853',
  DI: '#f9ab00',
  DO: '#FF897A',
  DON: '#4FE2B0',
  DIN: '#CDB4FF',
};

const STATUS_COLORS = {
  'As-Built': '#34a853',
  'as_built': '#34a853',
  'Future': '#f9ab00',
  'future': '#f9ab00',
};

const COLUMNS = [
  // Identification
  { key: 'system_code', label: 'System Code', shortLabel: 'Sys', editable: false, minWidth: 50 },
  { key: 'tag', label: 'Tag No.', shortLabel: 'Tag No', editable: true, minWidth: 120 },
  { key: 'description', label: 'Description', shortLabel: 'Description', editable: true, minWidth: 160 },
  // Type
  {
    key: 'instrument_type',
    label: 'Instrument Type',
    shortLabel: 'Type',
    editable: true,
    type: 'select',
    options: [
      { value: 'pressure', label: 'Pressure' },
      { value: 'temperature', label: 'Temperature' },
      { value: 'flow', label: 'Flow' },
      { value: 'level', label: 'Level' },
      { value: 'safety_valve', label: 'Safety Valve' },
      { value: 'control_valve', label: 'Control Valve' },
      { value: 'analyzer', label: 'Analyzer' },
      { value: 'other', label: 'Other' },
    ],
    minWidth: 80,
  },
  // Location & References
  { key: 'line_number', label: 'Line Number', shortLabel: 'Line', editable: false, minWidth: 100 },
  // Performance
  { key: 'set_point', label: 'Set Point', shortLabel: 'Set Pt', editable: true, minWidth: 60 },
  { key: 'range_min', label: 'Range Min', shortLabel: 'Min', editable: true, minWidth: 50 },
  { key: 'range_max', label: 'Range Max', shortLabel: 'Max', editable: true, minWidth: 50 },
  { key: 'range_unit', label: 'Unit', shortLabel: 'Unit', editable: true, minWidth: 50 },
  { key: 'calibration_range', label: 'Calibration Range', shortLabel: 'Cal Range', editable: true, minWidth: 70 },
  // I/O & Control
  {
    key: 'io_type',
    label: 'I/O Type',
    shortLabel: 'I/O',
    editable: true,
    type: 'select',
    options: [
      { value: 'AI', label: 'AI' },
      { value: 'AO', label: 'AO' },
      { value: 'DI', label: 'DI' },
      { value: 'DO', label: 'DO' },
      { value: 'DON', label: 'DON' },
      { value: 'DIN', label: 'DIN' },
    ],
    colorMap: IO_TYPE_COLORS,
    minWidth: 50,
  },
  { key: 'signal_type', label: 'Signal Type', shortLabel: 'Signal', editable: true, minWidth: 60 },
  { key: 'scada_tag', label: 'SCADA Tag', shortLabel: 'SCADA', editable: true, minWidth: 80 },
  { key: 'loop_number', label: 'Loop Number', shortLabel: 'Loop', editable: true, minWidth: 60 },
  { key: 'junction_box', label: 'Junction Box', shortLabel: 'JB', editable: true, minWidth: 50 },
  { key: 'cable_number', label: 'Cable Number', shortLabel: 'Cable', editable: true, minWidth: 60 },
  // Drawings
  { key: 'hookup_drawing', label: 'Hook-up Drawing', shortLabel: 'Hook-up', editable: true, minWidth: 80 },
  { key: 'datasheet_ref', label: 'Datasheet Ref', shortLabel: 'DataSheet', editable: true, minWidth: 80 },
  // Document & Status
  { key: 'transmittal_ref', label: 'Transmittal Reference', shortLabel: 'Transmittal', editable: true, minWidth: 100 },
  { key: 'revision', label: 'Revision', shortLabel: 'Rev', editable: true, minWidth: 40 },
  { key: 'revision_date', label: 'Rev Date', shortLabel: 'Rev Date', editable: true, minWidth: 80 },
  { key: 'remarks', label: 'Remarks', shortLabel: 'Remarks', editable: true, minWidth: 120 },
];

const COLUMN_GROUPS = [
  { label: 'Identification', span: 4, color: '#1a73e8' },
  { label: 'Location', span: 1, color: '#8AB4FF' },
  { label: 'Performance', span: 5, color: '#34a853' },
  { label: 'I/O & Control', span: 6, color: '#CDB4FF' },
  { label: 'Drawings', span: 2, color: '#FF897A' },
  { label: 'Document & Status', span: 4, color: '#FFD666' },
];

export default function InstrumentManager({ platformId }) {
  const { data: instData } = useAdminInstruments(platformId);
  const mutation = useInstrumentMutation();
  const importMut = useImport('instruments', platformId);
  const exportUrl = useExportUrl('instruments', platformId);

  const instruments = instData?.instruments || instData?.data || instData || [];

  const handleAdd = async (item) => {
    try { await mutation.create({ ...item, platformId }); } catch (err) { console.error('Failed to create instrument:', err); }
  };
  const handleUpdate = async (id, item) => {
    try { await mutation.update(id, item); } catch (err) { console.error('Failed to update instrument:', err); }
  };
  const handleDelete = async (id) => {
    try { await mutation.remove(id); } catch (err) { console.error('Failed to delete instrument:', err); }
  };
  const handleImport = async (csvText) => {
    try { await importMut.mutateAsync(csvText); } catch (err) { console.error('Failed to import instruments:', err); }
  };

  return (
    <EntityManager
      title="Instrument List"
      icon="sensors"
      accentHex="#8AB4FF"
      columns={COLUMNS}
      columnGroups={COLUMN_GROUPS}
      data={Array.isArray(instruments) ? instruments : []}
      onAdd={handleAdd}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      onImport={handleImport}
      exportUrl={exportUrl}
    />
  );
}
