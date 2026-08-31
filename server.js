/* Cube Pop — authoritative server (StarHermit game script).
 * Static hosting + same-origin API:
 *   GET  /api/v1/time                     → { now } (round-trip-adjusted by client)
 *   GET  /api/v1/daily/board?date=YYYY-MM-DD → ranked, server-validated entries
 *   POST /api/v1/daily/submit { name, date, envelope }
 *        Replays the input log through the bundled rules engine with the
 *        immutable daily seed; only exact-hash matches are ranked.
 * Node, no dependencies. Serves the distribution directory on port 8090.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8090;
const DATA_DIR = path.join(ROOT, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'daily-boards.json');

const Rules = require('./js/rules.js');
const Content = require('./js/content.js');
const RNG = require('./js/rng.js');

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml',
  '.opus': 'audio/ogg'
};
const MAX_BODY = 256 * 1024;
const MAX_NAME = 24;

// ---------- tiny JSON store ----------
function loadBoards() {
  try { return JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8')); }
  catch (e) { return { v: 1, days: {} }; }
}
function saveBoards(b) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = BOARD_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(b));
  fs.renameSync(tmp, BOARD_FILE);
}

// ---------- replay validation ----------
// Re-runs the envelope against the authoritative config. Returns
// { ok, score, moves, won, reason } or { ok:false, error }.
function validateDaily(date, envelope) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, error: 'missing envelope' };
  if (envelope.schema !== 1) return { ok: false, error: 'unsupported schema' };
  if (envelope.contentVersion !== Content.CONTENT_VERSION) return { ok: false, error: 'stale content version' };
  const cfg = Content.dailyConfig(date);
  if (envelope.cfgId !== cfg.id) return { ok: false, error: 'config mismatch' };
  if ((envelope.seed >>> 0) !== cfg.seed) return { ok: false, error: 'seed mismatch' };
  if (!Array.isArray(envelope.commands) || envelope.commands.length > 1000)
    return { ok: false, error: 'bad command log' };
  if (!envelope.result || typeof envelope.result.score !== 'object')
    return { ok: false, error: 'round not finished' };

  let state = Rules.createGame(cfg);
  if (Rules.hashState(state) !== envelope.initHash) return { ok: false, error: 'initial hash mismatch' };
  const seen = new Set();
  for (let i = 0; i < envelope.commands.length; i++) {
    const cmd = envelope.commands[i];
    const shapeErr = Rules.validateCommandShape(cmd);
    if (shapeErr) return { ok: false, error: 'malformed command at ' + i };
    if (cmd.id) { // idempotent duplicate rejection
      if (seen.has(cmd.id)) return { ok: false, error: 'duplicate command id' };
      seen.add(cmd.id);
    }
    const res = Rules.applyCommand(state, cmd);
    if (!res.ok) return { ok: false, error: 'illegal command at ' + i + ': ' + res.reason };
    state = res.state;
  }
  if (Rules.hashState(state) !== envelope.finalHash) return { ok: false, error: 'final hash mismatch' };
  if (!state.terminal) return { ok: false, error: 'no terminal state reached' };
  const claimed = envelope.result.score;
  if (claimed.total !== state.score.total) return { ok: false, error: 'score mismatch' };
  // plausibility: elapsed time must be physically possible for the move count
  if (state.elapsedMs < state.moves * 100) return { ok: false, error: 'implausibly fast' };
  return {
    ok: true, score: state.score.total, moves: state.moves,
    won: state.terminal.won, reason: state.terminal.reason,
    elapsedMs: state.elapsedMs, invalidCount: envelope.invalidCount | 0
  };
}

// Tie order: won, fewer invalid actions, lower elapsed, then stable entry id.
function rankEntries(entries) {
  return entries.slice().sort((a, b) =>
    (b.won - a.won) || (b.score - a.score) || (a.invalidCount - b.invalidCount) ||
    (a.elapsedMs - b.elapsedMs) || (a.entryId < b.entryId ? -1 : 1));
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > MAX_BODY) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const rateLog = new Map(); // ip → timestamps (crude in-memory rate limit)
function rateLimited(ip) {
  const now = Date.now();
  const arr = (rateLog.get(ip) || []).filter(t => now - t < 60000);
  if (arr.length >= 20) return true;
  arr.push(now);
  rateLog.set(ip, arr);
  return false;
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  let p;
  try { p = decodeURIComponent(url.split('?')[0]); } catch (e) { p = url.split('?')[0]; }
  const query = url.includes('?') ? new URLSearchParams(url.slice(url.indexOf('?') + 1)) : new URLSearchParams();

  // ---------- API ----------
  if (p === '/api/v1/time') {
    json(res, 200, { now: Date.now() });
    return;
  }
  if (p === '/api/v1/daily/board' && req.method === 'GET') {
    const date = query.get('date') || '';
    if (!DATE_RE.test(date)) { json(res, 400, { error: 'bad date' }); return; }
    const boards = loadBoards();
    const entries = rankEntries(((boards.days[date] || {}).entries) || [])
      .slice(0, 50)
      .map(e => ({ name: e.name, score: e.score, moves: e.moves, won: e.won }));
    json(res, 200, { date: date, contentVersion: Content.CONTENT_VERSION, entries: entries });
    return;
  }
  if (p === '/api/v1/daily/submit' && req.method === 'POST') {
    if (rateLimited(req.socket.remoteAddress || 'anon')) { json(res, 429, { error: 'rate limited' }); return; }
    readBody(req).then(body => {
      const name = String(body.name || "Guest").slice(0, MAX_NAME).replace(/[<>&"]/g, "") || "Guest";
      const date = String(body.date || '');
      if (!DATE_RE.test(date)) { json(res, 400, { error: 'bad date' }); return; }
      const today = Content.utcDateString(Date.now());
      if (date > today) { json(res, 400, { error: 'future date' }); return; }
      const v = validateDaily(date, body.envelope);
      if (!v.ok) { json(res, 422, { error: 'validation failed: ' + v.error }); return; }
      const boards = loadBoards();
      if (!boards.days[date]) boards.days[date] = { excluded: false, entries: [] };
      if (boards.days[date].excluded) { json(res, 409, { error: 'day excluded from ranking' }); return; }
      const entry = {
        entryId: RNG.hashString(name + '|' + date + '|' + body.envelope.finalHash).toString(36),
        name: name, score: v.score, moves: v.moves, won: v.won,
        elapsedMs: v.elapsedMs, invalidCount: v.invalidCount, at: Date.now()
      };
      // one entry per name per day (keep the best)
      const list = boards.days[date].entries.filter(e => e.name !== name);
      list.push(entry);
      boards.days[date].entries = rankEntries(list).slice(0, 100);
      saveBoards(boards);
      const rank = rankEntries(boards.days[date].entries).findIndex(e => e.entryId === entry.entryId) + 1;
      json(res, 200, { ok: true, score: v.score, rank: rank });
    }).catch(e => json(res, 400, { error: e.message }));
    return;
  }
  if (p.indexOf('/api/') === 0) { json(res, 404, { error: 'unknown endpoint' }); return; }

  // ---------- static ----------
  let rel = p;
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || file.indexOf(path.join(ROOT, 'data')) === 0) {
    res.writeHead(403); res.end(); return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
    return;
  }
  res.writeHead(404); res.end('not found: ' + p);
});

server.listen(PORT, () => { /* ready */ });

module.exports = server;
