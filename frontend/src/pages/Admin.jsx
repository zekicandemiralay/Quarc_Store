import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserPlus, RefreshCw, Plus, AlertTriangle, CheckCircle2, EyeOff, Pencil } from 'lucide-react';
import useAuthStore from '../store/authStore';
import useCatalogStore from '../store/catalogStore';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { toast } from '../store/toastStore';
import Modal from '../components/Modal';
import AppIcon from '../components/AppIcon';

// ── Users ───────────────────────────────────────────────────────────────────

function UserEditor({ user, onClose, onSaved, me }) {
  const { t } = useTranslation();
  const creating = !user;
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(user?.role || 'user');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (creating) {
        await api('/api/auth/admin/users', { method: 'POST', body: { username, password, role } });
      } else {
        const body = {};
        if (username !== user.username) body.username = username;
        if (role !== user.role) body.role = role;
        if (password) body.password = password;
        if (Object.keys(body).length) await api(`/api/auth/admin/users/${user.id}`, { method: 'PATCH', body });
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={creating ? t('admin.newUser', 'New user') : t('admin.editUser', 'Edit {{name}}', { name: user.username })} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="label">{t('auth.username', 'Username')}</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required autoCapitalize="none" />
        </div>
        <div>
          <label className="label">{creating ? t('auth.password', 'Password') : t('admin.resetPassword', 'New password (leave empty to keep)')}</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={creating} autoComplete="new-password" />
          {!creating && user.id !== me.id && password && (
            <p className="mt-1 text-xs text-amber-300/80">{t('admin.resetSignsOut', 'Resetting the password signs this user out of every Quarc app.')}</p>
          )}
        </div>
        <div>
          <label className="label">{t('admin.role', 'Role')}</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">{t('admin.roleUser', 'User')}</option>
            <option value="admin">{t('admin.roleAdmin', 'Admin')}</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('action.cancel', 'Cancel')}</button>
          <button className="btn-primary" disabled={busy}>{t('action.save', 'Save')}</button>
        </div>
      </form>
    </Modal>
  );
}

