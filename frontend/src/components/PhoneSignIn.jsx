import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';
import { api } from '../lib/api';

// The computer side of "Sign in with your phone", for the Store's own web
// page. (Every other Quarc app gets the same flow from sso-kit's
// StoreLoginButton.)

export default function PhoneSignIn({ onSignedIn }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [request, setRequest] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | sending | waiting | denied | expired
  const [error, setError] = useState('');
  const timer = useRef(null);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
      clearTimeout(timer.current);
    },
    []
  );

  function reset() {
    clearTimeout(timer.current);
    setRequest(null);
    setStatus('idle');
    setError('');
  }

  async function poll(req) {
    try {
      const r = await api('/api/auth/approval/poll', { method: 'POST', body: { id: req.id, secret: req.secret } });
      if (r.status === 'approved') {
        await onSignedIn?.();
        return;
      }
      if (r.status === 'denied' || r.status === 'expired') {
        setStatus(r.status);
        return;
      }
    } catch {
      // keep trying until it expires
    }
    if (alive.current) timer.current = setTimeout(() => poll(req), 2000);
  }

  async function send(e) {
    e.preventDefault();
    setError('');
    setStatus('sending');
    try {
      const req = await api('/api/auth/approval/start', { method: 'POST', body: { username: username.trim() } });
      setRequest(req);
      setStatus('waiting');
      timer.current = setTimeout(() => poll(req), 2000);
    } catch (err) {
      setStatus('idle');
      setError(err.message);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn w-full rounded-lg border border-accent/50 py-2.5 text-accent hover:bg-accent-soft">
        <Smartphone size={16} /> {t('phone.button', 'Sign in with your phone')}
      </button>
    );
  }

  return (
    <div className="card p-5">
      {status === 'waiting' && request ? (
        <div className="text-center">
          <p className="text-sm text-zinc-400">{t('phone.enter', 'Open Quarc Store on your phone and enter this number:')}</p>
          <p className="my-3 text-5xl font-bold tracking-widest text-accent">{request.number}</p>
          <p className="text-xs text-zinc-500">{t('phone.waiting', 'Waiting for your phone…')}</p>
          <button type="button" onClick={reset} className="btn-ghost mt-2 text-xs">{t('action.cancel', 'Cancel')}</button>
        </div>
      ) : status === 'denied' || status === 'expired' ? (
        <div className="text-center">
          <p className="text-sm text-zinc-400">
            {status === 'denied' ? t('phone.denied', 'The request was declined on your phone.') : t('phone.expired', 'The request expired. Try again.')}
          </p>
          <button type="button" onClick={reset} className="btn-primary mt-3">{t('action.retry', 'Try again')}</button>
        </div>
      ) : (
        <form onSubmit={send} className="space-y-3">
          <p className="text-sm text-zinc-400">{t('phone.hint', 'Approve it in Quarc Store on your phone — no password needed.')}</p>
          <input className="input" placeholder={t('auth.username', 'Username')} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required />
          {error && <p className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>{t('action.cancel', 'Cancel')}</button>
            <button className="btn-primary" disabled={status === 'sending'}>{t('phone.send', 'Send to my phone')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
