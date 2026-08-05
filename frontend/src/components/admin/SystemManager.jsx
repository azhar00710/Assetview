import { useAdminSystems, useSystemMutation, useImport, useExportUrl } from '../../hooks/useAdminApi';
import { SC } from '../../data/constants';
import EntityManager from './EntityManager';

const COLUMNS = [
  { key: 'code', label: 'Code', shortLabel: 'Code', editable: true, minWidth: 80 },
  { key: 'name', label: 'Name', shortLabel: 'Name', editable: true, minWidth: 160 },
  {
    key: 'sys_type',
    label: 'Type',
    shortLabel: 'Type',
    editable: true,
    type: 'select',
    options: [
      { value: 'process', label: 'Process' },
      { value: 'utility', label: 'Utility' },
      { value: 'safety', label: 'Safety' },
      { value: 'instrument', label: 'Instrument' },
    ],
    colorMap: SC,
    minWidth: 80,
  },
  { key: 'description', label: 'Description', shortLabel: 'Desc', editable: true, minWidth: 200 },
  { key: 'system_number', label: 'System Number', shortLabel: 'Sys No', editable: true, minWidth: 80 },
];

export default function SystemManager({ platformId }) {
  const { data: systemsData } = useAdminSystems(platformId);
  const mutation = useSystemMutation();
  const importMut = useImport('systems', platformId);
  const exportUrl = useExportUrl('systems', platformId);

  const systems = systemsData?.systems || systemsData?.data || systemsData || [];

  const handleAdd = async (item) => {
    try { await mutation.create({ ...item, platform_id: platformId }); } catch (err) { console.error('Failed to create system:', err); }
  };
  const handleUpdate = async (id, item) => {
    try { await mutation.update(id, item); } catch (err) { console.error('Failed to update system:', err); }
  };
  const handleDelete = async (id) => {
    try { await mutation.remove(id); } catch (err) { console.error('Failed to delete system:', err); }
  };
  const handleImport = async (csvText) => {
    try { await importMut.mutateAsync(csvText); } catch (err) { console.error('Failed to import systems:', err); }
  };

  return (
    <EntityManager
      title="Systems"
      icon="account_tree"
      accentHex="#4FE2B0"
      columns={COLUMNS}
      data={Array.isArray(systems) ? systems : []}
      onAdd={handleAdd}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      onImport={handleImport}
      exportUrl={exportUrl}
    />
  );
}
