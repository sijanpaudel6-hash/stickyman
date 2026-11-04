# Sticky Character Studio — AI Film Director Playbook

This repo is a local animation and silent-film engine. A rigged black-silhouette character in a grey hoodie acts in front of photos (for example Google Flow images), with music, ambient sound, camera moves and captions. **You direct it through MCP tools** (`.mcp.json` registers `sticky-studio` → `node mcp-server.js`) or through the **CLI** (`node cli.js …`). Both start `server.js` automatically, and canvas actions open the studio (headless Chromium when there is no display).

> Always pass **absolute file paths**. Every ID below is validated. Unknown values come back as `warnings` and are **not** applied, so read the warnings.

---

## Tools (MCP) ↔ CLI

| MCP tool | CLI | What it does |
|---|---|---|
| `sticky_status` | `node cli.js status` | Mode, aspect, duration, BPM / beat count, connected tab, scene list |
| `sticky_get_project` | `node cli.js get-project [out.json]` | Full project in flat agent format (scenes, fxMarkers, mediaCards, audio.beats/strongBeats, backgrounds + lightProfile) |
| `sticky_load_audio` | `node cli.js load-audio <path> --mode silent` | Load music/voiceover → `{duration, bpm, beats[], strongBeats[]}` |
| `sticky_import_photos` | `node cli.js import-photos <p1> <p2> … [--auto-build]` | Register photos → `[{bgId, name, path, width, height, lightProfile}]` |
| `sticky_apply_template` | `node cli.js template <id> [--no-photos]` | Load a silent-film storyboard fitted to the audio and photos |
| `sticky_set_project` | `node cli.js set-project <file.json \| '{…}'>` | Push a full or partial storyboard (only the keys you send are applied) |
| `sticky_update_scene` | `node cli.js update-scene <index\|id> '{…}'` | Patch one scene |
| `sticky_split_scene` | `node cli.js split <timeSec> [--no-snap]` | Split at a time, snapping to the nearest beat (±0.35 s) |
| `sticky_add_fx` | `node cli.js add-fx <type> <timeSec> [--duration s]` | Camera punch / SFX / `card` |
| `sticky_render_frame` | `node cli.js snapshot <timeSec> [out.png]` | Exact frame as PNG (MCP also returns it as an image) |
| `sticky_export_mp4` | `node cli.js export` | Real-time render → `exports/sticky_video_*.mp4` (60 fps H.264 + AAC) |

`get_status`, `get_project`, `set_project` and `update_scene` also work **with no studio tab open**: they read and write `projects/live_state.json`, and the studio loads that when it connects.

---

## Reference IDs

### Emotions (10)
| id | use for |
|---|---|
| `neutral` | default, calm |
| `happy` | warmth, relief, small wins |
| `tired` | 3 AM, burnout, exhaustion |
| `crying` | grief, breaking down (pair with `silentMouth: quiver`) |
| `angry` | frustration |
| `shocked` | panic, realisation |
| `skeptical` | doubt, side-eye |
| `confused` | "?" moments |
| `excited` | hype (star eyes) |
| `deadpan` | emptiness, numbness |

### Gestures (18) — `gesture`
| id | description | best view |
|---|---|---|
| `pocket` | hands in the hoodie pocket (chill default) | any |
| `idle` | relaxed arms (swing when walking) | any |
| `talking` | audio-reactive hand beats (voiceover) | front |
| `explain` | both palms out | front |
| `point_screen` | points sideways (at a media card) | front |
| `point_viewer` | points at the camera | front / 3/4 |
| `crossed` | crossed arms | front |
| `facepalm` | hand over face | front |
| `hands_head` | hands on head (panic) | front |
| `shrug` | shrug, palms up | front |
| `wave` | wave hello | front |
| `typing` | sits at a desk and types (desk + stool drawn) | auto 3/4–side |
| `slouch_lonely` | deep slouch, head hanging, slow heavy breath | front / 3/4 |
| `heavy_sigh` | 4.5 s cycle: inhale → hold → slump (auto breath foley) | front / 3/4 |
| `check_phone_dark` | holds a glowing phone; blue light cone on face and hoodie | front / 3/4 |
| `sit_curb_hug_knees` | sits on the ground hugging knees, head down | auto 3/4 |
| `look_back_horizon` | stands gazing at the vista, wind in the hoodie | `back` / 3/4 |
| `pull_hood_up` | action: reaches back and pulls the hood up (~2.3 s from scene start) | front |