function Users() {
  const { t } = useTranslation();
  const me = useAuthStore((s) => s.user);
  const [users, setUsers] = useState(null);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    api('/api/auth/admin/users')
      .then((r) => setUsers(Array.isArray(r) ? r : []))
      .catch((err) => {
        setUsers([]);
        toast(err.message, { tone: 'error' });
      });
  }, []);
  useEffect(load, [load]);

  async function act() {
    const { kind, user } = confirm;
    setConfirm(null);
    try {
      if (kind === 'delete') await api(`/api/auth/admin/users/${user.id}`, { method: 'DELETE' });
      else await api(`/api/auth/admin/users/${user.id}/revoke-sessions`, { method: 'POST' });
      toast(kind === 'delete' ? t('admin.deleted', 'User deleted') : t('admin.revoked', 'Signed out everywhere'), { tone: 'success' });
      load();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setEditing(null)}>
          <UserPlus size={14} /> {t('admin.newUser', 'New user')}
        </button>
      </div>
      {!users ? (
        <p className="text-sm text-zinc-500">{t('account.loadingSessions', 'Loading…')}</p>
      ) : (
        <div className="card divide-y divide-zinc-800">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 p-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold text-zinc-300">
                {u.username.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">
                  {u.username}
                  {u.role === 'admin' && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">ADMIN</span>}
                  {u.id === me.id && <span className="ml-1 text-xs text-zinc-500">({t('admin.you', 'you')})</span>}
                </p>
                <p className="text-xs text-zinc-500">
                  {t('admin.sessionsCount', '{{count}} active session(s)', { count: u.sessions })}
                  {u.lastSeenAt ? ` · ${timeAgo(u.lastSeenAt, t)}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setEditing(u)}>{t('action.edit', 'Edit')}</button>
                {u.id !== me.id && (
                  <>
                    <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setConfirm({ kind: 'revoke', user: u })}>{t('admin.signOut', 'Sign out')}</button>
                    <button className="btn-ghost px-2.5 py-1.5 text-xs text-red-400" onClick={() => setConfirm({ kind: 'delete', user: u })}>{t('action.delete', 'Delete')}</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing !== undefined && <UserEditor user={editing} me={me} onClose={() => setEditing(undefined)} onSaved={load} />}
      {confirm && (
        <Modal title={confirm.kind === 'delete' ? t('admin.deleteTitle', 'Delete {{name}}?', { name: confirm.user.username }) : t('admin.revokeTitle', 'Sign {{name}} out everywhere?', { name: confirm.user.username })} onClose={() => setConfirm(null)}>
          <p className="text-sm text-zinc-400">
            {confirm.kind === 'delete'
              ? t('admin.deleteBody', "They won't be able to sign in to any Quarc app. Their data inside each app (playlists, notes, …) is not deleted.")
              : t('admin.revokeBody', 'Every device and app they are signed in on will ask them to sign in again.')}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setConfirm(null)}>{t('action.cancel', 'Cancel')}</button>
            <button className="btn-danger" onClick={act}>{confirm.kind === 'delete' ? t('action.delete', 'Delete') : t('admin.signOut', 'Sign out')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Catalog ─────────────────────────────────────────────────────────────────

const fieldsFor = (t) => [
  ['name', t('admin.field.name', 'Name')],
  ['tagline', t('admin.field.tagline', 'Tagline')],
  ['description', t('admin.field.description', 'Description'), 'textarea'],
  ['repo', t('admin.field.repo', 'GitHub repo (owner/name)')],
  ['package_name', t('admin.field.package', 'Android package name')],
  ['web_url', t('admin.field.webUrl', 'Web app URL')],
  ['icon_url', t('admin.field.iconUrl', 'Icon URL')],
  ['accent', t('admin.field.accent', 'Colour (#rrggbb)')],
  ['sort_order', t('admin.field.sortOrder', 'Sort order'), 'number'],
  ['min_version', t('admin.field.minVersion', 'Minimum supported version (optional) — older installs must update, e.g. 1.2.0')],
  ['cert_sha256', t('admin.field.certs', 'Extra signing fingerprints (SHA-256, comma separated) — e.g. for debug builds'), 'textarea'],
];

function AppEditor({ app, onClose, onSaved }) {
  const { t } = useTranslation();
  const creating = !app;
  const [v, setV] = useState(() =>
    creating
      ? { id: '', name: '', tagline: '', description: '', repo: '', package_name: '', web_url: '', icon_url: '', accent: '#6366f1', sort_order: 100, min_version: '', cert_sha256: '', sso: true, hidden: false }
      : {
          name: app.name,
          tagline: app.tagline,
          description: app.description,
          repo: app.repo || '',
          package_name: app.packageName || '',
          web_url: app.webUrl || '',
          icon_url: app.iconUrl || '',
          accent: app.accent || '#6366f1',
          sort_order: app.admin.sortOrder,
          min_version: app.minVersion || '',
          cert_sha256: app.admin.certOverride || '',
          sso: app.admin.sso,
          hidden: app.admin.hidden,
        }
  );
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...v, sort_order: Number(v.sort_order) };
      if (creating) await api('/api/store/admin/apps', { method: 'POST', body });
      else await api(`/api/store/admin/apps/${app.id}`, { method: 'PATCH', body });
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(t('admin.removeApp', 'Remove {{name}} from the Store?', { name: app.name }))) return;
    try {
      await api(`/api/store/admin/apps/${app.id}`, { method: 'DELETE' });
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  }

  return (
    <Modal wide title={creating ? t('admin.addApp', 'Add app') : app.name} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        {creating && (
          <div>
            <label className="label">{t('admin.appId', 'Id (lowercase, e.g. "photos")')}</label>
            <input className="input" value={v.id} onChange={set('id')} required />
          </div>
        )}
        {fieldsFor(t).map(([k, label, type]) => (
          <div key={k}>
            <label className="label">{label}</label>
            {type === 'textarea' ? (
              <textarea className="input min-h-[70px]" value={v[k] ?? ''} onChange={set(k)} />
            ) : (
              <input className="input" type={type || 'text'} value={v[k] ?? ''} onChange={set(k)} required={k === 'name' || k === 'package_name'} />
            )}
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={!!v.sso} onChange={set('sso')} className="accent-emerald-600" />
          {t('admin.field.sso', 'Can receive the Quarc Store login (single sign-on)')}
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={!!v.hidden} onChange={set('hidden')} className="accent-emerald-600" />
          {t('admin.field.hidden', 'Hidden from the Store')}
        </label>
        {!creating && app.certSha256?.length > 0 && (
          <div className="rounded-lg bg-zinc-800/60 p-2.5">
            <p className="text-xs text-zinc-400">{t('admin.trustedCerts', 'Signing fingerprints trusted for single sign-on:')}</p>
            {app.certSha256.map((c) => (
              <p key={c} className="mt-1 break-all font-mono text-[10px] text-zinc-500">{c}</p>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pt-2">
          {!creating ? <button type="button" className="btn-danger" onClick={remove}>{t('action.delete', 'Delete')}</button> : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>{t('action.cancel', 'Cancel')}</button>
            <button className="btn-primary" disabled={busy}>{t('action.save', 'Save')}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function Catalog() {
  const { t } = useTranslation();
  const reloadPublic = useCatalogStore((s) => s.load);
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(undefined);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    api('/api/store/admin/apps')
      .then(setData)
      .catch((err) => toast(err.message, { tone: 'error' }));
  }, []);
  useEffect(load, [load]);

  async function refresh() {
    setSyncing(true);
    try {
      setData(await api('/api/store/admin/refresh', { method: 'POST', timeout: 90000 }));
      reloadPublic();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setSyncing(false);
    }
  }

  const saved = () => {
    load();
    reloadPublic();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">{data?.syncedAt ? t('updates.checked', 'Checked {{when}}', { when: timeAgo(data.syncedAt, t) }) : ''}</p>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={refresh} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {t('admin.syncNow', 'Sync releases')}
          </button>
          <button className="btn-primary" onClick={() => setEditing(null)}>
            <Plus size={14} /> {t('admin.addApp', 'Add app')}
          </button>
        </div>
      </div>
      {!data ? (
        <p className="text-sm text-zinc-500">{t('account.loadingSessions', 'Loading…')}</p>
      ) : (
        <div className="card divide-y divide-zinc-800">
          {data.apps.map((a) => {
            const problem = a.admin.lastError || (a.sso && a.packageName && !a.certSha256.length ? a.admin.certError || t('admin.noCert', 'No signing fingerprint yet — single sign-on is off for this app') : null);
            return (
              <button key={a.id} onClick={() => setEditing(a)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-zinc-800/40">
                <AppIcon app={a} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-zinc-100">
                    {a.name} {a.admin.hidden && <EyeOff size={12} className="text-zinc-500" />}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {a.latest ? `v${a.latest.version}` : t('admin.noRelease', 'no release')}
                    {a.minVersion ? ` · ${t('admin.minShort', 'requires ≥ v{{v}}', { v: a.minVersion })}` : ''} · {a.repo || '—'}
                  </p>
                  {problem ? (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-400"><AlertTriangle size={11} /> {problem}</p>
                  ) : a.sso ? (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-400/80"><CheckCircle2 size={11} /> {t('admin.ssoReady', 'Single sign-on ready')}</p>
                  ) : null}
                </div>
                <Pencil size={14} className="shrink-0 text-zinc-600" />
              </button>
            );
          })}
        </div>
      )}
      {editing !== undefined && <AppEditor app={editing} onClose={() => setEditing(undefined)} onSaved={saved} />}
    </div>
  );
}

export default function Admin() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState('users');
  if (!user) return <Navigate to="/account" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white">{t('nav.admin', 'Admin')}</h1>
      <div className="flex gap-1 rounded-xl bg-zinc-900 p-1">
        {[
          ['users', t('admin.users', 'Users')],
          ['catalog', t('admin.catalog', 'Catalog')],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-lg py-2 text-sm font-medium ${tab === k ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'users' ? <Users /> : <Catalog />}
    </div>
  );
}
