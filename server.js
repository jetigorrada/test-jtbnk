const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Set APP_PIN in Coolify. If it is missing, a random PIN is generated and printed
// to the logs on startup, so the app never runs with a known default PIN.
const PIN = process.env.APP_PIN || String(crypto.randomInt(100000, 1000000));
if (!process.env.APP_PIN) {
  console.warn(`APP_PIN not set - generated PIN for this run: ${PIN}`);
}

// Persisted data lives here. On Coolify, mount a volume at /app/data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.jsonl');

const VIEWS_DIR = path.join(__dirname, 'views');

// --- Genesys AI pilot embed ---------------------------------------------------
// Genesys Cloud web messenger, deployment "AI Pilot Test". It routes to the
// "AI Pilot - Test" Architect flow, which calls the Laconics Bot Connector.
// The messenger only loads on domains allowed in
// Genesys Admin > Messenger Deployments > AI Pilot Test > Restrict domain access.
const GENESYS_ENV = process.env.GENESYS_ENV || 'prod-euc2';
const GENESYS_DEPLOYMENT_ID = process.env.GENESYS_DEPLOYMENT_ID || '47671ecb-4abb-4120-8a9d-b36bee0fdd61';
const GENESYS_BOOTSTRAP =
  process.env.GENESYS_BOOTSTRAP || 'https://apps.euc2.pure.cloud/genesys-bootstrap/genesys.min.js';

const DEFAULT_EMBED = {
  id: 'genesys-ai-pilot',
  name: 'AI Pilot - Genesys',
  mode: 'inline',
  code: `<script type="text/javascript" charset="utf-8">
  (function (g, e, n, es, ys) {
    g['_genesysJs'] = e;
    g[e] = g[e] || function () {
      (g[e].q = g[e].q || []).push(arguments)
    };
    g[e].t = 1 * new Date();
    g[e].c = es;
    ys = document.createElement('script'); ys.async = 1; ys.src = n; ys.charset = 'utf-8'; document.head.appendChild(ys);
  })(window, 'Genesys', '${GENESYS_BOOTSTRAP}', {
    environment: '${GENESYS_ENV}',
    deploymentId: '${GENESYS_DEPLOYMENT_ID}'
  });
</script>`,
};

// --- storage helpers -------------------------------------------------------
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ embeds: [DEFAULT_EMBED], activeId: DEFAULT_EMBED.id }, null, 2)
    );
  }
}

function readConfig() {
  ensureStore();
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const cfg = JSON.parse(raw);
    if (!Array.isArray(cfg.embeds)) cfg.embeds = [];
    if (typeof cfg.activeId === 'undefined') cfg.activeId = null;
    return cfg;
  } catch {
    return { embeds: [], activeId: null };
  }
}

function writeConfig(cfg) {
  ensureStore();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// Make sure the AI pilot embed exists, even on a volume created by an older
// version, and make it the active one if nothing else is selected.
function seedDefaultEmbed() {
  const cfg = readConfig();
  if (cfg.embeds.some((e) => e.id === DEFAULT_EMBED.id)) return;
  cfg.embeds.unshift(DEFAULT_EMBED);
  if (!cfg.activeId || !cfg.embeds.some((e) => e.id === cfg.activeId)) cfg.activeId = DEFAULT_EMBED.id;
  writeConfig(cfg);
}

// --- feedback log ----------------------------------------------------------
// One JSON object per line in /app/data/feedback.jsonl.
const VERDICTS = ['correct', 'partly', 'wrong', 'handover-ok', 'handover-missing', 'other'];

function clip(v, n) {
  return String(v == null ? '' : v).trim().slice(0, n);
}

function readFeedback() {
  ensureStore();
  if (!fs.existsSync(FEEDBACK_FILE)) return [];
  return fs
    .readFileSync(FEEDBACK_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// --- auth ------------------------------------------------------------------
// In-memory set of valid session tokens. Cleared on restart (users re-enter PIN).
const sessions = new Set();

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function isAuthed(req) {
  const token = req.cookies && req.cookies.session;
  return Boolean(token && sessions.has(token));
}

function requireAuthPage(req, res, next) {
  if (isAuthed(req)) return next();
  const next_ = encodeURIComponent(req.originalUrl);
  return res.redirect(`/login?next=${next_}`);
}

function requireAuthApi(req, res, next) {
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// --- middleware ------------------------------------------------------------
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

// --- auth routes -----------------------------------------------------------
app.get('/login', (req, res) => {
  if (isAuthed(req)) return res.redirect('/');
  res.sendFile(path.join(VIEWS_DIR, 'login.html'));
});

app.post('/api/login', (req, res) => {
  const pin = (req.body && req.body.pin ? String(req.body.pin) : '').trim();
  if (pin !== PIN) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  const token = newToken();
  sessions.add(token);
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: 1000 * 60 * 60 * 12, // 12h
    path: '/',
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies && req.cookies.session;
  if (token) sessions.delete(token);
  res.clearCookie('session', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authed: isAuthed(req) });
});

// --- embed data API --------------------------------------------------------
app.get('/api/embeds', requireAuthApi, (req, res) => {
  res.json(readConfig());
});

// Full config replace: { embeds: [...], activeId }
app.put('/api/embeds', requireAuthApi, (req, res) => {
  const body = req.body || {};
  const embeds = Array.isArray(body.embeds) ? body.embeds : [];
  const clean = embeds
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      id: String(e.id || crypto.randomBytes(6).toString('hex')),
      name: String(e.name || 'Untitled').slice(0, 120),
      mode: ['inline', 'sandbox', 'iframe-url', 'script-url'].includes(e.mode) ? e.mode : 'sandbox',
      code: String(e.code || ''),
    }));
  const ids = clean.map((e) => e.id);
  const activeId = ids.includes(body.activeId) ? body.activeId : (ids[0] || null);
  const cfg = { embeds: clean, activeId };
  writeConfig(cfg);
  res.json(cfg);
});

// --- feedback API ----------------------------------------------------------
app.post('/api/feedback', requireAuthApi, (req, res) => {
  const b = req.body || {};
  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    at: new Date().toISOString(),
    tester: clip(b.tester, 80),
    question: clip(b.question, 2000),
    answer: clip(b.answer, 4000),
    verdict: VERDICTS.includes(b.verdict) ? b.verdict : 'other',
    note: clip(b.note, 2000),
  };
  if (!entry.question && !entry.note) {
    return res.status(400).json({ error: 'Shkruani te pakten pyetjen ose nje shenim.' });
  }
  ensureStore();
  fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(entry) + '\n');
  res.json(entry);
});

app.get('/api/feedback', requireAuthApi, (req, res) => {
  res.json(readFeedback().reverse());
});

app.get('/api/feedback.csv', requireAuthApi, (req, res) => {
  const cols = ['at', 'tester', 'verdict', 'question', 'answer', 'note'];
  const rows = [cols.join(',')].concat(
    readFeedback().map((f) => cols.map((c) => csvCell(f[c])).join(','))
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ai-pilot-feedback.csv"');
  res.send('﻿' + rows.join('\r\n'));
});

// --- protected pages -------------------------------------------------------
app.get('/', requireAuthPage, (req, res) => {
  res.sendFile(path.join(VIEWS_DIR, 'index.html'));
});

// Hidden settings page (not linked anywhere in the UI).
app.get('/settings', requireAuthPage, (req, res) => {
  res.sendFile(path.join(VIEWS_DIR, 'settings.html'));
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  ensureStore();
  seedDefaultEmbed();
  console.log(`Embed tester running on port ${PORT}`);
});