### Body & pose keys
| key | values |
|---|---|
| `pose` | `rig` (articulated, default) · v1 sprites: `front`, `bust`, `side`, `back` |
| `view` | `front`, `threeQuarter`, `side`, `back` |
| `hoodUp` | `true` / `false` (hood drawn on **every** view; back view defaults to up) |
| `walkSpeed` | `0` idle · `0.1–1.0` walk · `1.1–2.5` jog → sprint |
| `walkDir` | `left`, `right` |
| `walkInPlace` | `true` (treadmill) / `false` (travels across the frame, wraps around) |
| `wind` | `0..1` (hem, drawstrings, hood) |
| `silentMouth` | `closed` (default) · `sigh` · `quiver` (crying / anxiety) |
| `handLeft`, `handRight` | `auto`, `relaxed`, `open_palm`, `pointing`, `fist`, `holding_prop`, `in_pocket` |
| `prop` | `none`, `phone`, `mug`, `mic`, `controller`, `book` |
| `spineLean`, `headTilt`, `headNod` | degrees (≈ −25…25; `headNod` + = look down) |
| `ikPins` | `{ rightHand\|leftHand\|rightFoot\|leftFoot\|head: {x, y} }` in rig units (origin = ground between the feet, +x = facing direction, up is **negative** y; the head is near y ≈ −300, hands hang near y ≈ −130). `{}` clears |
| `x`, `y`, `scale`, `flipX` | position 0..1 (x 0.5 = centre; y ≈ 0.55 = standing on the lower third), size (1 = default), mirror |
| `motion` | `breathe` (default for silent), `talk_bounce`, `walk`, `shake` (trembling), `float`, `none` |
| `emotion` | see the table above |

### Backgrounds — `background`
Built-ins: `paper_sketch`, `cozy_night`, `rainy_window`, `streetlight` (midnight lamp), `classroom` (sunset desk), `dark_spotlight`, `rooftop_dusk`, `green_screen`.
Photos: use the `bgId` returned by `sticky_import_photos`, **or just put the absolute photo path** in `background` (it is imported automatically).

### Photo camera & depth
| key | values |
|---|---|
| `kenBurns` | `none`, `push_in`, `pull_out`, `drift_left`, `drift_right`, `breathing` (the photo moves 100%, the character 30% → parallax) |
| `foreground` | `none`, `bokeh`, `rain_streaks`, `window_reflection` |
| `camera` | `static`, `zoom_in`, `zoom_out`, `pan_right`, `handheld` (applies on top of `kenBurns`) |
| `atmosphere` | `dust` (glows with the music beat), `rain`, `none` |
| `dutchScene` / `spotlightScene` | whole-scene tilted horizon / background dimmed 60% |

### Light match (photo harmonisation) — `lightMatch`
`true` = recommended (`tint 0.35, rim 0.55, exposure 0.5`) · `false` = off · a number `0..1` = overall strength · or `{ tint, rim, exposure, side }` with `side` = `auto` (from the photo) | `left` | `right` | `back` (backlit, both edges).
**Use `true` on every photo scene.** Raise `rim` (0.7–0.9) for sunsets and backlit horizons; use `side: "back"` for `look_back_horizon`.

### Transitions (how a scene ENTERS) — `transitionType`, `transitionDur` (0–2 s)
`cut` · `dissolve` (both shots render live and blend) · `fade_black` (time passing, loneliness) · `fade_white` (flashback, realisation, hope). Scene 0 with `dissolve` or `fade_black` fades in from black. `fadeOutEnd: true` fades the film to black at the end.

