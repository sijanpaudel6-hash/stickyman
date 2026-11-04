# Sticky Character Studio (`stickyman`)

A local, browser-based YouTube Animation & Lip-Sync Studio built for the **Sticky Hoodie Character**.

## Features

- **Extracted Transparent Character Cutouts & Expression Layers**:
  - Full-Body Front, Side Profile, Back (Hood Up), and Close-Up Bust poses (`public/assets/`).
  - 4 Original Hand-Drawn Sheet Expressions (`Neutral`, `Happy`, `Tired`, `Crying`) with mouthless layers for live lip-syncing.
  - 6 Additional Procedural Glowing Expressions (`Angry`, `Shocked`, `Skeptical`, `Confused`, `Excited`, `Deadpan`).
- **Pre-Recorded Voiceover Lip-Sync + Live Microphone Support**:
  - Upload any `.mp3` or `.wav` voiceover to automatically generate the timeline waveform and animate the character's glowing mouth to your voice.
- **Scene-by-Scene Storyboard Timeline**:
  - Split scenes at the playhead (`S`), switch emotions (`1`–`9`, `0`), pick poses, adjust camera zoom/pan, and add on-screen captions.
- **Custom & Procedural Backgrounds**:
  - Upload custom background images or videos, or choose from 8 built-in animated backgrounds (*Sketchbook Paper*, *Cozy Night Room*, *Rainy Lo-Fi*, *Midnight Lamp*, *Sunset Desk*, *Dark Spotlight*, *Twilight Rooftop*, *Green Screen*).
- **1-Click MP4 Video Export**:
  - Renders 60fps video + audio and encodes a YouTube-ready `.mp4` (`H.264 + AAC`) via local `ffmpeg`.

## v3 — Silent Emotional Short Film & Cinematic Photo Engine

Made for no-narration films (music and ambience only) about loneliness, social anxiety, emptiness, burnout and quiet discipline, built from **Google Flow** photos and the rigged Sticky character.

### 1. Silent Film / Music-Only Mode
- Topbar toggle: **🎙️ Voiceover** (lip-sync, as before) or **🎬 Silent Film**. In Silent Film mode the music **never** moves the mouth.
- The music drives `audioState.musicEnergy` (low-frequency energy) and `audioState.beatPulse`. These make the dust motes glow and swell, deepen the breathing, and add a small head-nod on beats while walking or "listening".
- The track is analysed when it loads: **beat markers and BPM** show on the waveform, and **S** snaps a split to the nearest beat (toggle in the left panel). Without an uploaded track, a procedural 72 BPM piano demo plays.
- Per-scene **silent mouth**: Closed, Slow Heavy Sigh, or Quivering Lip.

### 2. Silent acting presets & hood
- `Lonely Slouch` (hunched spine, dropped shoulders, head hanging, very slow breathing), `Heavy Sigh` (4.5 s inhale / hold / exhale cycle that also triggers a breath foley), `Phone in Dark` (blue-white light cone, glow on the face and upper hoodie, rim on the head), `Hug Knees` (sitting on the ground, arms around the shins), `Gaze at Horizon` (best in 3/4 or back view, with wind), `Pull Hood Up` (hands reach behind the head and pull the hood over).
- **🧥 Hood up** can be toggled per scene on every view (front, 3/4, side and back). There is also a per-scene **Wind** slider for the hem, drawstrings and hood.

### 3. Google Flow photo integration
- **🖼️ Upload Photos** accepts multiple files. **✨ Auto-Build Scenes from Photos** spreads them across the music length, cuts on beats, and cycles through silent-acting shots, Ken Burns moves and dissolves.
- **Light Match**: each photo is sampled for sky colour, ground colour, key-light colour and key-light direction. The character then gets an *ambient tint*, an *exposure/contrast match* and a *rim light* on the edge facing the light (cool moonlight from a blue bedroom, warm amber from a sunset). The glowing eyes are drawn again after grading so they stay bright. **Auto** picks values from the photo.
- **Ken Burns 2.5D**: Slow Push In, Slow Pull Out, Drift Left, Drift Right, Breathing Float. The photo moves fully, the character 30%, and the foreground more (parallax).
- **Foreground depth**: out-of-focus bokeh, passing rain streaks, or windowpane reflection. **2.35:1 cinema bars** come from the aspect switcher.

