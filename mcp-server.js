#!/usr/bin/env node
// mcp-server.js — Model Context Protocol (stdio, JSON-RPC 2.0) server for Sticky Character Studio.
// Zero dependencies. Lets Claude Code / Antigravity direct, inspect and export films.
//
//   Register: .mcp.json in this repo ({ "mcpServers": { "sticky-studio": { "command": "node", "args": ["mcp-server.js"] } } })
//   Transport: newline-delimited JSON-RPC messages on stdin/stdout. Logs go to stderr only.
//   The studio server (server.js) is started automatically when it is not running.
const path = require('path');
const readline = require('readline');
const Schema = require('./public/projectSchema.js');
const client = require('./lib/studioClient.js');

const SERVER_INFO = { name: 'sticky-studio', title: 'Sticky Character Studio', version: '4.0.0' };
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const log = (...a) => process.stderr.write(`[sticky-mcp] ${a.join(' ')}\n`);

const INSTRUCTIONS = [
  'Sticky Character Studio: an animation + silent-film engine with a rigged hoodie character.',
  'Typical flow: sticky_load_audio (music → BPM/beats) → sticky_import_photos (lighting profiles) →',
  'sticky_set_project (scenes cut on beats) → sticky_render_frame at 2–3 key times to check framing/light/captions →',
  'sticky_update_scene to fix → sticky_export_mp4. Always pass ABSOLUTE file paths. See CLAUDE.md for every valid ID.',
].join(' ');

// ---------- JSON Schemas ----------
const I = Schema.IDS;
const sceneSchema = {
  type: 'object',
  description: 'A scene in flat agent format. Omitted keys keep defaults (set_project) or current values (update_scene).',
  properties: {
    title: { type: 'string' },
    start: { type: 'number', description: 'Seconds. If start/end are omitted on every scene they are laid out automatically.' },
    end: { type: 'number' },
    duration: { type: 'number', description: 'Seconds (alternative to start/end; set_project only)' },
    weight: { type: 'number', description: 'Relative length when auto-laid-out (default 1)' },
    emotion: { type: 'string', enum: I.emotions },
    pose: { type: 'string', enum: I.poses, description: '"rig" = articulated body (default). Others are flat v1 sprites.' },
    view: { type: 'string', enum: I.views },
    gesture: { type: 'string', enum: I.gestures },
    handLeft: { type: 'string', enum: I.handStates },
    handRight: { type: 'string', enum: I.handStates },
    prop: { type: 'string', enum: I.props },
    walkSpeed: { type: 'number', minimum: 0, maximum: 2.5, description: '0 idle, 0.1–1 walk, 1.1–2.5 jog→sprint' },
    walkDir: { type: 'string', enum: ['left', 'right'] },
    walkInPlace: { type: 'boolean', description: 'false = translate across the screen' },
    hoodUp: { type: 'boolean' },
    wind: { type: 'number', minimum: 0, maximum: 1 },
    silentMouth: { type: 'string', enum: I.silentMouths },
    background: { type: 'string', description: `Built-in id (${I.backgrounds.join(', ')}), an imported photo bgId, or an absolute photo path (imported automatically)` },
    kenBurns: { type: 'string', enum: I.kenBurns },
    foreground: { type: 'string', enum: I.foregrounds },
    transitionType: { type: 'string', enum: I.transitions, description: 'How this scene ENTERS' },
    transitionDur: { type: 'number', minimum: 0, maximum: 2 },
    transitionSfx: { type: 'string', enum: ['none', ...I.sfx] },
    ambientBed: { type: 'string', enum: I.ambientBeds },
    ambientVol: { type: 'number', minimum: 0, maximum: 1 },
    lightMatch: {
      description: 'true (recommended for photos), false, 0..1 strength, or {tint, rim, exposure: 0..1, side: auto|left|right|back}',
      anyOf: [{ type: 'boolean' }, { type: 'number' }, { type: 'object', properties: { tint: { type: 'number' }, rim: { type: 'number' }, exposure: { type: 'number' }, side: { type: 'string', enum: ['auto', 'left', 'right', 'back'] } } }],
    },
    x: { type: 'number', description: 'Horizontal position 0..1 (0.5 = centre)' },
    y: { type: 'number', description: 'Vertical body-centre 0..1 (0.55 typical; larger = lower)' },
    scale: { type: 'number', description: '1 = default size (0.4–3)' },
    flipX: { type: 'boolean' },
    spineLean: { type: 'number', description: 'degrees (-25..25)' },
    headTilt: { type: 'number', description: 'degrees (-30..30)' },
    headNod: { type: 'number', description: 'degrees (-25..25), + = look down' },
    ikPins: { type: 'object', description: '{ rightHand|leftHand|rightFoot|leftFoot|head: {x, y} } in rig units, or {} to clear' },
    subtitle: { type: 'string', description: 'On-screen caption for this scene' },
    captionStyle: { description: 'Project-wide caption style: mode string or {mode, highlight, position, chunk, uppercase, size}', anyOf: [{ type: 'string', enum: I.captionModes }, { type: 'object' }] },
    dutchScene: { type: 'boolean' },
    spotlightScene: { type: 'boolean' },
    motion: { type: 'string', enum: I.motions },
    camera: { type: 'string', enum: I.cameras },
    atmosphere: { type: 'string', enum: I.atmospheres },
    foley: { type: 'boolean', description: 'Auto footsteps / sigh breaths (default on in silent mode)' },
  },
  additionalProperties: false,
};

const fxMarkerSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: [...I.cameraFx, ...I.sfx] },
    timeSec: { type: 'number' },
    duration: { type: 'number', description: 'camera punches only' },
    intensity: { type: 'number', description: 'camera punches only (0..3, default 1)' },
    dir: { type: 'number', enum: [-1, 1], description: 'dutch tilt direction' },
    volume: { type: 'number', description: 'sfx only (0..3)' },
  },
  required: ['type', 'timeSec'],
};

const cardSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: I.cardKinds },
    text: { type: 'string', description: 'meme: "TOP | BOTTOM"' },
    title: { type: 'string' },
    imagePath: { type: 'string', description: 'absolute image path (image/meme/post cards)' },
    side: { type: 'string', enum: ['auto', 'left', 'right'] },
    hold: { type: 'number', description: 'seconds on screen (0 = until scene end)' },
    size: { type: 'number', description: 'fraction of frame width (0.15–0.6)' },
  },
};

const TOOLS = [
  {
    name: 'sticky_status',
    title: 'Studio status',
    description: 'Studio status: mode (silent/voiceover), aspect ratio, duration, audio BPM & beat count, connected browser, scene summary.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    action: 'get_status',
  },
  {
    name: 'sticky_get_project',
    title: 'Get project',
    description: 'Full project JSON in flat agent format: every scene (all settable keys), FX markers, media cards, caption style, audio beats (beats/strongBeats), imported photo backgrounds with lighting profiles.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    action: 'get_project',
  },
  {
    name: 'sticky_load_audio',
    title: 'Load audio track',
    description: 'Load a local audio file (.mp3/.wav/.ogg/.m4a) as the music (silent film) or voiceover track. Returns duration, BPM and beat timestamps (beats, strongBeats) for cutting scenes on the music.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the audio file' },
        mode: { type: 'string', enum: I.modes, description: 'silent = music only, never lip-syncs (default keeps current mode)' },
      },
      required: ['path'],
    },
    action: 'load_audio_path',
    map: (a) => ({ path: abs(a.path), mode: a.mode }),
  },
  {
    name: 'sticky_import_photos',
    title: 'Import photos',
    description: 'Import local photos/clips (e.g. Google Flow images) as backgrounds. Returns each bgId with a lighting profile (tone warm/cool, brightness, light direction, key colour). autoBuildScenes=true spreads them across the music, cutting on beats.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths, in story order' },
        autoBuildScenes: { type: 'boolean', default: false },
      },
      required: ['paths'],
    },
    action: 'import_photo_paths',
    map: (a) => ({ paths: (a.paths || []).map(abs), autoBuildScenes: !!a.autoBuildScenes }),
  },
  {
    name: 'sticky_apply_template',
    title: 'Apply silent film template',
    description: 'Load a ready-made silent film storyboard fitted to the current audio length (cuts on beats) and, by default, the imported photos.',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', enum: I.templates },
        usePhotos: { type: 'boolean', default: true },
        photoPaths: { type: 'array', items: { type: 'string' }, description: 'Optional photos (absolute paths) in scene order' },
      },
      required: ['template'],
    },
    action: 'apply_template',
    map: (a) => ({ template: a.template, usePhotos: a.usePhotos, photoPaths: a.photoPaths ? a.photoPaths.map(abs) : undefined }),
  },
  {
    name: 'sticky_set_project',
    title: 'Set project / storyboard',
    description: 'Push a full or partial storyboard. Only the top-level keys you include are applied. Scenes without start/end are laid out over the audio length (use duration/weight) and cuts snap to beats unless snapToBeats=false.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: I.modes },
        aspectRatio: { type: 'string', enum: I.aspectRatios },
        fadeOutEnd: { description: 'true or seconds of fade-to-black at the end', anyOf: [{ type: 'boolean' }, { type: 'number' }] },
        masterAmbientVol: { type: 'number', minimum: 0, maximum: 1 },
        captionStyle: sceneSchema.properties.captionStyle,
        totalDuration: { type: 'number', description: 'Only needed without an audio track' },
        snapToBeats: { type: 'boolean', default: true },
        scenes: { type: 'array', items: sceneSchema },
        fxMarkers: { type: 'array', items: fxMarkerSchema },
        mediaCards: { type: 'array', items: { ...cardSchema, properties: { ...cardSchema.properties, sceneIndex: { type: 'integer' }, timeSec: { type: 'number' }, appear: { type: 'number', description: 'seconds after the scene starts' } } } },
      },
    },
    action: 'set_project',
    map: (a) => ({ ...a, scenes: a.scenes && a.scenes.map(absScene) }),
  },
  {
    name: 'sticky_update_scene',
    title: 'Update scene',
    description: 'Change any properties of one scene (by 0-based index or id): emotion, gesture, view, walkSpeed, ikPins, hoodUp, wind, background, kenBurns, lightMatch, transition, ambient bed, subtitle, position… Returns the updated scene and validation warnings.',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: '0-based scene index' },
        id: { type: 'string', description: 'scene id (alternative to index)' },
        updates: sceneSchema,
      },
      required: ['updates'],
    },
    action: 'update_scene',
    map: (a) => ({ index: a.index, id: a.id, updates: absScene(a.updates || {}) }),
  },
  {
    name: 'sticky_split_scene',
    title: 'Split scene',
    description: 'Split the scene under timeSec into two (the new scene copies its settings). Snaps to the nearest musical beat within 0.35s unless snapToBeat=false.',
    inputSchema: {
      type: 'object',
      properties: { timeSec: { type: 'number' }, snapToBeat: { type: 'boolean', default: true } },
      required: ['timeSec'],
    },
    action: 'split_scene',
  },
  {
    name: 'sticky_add_fx',
    title: 'Add FX / SFX / media card',
    description: 'Add a camera punch (snap_zoom, dutch_tilt, shake, spotlight), a sound effect (whoosh, pop, vine_boom, record_scratch, shutter, typing, footstep_wet, heavy_sigh_breath, phone_vibrate, door_close_echo) or, with type="card", a picture-in-picture media card at timeSec.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...I.cameraFx, ...I.sfx, 'card'] },
        timeSec: { type: 'number' },
        duration: { type: 'number' },
        intensity: { type: 'number' },
        dir: { type: 'number', enum: [-1, 1] },
        volume: { type: 'number' },
        card: cardSchema,
      },
      required: ['type', 'timeSec'],
    },
    action: 'add_fx',
    map: (a) => (a.type === 'card' ? { kind: 'card', timeSec: a.timeSec, card: { ...(a.card || {}), imagePath: a.card && a.card.imagePath ? abs(a.card.imagePath) : undefined } } : a),
  },
  {
    name: 'sticky_render_frame',
    title: 'Render frame (vision check)',
    description: 'Render the exact frame at timeSec (rig pose, light match, transition, foreground, captions), save it as PNG and return it as an image so you can visually check framing, lighting rim and caption readability.',
    inputSchema: {
      type: 'object',
      properties: {
        timeSec: { type: 'number' },
        outPath: { type: 'string', description: 'Optional absolute .png path (default: system temp dir)' },
        gizmos: { type: 'boolean', description: 'Overlay IK bones/handles (default false)' },
      },
      required: ['timeSec'],
    },
    annotations: { readOnlyHint: true },
    action: 'render_frame',
    map: (a) => ({ ...a, outPath: a.outPath ? abs(a.outPath) : undefined }),
  },
  {
    name: 'sticky_export_mp4',
    title: 'Export MP4',
    description: 'Render the whole timeline in real time to a 60 fps H.264 + AAC MP4 (music, ambience, foley, SFX mixed) in exports/. Takes about the film length plus encoding time.',
    inputSchema: { type: 'object', properties: {} },
    action: 'export_mp4',
  },
];

