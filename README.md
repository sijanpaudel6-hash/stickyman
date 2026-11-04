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
