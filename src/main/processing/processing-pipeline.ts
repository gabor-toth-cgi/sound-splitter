// ============================================================
// Processing Pipeline – orchestrates VAD, extraction, recognition
// ============================================================

import { BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ProcessingState, OutputFile, IPC, SpeechSegment, VADThresholds, sensitivityToThresholds, formatTime, SupportedLanguage } from '../../shared/types';
import { AudioProcessor } from './audio-processor';
import { SpeechDetector, VADOptions } from './speech-detector';
import { SpeechRecognizer } from './speech-recognizer';
import { FileService } from '../services/file-service';
import { logger } from '../services/logger';

export interface PipelineOptions {
  /** Sensitivity level 1-10 (default 5) */
  sensitivity?: number;
  /** Additive threshold bias from learned profile */
  thresholdBias?: number;
  /** Language for speech recognition ('auto', 'en', 'hu') */
  language?: SupportedLanguage;
  /** Shared SpeechDetector instance (reuses ONNX model across runs) */
  speechDetector?: SpeechDetector;
  /** Shared SpeechRecognizer instance (reuses Whisper model across runs) */
  speechRecognizer?: SpeechRecognizer;
}

export class ProcessingPipeline {
  private win: BrowserWindow;
  private inputPath: string;
  private startTime: number;
  private state: ProcessingState = ProcessingState.IDLE;
  private sensitivity: number;
  private thresholdBias: number;
  private language: SupportedLanguage;

  private audioProcessor: AudioProcessor;
  private speechDetector: SpeechDetector;
  private speechRecognizer: SpeechRecognizer;
  private vadOptions: VADOptions;

  private outputFiles: Map<string, OutputFile> = new Map();
  private usedNames: Set<string> = new Set();
  private pausePromiseResolve: (() => void) | null = null;
  private shouldStop = false;
  /** Sequential queue for recognition tasks to avoid race conditions on usedNames and fs renames */
  private recognitionQueue: Promise<void> = Promise.resolve();

  constructor(win: BrowserWindow, inputPath: string, startTime: number, opts?: PipelineOptions) {
    this.win = win;
    this.inputPath = inputPath;
    this.startTime = startTime;
    this.sensitivity = opts?.sensitivity ?? 5;
    this.thresholdBias = opts?.thresholdBias ?? 0;
    this.language = opts?.language ?? 'auto';

    const thresholds = sensitivityToThresholds(this.sensitivity);

    this.audioProcessor = new AudioProcessor();
    // Reuse shared instances if provided, otherwise create new ones
    this.speechDetector = opts?.speechDetector ?? new SpeechDetector();
    this.speechRecognizer = opts?.speechRecognizer ?? new SpeechRecognizer();
    this.vadOptions = { thresholds, thresholdBias: this.thresholdBias };
  }

  /** Get the sensitivity level used for this pipeline run */
  getSensitivity(): number {
    return this.sensitivity;
  }

  getOutputFile(id: string): OutputFile | undefined {
    return this.outputFiles.get(id);
  }

  getAllOutputFiles(): OutputFile[] {
    return Array.from(this.outputFiles.values());
  }

