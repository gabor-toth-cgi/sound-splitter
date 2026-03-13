# Sound Splitter

An Electron desktop application that uses AI/ML to split audio and video files into individual speech segments. It detects voice activity using Silero VAD (with energy-based fallback), extracts each speech segment as a separate MP3, and auto-names files using OpenAI Whisper speech recognition.

![Windows](https://img.shields.io/badge/platform-Windows%20x64-blue)
![Electron](https://img.shields.io/badge/Electron-41-47848F)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Silero VAD** — Neural network voice activity detection via ONNX Runtime, with energy-based fallback
- **Whisper Speech Recognition** — Auto-names segments using `Xenova/whisper-small` (~500MB model, downloaded on first run)
- **Multi-language Support** — English, Hungarian, and auto-detect modes
- **Adjustable Sensitivity** — 10-level slider from aggressive (catches short utterances) to conservative (only clear speech)
- **User Feedback Learning** — Thumbs up/down per segment trains a per-file bias that improves future splits
- **Full Media Player** — Waveform visualization (wavesurfer.js), play/pause/stop/seek/volume/mute
- **Processing Controls** — Start from current playback position, pause/resume/stop mid-processing
- **Noise Reduction** — FFmpeg `afftdn` filter applied during extraction
- **Results Panel** — Per-segment playback, confidence badges, inline rename for low-confidence results
- **Console Log** — Collapsible timestamped event log
- **Dark Theme** — Full dark UI

## Prerequisites

- **Node.js** v18+ (tested with v24.14.0)
- **npm** 8+ (tested with 11.9.0)
- **Windows 10/11 x64**
- No elevated permissions required

## Installation

```bash
npm install
```

> **SSL Issues:** If `ffmpeg-static` post-install fails in a corporate environment:
> ```bash
> set NODE_TLS_REJECT_UNAUTHORIZED=0 && node node_modules/ffmpeg-static/install.js
> ```

## Usage

### Development

```bash
npm start
```

Compiles TypeScript, bundles the renderer with esbuild, and launches the Electron app.

### Production Build

```bash
npm run dist
```

Produces an unpacked distribution at `release/win-unpacked/Sound Splitter.exe`. Run the exe directly — no installer needed.

### npm Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript + bundle renderer with esbuild |
| `npm start` | Build and launch the Electron app |
| `npm run dev` | Same as `npm start` |
| `npm run dist` | Build and package with electron-builder |
| `npm run clean` | Remove the `dist/` directory |

## How It Works

### Processing Pipeline

1. **Audio Decoding** — Input file is decoded to 16kHz mono float32 PCM via FFmpeg
2. **Voice Activity Detection** — Silero VAD (ONNX) analyzes 32ms audio chunks, producing per-chunk speech probabilities. Segments are formed using configurable thresholds for speech probability, minimum silence duration, minimum speech duration, and padding.
3. **Segment Extraction** — Each speech segment is extracted as MP3 with `afftdn` noise reduction and silence trimming
4. **Speech Recognition** — Whisper (`whisper-small`) transcribes each segment. Files are auto-renamed based on content. Confidence is estimated via a text-quality heuristic (word count, common words, repetition, alpha ratio).

### Sensitivity Slider

The slider (1–10) maps to VAD thresholds:

| Level | Speech Threshold | Min Silence | Min Speech | Padding |
|-------|-----------------|-------------|------------|---------|
| 1 (Aggressive) | 0.30 | 50ms | 100ms | 10ms |
| 5 (Balanced) | 0.50 | 300ms | 250ms | 30ms |
| 10 (Conservative) | 0.80 | 800ms | 500ms | 100ms |

### Feedback Learning

- Each segment has thumbs up/down buttons in the results panel
- Wrong-split feedback adjusts a per-file threshold bias via online gradient descent (learning rate 0.05)
- Correct-split feedback pulls bias toward zero
- Bias is clamped to ±0.3 and persisted across sessions
- On subsequent runs, matched file profiles pre-adjust the VAD threshold

## Application Walkthrough

### 1. Load a File

Click **Choose File**. Supported formats:
- Audio: `.mp3`, `.wav`, `.ogg`, `.flac`, `.aac`, `.m4a`, `.wma`
- Video: `.mp4`, `.mkv`, `.avi`, `.webm`, `.mov`

The waveform renders across the full width with total duration displayed.

### 2. Playback

| Control | Action |
|---------|--------|
| Play / Pause | Toggle playback (also `Space` key) |
| Stop | Reset to beginning |
| Seek slider | Jump to any position |
| Volume slider | Adjust volume |
| Mute | Toggle mute |

Click directly on the waveform to seek.

### 3. Process

1. Seek to the desired start position
2. Select language (English, Hungarian, or Auto-detect)
3. Adjust sensitivity if needed
4. Click **Start Processing**

On first run, the Whisper model (~500MB) downloads automatically. Subsequent runs use the cached model.

### 4. Results

Segments appear incrementally as they're extracted:

- **Timestamp name** → updated to speech-based name after recognition
- **Confidence badge** — green (≥80%), yellow (60–79%), red (<60%)
- **Play/Stop** — preview individual segments
- **Inline rename** — edit suggested names for low-confidence results
- **Thumbs up/down** — provide feedback to improve future splits

### 5. Output

Files are saved to `./output/<input filename>/`:

```
output/
  meeting/
    good-morning-everyone.mp3
    lets-review-the-agenda.mp3
    00m45s-01m02s.mp3          # low confidence, kept timestamp name
```

## Project Structure

```
sound-splitter/
  src/
    main/                          # Electron main process
      index.ts                     # App entry, window creation, TLS relaunch guard
      preload.ts                   # Context bridge (typed IPC API)
      ipc-handlers.ts              # IPC handler registration
      processing/
        processing-pipeline.ts     # Pipeline orchestrator
        speech-detector.ts         # Silero VAD + energy-based fallback
        speech-recognizer.ts       # Whisper transcription (whisper-small)
        audio-processor.ts         # FFmpeg decode/extract/trim
        silero-vad.ts              # ONNX Runtime model wrapper
      services/
        file-service.ts            # Output directory and file naming
        feedback-store.ts          # Feedback persistence and learning
        logger.ts                  # Dual-output logger (console + IPC)
    renderer/                      # Electron renderer process (browser context)
      index.html                   # Main layout with CSP
      app.ts                       # Entry point, component wiring
      styles/
        main.css                   # Dark theme styles
      components/
        file-picker.ts             # File dialog
        waveform.ts                # wavesurfer.js wrapper
        media-controls.ts          # Playback controls
        processing-controls.ts     # Start/pause/stop, sensitivity, language
        results-panel.ts           # Output file list with feedback
        console-log.ts             # Collapsible log panel
    shared/
      types.ts                     # Shared types, IPC channels, utilities
  resources/
    models/
      silero_vad.onnx              # Silero VAD model (2.3MB)
  test-integration.js              # 40 headless integration tests
  test-e2e.js                      # Full pipeline E2E tests (5 audio samples)
  generate-test-audio.ps1          # PowerShell script to generate test audio via SAPI TTS
```

## Testing

### Generate Test Audio

The test audio samples are generated locally using Windows SAPI TTS:

```powershell
powershell -ExecutionPolicy Bypass -File generate-test-audio.ps1
```

This creates 5 realistic audio samples in `input/` with varying speakers, pauses, and background noise levels.

### Integration Tests

```bash
node --use-system-ca test-integration.js
```

40 tests covering: Silero VAD model loading/inference, sensitivity mapping, feedback store persistence/learning, threshold bias calculations, and language support.

### End-to-End Tests

```bash
node --use-system-ca test-e2e.js
```

377 tests across 5 audio samples + pipeline integration. Runs the full VAD → extraction → Whisper recognition pipeline headlessly (no Electron required). First run downloads the Whisper model (~500MB).

> **Note:** Both test commands may need `NODE_TLS_REJECT_UNAUTHORIZED=0` in corporate environments:
> ```bash
> set NODE_TLS_REJECT_UNAUTHORIZED=0 && node --use-system-ca test-e2e.js
> ```

## Technical Notes

- **Renderer isolation** — `contextIsolation: true`, `nodeIntegration: false`. All IPC is typed via `src/shared/types.ts`.
- **Renderer bundling** — esbuild (browser platform, IIFE format) produces `dist/renderer/app.bundle.js`.
- **wavesurfer.js** — ESM-only, loaded via dynamic `import()`.
- **FFmpeg** — Bundled via `ffmpeg-static`, included as an extra resource in packaged builds.
- **Whisper model** — `Xenova/whisper-small` cached by `@xenova/transformers` (typically `~/.cache/`).
- **Silero VAD** — ONNX model at `resources/models/silero_vad.onnx`, loaded via `onnxruntime-node` v1.14.0.
- **TLS workaround** — Node v24's `fetch()` ignores `NODE_TLS_REJECT_UNAUTHORIZED`. The app's main process detects this and relaunches with `--use-system-ca` in `NODE_OPTIONS`.
- **No admin required** — Uses `dir` target instead of `portable` for electron-builder (avoids symlink creation).

## License

MIT
