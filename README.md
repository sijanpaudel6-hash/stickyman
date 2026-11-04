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

## Quick Start

```bash
# Start the local studio server on http://localhost:3456
./start-studio.sh
# or:
node server.js
```

You can also open `public/index.html` directly in any modern browser.
