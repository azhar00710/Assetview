import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authFetch, clearToken, getToken, setToken } from '../lib/authApi';

const AuthContext = createContext(null);

const BASE = '/api/v1';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const applySession = useCallback((token, nextUser) => {
    setToken(token);
    setUser(nextUser);
    setError(null);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const res = await authFetch(`${BASE}/auth/me`);
      if (!res.ok) {
        clearToken();
        setUser(null);
        setLoading(false);
        return null;
      }
      const data = await res.json();
      setUser(data.user);
      setLoading(false);
      return data.user;
    } catch {
      clearToken();
      setUser(null);
      setLoading(false);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
    };
    window.addEventListener('av:auth-expired', onExpired);
    return () => window.removeEventListener('av:auth-expired', onExpired);
  }, []);

  const login = useCallback(async (email, password) => {
    setError(null);
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || 'Login failed';
      setError(msg);
      throw new Error(msg);
    }
    applySession(data.token, data.user);
    return data.user;
  }, [applySession]);

  const hasPermission = useCallback((perm) => {
    if (!user?.permissions) return false;
    if (user.permissions.includes('*')) return true;
    if (Array.isArray(perm)) return perm.some((p) => user.permissions.includes(p));
    return user.permissions.includes(perm);
  }, [user]);

  const value = useMemo(() => ({
    user,
    loading,
    error,
    isAuthenticated: !!user,
    isAdmin: !!user?.isAdmin || hasPermission('admin.access'),
    login,
    logout,
    refreshMe,
    hasPermission,
  }), [user, loading, error, login, logout, refreshMe, hasPermission]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
