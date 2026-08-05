/**
 * Permission catalog for AssetView RBAC.
 * Admins receive all permissions. Other roles get a subset assigned by an admin.
 */
export const PERMISSIONS = [
  { key: 'admin.access', label: 'Admin Panel', group: 'Admin', description: 'Open the admin panel' },
  { key: 'users.manage', label: 'Users & Roles', group: 'Admin', description: 'Create and manage users and roles' },
  { key: 'hierarchy.manage', label: 'Hierarchy', group: 'Admin', description: 'Manage client → platform hierarchy' },
  { key: 'entities.manage', label: 'Entities', group: 'Admin', description: 'Manage systems, P&IDs, lines, equipment, instruments' },
  { key: 'storage.manage', label: 'Storage', group: 'Admin', description: 'Storage and AI provider settings' },
  { key: 'audit.view', label: 'Audit Log', group: 'Admin', description: 'View change history' },
  { key: 'import.manage', label: 'Import', group: 'Admin', description: 'Import CSV data' },
  { key: 'symbols.manage', label: 'Symbols', group: 'Admin', description: 'Manage P&ID symbol library' },
  { key: 'explorer.view', label: 'Asset Explorer', group: 'App', description: 'Browse platforms, systems, and registers' },
  { key: 'canvas.view', label: 'System Canvas', group: 'App', description: 'Open the topology canvas' },
  { key: 'pnid.view', label: 'P&ID Viewer', group: 'App', description: 'View P&ID drawings' },
  { key: 'annotations.edit', label: 'Annotations', group: 'App', description: 'Create and edit annotations' },
  { key: 'smart_annotation.use', label: 'Smart Annotation', group: 'App', description: 'Use Smart Identification / smart annotation on P&IDs' },
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export const ADMIN_ROLE_NAME = 'Admin';

export const DEFAULT_ROLES = [
  {
    name: ADMIN_ROLE_NAME,
    description: 'Full control — all permissions',
    permissions: ALL_PERMISSION_KEYS,
    is_system: true,
  },
  {
    name: 'Engineer',
    description: 'Explore assets, canvas, P&IDs, annotations, and smart annotation',
    permissions: [
      'explorer.view',
      'canvas.view',
      'pnid.view',
      'annotations.edit',
      'smart_annotation.use',
    ],
    is_system: true,
  },
  {
    name: 'Viewer',
    description: 'Read-only access to explorer, canvas, and P&IDs',
    permissions: ['explorer.view', 'canvas.view', 'pnid.view'],
    is_system: true,
  },
];

export function normalizePermissions(list) {
  if (!Array.isArray(list)) return [];
  const allowed = new Set(ALL_PERMISSION_KEYS);
  return [...new Set(list.filter((p) => typeof p === 'string' && allowed.has(p)))];
}

export function mergePermissions(rolePermissionLists) {
  const set = new Set();
  for (const list of rolePermissionLists) {
    for (const p of list || []) set.add(p);
  }
  return [...set];
}

export function hasPermission(userPermissions, required) {
  if (!required) return true;
  const perms = userPermissions || [];
  if (perms.includes('*')) return true;
  if (Array.isArray(required)) {
    return required.some((r) => perms.includes(r));
  }
  return perms.includes(required);
}
