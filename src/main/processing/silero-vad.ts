// ============================================================
// Silero VAD – Neural network voice activity detection using
// the Silero VAD v5 ONNX model via onnxruntime-node.
//
// Model inputs:
//   input  [batch, 576]    float32 – 512 audio samples + 64 context
//   state  [2, batch, 128] float32 – LSTM hidden/cell state
//   sr     scalar          int64   – sample rate (16000)
//
// Model outputs:
//   output [batch, 1]      float32 – speech probability [0.0-1.0]
//   stateN [2, batch, 128] float32 – updated LSTM state
// ============================================================

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { logger } from '../services/logger';

const SAMPLE_RATE = 16000;
const WINDOW_SIZE = 512;    // 512 samples = 32ms at 16kHz
const CONTEXT_SIZE = 64;    // 64-sample context prepended to each chunk
const INPUT_SIZE = WINDOW_SIZE + CONTEXT_SIZE; // 576
const STATE_DIM = 128;      // LSTM state dimension

export interface SileroVADResult {
  /** Per-chunk speech probabilities, one per WINDOW_SIZE (512-sample) chunk */
  probabilities: number[];
  /** Duration of each chunk in seconds */
  chunkDuration: number;
}

export interface SpeechTimestamp {
  start: number;  // seconds
  end: number;    // seconds
}

export interface SileroVADOptions {
  /** Speech probability threshold (0.0-1.0). Default 0.5. */
  threshold?: number;
  /** Negative threshold delta below main threshold to end speech. Default 0.15. */
  negThresholdDelta?: number;
  /** Minimum silence duration in ms to split segments. Default 300. */
  minSilenceDurationMs?: number;
  /** Minimum speech duration in ms to keep a segment. Default 250. */
  minSpeechDurationMs?: number;
  /** Padding in ms added to start/end of each segment. Default 30. */
  speechPadMs?: number;
}

/**
 * Wrapper around the Silero VAD ONNX model.
 * Call init() once, then use process() or getSpeechTimestamps() on audio data.
 */
export class SileroVAD {
  private session: import('onnxruntime-node').InferenceSession | null = null;
  private ort: typeof import('onnxruntime-node') | null = null;
  private _isLoaded = false;

  get isLoaded(): boolean {
    return this._isLoaded;
  }

  /**
   * Resolve the model path. Works in:
   *   1. Packaged Electron app (process.resourcesPath/models/)
   *   2. Electron dev mode (app.getAppPath()/resources/models/)
   *   3. Headless Node.js (cwd or __dirname-based resolution)
   */
  private getModelPath(): string {
    // In packaged app, extraResources copies to process.resourcesPath
    if (typeof process.resourcesPath === 'string') {
      const packaged = path.join(process.resourcesPath, 'models', 'silero_vad.onnx');
      if (fs.existsSync(packaged)) return packaged;
    }

    // In Electron development, resources/models/ is relative to app root
    try {
      const dev = path.join(app.getAppPath(), 'resources', 'models', 'silero_vad.onnx');
      if (fs.existsSync(dev)) return dev;
    } catch {
      // app.getAppPath() may throw if Electron is mocked or unavailable
    }

    // Fallback: try relative to current working directory
    const cwd = path.join(process.cwd(), 'resources', 'models', 'silero_vad.onnx');
    if (fs.existsSync(cwd)) return cwd;

    // Fallback: resolve from __dirname (dist/main/processing/) up to project root
    const fromDirname = path.resolve(__dirname, '..', '..', '..', 'resources', 'models', 'silero_vad.onnx');
    if (fs.existsSync(fromDirname)) return fromDirname;

    throw new Error('Silero VAD model not found. Expected at resources/models/silero_vad.onnx');
  }

