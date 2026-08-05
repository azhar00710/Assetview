import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export default function LoginPage() {
  const { login, error } = useAuth();
  const { isDark } = useTheme();
  const [email, setEmail] = useState('admin@assetview.local');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setLocalError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const panel = 'var(--md-surface-container)';
  const inputBg = 'var(--md-surface-container-high)';
  const text = 'var(--md-on-surface)';
  const muted = 'var(--md-on-surface-variant)';
  const outline = 'var(--md-outline-variant)';
  const primary = 'var(--md-primary)';

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 font-sans"
      style={{
        background: isDark
          ? 'radial-gradient(1200px 600px at 20% -10%, rgba(79,226,176,0.12), transparent), radial-gradient(900px 500px at 90% 110%, rgba(138,180,255,0.10), transparent), var(--md-surface)'
          : 'radial-gradient(1200px 600px at 20% -10%, rgba(0,94,66,0.08), transparent), #F5F7F7',
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 shadow-xl"
        style={{ background: panel, border: `1px solid ${outline}` }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #4FE2B0, #8AB4FF)' }}
          >
            <span className="text-sm font-black text-[#0E1512]">G</span>
          </div>
          <div>
            <div className="text-[18px] font-bold tracking-tight" style={{ color: text }}>AssetView</div>
            <div className="text-[10px] font-semibold tracking-widest" style={{ color: primary }}>GEOSOFT</div>
          </div>
        </div>

        <h1 className="text-[15px] font-semibold mb-1" style={{ color: text }}>Sign in</h1>
        <p className="text-[12px] mb-6" style={{ color: muted }}>
          Email and password access. Admins manage users and roles in the Admin panel.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-[11px] font-medium mb-1.5 block" style={{ color: muted }}>Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none border"
              style={{ background: inputBg, borderColor: outline, color: text }}
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-medium mb-1.5 block" style={{ color: muted }}>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none border"
              style={{ background: inputBg, borderColor: outline, color: text }}
            />
          </label>

          {(localError || error) && (
            <div className="text-[12px] px-3 py-2 rounded-lg" style={{ color: 'var(--md-error)', background: 'rgba(255,137,122,0.12)' }}>
              {localError || error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg text-[13px] font-semibold cursor-pointer transition-opacity disabled:opacity-60"
            style={{ background: primary, color: '#0E1512' }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-[10px] leading-relaxed" style={{ color: muted }}>
          Default admin (first run): <span style={{ color: text }}>admin@assetview.local</span> / <span style={{ color: text }}>Admin@123</span>
        </p>
      </div>
    </div>
  );
}
