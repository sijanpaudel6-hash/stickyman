// server.js — Sticky Character Studio local server (zero npm dependencies).
//
//   Static studio UI ............................ GET  /                     (public/)
//   WebM → MP4 (FFmpeg) ......................... POST /api/convert-mp4
//   Saved exports ............................... GET  /api/exports, /exports/<file>
//   v4 Agent bridge:
//     Persistent project state .................. GET/POST /api/state      (projects/live_state.json)
//     Local disk asset streaming ................ GET  /api/local-file?path=/abs/path (audio/image/video, Range)
//     Browser RPC channel (Server-Sent Events) .. GET  /api/bridge/events
//     Browser RPC replies ....................... POST /api/bridge/reply
//     Agent RPC (MCP server / CLI) .............. POST /api/rpc {action, params}
//     Bridge diagnostics ........................ GET  /api/bridge/status
//
// Security: the server binds to 127.0.0.1 by default (set HOST=0.0.0.0 to expose it on your LAN) and
// every /api route rejects cross-site browser requests, so other websites cannot read local files or
// drive the studio through your browser.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Schema = require('./public/projectSchema.js');

const PORT = Number(process.env.PORT) || 3456;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const EXPORTS_DIR = path.join(__dirname, 'exports');
const PROJECTS_DIR = path.join(__dirname, 'projects');
const STATE_FILE = path.join(PROJECTS_DIR, 'live_state.json');
const STUDIO_URL = `http://localhost:${PORT}/`;
const BROWSER_WAIT_MS = Number(process.env.STICKY_BROWSER_WAIT_MS) || 8000;

[EXPORTS_DIR, PROJECTS_DIR].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};

// Media types the agent may stream from disk into the studio
const LOCAL_FILE_TYPES = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov']);

// Actions understood by the browser bridge, and those the server can answer with no browser connected
const ACTIONS = ['get_status', 'get_project', 'set_project', 'update_scene', 'split_scene', 'load_audio_path',
  'import_photo_paths', 'apply_template', 'add_fx', 'render_frame', 'export_mp4'];
const OFFLINE_ACTIONS = new Set(['get_status', 'get_project', 'set_project', 'update_scene']);

