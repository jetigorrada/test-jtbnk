const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PIN = process.env.APP_PIN || '1211';

// Persisted data lives here. On Coolify, mount a volume at /app/data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const VIEWS_DIR = path.join(__dirname, 'views');

// --- storage helpers -------------------------------------------------------
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ embeds: [], activeId: null }, null, 2));
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
  console.log(`Embed tester running on port ${PORT}`);
});
