import { useMemo } from 'react';
import { useAdminLines, useLineMutation, useAdminSystems, useImport, useExportUrl } from '../../hooks/useAdminApi';
import { STC } from '../../data/constants';
import EntityManager from './EntityManager';

const STATUS_COLORS = {
  'As-Built': '#34a853',
  'as_built': '#34a853',
  'Future': '#f9ab00',
  'future': '#f9ab00',
  'Draft': '#FFB068',
  'draft': '#FFB068',
  'Approved': '#1a73e8',
  'approved': '#1a73e8',
};

const COLUMNS = [
  // Identification
  { key: 'system_code', label: 'System Code', shortLabel: 'Sys', editable: false, minWidth: 50 },
  { key: 'line_number', label: 'Line Number', shortLabel: 'Line No', editable: true, minWidth: 120 },
  { key: 'nominal_size', label: 'Nominal Size', shortLabel: 'Size', editable: true, minWidth: 50 },
  { key: 'fluid_code', label: 'Fluid Code', shortLabel: 'Fluid', editable: true, minWidth: 50 },
  { key: 'pipe_class', label: 'Pipe Class / Spec', shortLabel: 'Spec', editable: true, minWidth: 60 },
  { key: 'material', label: 'Material', shortLabel: 'Mat', editable: true, minWidth: 60 },
  // Service
  { key: 'service', label: 'Service / Fluid', shortLabel: 'Service', editable: true, minWidth: 80 },
  { key: 'insulation_code', label: 'Insulation Code', shortLabel: 'Insul', editable: true, minWidth: 50 },
  // Connectivity
  { key: 'from_equipment_tag', label: 'From Equipment/Tag', shortLabel: 'From', editable: true, minWidth: 100 },
  { key: 'to_equipment_tag', label: 'To Equipment/Tag', shortLabel: 'To', editable: true, minWidth: 100 },
  // P&ID References (stored in metadata)
  { key: 'from_pnid', label: 'From P&ID', shortLabel: 'From P&ID', editable: true, minWidth: 100 },
  { key: 'to_pnid', label: 'To P&ID', shortLabel: 'To P&ID', editable: true, minWidth: 100 },
  // Design Conditions
  { key: 'design_pressure', label: 'Design Pressure (BarG)', shortLabel: 'Des.P', editable: true, minWidth: 60 },
  { key: 'design_temperature', label: 'Design Temp (DegC)', shortLabel: 'Des.T', editable: true, minWidth: 60 },
  { key: 'operating_pressure', label: 'Operating Pressure (BarG)', shortLabel: 'Op.P', editable: true, minWidth: 60 },
  { key: 'operating_temperature', label: 'Operating Temp (DegC)', shortLabel: 'Op.T', editable: true, minWidth: 60 },
  // Flow Properties (stored in metadata)
  { key: 'fluid_velocity', label: 'Fluid Velocity m/sec', shortLabel: 'Vel', editable: true, minWidth: 50 },
  { key: 'gas_dynamic_viscosity', label: 'Gas Dynamic Viscosity Pa*s', shortLabel: 'Gas Visc', editable: true, minWidth: 60 },
  { key: 'liquid_density', label: 'Liquid Density kg/m3', shortLabel: 'Liq Den', editable: true, minWidth: 60 },
  { key: 'vapor_density', label: 'Vapor Density kg/m3', shortLabel: 'Vap Den', editable: true, minWidth: 60 },
  { key: 'liquid_mass_flow_rate', label: 'Liquid Mass Flow Rate kg/hr', shortLabel: 'Liq Flow', editable: true, minWidth: 60 },
  { key: 'gas_mass_flow_rate', label: 'Gas Mass Flow Rate kg/hr', shortLabel: 'Gas Flow', editable: true, minWidth: 60 },
  { key: 'total_mass_flow_rate', label: 'Total Mass Flow Rate kg/hr', shortLabel: 'Tot Flow', editable: true, minWidth: 60 },
  { key: 'slug_velocity', label: 'Slug Velocity m/sec', shortLabel: 'Slug Vel', editable: true, minWidth: 60 },
  // Stress & Vibration
  { key: 'stress_critical', label: 'Stress Critical', shortLabel: 'St.Crit', editable: true, minWidth: 50 },
  { key: 'stress_analysis_ref', label: 'Stress Analysis Ref', shortLabel: 'St.Ref', editable: true, minWidth: 70 },
  { key: 'vibration_analysis_req', label: 'Vibration Analysis Req', shortLabel: 'Vib Req', editable: true, minWidth: 50 },
  // Testing
  { key: 'test_pressure', label: 'Test Pressure (BarG)', shortLabel: 'Test P', editable: true, minWidth: 60 },
  { key: 'test_medium', label: 'Test Medium', shortLabel: 'Test Med', editable: true, minWidth: 60 },
  // Document Reference
  { key: 'isometric_ref', label: 'Isometric Ref', shortLabel: 'Iso Ref', editable: true, minWidth: 80 },
  { key: 'line_class_spec', label: 'Line Class Spec', shortLabel: 'Class', editable: true, minWidth: 70 },
  { key: 'transmittal_ref', label: 'Transmittal Reference', shortLabel: 'Transmittal', editable: true, minWidth: 100 },
  { key: 'revision', label: 'Revision', shortLabel: 'Rev', editable: true, minWidth: 40 },
  { key: 'revision_date', label: 'Rev Date', shortLabel: 'Rev Date', editable: true, minWidth: 80 },
  {
    key: 'status',
    label: 'Status',
    shortLabel: 'Status',
    editable: true,
    type: 'select',
    options: [
      { value: 'As-Built', label: 'As-Built' },
      { value: 'Future', label: 'Future' },
      { value: 'Draft', label: 'Draft' },
      { value: 'Approved', label: 'Approved' },
    ],
    colorMap: STATUS_COLORS,
    minWidth: 70,
  },
  { key: 'remarks', label: 'Remarks', shortLabel: 'Remarks', editable: true, minWidth: 120 },
];