### 4. Transitions
Per scene (how it *enters*), 0–2 s: Cut, Cross-Dissolve (both shots rendered live and blended), Fade Through Black, Fade Through White. There is also an optional fade to black at the end of the film.

### 5. Ambient soundscapes & foley (`public/fx/ambient.js`, `sfx.js`)
- Procedural beds per scene with per-scene and master volume: rain on window (with distant thunder), night wind, vinyl crackle, 60 BPM clock ticking, heartbeat, muffled crowd. Beds crossfade between scenes and can be previewed while paused.
- Foley: Wet Footstep (also triggered automatically on each heel strike), Heavy Sigh, Phone Vibrate, Door Close Echo.
- Music, SFX, foley and ambience all go through one bus into the MP4 export.

### 6. Aspect ratio & templates
- **16:9** (1280×720), **16:9 + 2.35:1 bars**, or **9:16 Shorts/Reels/TikTok** (720×1280). In 9:16 the character framing is scaled, cards move above the character and captions sit above the app UI.
- **🎞️ Silent Film Templates**: *3 AM Loneliness*, *Social Anxiety (Invisible in the Crowd)*, *Emptiness / Burnout*, *Quiet Discipline (Nobody Watching)*. Each sets acting, ambience, transitions, Ken Burns, foreground and cinematic serif captions. They stretch to your music, cut on beats, and use your uploaded photos when they're available.
- **💾 Save** stores uploaded photo backgrounds (images) inside the project file.

### v3 file map
```
public/fx/musicAnalysis.js  beat/onset detection, BPM, demo piano track, silent mouth states
public/fx/lightMatch.js     ambient tint, exposure match, directional rim light
public/fx/cinematic.js      Ken Burns, foreground overlays, letterbox, transition timing
public/fx/ambient.js        procedural ambient soundscape beds
public/templates.js         silent film templates + shared scene factory + beat-snapped layout
public/studioV3.js          v3 UI (mode, aspect, templates, auto-build, cinematic inspector)
```

## v2 — Articulated Body Rig + Viral YouTube Engine

Pick **🦴 Rigged Body (v2)** in *Character Pose / Shot* (all demo scenes already use it).

### Skeletal rig & limb control (`public/rig/`)
- **Hierarchical 2D bone rig**, drawn back → front: `back_arm_upper → back_arm_lower → back_hand` (when behind the body), `left/right_leg_upper → _lower → _shoe`, `torso_hoodie_base` (spine lean + breathing squash/stretch), `head_neck` (tilt, nod, turn), `front_arm_upper → front_arm_lower → front_hand`, then the `hoodie_kangaroo_pocket_overlay` **on top of** hands that are `in_pocket`.
- **Views:** Front · 3/4 · Side Profile · Back (hood up). Walking automatically turns the body to a 3/4 profile.
- **Ink style matching the reference sheet:** baggy `#7d7970` sleeves with `#5c5851` folds, `#1a1917` ink and ribbed cuffs; `#08080a` silhouette hands; `#1c1b19` joggers with knee creases and bunched cuffs; grey sneakers with light midsoles and laces that roll at the ankle. Limbs use a two-pass outline/fill so shoulders, elbows, hips and knees have rounded caps and no seams.
- **6 hand states:** relaxed, open palm, pointing, fist, holding prop, in pocket (per hand, or *Auto* from the gesture).
- **12 action / gesture presets:** Hands in Pocket, Relaxed Arms, Talking (audio-reactive syllable beats), Explain / Palms, Point at Screen, Point at Viewer, Crossed Arms, Facepalm, Hands on Head, Shrug, Wave Hello, Sit at Desk & Type. Switching gestures cross-fades over 0.35 s.
- **Direct canvas IK:** with gizmos on (`G`), drag the **right/left hand**, **feet** or **head** (analytic 2-bone IK: shoulder → elbow → wrist, hip → knee → ankle). Pins are saved per scene; double-click a pin to release it, or use *Clear IK Pins*. Shift-drag moves the whole character.
- **FK sliders:** spine lean, head tilt, head nod.
- **Props:** smartphone, coffee mug (with steam), microphone, game controller, book.

