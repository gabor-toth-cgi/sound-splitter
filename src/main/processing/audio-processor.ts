// ============================================================
// Audio Processor – ffmpeg operations for segment extraction
// ============================================================

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';

// Resolve ffmpeg binary path
function getFfmpegPath(): string {
  // In packaged app, look in resources (process.resourcesPath may be undefined in dev)
  if (typeof process.resourcesPath === 'string') {
    const resourcePath = path.join(process.resourcesPath, 'ffmpeg.exe');
    if (fs.existsSync(resourcePath)) return resourcePath;
  }

  // In development, use ffmpeg-static
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  } catch { /* ignore */ }

  // Fallback: hope it's on PATH
  return 'ffmpeg';
}

const FFMPEG = getFfmpegPath();

/**
 * Run an ffmpeg command and return a promise.
 */
function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc: ChildProcess = spawn(FFMPEG, args, { windowsHide: true });
    let stderr = '';

    // Drain stdout to prevent pipe blocking (ffmpeg rarely writes to stdout,
    // but it can happen with certain output formats)
    proc.stdout?.resume();

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stderr);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

export class AudioProcessor {
  /**
   * Validate that the input file exists and is readable.
   */
  private validateInput(inputPath: string): void {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }
    const stat = fs.statSync(inputPath);
    if (stat.size === 0) {
      throw new Error(`Input file is empty: ${inputPath}`);
    }
  }

  /**
   * Decode audio to raw PCM (16 kHz, mono, float32le) for VAD processing.
   * Returns the path to a temporary .raw file.
   */
  async decodeToRawPCM(inputPath: string, startTime: number = 0): Promise<string> {
    this.validateInput(inputPath);
    const tmpFile = path.join(os.tmpdir(), `ss_pcm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.raw`);

    const args = [
      '-y',
      ...(startTime > 0 ? ['-ss', String(startTime)] : []),
      '-i', inputPath,
      '-vn',                    // no video
      '-ac', '1',               // mono
      '-ar', '16000',           // 16 kHz
      '-f', 'f32le',            // raw float32 little-endian
      '-acodec', 'pcm_f32le',
      tmpFile,
    ];

    await runFfmpeg(args);
    return tmpFile;
  }

  /**
   * Extract a segment from the input, apply noise reduction, export as mp3.
   */
  async extractSegment(
    inputPath: string,
    startTime: number,
    endTime: number,
    outputPath: string,
  ): Promise<void> {
    this.validateInput(inputPath);
    const duration = endTime - startTime;

    if (duration <= 0) {
      throw new Error(`Invalid segment duration: ${duration}s (start=${startTime}, end=${endTime})`);
    }

    // Ensure output directory exists
    const outDir = path.dirname(outputPath);
    fs.mkdirSync(outDir, { recursive: true });

    const args = [
      '-y',
      '-ss', String(startTime),
      '-t', String(duration),
      '-i', inputPath,
      '-vn',
      // Noise reduction filter: FFT-based de-noise
      '-af', 'afftdn=nf=-25:tn=1',
      '-codec:a', 'libmp3lame',
      '-q:a', '2',             // good quality VBR
      outputPath,
    ];

    await runFfmpeg(args);
  }

  /**
   * Trim leading and trailing silence/non-speech from an audio file in-place.
   */
  async trimSilence(filePath: string): Promise<void> {
    const tmpOut = filePath + '.trimmed.mp3';

    const args = [
      '-y',
      '-i', filePath,
      '-af',
      // Remove silence from start (stop_periods=-1 removes from end too)
      // Use -50dB threshold to avoid stripping quiet speech
      'silenceremove=start_periods=1:start_duration=0.1:start_threshold=-50dB:' +
      'stop_periods=-1:stop_duration=0.3:stop_threshold=-50dB',
      '-codec:a', 'libmp3lame',
      '-q:a', '2',
      tmpOut,
    ];

    try {
      await runFfmpeg(args);
      // Safety: if trimmed file is too small, keep the original
      const trimmedSize = fs.statSync(tmpOut).size;
      if (trimmedSize < 1024) {
        // Trimming removed all content — discard trimmed version
        fs.unlinkSync(tmpOut);
        return;
      }
      // Replace original with trimmed version safely:
      // Copy trimmed over original (atomic on same volume), then remove temp.
      // This avoids a window where neither file exists.
      fs.copyFileSync(tmpOut, filePath);
      fs.unlinkSync(tmpOut);
    } catch (err) {
      // If trimming fails, keep original
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
      throw err;
    }
  }

  /**
   * Get the duration of an audio file in seconds.
   */
  async getDuration(filePath: string): Promise<number> {
    // Use ffprobe-style approach: ffmpeg prints duration to stderr even on error
    const args = [
      '-i', filePath,
      '-hide_banner',
      '-f', 'null',
      '-',
    ];

    // ffmpeg may exit non-zero for -f null, so we catch and still parse stderr
    let stderr = '';
    try {
      stderr = await runFfmpeg(args);
    } catch (e: any) {
      stderr = e.message || '';
    }

    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (match) {
      const [, h, m, s, frac] = match;
      // The fractional part can be 1-6+ digits; normalize to seconds
      const fracSeconds = parseInt(frac) / Math.pow(10, frac.length);
      return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + fracSeconds;
    }
    // Duration not found in ffmpeg output — may indicate a corrupt or empty file
    if (stderr.length > 0) {
      // Log is only available via import; use console.warn as fallback
      console.warn(`getDuration: could not parse duration from ffmpeg output for ${filePath}`);
    }
    return 0;
  }

  /**
   * Clean up temporary files.
   */
  cleanupTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
  }
}
