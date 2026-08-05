import { useMemo, useState } from 'react';
import {
  useAdminUsers,
  useAdminRoles,
  useAdminPermissions,
  useAccessScopes,
  useUserMutation,
  useRoleMutation,
} from '../../hooks/useAdminApi';

const emptyUserForm = {
  email: '',
  displayName: '',
  password: '',
  roleIds: [],
  isActive: true,
  projectIds: [],
  locationIds: [],
};

const emptyRoleForm = {
  name: '',
  description: '',
  permissions: [],
};

export default function AccessControlManager() {
  const [tab, setTab] = useState('users');
  const [userForm, setUserForm] = useState(null);
  const [roleForm, setRoleForm] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  const { data: usersData, isLoading: usersLoading } = useAdminUsers({ q: search || undefined });
  const { data: rolesData, isLoading: rolesLoading } = useAdminRoles();
  const { data: permData } = useAdminPermissions();
  const { data: scopeData } = useAccessScopes();
  const userMut = useUserMutation();
  const roleMut = useRoleMutation();

  const users = usersData?.users || [];
  const roles = rolesData?.roles || [];
  const permissions = permData?.permissions || [];
  const allProjects = scopeData?.projects || [];
  const allLocations = scopeData?.locations || [];

  const permGroups = useMemo(() => {
    const groups = {};
    for (const p of permissions) {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    }
    return groups;
  }, [permissions]);

  const openCreateUser = () => {
    setError(null);
    setUserForm({ mode: 'create', ...emptyUserForm });
  };

  const openEditUser = (u) => {
    setError(null);
    setUserForm({
      mode: 'edit',
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      password: '',
      roleIds: u.roleIds || [],
      isActive: u.isActive,
      projectIds: u.projectIds || [],
      locationIds: u.locationIds || [],
    });
  };

  const openCreateRole = () => {
    setError(null);
    setRoleForm({ mode: 'create', ...emptyRoleForm });
  };

  const openEditRole = (r) => {
    setError(null);
    setRoleForm({
      mode: 'edit',
      id: r.id,
      name: r.name,
      description: r.description || '',
      permissions: [...(r.permissions || [])],
      isSystem: r.isSystem,
    });
  };

  const saveUser = async () => {
    setError(null);
    try {
      const scopePayload = {
        projectIds: userForm.projectIds,
        locationIds: userForm.locationIds,
      };
      if (userForm.mode === 'create') {
        await userMut.create({
          email: userForm.email,
          displayName: userForm.displayName,
          password: userForm.password,
          roleIds: userForm.roleIds,
          isActive: userForm.isActive,
          ...scopePayload,
        });
      } else {
        const payload = {
          email: userForm.email,
          displayName: userForm.displayName,
          roleIds: userForm.roleIds,
          isActive: userForm.isActive,
          ...scopePayload,
        };
        if (userForm.password) payload.password = userForm.password;
        await userMut.update(userForm.id, payload);
      }
      setUserForm(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const saveRole = async () => {
    setError(null);
    try {
      if (roleForm.mode === 'create') {
        await roleMut.create({
          name: roleForm.name,
          description: roleForm.description,
          permissions: roleForm.permissions,
        });
      } else {
        await roleMut.update(roleForm.id, {
          name: roleForm.isSystem ? undefined : roleForm.name,
          description: roleForm.description,
          permissions: roleForm.permissions,
        });
      }
      setRoleForm(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleRolePerm = (key) => {
    setRoleForm((prev) => {
      const has = prev.permissions.includes(key);
      return {
        ...prev,
        permissions: has
          ? prev.permissions.filter((p) => p !== key)
          : [...prev.permissions, key],
      };
    });
  };

  const toggleUserRole = (roleId) => {
    setUserForm((prev) => {
      const has = prev.roleIds.includes(roleId);
      return {
        ...prev,
        roleIds: has
          ? prev.roleIds.filter((id) => id !== roleId)
          : [...prev.roleIds, roleId],
      };
    });
  };

  const toggleId = (field, id) => {
    setUserForm((prev) => {
      const list = prev[field] || [];
      const has = list.includes(id);
      return {
        ...prev,
        [field]: has ? list.filter((x) => x !== id) : [...list, id],
      };
    });
  };

  const scopeSummary = (u) => {
    if (u.accessAll) return 'All projects & locations';
    const parts = [];
    if (u.projects?.length) parts.push(`${u.projects.length} project(s)`);
    if (u.locations?.length) parts.push(`${u.locations.length} location(s)`);
    return parts.join(', ') || 'Restricted';
  };

  const inputStyle = {
    background: 'var(--md-surface-container-high)',
    border: '1px solid var(--md-outline-variant)',
    color: 'var(--md-on-surface)',
  };

  const chipBtn = (on) => ({
    color: on ? 'var(--md-primary)' : 'var(--md-on-surface-variant)',
    background: on ? 'var(--md-primary-container)' : 'var(--md-surface-container-high)',
    border: `1px solid ${on ? 'transparent' : 'var(--md-outline-variant)'}`,
  });

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-[13px] font-bold" style={{ color: 'var(--md-on-surface)' }}>
          Access Control
        </h2>
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: 'var(--md-surface-container)' }}>
          {['users', 'roles'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setUserForm(null); setRoleForm(null); setError(null); }}
              className="px-3 py-1.5 rounded-md text-[11px] font-medium cursor-pointer"
              style={{
                color: tab === t ? 'var(--md-primary)' : 'var(--md-on-surface-variant)',
                background: tab === t ? 'var(--md-primary-container)' : 'transparent',
              }}
            >
              {t === 'users' ? 'Users' : 'Roles'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {tab === 'users' && (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users…"
              className="px-2.5 py-1.5 rounded-lg text-[11px] outline-none w-48"
              style={inputStyle}
            />
            <button
              type="button"
              onClick={openCreateUser}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer"
              style={{ background: 'var(--md-primary)', color: '#0E1512' }}
            >
              + New User
            </button>
          </>
        )}
        {tab === 'roles' && (
          <button
            type="button"
            onClick={openCreateRole}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer"
            style={{ background: 'var(--md-primary)', color: '#0E1512' }}
          >
            + New Role
          </button>
        )}
      </div>

      {error && (
        <div className="text-[12px] px-3 py-2 rounded-lg" style={{ color: 'var(--md-error)', background: 'rgba(255,137,122,0.12)' }}>
          {error}
        </div>
      )}

      {tab === 'users' && !userForm && (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--md-outline-variant)' }}>
          <table className="w-full text-left">
            <thead style={{ background: 'var(--md-surface-container)' }}>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--md-on-surface-variant)' }}>
                <th className="px-3 py-2 font-semibold">User</th>
                <th className="px-3 py-2 font-semibold">Roles</th>
                <th className="px-3 py-2 font-semibold">Access scope</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Last login</th>
                <th className="px-3 py-2 font-semibold w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersLoading && (
                <tr><td colSpan={6} className="px-3 py-6 text-[12px] text-center" style={{ color: 'var(--md-on-surface-variant)' }}>Loading…</td></tr>
              )}
              {!usersLoading && users.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-[12px] text-center" style={{ color: 'var(--md-on-surface-variant)' }}>No users found</td></tr>
              )}
              {users.map((u) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--md-outline-variant)' }}>
                  <td className="px-3 py-2.5">
                    <div className="text-[12px] font-medium" style={{ color: 'var(--md-on-surface)' }}>{u.displayName}</div>
                    <div className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>{u.email}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(u.roles || []).map((r) => (
                        <span
                          key={r.id}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--md-primary-container)', color: 'var(--md-primary)' }}
                        >
                          {r.name}
                        </span>
                      ))}
                      {!u.roles?.length && (
                        <span className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                    {scopeSummary(u)}
                  </td>
                  <td className="px-3 py-2.5 text-[11px]" style={{ color: u.isActive ? 'var(--md-primary)' : 'var(--md-error)' }}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </td>
                  <td className="px-3 py-2.5 text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-2">
                      <button type="button" onClick={() => openEditUser(u)} className="text-[11px] cursor-pointer" style={{ color: 'var(--md-secondary)' }}>Edit</button>
                      <button
                        type="button"
                        className="text-[11px] cursor-pointer"
                        style={{ color: 'var(--md-error)' }}
                        onClick={async () => {
                          if (!window.confirm(`Delete user ${u.email}?`)) return;
                          try {
                            await userMut.remove(u.id);
                          } catch (err) {
                            setError(err.message);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'users' && userForm && (
        <div className="rounded-xl p-4 max-w-2xl space-y-3" style={{ background: 'var(--md-surface-container)', border: '1px solid var(--md-outline-variant)' }}>
          <h3 className="text-[12px] font-semibold" style={{ color: 'var(--md-on-surface)' }}>
            {userForm.mode === 'create' ? 'Create user' : 'Edit user'}
          </h3>
          <label className="block">
            <span className="text-[10px] mb-1 block" style={{ color: 'var(--md-on-surface-variant)' }}>Display name</span>
            <input className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none" style={inputStyle}
              value={userForm.displayName} onChange={(e) => setUserForm({ ...userForm, displayName: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-[10px] mb-1 block" style={{ color: 'var(--md-on-surface-variant)' }}>Email</span>
            <input type="email" className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none" style={inputStyle}
              value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-[10px] mb-1 block" style={{ color: 'var(--md-on-surface-variant)' }}>
              Password {userForm.mode === 'edit' ? '(leave blank to keep)' : ''}
            </span>
            <input type="password" className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none" style={inputStyle}
              value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
          </label>
          <div>
            <span className="text-[10px] mb-1.5 block" style={{ color: 'var(--md-on-surface-variant)' }}>Roles</span>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => {
                const on = userForm.roleIds.includes(r.id);
                return (
                  <button key={r.id} type="button" onClick={() => toggleUserRole(r.id)}
                    className="px-2.5 py-1 rounded-lg text-[11px] cursor-pointer" style={chipBtn(on)}>
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-1 space-y-2">
            <div className="text-[11px] font-semibold" style={{ color: 'var(--md-on-surface)' }}>
              Project & location access
            </div>
            <p className="text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>
              Leave both empty for access to all projects and locations. Selecting any project or location restricts the user to platforms under that scope.
            </p>
            {(userForm.projectIds.length > 0 || userForm.locationIds.length > 0) && (
              <button
                type="button"
                className="text-[10px] cursor-pointer underline"
                style={{ color: 'var(--md-secondary)' }}
                onClick={() => setUserForm({ ...userForm, projectIds: [], locationIds: [] })}
              >
                Clear scope (grant all access)
              </button>
            )}
            <div>
              <span className="text-[10px] mb-1.5 block" style={{ color: 'var(--md-on-surface-variant)' }}>Projects</span>
              <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                {allProjects.length === 0 && (
                  <span className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>No projects in hierarchy</span>
                )}
                {allProjects.map((p) => {
                  const on = userForm.projectIds.includes(p.id);
                  return (
                    <button key={p.id} type="button" onClick={() => toggleId('projectIds', p.id)}
                      className="px-2.5 py-1 rounded-lg text-[11px] cursor-pointer" style={chipBtn(on)} title={p.name}>
                      {p.code}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="text-[10px] mb-1.5 block" style={{ color: 'var(--md-on-surface-variant)' }}>Locations</span>
              <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                {allLocations.length === 0 && (
                  <span className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>No locations in hierarchy</span>
                )}
                {allLocations.map((l) => {
                  const on = userForm.locationIds.includes(l.id);
                  return (
                    <button key={l.id} type="button" onClick={() => toggleId('locationIds', l.id)}
                      className="px-2.5 py-1 rounded-lg text-[11px] cursor-pointer" style={chipBtn(on)} title={l.name}>
                      {l.projectCode ? `${l.projectCode} / ${l.code}` : l.code}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: 'var(--md-on-surface)' }}>
            <input type="checkbox" checked={userForm.isActive} onChange={(e) => setUserForm({ ...userForm, isActive: e.target.checked })} />
            Active
          </label>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={saveUser} disabled={userMut.isLoading}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer"
              style={{ background: 'var(--md-primary)', color: '#0E1512' }}>
              Save
            </button>
            <button type="button" onClick={() => setUserForm(null)}
              className="px-3 py-1.5 rounded-lg text-[11px] cursor-pointer"
              style={{ color: 'var(--md-on-surface-variant)', background: 'var(--md-surface-container-high)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {tab === 'roles' && !roleForm && (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--md-outline-variant)' }}>
          <table className="w-full text-left">
            <thead style={{ background: 'var(--md-surface-container)' }}>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--md-on-surface-variant)' }}>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Permissions</th>
                <th className="px-3 py-2 font-semibold">Users</th>
                <th className="px-3 py-2 font-semibold w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rolesLoading && (
                <tr><td colSpan={4} className="px-3 py-6 text-[12px] text-center" style={{ color: 'var(--md-on-surface-variant)' }}>Loading…</td></tr>
              )}
              {roles.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--md-outline-variant)' }}>
                  <td className="px-3 py-2.5">
                    <div className="text-[12px] font-medium" style={{ color: 'var(--md-on-surface)' }}>
                      {r.name}
                      {r.isSystem && (
                        <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(138,180,255,0.15)', color: 'var(--md-secondary)' }}>
                          system
                        </span>
                      )}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>{r.description || '—'}</div>
                  </td>
                  <td className="px-3 py-2.5 text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                    {(r.permissions || []).length} permission{(r.permissions || []).length === 1 ? '' : 's'}
                  </td>
                  <td className="px-3 py-2.5 text-[11px]" style={{ color: 'var(--md-on-surface)' }}>{r.userCount}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-2">
                      <button type="button" onClick={() => openEditRole(r)} className="text-[11px] cursor-pointer" style={{ color: 'var(--md-secondary)' }}>Edit</button>
                      {!r.isSystem && (
                        <button
                          type="button"
                          className="text-[11px] cursor-pointer"
                          style={{ color: 'var(--md-error)' }}
                          onClick={async () => {
                            if (!window.confirm(`Delete role ${r.name}?`)) return;
                            try {
                              await roleMut.remove(r.id);
                            } catch (err) {
                              setError(err.message);
                            }
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'roles' && roleForm && (
        <div className="rounded-xl p-4 max-w-2xl space-y-3" style={{ background: 'var(--md-surface-container)', border: '1px solid var(--md-outline-variant)' }}>
          <h3 className="text-[12px] font-semibold" style={{ color: 'var(--md-on-surface)' }}>
            {roleForm.mode === 'create' ? 'Create role' : `Edit role — ${roleForm.name}`}
          </h3>
          {!roleForm.isSystem && (
            <label className="block">
              <span className="text-[10px] mb-1 block" style={{ color: 'var(--md-on-surface-variant)' }}>Name</span>
              <input className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none" style={inputStyle}
                value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} />
            </label>
          )}
          <label className="block">
            <span className="text-[10px] mb-1 block" style={{ color: 'var(--md-on-surface-variant)' }}>Description</span>
            <input className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none" style={inputStyle}
              value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} />
          </label>
          <div>
            <span className="text-[10px] mb-2 block" style={{ color: 'var(--md-on-surface-variant)' }}>Permissions</span>
            {roleForm.name === 'Admin' && (
              <p className="text-[11px] mb-2" style={{ color: 'var(--md-secondary)' }}>
                Admin always retains full control. Permission list is kept in sync with the catalog.
              </p>
            )}
            <div className="space-y-3">
              {Object.entries(permGroups).map(([group, perms]) => (
                <div key={group}>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--md-on-surface-variant)' }}>{group}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {perms.map((p) => {
                      const on = roleForm.permissions.includes(p.key);
                      const locked = roleForm.name === 'Admin';
                      return (
                        <label
                          key={p.key}
                          className={`flex items-start gap-2 px-2.5 py-2 rounded-lg text-[11px] ${locked ? 'opacity-70' : 'cursor-pointer'}`}
                          style={{ background: 'var(--md-surface-container-high)' }}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={on || locked}
                            disabled={locked}
                            onChange={() => toggleRolePerm(p.key)}
                          />
                          <span>
                            <span className="font-medium block" style={{ color: 'var(--md-on-surface)' }}>{p.label}</span>
                            <span style={{ color: 'var(--md-on-surface-variant)' }}>{p.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={saveRole} disabled={roleMut.isLoading}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer"
              style={{ background: 'var(--md-primary)', color: '#0E1512' }}>
              Save
            </button>
            <button type="button" onClick={() => setRoleForm(null)}
              className="px-3 py-1.5 rounded-lg text-[11px] cursor-pointer"
              style={{ color: 'var(--md-on-surface-variant)', background: 'var(--md-surface-container-high)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