### Ambient beds (continuous, per scene) — `ambientBed`, `ambientVol` 0..1
| id | mood |
|---|---|
| `none` | — |
| `rain_window` | soft rain + distant thunder (also makes footsteps wet) |
| `night_wind` | lonely midnight wind |
| `vinyl_crackle` | warm lo-fi dust |
| `clock_ticking` | 60 BPM reverberant tick: 3 AM, insomnia, emptiness |
| `heartbeat` | deep muffled heartbeat: anxiety, panic |
| `crowd_muffle` | low-passed murmur: alone in a crowded room |

### FX markers — `sticky_add_fx` / `fxMarkers: [{type, timeSec, …}]`
- **Camera punches:** `snap_zoom` (1.0→1.25× spring onto the face), `dutch_tilt`, `shake`, `spotlight` (+ `duration`, `intensity` 0..3, `dir` ±1 for dutch)
- **SFX / foley (10):** `whoosh`, `pop`, `vine_boom`, `record_scratch`, `shutter`, `typing`, `footstep_wet`, `heavy_sigh_breath`, `phone_vibrate`, `door_close_echo` (+ `volume`)
- Scenes can also set `transitionSfx` (an SFX played at the cut) and `foley: true` (auto footsteps on every heel strike + sigh breaths; on by default in silent mode)
- **Media cards:** `type: "card"` with `card: {kind: image|meme|post|note, text, imagePath, side: auto|left|right, hold, size}`

### Project-level keys (`sticky_set_project`)
| key | values |
|---|---|
| `mode` | `silent` (music only, the mouth never lip-syncs) · `voiceover` |
| `aspectRatio` | `16:9` · `16:9-letterbox` (2.35:1 cinema bars) · `9:16` (Shorts / Reels / TikTok, 720×1280) |
| `fadeOutEnd` | `true` or seconds |
| `masterAmbientVol` | 0..1 |
| `captionStyle` | `cinematic` (silent film serif), `pop`, `karaoke`, `classic`, `off`, or `{mode, highlight, position: bottom\|middle\|top, chunk, uppercase, size}` |
| `snapToBeats` | default `true`: cuts snap to the nearest beat |
| `scenes` | flat scene objects. Timing: give `start`/`end` on **all** scenes, or none and use `duration` / `weight` (spread over the music) |
| `fxMarkers` | see above |
| `mediaCards` | `[{sceneIndex \| timeSec, kind, text, imagePath, appear, hold, side}]` |

### Templates — `sticky_apply_template`
`loneliness_3am` (phone in the dark → hooded rain walk → hugging knees on the curb → dawn horizon) · `social_anxiety` (slouched corner + crowd murmur → panic with heartbeat → stepping outside into wind → relief sigh) · `burnout` (typing at the desk → empty stare with clock → fade to black → rain walk) · `discipline` (tired wake-up → pulling the hood up → 1.2× jog → 2.0× sprint into sunrise).

---

## Directing workflow

1. **Look and listen.** Look at the user's photos with vision (read the image files) and decide the emotional arc (e.g. isolation → breaking point → release → hope). Load the music with `sticky_load_audio {path, mode: "silent"}` and note `duration`, `bpm` and `strongBeats` (the best cut points).
2. **Import and map photos.** `sticky_import_photos {paths: [...]}` in story order. Use each `lightProfile` (`tone` warm/cool, `brightness`, `lightFrom`) to pick the beat. Dark cool rooms suit `check_phone_dark` / `slouch_lonely` + `clock_ticking`. Rainy streets suit hooded `pocket` walks + `rain_window` + `rain_streaks`. Sunsets and skylines suit `look_back_horizon` (back view, `lightMatch {rim: 0.8, side: "back"}`) + `night_wind`.
3. **Build the storyboard** with one `sticky_set_project` call: `mode: "silent"`, `captionStyle: "cinematic"`, `fadeOutEnd: true`, and one scene per photo. Give each scene `background` (the path or bgId), `gesture`, `emotion`, `view`, `hoodUp`, `kenBurns`, `lightMatch: true`, `ambientBed`, `transitionType` (first scene `fade_black`, mostly `dissolve` 1.0–1.5 s, `fade_black` for time jumps, `fade_white` for the turn toward hope), short poetic `subtitle`s (≤ 8 words, or empty), and `weight` for emphasis. Add a few `fxMarkers` (`phone_vibrate`, `door_close_echo`, a `snap_zoom` on the emotional peak). Check `warnings` in the result.
4. **Inspect visually.** `sticky_render_frame` at 2–3 key times: inside the first scene (after its fade, ~1.5 s), mid-film, and on the climax. Check that the character is fully in frame and grounded (adjust `y`, `scale`, `x`), that the rim and tint match the photo (adjust `lightMatch`), that captions are readable and not covered, and that faces aren't hidden by cards. Fix with `sticky_update_scene` and re-render.
5. **Export** with `sticky_export_mp4` when the user is ready. It takes about the film's length plus encoding. Report the `mp4Path`.