const log = (...a) => console.log(`[studio ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------------------------------------------------------------------------------------------
// Persistent project state
// ---------------------------------------------------------------------------------------------
let state = { version: 4, updatedAt: 0, source: 'none', project: null };
try {
  if (fs.existsSync(STATE_FILE)) state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
} catch (e) {
  log('could not read live_state.json:', e.message);
}

function saveState(project, source) {
  // Keep a one-step backup when the stored project is replaced from a different source
  if (state.project && state.source !== source) {
    try { fs.writeFileSync(path.join(PROJECTS_DIR, 'live_state.prev.json'), JSON.stringify(state, null, 2)); } catch (e) { /* ignore */ }
  }
  state = { version: 4, updatedAt: Date.now(), source, project };
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 80 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
function hostnameOf(h) {
  if (!h) return '';
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

// Block DNS-rebinding and cross-site requests on every API route.
function isTrustedRequest(req) {
  const exposed = HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1';
  if (!exposed && !LOCAL_HOSTS.has(hostnameOf(req.headers.host))) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (!exposed && !LOCAL_HOSTS.has(o.hostname)) return false;
      if (Number(o.port || 80) !== PORT) return false;
    } catch (e) {
      return false;
    }
  }
  return true;
}

function expandPath(p) {
  if (!p) return '';
  let s = String(p).trim();
  if (s.startsWith('file://')) s = decodeURIComponent(new URL(s).pathname);
  if (s === '~' || s.startsWith('~/')) s = path.join(os.homedir(), s.slice(1));
  return s;
}

// ---------------------------------------------------------------------------------------------
// Browser bridge (SSE clients + pending RPC requests)
// ---------------------------------------------------------------------------------------------
const clients = new Map();          // id → { id, res, connectedAt, userAgent }
const pending = new Map();          // reqId → { resolve, reject, timer, clientId, action }
let clientSeq = 0;
let reqSeq = 0;
let launch = { at: 0, proc: null, how: null };
const clientWaiters = new Set();

function activeClient() {
  let best = null;
  for (const c of clients.values()) if (!best || c.connectedAt > best.connectedAt) best = c;
  return best;
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function waitForClient(ms) {
  if (activeClient()) return Promise.resolve(activeClient());
  return new Promise((resolve) => {
    const done = (c) => {
      clearTimeout(timer);
      clientWaiters.delete(done);
      resolve(c);
    };
    const timer = setTimeout(() => done(null), ms);
    clientWaiters.add(done);
  });
}

function findChrome() {
  const candidates = [
    process.env.STICKY_CHROME,
    '/opt/pw-browsers/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

// Open the studio so canvas-dependent RPCs can run. STICKY_BROWSER = auto | headless | open | none
function launchBrowser() {
  // Don't double-launch: a headless browser we started is still running (it may still be connecting),
  // or a desktop tab was opened moments ago.
  if (launch.proc && launch.proc.exitCode === null && launch.proc.signalCode === null) return launch.how;
  if (!launch.proc && launch.how && launch.how.startsWith('opened') && Date.now() - launch.at < 15000) return launch.how;
  const mode = (process.env.STICKY_BROWSER || 'auto').toLowerCase();
  if (mode === 'none') return null;
  const hasDisplay = process.platform === 'darwin' || process.platform === 'win32' || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
  launch.at = Date.now();
  if (mode === 'open' || (mode === 'auto' && hasDisplay)) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', STUDIO_URL] : [STUDIO_URL];
    try {
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      p.on('error', () => {});
      p.unref();
      launch.how = `opened ${STUDIO_URL} in the default browser`;
      log(launch.how);
      return launch.how;
    } catch (e) {
      if (mode === 'open') return null;
    }
  }
  const chrome = findChrome();
  if (!chrome) {
    launch.how = null;
    return null;
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sticky-chrome-'));
  const args = ['--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-domain-reliability', '--no-pings', '--metrics-recording-only',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--window-size=1600,1000', STUDIO_URL];
  if (typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox');
  try {
    const p = spawn(chrome, args, { stdio: 'ignore', detached: false });
    p.on('error', (e) => log('headless browser error:', e.message));
    p.on('exit', () => { if (launch.proc === p) launch.proc = null; });
    launch.proc = p;
    launch.how = `started headless browser (${path.basename(chrome)})`;
    log(launch.how);
    return launch.how;
  } catch (e) {
    launch.how = null;
    return null;
  }
}

function timeoutFor(action) {
  if (action === 'export_mp4') {
    const total = (state.project && Number(state.project.totalDuration)) || 60;
    return Math.max(5 * 60 * 1000, (total * 3 + 120) * 1000);
  }
  if (action === 'load_audio_path' || action === 'import_photo_paths') return 120 * 1000;
  if (action === 'render_frame' || action === 'apply_template' || action === 'set_project') return 90 * 1000;
  return 45 * 1000;
}

function dispatchToBrowser(client, action, params) {
  const reqId = `r${Date.now().toString(36)}_${++reqSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error(`browser did not answer "${action}" within ${Math.round(timeoutFor(action) / 1000)}s`));
    }, timeoutFor(action));
    pending.set(reqId, { resolve, reject, timer, clientId: client.id, action });
    sseSend(client.res, 'rpc', { reqId, action, params: params || {} });
  });
}

function offlineRpc(action, params) {
  const project = state.project || { scenes: [] };
  switch (action) {
    case 'get_status': {
      const audio = project.audio || {};
      return {
        connected: false,
        note: 'No studio browser tab is connected; values come from projects/live_state.json. Canvas actions will auto-launch the studio.',
        mode: project.mode || 'voiceover',
        aspectRatio: project.aspectRatio || '16:9',
        totalDuration: project.totalDuration || 0,
        currentTime: project.currentTime || 0,
        bpm: audio.bpm || 0,
        beatCount: (audio.beats || []).length,
        audio: audio.fileName ? { fileName: audio.fileName, path: audio.path, duration: audio.duration } : null,
        sceneCount: (project.scenes || []).length,
        scenes: (project.scenes || []).map((s, i) => ({ index: i, id: s.id, title: s.title, start: s.start, end: s.end, emotion: s.emotion, gesture: s.gesture, view: s.view, background: s.background })),
        stateUpdatedAt: state.updatedAt,
      };
    }
    case 'get_project':
      return { connected: false, ...project };
    case 'set_project': {
      const r = Schema.offlineSetProject(project, params || {});
      saveState(r.project, 'server');
      return { connected: false, applied: 'saved to live_state.json — the studio loads it when it connects', sceneCount: (r.project.scenes || []).length, warnings: r.warnings, scenes: r.project.scenes };
    }
    case 'update_scene': {
      const ref = params.index ?? params.id;
      const r = Schema.offlineUpdateScene(project, ref, params.updates || params.props || params.scene || {});
      if (r.error) throw new Error(r.error);
      saveState(r.project, 'server');
      return { connected: false, scene: r.scene, warnings: r.warnings };
    }
    default:
      throw new Error(`"${action}" needs the studio canvas`);
  }
}