### Walk / run engine (`public/rig/locomotion.js`, `clothPhysics.js`)
- **Speed slider 0.0 – 2.5x**, direction ◀ / ▶, *Walk in Place* or *Translate Across Screen* (wraps around the frame).
- Walking: `sin(φ)·stride` hip swing, knee flex only during the forward recovery swing, heel-to-toe ankle roll, counter-swinging arms with a lagging forearm, `|sin φ|·bounce` torso bounce, and feet snapped to the ground.
- Running (≥ ~1.1x): forward lean up to 16°, 75°–95° elbow pump with fists, flight phase (both feet off the ground) and higher knee lift. Speed 0 eases back into the idle pose.
- **Jump** (`J`): anticipation crouch, airborne tuck, landing squash.
- **Secondary motion:** Verlet hoodie drawstrings (pinned to the collar, pushed by the root's acceleration) plus spring-damper hood bounce and hem sway.

### Viral production FX (`public/fx/`)
- **Camera punches** (added at the playhead, shown as markers on the FX track): Snap Zoom 1.0 → 1.25x with spring overshoot toward the face (`Z`), Dutch Tilt, Impact Shake, Spotlight Dimming (background dimmed 60%; the character and glowing eyes stay bright). There are also per-scene "whole scene" Dutch and Spotlight toggles.
- **Synthesized SFX** (Web Audio, no asset files): Whoosh, Pop/Bubble, Vine Boom (`B`), Record Scratch, Camera Shutter, Keyboard Typing. Add them at the playhead or as a per-scene **transition SFX**. They are mixed into the MP4 export.
- **PiP media cards** with spring pop-in: image/screenshot, meme (`TOP | BOTTOM` text), social post card, big text card. Each card has an appear time, hold time and side (*Auto* picks the side opposite the character and keeps it there).
- **Animated captions:** pop-in words (chunk size, highlight colour, bounce on the active word, upper-case), karaoke line, classic box; position top / middle / bottom.
- **FX timeline track:** drag markers to retime them; double-click or right-click to delete.
- **💾 Save / 📂 Load** saves the whole project (scenes, rig poses, IK pins, FX, captions, card images) as one `.json` file.

### Keyboard shortcuts
`Space` play/pause · `S` split scene · `1–9, 0` emotions · `G` IK gizmos · `J` jump · `Z` snap zoom at playhead · `B` vine boom at playhead

### File map
```
public/rig/rigCore.js        math, analytic 2-bone IK, springs, rig proportions, body projection
public/rig/gestures.js       hand states, gesture presets, audio-reactive talking controller, prop grips
public/rig/locomotion.js     walk → jog → run gait, ankle roll, flight phase, jump
public/rig/clothPhysics.js   Verlet drawstrings, hood/hem springs
public/rig/props.js          phone, mug, mic, controller, book, desk + stool set piece
public/rig/rigCharacter.js   rig solver (FK/IK/blending), layered ink renderer, gizmos & hit-testing
public/fx/cameraFx.js        snap zoom, dutch tilt, shake, spotlight
public/fx/captions.js        pop-in / karaoke / classic captions
public/fx/sfx.js             synthesized SFX engine (routes into the MP4 export)
public/fx/mediaCards.js      PiP B-roll cards
public/studioV2.js           inspector UI, FX timeline track, project save/load
```

## Quick Start

```bash
# Start the local studio server on http://localhost:3456
./start-studio.sh
# or:
node server.js
```

You can also open `public/index.html` directly in any modern browser.
