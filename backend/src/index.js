const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initDb, getDb } = require('./db');
const { startNightlyBackups } = require('./lib/nightlyBackup');
const { seed } = require('./seed');
const { startSyncLoop } = require('./services/github');
const catalogRoutes = require('./routes/catalog');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3007;

app.set('trust proxy', true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'quarc-store' }));
app.use('/api/store/admin', adminRoutes);
app.use('/api/store', catalogRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

initDb();
seed();

if (require.main === module) {
  if (process.env.DISABLE_SYNC !== 'true') startSyncLoop();
  startNightlyBackups(getDb, 'store.db');
  app.listen(PORT, () => console.log(`Quarc Store backend listening on :${PORT}`));
}

module.exports = app;
