// Public, read-only catalog. No login needed: browsing and installing apps
// works without an account — signing in to the Store is optional and only
// adds single sign-on for the other apps.

const express = require('express');
const router = express.Router();
const { buildCatalog, getApp, getRequirements } = require('../services/catalog');
const { refreshIfStale } = require('../services/github');

// Opening the Store or tapping "Check now" lands here: make sure a release
// published a minute ago shows up, instead of waiting for the next
// scheduled sync (every SYNC_INTERVAL_MINUTES).
router.get('/catalog', async (_req, res, next) => {
  try {
    await refreshIfStale();
    res.set('Cache-Control', 'no-cache');
    res.json(buildCatalog());
  } catch (err) {
    next(err);
  }
});

router.get('/apps/:id', (req, res) => {
  const app = getApp(req.params.id);
  if (!app) return res.status(404).json({ error: 'App not found' });
  res.json(app);
});

// Called by each Quarc app on launch (Android and desktop): "is my version
// still allowed?" — see sso-kit/web/RequiredUpdateGate.jsx. Deliberately
// never triggers a GitHub check: every app calls it on every launch.
router.get('/packages/:packageName', (req, res) => {
  const reqs = getRequirements(req.params.packageName);
  if (!reqs) return res.status(404).json({ error: 'Unknown app' });
  res.set('Cache-Control', 'no-cache');
  res.json(reqs);
});

module.exports = router;