const COLUMN_GROUPS = [
  { label: 'Identification', span: 6, color: '#1a73e8' },
  { label: 'Service', span: 2, color: '#34a853' },
  { label: 'Connectivity', span: 2, color: '#f9ab00' },
  { label: 'P&ID Reference', span: 2, color: '#8AB4FF' },
  { label: 'Design Conditions', span: 4, color: '#e37400' },
  { label: 'Flow Properties', span: 8, color: '#4FE2B0' },
  { label: 'Stress & Vibration', span: 3, color: '#FF897A' },
  { label: 'Testing', span: 2, color: '#CDB4FF' },
  { label: 'Document & Status', span: 7, color: '#FFD666' },
];

export default function LineManager({ platformId }) {
  const { data: linesData } = useAdminLines(platformId);
  const { data: systemsData } = useAdminSystems(platformId);
  const mutation = useLineMutation();
  const importMut = useImport('lines', platformId);
  const exportUrl = useExportUrl('lines', platformId);

  const lines = linesData?.lines || linesData?.data || linesData || [];

  // Inline "+ Add" must supply a system; offer this platform's systems as a
  // dropdown since the API resolves system_code -> system_id.
  const systems = systemsData?.systems || systemsData?.data || systemsData || [];
  const editableColumns = useMemo(() => {
    const options = (Array.isArray(systems) ? systems : []).map(s => ({
      value: s.code,
      label: s.code ? `${s.code} — ${s.name || ''}`.trim().replace(/—\s*$/, '') : (s.name || ''),
    }));
    return COLUMNS.map(col =>
      col.key === 'system_code' ? { ...col, editable: true, type: 'select', options } : col
    );
  }, [systems]);

  // Errors propagate to EntityManager, which shows them in its banner.
  const handleAdd = async (item) => { await mutation.create({ ...item, platformId }); };
  const handleUpdate = async (id, item) => { await mutation.update(id, item); };
  const handleDelete = async (id) => { await mutation.remove(id); };
  const handleImport = async (csvText) => { await importMut.mutateAsync(csvText); };

  return (
    <EntityManager
      title="Line List"
      icon="route"
      accentHex="#FFB068"
      columns={editableColumns}
      columnGroups={COLUMN_GROUPS}
      data={Array.isArray(lines) ? lines : []}
      onAdd={handleAdd}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      onImport={handleImport}
      exportUrl={exportUrl}
    />
  );
}
