const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initDb, getDb } = require('./db');
const { startNightlyBackups } = require('./lib/nightlyBackup');
const authRoutes = require('./routes/auth');
const { router: sessionRoutes } = require('./routes/sessions');
const adminRoutes = require('./routes/admin');
const approvalRoutes = require('./routes/approval');
const { pruneSessions } = require('./lib/sessions');

const app = express();
const PORT = process.env.PORT || 3002;

// Behind each app's nginx; lets req.ip reflect X-Forwarded-For.
app.set('trust proxy', true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'quarc-auth', version: 2 }));
// Also reachable through every app's nginx (/api/auth/* is proxied here),
// so a client can tell whether the shared login supports v2 features.
app.get('/api/auth/health', (_req, res) => res.json({ ok: true, service: 'quarc-auth', version: 2 }));

app.use('/api/auth', authRoutes);
app.use('/api/auth', sessionRoutes);
app.use('/api/auth/admin', adminRoutes);
app.use('/api/auth/approval', approvalRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

initDb();
pruneSessions();
setInterval(pruneSessions, 24 * 60 * 60 * 1000).unref();

if (require.main === module) {
  // Every Quarc account lives in this one file — back it up every night.
  startNightlyBackups(getDb, 'auth.db');
  app.listen(PORT, () => {
    console.log(`Quarc Auth listening on :${PORT}`);
  });
}

module.exports = app;