  /**
   * Load the ONNX model. Must be called before processing.
   */
  async init(): Promise<void> {
    if (this._isLoaded) return;

    try {
      // Dynamic require to avoid issues if onnxruntime-node isn't available
      this.ort = require('onnxruntime-node');
    } catch (err: any) {
      throw new Error(`Failed to load onnxruntime-node: ${err.message}`);
    }

    const modelPath = this.getModelPath();
    logger.info(`Loading Silero VAD model from: ${modelPath}`);

    this.session = await this.ort!.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: 1,
    });

    logger.info(`Silero VAD model loaded. Inputs: [${this.session.inputNames}], Outputs: [${this.session.outputNames}]`);
    this._isLoaded = true;
  }

  /**
   * Process raw PCM audio (16kHz, mono, float32) and return per-chunk speech
   * probabilities.
   */
  async process(samples: Float32Array): Promise<SileroVADResult> {
    if (!this.session || !this.ort) {
      throw new Error('SileroVAD not initialized. Call init() first.');
    }

    const totalChunks = Math.floor(samples.length / WINDOW_SIZE);
    if (totalChunks === 0) {
      return { probabilities: [], chunkDuration: WINDOW_SIZE / SAMPLE_RATE };
    }

    const probabilities: number[] = [];

    // Initialize LSTM state: [2, 1, 128] zeros
    let stateData = new Float32Array(2 * 1 * STATE_DIM); // all zeros

    // Initialize context: 64 zeros
    let context = new Float32Array(CONTEXT_SIZE);

    // Sample rate tensor (int64 scalar) — created once, reused across iterations
    const srData = BigInt64Array.from([BigInt(SAMPLE_RATE)]);
    const srTensor = new this.ort.Tensor('int64', srData, []);

    // Pre-allocate the input data buffer outside the loop to reduce GC pressure
    const inputData = new Float32Array(INPUT_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      // Extract 512-sample audio chunk
      const audioChunk = samples.slice(i * WINDOW_SIZE, (i + 1) * WINDOW_SIZE);

      // Build input: [context(64) + audio(512)] = 576 samples (reuse pre-allocated buffer)
      inputData.set(context, 0);
      inputData.set(audioChunk, CONTEXT_SIZE);

      // Create tensors
      const inputTensor = new this.ort.Tensor('float32', inputData, [1, INPUT_SIZE]);
      const stateTensor = new this.ort.Tensor('float32', stateData, [2, 1, STATE_DIM]);

      // Run inference
      const feeds: Record<string, import('onnxruntime-node').Tensor> = {
        input: inputTensor,
        state: stateTensor,
        sr: srTensor,
      };

      const results = await this.session.run(feeds);

      // Extract output probability
      const outputData = results['output'].data as Float32Array;
      probabilities.push(outputData[0]);

      // Update LSTM state for next chunk
      stateData = new Float32Array(results['stateN'].data as Float32Array);

      // Update context: last 64 samples of current audio chunk
      context = audioChunk.slice(audioChunk.length - CONTEXT_SIZE);
    }

    return {
      probabilities,
      chunkDuration: WINDOW_SIZE / SAMPLE_RATE,
    };
  }

  /**
   * Port of Silero's `get_speech_timestamps` post-processing.
   * Takes raw speech probabilities and returns merged speech timestamps.
   *
   * @param samples Raw PCM audio (16kHz mono float32)
   * @param opts VAD options (threshold, min durations, padding)
   * @param offsetSeconds Time offset added to all timestamps
   * @returns Array of speech timestamps in seconds
   */
  async getSpeechTimestamps(
    samples: Float32Array,
    opts?: SileroVADOptions,
    offsetSeconds: number = 0,
  ): Promise<SpeechTimestamp[]> {
    const threshold = opts?.threshold ?? 0.5;
    const negThreshold = threshold - (opts?.negThresholdDelta ?? 0.15);
    const minSilenceSamples = Math.floor(((opts?.minSilenceDurationMs ?? 300) * SAMPLE_RATE) / 1000);
    const minSpeechSamples = Math.floor(((opts?.minSpeechDurationMs ?? 250) * SAMPLE_RATE) / 1000);
    const speechPadSamples = Math.floor(((opts?.speechPadMs ?? 30) * SAMPLE_RATE) / 1000);

    const { probabilities } = await this.process(samples);

    if (probabilities.length === 0) return [];

    // Convert chunk-level probabilities to sample-level speech regions
    const speeches: SpeechTimestamp[] = [];
    let triggered = false;
    let speechStart = 0;
    let tempEnd = 0;

    for (let i = 0; i < probabilities.length; i++) {
      const prob = probabilities[i];
      const currentSample = i * WINDOW_SIZE;

      if (prob >= threshold && !triggered) {
        // Speech start
        triggered = true;
        speechStart = currentSample;
        tempEnd = 0;
      } else if (prob < negThreshold && triggered) {
        // Potential speech end
        if (tempEnd === 0) {
          tempEnd = currentSample;
        }
        // Check if silence duration exceeds minimum
        if (currentSample - tempEnd >= minSilenceSamples) {
          // Confirm end of speech
          speeches.push({
            start: speechStart,
            end: tempEnd,
          });
          triggered = false;
          tempEnd = 0;
        }
      } else if (prob >= threshold && triggered) {
        // Still in speech, reset temp end
        tempEnd = 0;
      }
    }

    // Handle speech that extends to end of audio
    if (triggered) {
      speeches.push({
        start: speechStart,
        end: probabilities.length * WINDOW_SIZE,
      });
    }

    // Filter out segments shorter than minSpeechDuration
    const filtered = speeches.filter(
      (s) => (s.end - s.start) >= minSpeechSamples,
    );

    // Apply padding and convert to seconds
    const audioDuration = samples.length / SAMPLE_RATE;
    return filtered.map((s) => ({
      start: Math.max(0, s.start - speechPadSamples) / SAMPLE_RATE + offsetSeconds,
      end: Math.min(audioDuration, (s.end + speechPadSamples) / SAMPLE_RATE) + offsetSeconds,
    }));
  }

  /**
   * Release the ONNX session.
   */
  async dispose(): Promise<void> {
    if (this.session) {
      // Release ONNX session resources if available (added in later onnxruntime versions)
      if (typeof (this.session as any).release === 'function') {
        try {
          await (this.session as any).release();
        } catch { /* best-effort release */ }
      }
      this.session = null;
      this._isLoaded = false;
    }
  }
}
