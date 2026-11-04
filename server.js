const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3456;
const PUBLIC_DIR = path.join(__dirname, 'public');
const EXPORTS_DIR = path.join(__dirname, 'exports');

if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // API: Convert WebM blob to YouTube-ready MP4 via local ffmpeg
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
        outMp4
      ]);

      let stderr = '';
      ff.stderr.on('data', (d) => { stderr += d.toString(); });

      ff.on('close', (code) => {
        try { fs.unlinkSync(tempWebm); } catch (e) {}
        if (code === 0 && fs.existsSync(outMp4)) {
          res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Disposition': `attachment; filename="${outMp4Name}"`,
            'X-Saved-Path': outMp4
          });
          fs.createReadStream(outMp4).pipe(res);
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'FFmpeg conversion failed', details: stderr.slice(-600) }));
        }
      });
    });
    return;
  }

  // API: List saved exports
  if (req.method === 'GET' && url.pathname === '/api/exports') {
    const files = fs.readdirSync(EXPORTS_DIR)
      .filter(f => f.endsWith('.mp4') || f.endsWith('.webm'))
      .map(f => {
        const full = path.join(EXPORTS_DIR, f);
        const stat = fs.statSync(full);
        return { name: f, path: full, size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ exportsDir: EXPORTS_DIR, files }));
    return;
  }

  // Serve exported file if requested
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

  // Static files in /public
  let safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '') safePath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Sticky Character Studio running at http://localhost:${PORT}`);
});