function abs(p) {
  if (!p || typeof p !== 'string') return p;
  if (p.startsWith('~')) return p;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}
function absScene(s) {
  if (!s || typeof s !== 'object') return s;
  const bg = s.background;
  if (typeof bg === 'string' && /[\\/]/.test(bg)) return { ...s, background: abs(bg) };
  return s;
}

// ---------- Tool execution ----------
async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  const params = tool.map ? tool.map(args || {}) : (args || {});
  const { result, via } = await client.rpc(tool.action, params, log);

  if (tool.action === 'render_frame') {
    const { base64Png, ...summary } = result || {};
    const content = [{ type: 'text', text: JSON.stringify({ ...summary, via }, null, 2) }];
    if (base64Png) content.push({ type: 'image', data: base64Png, mimeType: 'image/png' });
    return { content };
  }
  const payload = typeof result === 'object' && result !== null ? { ...result } : { result };
  if (via === 'server') payload.servedBy = 'server (no studio tab connected — changes apply when it connects)';
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

// ---------- JSON-RPC plumbing ----------
function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const replyError = (id, code, message, data) => send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    if (msg && msg.id !== undefined && !('result' in msg) && !('error' in msg)) replyError(msg.id, -32600, 'Invalid Request');
    return;
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const { id, method, params } = msg;
  try {
    switch (method) {
      case 'initialize': {
        const requested = params && params.protocolVersion;
        reply(id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
        return;
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        if (!isNotification) reply(id, {});
        return;
      case 'tools/list':
        reply(id, { tools: TOOLS.map(({ action, map, ...t }) => t) });
        return;
      case 'tools/call': {
        const name = params && params.name;
        try {
          const result = await callTool(name, (params && params.arguments) || {});
          reply(id, result);
        } catch (e) {
          if (e.code === -32602) replyError(id, -32602, e.message);
          else reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
        }
        return;
      }
      default:
        if (!isNotification) replyError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (!isNotification) replyError(id, -32603, e.message);
  }
}

// Exit only after in-flight tool calls have answered (e.g. when requests are piped in and stdin closes)
let inFlight = 0;
let stdinClosed = false;
const maybeExit = () => { if (stdinClosed && inFlight === 0) setTimeout(() => process.exit(0), 20); };
const track = (p) => {
  inFlight++;
  p.finally(() => { inFlight--; maybeExit(); });
};

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (e) {
    replyError(null, -32700, 'Parse error');
    return;
  }
  if (Array.isArray(msg)) msg.forEach((m) => track(handle(m)));
  else track(handle(msg));
});
rl.on('close', () => {
  stdinClosed = true;
  maybeExit();
});

// Warm up: make sure the studio server is running (non-blocking; errors only logged)
client.ensureServer(log).catch((e) => log(`could not start studio server yet: ${e.message}`));
log(`ready (${TOOLS.length} tools)`);
