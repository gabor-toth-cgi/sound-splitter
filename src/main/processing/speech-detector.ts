// ============================================================
// Speech Detector – Voice Activity Detection
//
// Primary: Silero VAD neural network (ONNX)
// Fallback: Energy-based adaptive threshold (if ONNX fails to load)
//
// The detector loads the Silero model once and reuses it across
// multiple detect() calls. Thresholds are passed per-call so the
// same detector instance works with different sensitivity levels.
// ============================================================

import * as fs from 'fs';
import { SpeechSegment, VADThresholds } from '../../shared/types';
import { SileroVAD, SileroVADOptions } from './silero-vad';
import { logger } from '../services/logger';

// Configuration for energy-based fallback
const SAMPLE_RATE = 16000;
const FRAME_SIZE_MS = 30;
const FRAME_SIZE = (SAMPLE_RATE * FRAME_SIZE_MS) / 1000; // 480 samples
const SPEECH_THRESHOLD_FACTOR = 1.5;

// Default thresholds (sensitivity level 5 = Balanced)
const DEFAULT_THRESHOLDS: VADThresholds = {
  speechThreshold: 0.5,
  minSilenceDurationMs: 300,
  minSpeechDurationMs: 250,
  speechPadMs: 30,
};

export interface VADOptions {
  /** Override VAD thresholds from sensitivity slider */
  thresholds?: VADThresholds;
  /** Additive bias to speech threshold (from learned feedback profile) */
  thresholdBias?: number;
}

/**
 * Detect speech segments in raw PCM audio data (16 kHz, mono, float32le).
 *
 * Tries Silero VAD (neural network) first. If that fails to load or
 * encounters an error, falls back to energy-based detection.
 *
 * The Silero model is loaded once on first use and cached for subsequent calls.
 */
export class SpeechDetector {
  private sileroVAD: SileroVAD;
  private sileroReady = false;
  private sileroInitPromise: Promise<void> | null = null;

  constructor() {
    this.sileroVAD = new SileroVAD();

    // Start loading Silero in the background
    this.sileroInitPromise = this.sileroVAD.init()
      .then(() => {
        this.sileroReady = true;
        logger.info('Silero VAD ready (neural network detection active)');
      })
      .catch((err: any) => {
        logger.warn(`Silero VAD unavailable, using energy-based fallback: ${err.message}`);
        this.sileroReady = false;
      });
  }

  /**
   * Detect speech segments from a raw PCM file.
   * @param rawPcmPath Path to the .raw file (float32le, 16kHz, mono)
   * @param offsetSeconds Time offset to add to all segment boundaries
   * @param opts VAD options (thresholds + bias) for this specific run
   * @returns Array of speech segments with absolute times
   */
  async detect(rawPcmPath: string, offsetSeconds: number = 0, opts?: VADOptions): Promise<SpeechSegment[]> {
    const buffer = fs.readFileSync(rawPcmPath);
    // Slice the underlying ArrayBuffer to avoid Node.js Buffer pool offset issues
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const samples = new Float32Array(ab);

    return this.detectFromSamples(samples, offsetSeconds, opts);
  }

  /**
   * Core VAD on raw float32 samples.
   */
  async detectFromSamples(samples: Float32Array, offsetSeconds: number = 0, opts?: VADOptions): Promise<SpeechSegment[]> {
    const thresholds = opts?.thresholds ?? DEFAULT_THRESHOLDS;
    const thresholdBias = opts?.thresholdBias ?? 0;

    // Wait for Silero init to complete (only blocks on first call)
    if (this.sileroInitPromise) {
      await this.sileroInitPromise;
      this.sileroInitPromise = null;
    }

    if (this.sileroReady) {
      try {
        return await this.detectWithSilero(samples, offsetSeconds, thresholds, thresholdBias);
      } catch (err: any) {
        logger.warn(`Silero VAD error, falling back to energy-based: ${err.message}`);
      }
    }

    // Fallback: energy-based detection
    return this.detectWithEnergy(samples, offsetSeconds, thresholds);
  }

  // ================================================================
  // Silero VAD (neural network) detection
  // ================================================================