async function handleRpc(action, params) {
  if (!ACTIONS.includes(action)) throw new Error(`unknown action "${action}". Valid: ${ACTIONS.join(', ')}`);
  let client = activeClient();
  if (!client && OFFLINE_ACTIONS.has(action)) return { via: 'server', result: offlineRpc(action, params) };
  if (!client) {
    const how = launchBrowser();
    client = await waitForClient(how ? BROWSER_WAIT_MS + (how.startsWith('started') ? 4000 : 0) : 200);
    if (!client) {
      throw new Error(`No studio browser is connected and none could be started${how ? ` (${how}, but it did not connect in time)` : ''}. Open ${STUDIO_URL} in a browser (or set STICKY_BROWSER=headless and STICKY_CHROME=/path/to/chrome).`);
    }
  }
  const result = await dispatchToBrowser(client, action, params);
  if (action === 'render_frame' && result && result.base64Png) {
    const file = (params && params.outPath) ? expandPath(params.outPath) : path.join(os.tmpdir(), `sticky_frame_${Date.now()}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(result.base64Png, 'base64'));
    result.imagePath = file;
  }
  if (action === 'export_mp4' && result && result.mp4Path && fs.existsSync(result.mp4Path)) {
    result.sizeBytes = fs.statSync(result.mp4Path).size;
  }
  return { via: 'browser', result };
}

// ---------------------------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/') && !isTrustedRequest(req)) {
    sendJson(res, 403, { error: 'Cross-site or non-local requests are not allowed.' });
    return;
  }

  try {
    // ---- API: Convert WebM blob to YouTube-ready MP4 via local ffmpeg ----
    if (req.method === 'POST' && url.pathname === '/api/convert-mp4') {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const tempWebm = path.join(EXPORTS_DIR, `temp_${timestamp}.webm`);
      const outMp4Name = `sticky_video_${timestamp}.mp4`;
      const outMp4 = path.join(EXPORTS_DIR, outMp4Name);

      const writeStream = fs.createWriteStream(tempWebm);
      req.pipe(writeStream);

      writeStream.on('finish', () => {
        const ff = spawn('ffmpeg', [
          '-y',
          '-i', tempWebm,
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '18',
          '-pix_fmt', 'yuv420p',
          '-r', '60',                 // constant 60 fps (MediaRecorder WebM is variable-frame-rate)
          '-movflags', '+faststart',
          '-c:a', 'aac',
          '-b:a', '192k',
          outMp4,
        ]);

        let stderr = '';
        ff.stderr.on('data', (d) => { stderr += d.toString(); });
        ff.on('error', (e) => { stderr += `\n${e.message}`; });

        ff.on('close', (code) => {
          try { fs.unlinkSync(tempWebm); } catch (e) { /* ignore */ }
          if (code === 0 && fs.existsSync(outMp4)) {
            res.writeHead(200, {
              'Content-Type': 'video/mp4',
              'Content-Disposition': `attachment; filename="${outMp4Name}"`,
              'X-Saved-Path': outMp4,
              'Access-Control-Expose-Headers': 'X-Saved-Path',
            });
            fs.createReadStream(outMp4).pipe(res);
          } else {
            sendJson(res, 500, { error: 'FFmpeg conversion failed', details: stderr.slice(-600) });
          }
        });
      });
      return;
    }

    // ---- API: List saved exports (also used as the health check) ----
    if (req.method === 'GET' && url.pathname === '/api/exports') {
      const files = fs.readdirSync(EXPORTS_DIR)
        .filter((f) => f.endsWith('.mp4') || f.endsWith('.webm'))
        .map((f) => {
          const full = path.join(EXPORTS_DIR, f);
          const stat = fs.statSync(full);
          return { name: f, path: full, size: stat.size, mtime: stat.mtime };
        })
        .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
      sendJson(res, 200, { exportsDir: EXPORTS_DIR, files, studio: 'sticky-character-studio', bridgeClients: clients.size });
      return;
    }

    // ---- v4: persistent project state ----
    if (url.pathname === '/api/state') {
      if (req.method === 'GET') {
        sendJson(res, 200, state);
        return;
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        if (!body || typeof body.project !== 'object') {
          sendJson(res, 400, { error: 'expected { project }' });
          return;
        }
        saveState(body.project, body.source || 'browser');
        sendJson(res, 200, { ok: true, updatedAt: state.updatedAt });
        return;
      }
    }

    // ---- v4: stream a local media file from disk into the studio ----
    if (req.method === 'GET' && url.pathname === '/api/local-file') {
      const file = expandPath(url.searchParams.get('path'));
      if (!file || !path.isAbsolute(file)) {
        sendJson(res, 400, { error: 'path must be an absolute file path' });
        return;
      }
      const ext = path.extname(file).toLowerCase();
      if (!LOCAL_FILE_TYPES.has(ext)) {
        sendJson(res, 403, { error: `file type "${ext}" is not allowed (audio, image or video only)` });
        return;
      }
      let st;
      try {
        st = fs.statSync(file);
      } catch (e) {
        sendJson(res, 404, { error: `not found: ${file}` });
        return;
      }
      if (!st.isFile()) {
        sendJson(res, 400, { error: 'not a file' });
        return;
      }
      const type = MIME_TYPES[ext] || 'application/octet-stream';
      const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
        if (start >= st.size || start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
          res.end();
          return;
        }
        res.writeHead(206, {
          'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Cache-Control': 'no-cache',
        });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
        fs.createReadStream(file).pipe(res);
      }
      return;
    }

    // ---- v4: Server-Sent Events channel to the studio tab ----
    if (req.method === 'GET' && url.pathname === '/api/bridge/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const client = { id: `c${++clientSeq}`, res, connectedAt: Date.now(), userAgent: req.headers['user-agent'] || '' };
      clients.set(client.id, client);
      sseSend(res, 'hello', { clientId: client.id, state });
      log(`bridge client ${client.id} connected (${clients.size} total)`);
      const hb = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(hb);
        clients.delete(client.id);
        for (const [id, p] of pending) {
          if (p.clientId === client.id) {
            clearTimeout(p.timer);
            pending.delete(id);
            p.reject(new Error(`studio tab disconnected while running "${p.action}"`));
          }
        }
        log(`bridge client ${client.id} disconnected (${clients.size} left)`);
      });
      for (const w of [...clientWaiters]) w(client);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/bridge/reply') {
      const body = await readJson(req);
      const p = pending.get(body.reqId);
      if (!p) {
        sendJson(res, 404, { error: 'unknown or expired reqId' });
        return;
      }
      clearTimeout(p.timer);
      pending.delete(body.reqId);
      if (body.ok) p.resolve(body.result);
      else p.reject(new Error(body.error || 'browser reported an error'));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/bridge/status') {
      sendJson(res, 200, {
        clients: [...clients.values()].map((c) => ({ id: c.id, connectedAt: c.connectedAt, userAgent: c.userAgent })),
        pending: [...pending.values()].map((p) => p.action),
        stateUpdatedAt: state.updatedAt,
        stateSource: state.source,
        launched: launch.how,
      });
      return;
    }

    // ---- v4: agent RPC (MCP server / CLI) ----
    if (req.method === 'POST' && url.pathname === '/api/rpc') {
      let body;
      try {
        body = await readJson(req);
      } catch (e) {
        sendJson(res, 400, { ok: false, error: `invalid JSON: ${e.message}` });
        return;
      }
      try {
        const out = await handleRpc(String(body.action || ''), body.params || {});
        sendJson(res, 200, { ok: true, action: body.action, via: out.via, result: out.result });
      } catch (e) {
        sendJson(res, 200, { ok: false, action: body.action, error: e.message });
      }
      return;
    }

    // ---- Serve exported file ----
    if (req.method === 'GET' && url.pathname.startsWith('/exports/')) {
      const fname = path.basename(url.pathname);
      const fpath = path.join(EXPORTS_DIR, fname);
      if (fs.existsSync(fpath)) {
        const ext = path.extname(fpath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(fpath).pipe(res);
        return;
      }
    }

    // ---- Static files in /public ----
    let safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (safePath === '/' || safePath === '' || safePath === path.sep) safePath = '/index.html';
    const filePath = path.join(PUBLIC_DIR, safePath);
    if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  } catch (e) {
    log('request error:', e.message);
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
    else res.end();
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use — is the studio already running?`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Sticky Character Studio running at http://localhost:${PORT} (bound to ${HOST})`);
});

const shutdown = () => {
  if (launch.proc) {
    try { launch.proc.kill(); } catch (e) { /* ignore */ }
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
