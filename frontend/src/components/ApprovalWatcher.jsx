import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MonitorSmartphone } from 'lucide-react';
import useAuthStore from '../store/authStore';
import { api } from '../lib/api';
import { isNative } from '../lib/native';
import { toast } from '../store/toastStore';
import Modal from './Modal';

// The phone side of "Sign in with your phone": while Quarc Store is open on
// Android and signed in, it checks for sign-in requests from computers and
// asks the user to type the number that computer shows. (Only a Quarc Store
// session can approve — see auth/src/routes/approval.js.)

export default function ApprovalWatcher() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [requests, setRequests] = useState([]);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNative() || !user) return undefined;
    let stopped = false;
    let timer;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const list = await api('/api/auth/approval/pending', { timeout: 8000 });
          if (!stopped) setRequests(Array.isArray(list) ? list : []);
        } catch {
          // offline / server hiccup: try again next tick
        }
      }
      if (!stopped) timer = setTimeout(tick, 4000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [user]);

  const current = requests[0];
  if (!current) return null;

  function done() {
    setNumber('');
    setRequests((list) => list.filter((r) => r.id !== current.id));
  }

  async function approve(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/auth/approval/${current.id}/approve`, { method: 'POST', body: { number: Number(number) } });
      toast(t('approval.approved', 'Signed in on {{device}}', { device: current.device || t('account.unknownDevice', 'Unknown device') }), { tone: 'success' });
    } catch (err) {
      toast(err.message, { tone: 'error', ms: 6000 });
    } finally {
      setBusy(false);
      done();
    }
  }

  async function deny() {
    setBusy(true);
    try {
      await api(`/api/auth/approval/${current.id}/deny`, { method: 'POST', body: {} });
    } catch {
      // expired anyway
    } finally {
      setBusy(false);
      done();
    }
  }

  return (
    <Modal title={t('approval.title', 'Sign-in request')} onClose={deny}>
      <form onSubmit={approve} className="space-y-4">
        <div className="flex gap-3">
          <MonitorSmartphone size={22} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-sm text-zinc-300">
            {t('approval.body', '{{app}} on {{device}} wants to sign in as {{user}}.', {
              app: current.client && current.client !== 'web' ? current.client : t('approval.aQuarcApp', 'A Quarc app'),
              device: current.device || t('account.unknownDevice', 'Unknown device'),
              user: user.username,
            })}
          </p>
        </div>
        <div>
          <label className="label">{t('approval.enterNumber', 'Enter the number shown on that screen')}</label>
          <input
            className="input text-center text-2xl font-bold tracking-widest"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))}
            autoFocus
            required
          />
        </div>
        <p className="text-xs text-zinc-500">{t('approval.notYou', "Didn't try to sign in? Tap Deny — your password stays safe.")}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={deny} disabled={busy}>
            {t('approval.deny', 'Deny')}
          </button>
          <button className="btn-primary" disabled={busy || number.length !== 2}>
            {t('approval.approve', 'Approve')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