  private setState(state: ProcessingState): void {
    this.state = state;
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(IPC.PROCESSING_STATE, state);
    }
  }

  /**
   * Start the full processing pipeline.
   */
  async start(): Promise<void> {
    this.shouldStop = false;
    this.setState(ProcessingState.PROCESSING);

    try {
      // Step 1: Initialize speech recognizer (downloads model if needed)
      logger.info('Loading AI models...');
      try {
        await this.speechRecognizer.init((pct: number) => {
          if (pct > 0) logger.debug(`Model download: ${Math.round(pct)}%`);
        });
        logger.info('Whisper model loaded');
      } catch (err: any) {
        logger.warn(`Speech recognition unavailable: ${err.message}. Files will use timestamp names.`);
      }

      // Step 2: Decode audio to raw PCM for VAD
      logger.info(`Decoding audio from ${formatTime(this.startTime)}...`);
      const rawPcmPath = await this.audioProcessor.decodeToRawPCM(this.inputPath, this.startTime);

      if (this.shouldStop) {
        this.audioProcessor.cleanupTempFile(rawPcmPath);
        this.setState(ProcessingState.STOPPED);
        return;
      }

      // Step 3: Run VAD
      logger.info(`Analyzing speech patterns (sensitivity: ${this.sensitivity}/10, language: ${this.language})...`);
      const segments = await this.speechDetector.detect(rawPcmPath, this.startTime, this.vadOptions);
      this.audioProcessor.cleanupTempFile(rawPcmPath);

      if (segments.length === 0) {
        logger.warn('No speech segments detected in the audio.');
        logger.info('Processing complete with 0 results. Try lowering the sensitivity level.');
        this.setState(ProcessingState.IDLE);
        return;
      }

      logger.info(`Detected ${segments.length} speech segment(s)`);

      // Step 4: Ensure output directory
      const outputDir = FileService.ensureOutputDir(this.inputPath);
      logger.info(`Output directory: ${outputDir}`);

      // Step 5: Process each segment
      for (let i = 0; i < segments.length; i++) {
        // Check for stop
        if (this.shouldStop) {
          this.setState(ProcessingState.STOPPED);
          logger.info('Processing stopped by user');
          return;
        }

        // Check for pause
        if (this.state === ProcessingState.PAUSED) {
          logger.info('Processing paused. Waiting to resume...');
          await this.waitForResume();
          if (this.shouldStop) {
            this.setState(ProcessingState.STOPPED);
            return;
          }
          logger.info('Processing resumed');
        }

        const seg = segments[i];
        await this.processSegment(seg, i + 1, segments.length, outputDir);
      }

      logger.info(`Processing complete. ${segments.length} segment(s) produced. Waiting for speech recognition...`);

      // Wait for all queued recognition tasks to complete
      await this.recognitionQueue;

      logger.info('All speech recognition tasks finished.');
      this.setState(ProcessingState.IDLE);

    } catch (err: any) {
      logger.error(`Processing error: ${err.message}`);
      this.setState(ProcessingState.ERROR);
    }
  }

  /**
   * Process a single speech segment: extract, save, recognize, rename.
   */
  private async processSegment(
    seg: SpeechSegment,
    index: number,
    total: number,
    outputDir: string,
  ): Promise<void> {
    const id = crypto.randomUUID();
    const tsName = FileService.timestampFileName(seg.startTime, seg.endTime);
    const outputPath = path.join(outputDir, tsName);

    logger.info(`[${index}/${total}] Extracting segment: ${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}`);

    // Create initial output file record
    const outputFile: OutputFile = {
      id,
      filePath: outputPath,
      fileName: tsName,
      suggestedName: null,
      confidence: 0,
      startTime: seg.startTime,
      endTime: seg.endTime,
      duration: seg.endTime - seg.startTime,
      needsRename: false,
      status: 'processing',
      feedback: null,
    };

    this.outputFiles.set(id, outputFile);

    // Notify renderer of new segment
    this.sendToRenderer(IPC.SEGMENT_PRODUCED, outputFile);

    try {
      // Extract and apply noise reduction
      await this.audioProcessor.extractSegment(
        this.inputPath,
        seg.startTime,
        seg.endTime,
        outputPath,
      );

      // Trim leading/trailing silence
      try {
        await this.audioProcessor.trimSilence(outputPath);
      } catch {
        logger.debug('Silence trimming skipped for segment');
      }

      // Get actual duration after trimming
      outputFile.duration = await this.audioProcessor.getDuration(outputPath);
      outputFile.status = 'ready';
      outputFile.filePath = outputPath;

      logger.info(`[${index}/${total}] Saved: ${tsName} (${outputFile.duration.toFixed(1)}s)`);

      // Notify renderer
      this.sendToRenderer(IPC.SEGMENT_PRODUCED, outputFile);

      // Run speech recognition sequentially (queued to avoid race conditions on usedNames/fs)
      this.recognitionQueue = this.recognitionQueue.then(() =>
        this.recognizeAndRename(outputFile, outputDir, this.language).catch((err) => {
          logger.debug(`Recognition failed for ${tsName}: ${err.message}`);
        })
      );

    } catch (err: any) {
      outputFile.status = 'error';
      this.sendToRenderer(IPC.SEGMENT_PRODUCED, outputFile);
      logger.error(`[${index}/${total}] Failed to extract segment: ${err.message}`);
    }
  }

  /**
   * Run speech recognition on a produced segment and rename the file.
   */
  private async recognizeAndRename(file: OutputFile, outputDir: string, language: SupportedLanguage): Promise<void> {
    try {
      const result = await this.speechRecognizer.recognize(file.filePath, language);

      if (!result.text) {
        logger.debug(`No speech recognized for ${file.fileName}`);
        return;
      }

      const { fileName } = SpeechRecognizer.generateFileName(result.text, this.usedNames);
      this.usedNames.add(fileName);

      file.suggestedName = result.text;
      file.confidence = result.confidence;
      file.needsRename = result.confidence < 0.8;

      // Rename the file (skip if pipeline was stopped)
      if (this.shouldStop) return;

      const newFileName = fileName + '.mp3';
      const newPath = path.join(outputDir, newFileName);

      try {
        fs.renameSync(file.filePath, newPath);
        file.filePath = newPath;
        file.fileName = newFileName;
      } catch {
        // Keep original timestamp name if rename fails
      }

      const confPct = Math.round(result.confidence * 100);
      logger.info(
        `Speech recognized: "${result.text}" (${confPct}% confidence)` +
        (file.needsRename ? ' [needs review]' : '')
      );

      // Notify renderer of updated result
      this.sendToRenderer(IPC.RECOGNITION_RESULT, file);

    } catch (err: any) {
      logger.debug(`Recognition error: ${err.message}`);
    }
  }

  pause(): void {
    if (this.state === ProcessingState.PROCESSING) {
      this.setState(ProcessingState.PAUSED);
    }
  }

  isPaused(): boolean {
    return this.state === ProcessingState.PAUSED;
  }

  resume(): void {
    if (this.state === ProcessingState.PAUSED) {
      this.setState(ProcessingState.PROCESSING);
      if (this.pausePromiseResolve) {
        this.pausePromiseResolve();
        this.pausePromiseResolve = null;
      }
    }
  }

  stop(): void {
    this.shouldStop = true;
    // Unblock any pause wait
    if (this.pausePromiseResolve) {
      this.pausePromiseResolve();
      this.pausePromiseResolve = null;
    }
    this.setState(ProcessingState.STOPPED);
  }

  private waitForResume(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.pausePromiseResolve = resolve;
    });
  }

  private sendToRenderer(channel: string, data: any): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, data);
    }
  }
}