### Taste guide for silent emotional shorts
- Fewer, longer shots (4–8 s). Cut on `strongBeats`. Let `heavy_sigh` and `slouch_lonely` breathe for at least one full cycle (≥ 4.5 s).
- `hoodUp: true` = withdrawal / rain / anxiety; hood down = openness, relief.
- Keep `walkSpeed` 0.4–0.6 for melancholy walks, 1.2 for a determined jog, 2.0+ only for climactic sprints.
- Pair emotion and mouth: `crying` + `quiver`, `tired` + `sigh`. In silent mode never use `talking`.
- Use one ambient bed per scene at 0.4–0.8 volume. Change beds on cuts to mark a new place.
- For `9:16`, keep `x` ≈ 0.5 and `scale` 0.9–1.1. Captions and cards reposition automatically.

### Example storyboard
```json
{
  "mode": "silent", "aspectRatio": "16:9-letterbox", "captionStyle": "cinematic", "fadeOutEnd": true,
  "scenes": [
    { "title": "3 AM", "background": "/abs/photos/bedroom.jpg", "gesture": "check_phone_dark", "emotion": "tired",
      "kenBurns": "push_in", "lightMatch": true, "ambientBed": "clock_ticking", "transitionType": "fade_black", "transitionDur": 1.2, "subtitle": "3:07 AM." },
    { "title": "Rain Walk", "background": "/abs/photos/street.jpg", "gesture": "pocket", "view": "threeQuarter", "hoodUp": true,
      "walkSpeed": 0.55, "walkInPlace": false, "x": 0.25, "foreground": "rain_streaks", "ambientBed": "rain_window",
      "lightMatch": true, "transitionType": "dissolve", "transitionDur": 1.2, "weight": 1.2 },
    { "title": "Dawn", "background": "/abs/photos/sunset.jpg", "gesture": "look_back_horizon", "view": "back", "wind": 0.6,
      "lightMatch": { "rim": 0.8, "side": "back" }, "kenBurns": "pull_out", "ambientBed": "night_wind",
      "transitionType": "fade_white", "subtitle": "But the sun still came up." }
  ],
  "fxMarkers": [ { "type": "phone_vibrate", "timeSec": 0.8 } ]
}
```

---

## Developer notes (for editing this repo)
- Zero npm dependencies: plain Node (`server.js`, `mcp-server.js`, `cli.js`, `lib/studioClient.js`) plus browser scripts in `public/` loaded by `public/index.html` (no bundler).
- `public/projectSchema.js` is UMD and shared by Node and the browser. It defines the flat agent format, aliases and validation. Add new IDs there **and** in the renderer.
- Browser bridge: `public/remoteBridge.js` (SSE `/api/bridge/events` → handlers → `POST /api/bridge/reply`). Server RPC: `POST /api/rpc {action, params}`.
- Env: `PORT` / `STICKY_PORT` (3456), `HOST` (127.0.0.1), `STICKY_BROWSER=auto|headless|open|none`, `STICKY_CHROME=/path/to/chrome`, `STICKY_BROWSER_WAIT_MS`.
- Verify JS with `node --check <file>`. The studio can be opened with `?fresh=1` to skip restoring `projects/live_state.json`.
