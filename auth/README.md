# Quarc Auth

The one login service shared by every Quarc app (Music, Notes, Weather, Translate,
Calendar, Store, and future apps), so **one account works everywhere**.

It used to live in the Quarc_Notes repo (v1); **this folder is now its only home**, since
Quarc Store is the primary source of identity for the suite.

Each app's own backend still verifies the JWT locally (same `JWT_SECRET`, no network
call per request). This service is only in the request path for `/api/auth/*`, which
every app's nginx proxies here.

## What v2 adds (fully backward compatible)

| Feature | Endpoint(s) |
|---|---|
| **Server-side sessions** — every login gets a session id (`sid` claim) so it can be revoked | — |
| See your logins (device, app, last active) | `GET /api/auth/sessions` |
| Sign out one login | `DELETE /api/auth/sessions/:id` |
| Sign out everywhere (optionally keeping this device) | `POST /api/auth/sessions/revoke-all` |
| **Quarc Store single sign-on** — the Store mints a session for another app on the same device; it's a *child* of the Store's session, so signing out of the Store signs those apps out too | `POST /api/auth/sso/token` |
| **User administration** for the whole suite | `GET/POST /api/auth/admin/users`, `PATCH/DELETE /api/auth/admin/users/:id`, `POST /api/auth/admin/users/:id/revoke-sessions`, `POST /api/auth/admin/users/:id/reset-password` (used by Quarc Music's admin page) |
| Find users by name — id + username only, any signed-in user (Quarc Music's friends search) | `GET /api/auth/users/search?q=` |
| Brute-force guard on login (10 failures / 15 min per IP+username) | — |
| `ALLOW_REGISTRATION=false` to close self sign-up | — |
| Optional `signOutOthers: true` on change-password | `POST /api/auth/change-password` |
| **Sign in with your phone** — a computer asks, Quarc Store on the phone approves by typing the shown number (one wrong number blocks it; 2-minute expiry; only Store sessions approve) | `POST /api/auth/approval/start`, `POST /api/auth/approval/poll`, `GET /api/auth/approval/pending`, `POST /api/auth/approval/:id/approve`, `POST /api/auth/approval/:id/deny` |
| **Nightly backup** of `auth.db` into `Quarc_Store/backups/nightly_YYYY-MM-DD/` (`BACKUP_HOUR_UTC`, `BACKUP_KEEP_DAYS`) | — |

Tokens issued by v1 (no `sid`) keep working until they expire, or until the user uses
"sign out everywhere" (which also cuts off old tokens via `users.tokens_valid_after`).

**When revocation takes effect:** apps verify JWTs locally, so a revoked session is
signed out the next time the app calls `GET /api/auth/me` — which every Quarc app's
`checkSession()` does on each launch (and on resume for apps with Store SSO).

## Run it

```bash
cd Quarc_Store/auth
cp .env.example .env          # set the SAME JWT_SECRET every Quarc app uses
docker network create quarcnet-shared   # once per server, if it doesn't exist
docker compose up -d --build
```

## Switching a server from the old v1 (one time)

The Docker volume is named after the folder (`auth` → `auth_auth_data`), so running from
`Quarc_Store/auth` reuses the exact same database — **no data migration**:

```bash
cp ~/Quarc_Notes/auth/.env ~/Quarc_Store/auth/.env    # same JWT_SECRET! (.env is untracked,
                                                      #  so it survives pulling Quarc_Notes)
docker stop quarc-auth && docker rm quarc-auth        # old container; the data volume stays
cd ~/Quarc_Store && bash deploy.sh auth               # schema upgrades itself on start
```

Lost the old `.env`? Every Quarc app's `.env` has the same `JWT_SECRET` — copy it from
any of them into `auth/.env` (starting from `.env.example`).

Nobody is logged out: v1 tokens stay valid, and the new tables/columns are added in place.

## Tests

```bash
npm install && npm test
```

## Importing Quarc Music's old users

See `migrate-from-music.js` (unchanged from v1). Run it against a **copy** of `music.db`:

```bash
npm install
node migrate-from-music.js /path/to/backup_YYYYMMDD_HHMMSS/music.db
```
