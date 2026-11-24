import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import useAuthStore from '../store/authStore';
import { isAndroid, isDesktop, isNative } from '../lib/native';
import PhoneSignIn from './PhoneSignIn';

export default function LoginForm({ onSuccess }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const isLogin = mode === 'login';

  function switchMode(m) {
    setMode(m);
    setError('');
    setPassword('');
    setConfirm('');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!isLogin) {
      if (password.length < 8) return setError(t('auth.passwordMinLength', 'Password must be at least 8 characters'));
      if (password !== confirm) return setError(t('auth.passwordsNoMatch', "Passwords don't match"));
    }
    setBusy(true);
    try {
      const user = isLogin ? await login(username.trim(), password) : await register(username.trim(), password);
      onSuccess?.(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-white">{isLogin ? t('auth.welcome', 'Sign in to Quarc') : t('auth.createTitle', 'Create your Quarc account')}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t('auth.oneAccount', 'One account for every Quarc app.')}</p>
      </div>

      {isNative() && (
        <div className="mb-4 flex gap-2.5 rounded-xl border border-accent/30 bg-accent-soft p-3 text-sm text-emerald-200">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" />
          <p>
            {isDesktop()
              ? t('auth.ssoHintPc', 'Signing in here signs you in to every Quarc app on this PC — no separate logins needed.')
              : t('auth.ssoHint', 'Signing in here signs you in to every Quarc app on this phone — no separate logins needed.')}
          </p>
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-xl bg-zinc-900 p-1">
        {['login', 'signup'].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${mode === m ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
          >
            {m === 'login' ? t('auth.signIn', 'Sign in') : t('auth.createAccount', 'Create account')}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="card space-y-4 p-5">
        <div>
          <label className="label">{t('auth.username', 'Username')}</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </div>
        <div>
          <label className="label">{t('auth.password', 'Password')}</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
          />
        </div>
        {!isLogin && (
          <div>
            <label className="label">{t('auth.confirmPassword', 'Confirm password')}</label>
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
        )}
        {error && <p className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full rounded-lg py-2.5">
          {busy ? t('auth.working', 'Please wait…') : isLogin ? t('auth.signIn', 'Sign in') : t('auth.createAccount', 'Create account')}
        </button>
      </form>
      {!isAndroid() && isLogin && (
        <div className="mt-4">
          <PhoneSignIn
            onSignedIn={async () => {
              await useAuthStore.getState().checkSession();
              onSuccess?.(useAuthStore.getState().user);
            }}
          />
        </div>
      )}
      <p className="mt-4 text-center text-xs text-zinc-600">{t('auth.sameAccount', 'Same username and password as Quarc Music, Notes and the other Quarc apps.')}</p>
    </div>
  );
}
