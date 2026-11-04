#!/usr/bin/env node
// cli.js — Sticky Character Studio CLI Director (zero dependencies).
// Calls the same /api/rpc endpoints as the MCP server and starts server.js automatically.
const fs = require('fs');
const path = require('path');
const client = require('./lib/studioClient.js');

const HELP = `Sticky Character Studio — CLI Director

Usage: node cli.js <command> [args] [--flags]

  status                                       Studio status (mode, BPM, beats, scenes)
  get-project [out.json]                       Print (or save) the full project JSON
  set-project <file.json | '{...}'>            Push a full/partial storyboard  [--no-snap]
  update-scene <index|id> '<json>'             Patch one scene, e.g. '{"gesture":"heavy_sigh","hoodUp":true}'
  split <timeSec>                              Split the scene at timeSec       [--no-snap]
  load-audio <path> [--mode silent|voiceover]  Load a music / voiceover track → duration, BPM, beats
  import-photos <path...> [--auto-build]       Import background photos (Google Flow…) → lighting profiles
  template <loneliness_3am|social_anxiety|burnout|discipline> [--no-photos]
  add-fx <type> <timeSec> [--duration s] [--intensity n] [--text "..."]  Camera punch / SFX / card
  snapshot <timeSec> [out.png]                 Render the exact frame to a PNG
  export                                       Export the whole film to exports/*.mp4
  help

Environment: STICKY_PORT (default 3456), STICKY_BROWSER=auto|headless|open|none, STICKY_CHROME=/path/to/chrome`;

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && ['mode', 'duration', 'intensity', 'text', 'volume', 'dir', 'kind'].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

const absPath = (p) => path.resolve(process.cwd(), p.startsWith('~') ? p.replace(/^~/, require('os').homedir()) : p);

function readJsonArg(arg) {
  if (!arg) throw new Error('missing JSON argument');
  const t = arg.trim();
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  return JSON.parse(fs.readFileSync(absPath(t), 'utf8'));
}

const print = (obj) => console.log(JSON.stringify(obj, null, 2));
const info = (msg) => process.stderr.write(`${msg}\n`);

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const cmd = pos.shift();
  const call = async (action, params) => {
    const { result, via } = await client.rpc(action, params, info);
    if (via === 'server') info('(no studio tab connected — answered from projects/live_state.json)');
    return result;
  };

  switch (cmd) {
    case 'status':
      print(await call('get_status'));
      break;
    case 'get-project': {
      const p = await call('get_project');
      if (pos[0]) {
        fs.writeFileSync(absPath(pos[0]), JSON.stringify(p, null, 2));
        info(`saved ${absPath(pos[0])}`);
      } else print(p);
      break;
    }
    case 'set-project': {
      const project = readJsonArg(pos[0]);
      if (flags['no-snap']) project.snapToBeats = false;
      print(await call('set_project', project));
      break;
    }
    case 'update-scene': {
      if (pos[0] === undefined) throw new Error('usage: update-scene <index|id> \'{"emotion":"tired"}\'');
      const ref = /^\d+$/.test(pos[0]) ? Number(pos[0]) : pos[0];
      const updates = readJsonArg(pos[1]);
      print(await call('update_scene', typeof ref === 'number' ? { index: ref, updates } : { id: ref, updates }));
      break;
    }
    case 'split':
      print(await call('split_scene', { timeSec: Number(pos[0]), snapToBeat: !flags['no-snap'] }));
      break;
    case 'load-audio': {
      if (!pos[0]) throw new Error('usage: load-audio <path> [--mode silent|voiceover]');
      print(await call('load_audio_path', { path: absPath(pos[0]), mode: flags.mode }));
      break;
    }
    case 'import-photos': {
      if (!pos.length) throw new Error('usage: import-photos <path...> [--auto-build]');
      print(await call('import_photo_paths', { paths: pos.map(absPath), autoBuildScenes: !!flags['auto-build'] }));
      break;
    }
    case 'template': {
      if (!pos[0]) throw new Error('usage: template <loneliness_3am|social_anxiety|burnout|discipline>');
      const r = await call('apply_template', { template: pos[0], usePhotos: !flags['no-photos'] });
      print({ template: r.template, name: r.name, totalDuration: r.totalDuration, scenes: r.scenes.map((s) => `${s.index}. ${s.title} [${s.start}–${s.end}s] ${s.gesture} · ${s.emotion} · ${s.background} · ${s.transitionType}`), fxMarkers: r.fxMarkers });
      break;
    }
    case 'add-fx': {
      if (!pos[0] || pos[1] === undefined) throw new Error('usage: add-fx <type> <timeSec>');
      const params = { type: pos[0], timeSec: Number(pos[1]) };
      ['duration', 'intensity', 'volume', 'dir'].forEach((k) => { if (flags[k] !== undefined) params[k] = Number(flags[k]); });
      if (pos[0] === 'card') Object.assign(params, { kind: 'card', card: { kind: flags.kind || 'note', text: flags.text || '' } });
      print(await call('add_fx', params));
      break;
    }
    case 'snapshot': {
      const t = Number(pos[0]);
      if (!Number.isFinite(t)) throw new Error('usage: snapshot <timeSec> [out.png]');
      const r = await call('render_frame', { timeSec: t, outPath: pos[1] ? absPath(pos[1]) : undefined, gizmos: !!flags.gizmos });
      const { base64Png, ...summary } = r;
      print(summary);
      break;
    }
    case 'export': {
      info('Exporting… this records the film in real time, then encodes with FFmpeg.');
      print(await call('export_mp4'));
      break;
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command "${cmd}".\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
});