  private async detectWithSilero(
    samples: Float32Array,
    offsetSeconds: number,
    thresholds: VADThresholds,
    thresholdBias: number,
  ): Promise<SpeechSegment[]> {
    const effectiveThreshold = Math.max(0.1, Math.min(0.95,
      thresholds.speechThreshold + thresholdBias,
    ));

    const opts: SileroVADOptions = {
      threshold: effectiveThreshold,
      negThresholdDelta: 0.15,
      minSilenceDurationMs: thresholds.minSilenceDurationMs,
      minSpeechDurationMs: thresholds.minSpeechDurationMs,
      speechPadMs: thresholds.speechPadMs,
    };

    logger.info(
      `Silero VAD: threshold=${effectiveThreshold.toFixed(2)}, ` +
      `minSilence=${opts.minSilenceDurationMs}ms, ` +
      `minSpeech=${opts.minSpeechDurationMs}ms, ` +
      `pad=${opts.speechPadMs}ms`,
    );

    const timestamps = await this.sileroVAD.getSpeechTimestamps(samples, opts, offsetSeconds);

    return timestamps.map((ts) => ({
      startTime: ts.start,
      endTime: ts.end,
      isSpeech: true,
    }));
  }

  // ================================================================
  // Energy-based fallback detection
  // ================================================================

  private async detectWithEnergy(
    samples: Float32Array,
    offsetSeconds: number,
    thresholds: VADThresholds,
  ): Promise<SpeechSegment[]> {
    const totalFrames = Math.floor(samples.length / FRAME_SIZE);
    if (totalFrames === 0) return [];

    // Convert threshold parameters to frame counts
    const minBreakFrames = Math.ceil((thresholds.minSilenceDurationMs) / FRAME_SIZE_MS);
    const minSpeechFrames = Math.ceil((thresholds.minSpeechDurationMs) / FRAME_SIZE_MS);

    logger.info(
      `Energy-based VAD: minSilence=${thresholds.minSilenceDurationMs}ms, ` +
      `minSpeech=${thresholds.minSpeechDurationMs}ms`,
    );

    // ----- Pass 1: compute per-frame RMS energy -----
    const energies: number[] = new Array(totalFrames);
    for (let i = 0; i < totalFrames; i++) {
      const start = i * FRAME_SIZE;
      let sumSq = 0;
      for (let j = start; j < start + FRAME_SIZE; j++) {
        sumSq += samples[j] * samples[j];
      }
      energies[i] = Math.sqrt(sumSq / FRAME_SIZE);
    }

    // ----- Adaptive threshold -----
    const sorted = [...energies].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.10)];
    const p90 = sorted[Math.floor(sorted.length * 0.90)];
    const dynamicRange = p90 / Math.max(p10, 1e-10);

    let threshold: number;
    if (dynamicRange > 3) {
      threshold = Math.sqrt(p10 * p90);
    } else {
      const median = sorted[Math.floor(sorted.length / 2)];
      threshold = Math.max(median * SPEECH_THRESHOLD_FACTOR, 0.005);
    }
    threshold = Math.max(threshold, 0.0005);

    // ----- Pass 2: classify frames -----
    const isSpeech: boolean[] = energies.map((e) => e > threshold);

    // ----- Smoothing: fill short gaps -----
    let gapStart = -1;
    for (let i = 0; i < isSpeech.length; i++) {
      if (!isSpeech[i]) {
        if (gapStart < 0) gapStart = i;
      } else {
        if (gapStart >= 0) {
          const gapLen = i - gapStart;
          if (gapLen < minBreakFrames) {
            for (let j = gapStart; j < i; j++) isSpeech[j] = true;
          }
          gapStart = -1;
        }
      }
    }

    // ----- Extract segments -----
    const rawSegments: SpeechSegment[] = [];
    let segStart = -1;
    for (let i = 0; i < isSpeech.length; i++) {
      if (isSpeech[i] && segStart < 0) {
        segStart = i;
      } else if (!isSpeech[i] && segStart >= 0) {
        rawSegments.push({
          startTime: (segStart * FRAME_SIZE) / SAMPLE_RATE + offsetSeconds,
          endTime: (i * FRAME_SIZE) / SAMPLE_RATE + offsetSeconds,
          isSpeech: true,
        });
        segStart = -1;
      }
    }
    // Handle segment that extends to end
    if (segStart >= 0) {
      rawSegments.push({
        startTime: (segStart * FRAME_SIZE) / SAMPLE_RATE + offsetSeconds,
        endTime: (totalFrames * FRAME_SIZE) / SAMPLE_RATE + offsetSeconds,
        isSpeech: true,
      });
    }

    // ----- Filter out very short speech segments -----
    const minDuration = (minSpeechFrames * FRAME_SIZE) / SAMPLE_RATE;
    return rawSegments.filter((seg) => (seg.endTime - seg.startTime) >= minDuration);
  }

  /**
   * Release resources.
   */
  async dispose(): Promise<void> {
    if (this.sileroVAD) {
      await this.sileroVAD.dispose();
    }
  }
}
