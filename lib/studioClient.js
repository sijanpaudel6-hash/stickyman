// studioClient.js — Shared zero-dependency client for the MCP server and the CLI.
// Talks to server.js over HTTP and starts it in the background when it is not running.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.STICKY_PORT || process.env.PORT) || 3456;
const HOST = '127.0.0.1';

function request(method, pathname, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: HOST,
      port: PORT,
      method,
      path: pathname,
      headers: { Host: `localhost:${PORT}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request to ${pathname} timed out after ${Math.round(timeoutMs / 1000)}s`)));
    if (data) req.write(data);
    req.end();
  });
}

async function isUp() {
  try {
    const r = await request('GET', '/api/exports', undefined, 1500);
    return r.status === 200 && r.json && Array.isArray(r.json.files);
  } catch (e) {
    return false;
  }
}

let starting = null;

// Start `node server.js` detached (logs → projects/server.log) and wait until it answers.
async function ensureServer(log = () => {}) {
  if (await isUp()) return { started: false };
  if (!starting) {
    starting = (async () => {
      const logDir = path.join(ROOT, 'projects');
      fs.mkdirSync(logDir, { recursive: true });
      const out = fs.openSync(path.join(logDir, 'server.log'), 'a');
      const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
        cwd: ROOT,
        detached: true,
        stdio: ['ignore', out, out],
        env: { ...process.env, PORT: String(PORT) },
      });
      child.unref();
      log(`started studio server (pid ${child.pid}) on http://localhost:${PORT}`);
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 150));
        if (await isUp()) return { started: true, pid: child.pid };
      }
      throw new Error(`studio server did not start — see ${path.join(logDir, 'server.log')}`);
    })();
  }
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

// Client-side HTTP timeout per action (the server enforces its own, shorter browser timeouts)
function clientTimeout(action) {
  if (action === 'export_mp4') return 60 * 60 * 1000;
  if (['load_audio_path', 'import_photo_paths', 'render_frame', 'apply_template', 'set_project'].includes(action)) return 5 * 60 * 1000;
  return 2 * 60 * 1000;
}

async function rpc(action, params = {}, log) {
  await ensureServer(log);
  const r = await request('POST', '/api/rpc', { action, params }, clientTimeout(action));
  if (!r.json) throw new Error(`unexpected response from studio (HTTP ${r.status}): ${r.text.slice(0, 200)}`);
  if (!r.json.ok) throw new Error(r.json.error || 'studio returned an error');
  return { result: r.json.result, via: r.json.via };
}

module.exports = { ROOT, PORT, request, isUp, ensureServer, rpc };
