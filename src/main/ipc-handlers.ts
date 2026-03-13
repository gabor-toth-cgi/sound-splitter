import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { IPC, SegmentFeedback, formatTime, simpleHash, SupportedLanguage } from '../shared/types';
import { logger } from './services/logger';
import { ProcessingPipeline } from './processing/processing-pipeline';
import { SpeechDetector } from './processing/speech-detector';
import { SpeechRecognizer } from './processing/speech-recognizer';
import { FileService } from './services/file-service';
import { FeedbackStore } from './services/feedback-store';

let pipeline: ProcessingPipeline | null = null;
let feedbackStore: FeedbackStore | null = null;

// Shared singleton instances — models are loaded once and reused across pipeline runs
let sharedSpeechDetector: SpeechDetector | null = null;
let sharedSpeechRecognizer: SpeechRecognizer | null = null;

/** Allowed audio/video file extensions for processing input. */
const ALLOWED_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma',
  '.mp4', '.mkv', '.avi', '.webm', '.mov',
]);

/** Valid language codes for speech recognition. */
const VALID_LANGUAGES = new Set<SupportedLanguage>(['auto', 'en', 'hu']);

/**
 * Validate that a file path is a real, existing file with an allowed extension.
 * Returns the normalized absolute path, or null if invalid.
 */
function validateInputFile(filePath: unknown): string | null {
  if (!filePath || typeof filePath !== 'string') return null;

  // Resolve to absolute, normalizing any ".." segments
  const resolved = path.resolve(filePath);

  // Check extension whitelist
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    logger.warn(`Rejected file with disallowed extension: ${ext}`);
    return null;
  }

  // Must exist on disk
  if (!fs.existsSync(resolved)) {
    logger.warn(`Input file does not exist: ${resolved}`);
    return null;
  }

  return resolved;
}

/**
 * Validate a user-supplied filename for renaming. Returns sanitized name
 * or null if the input is malicious / empty.
 */
function validateRenameInput(newName: unknown): string | null {
  if (!newName || typeof newName !== 'string') return null;

  // Reject anything that contains path separators or parent traversal
  if (/[/\\]/.test(newName) || newName.includes('..')) {
    logger.warn(`Rejected rename containing path separators or traversal: ${newName}`);
    return null;
  }

  // Strip any .mp3 extension the user may have typed before sanitizing
  const nameWithoutExt = newName.replace(/\.mp3$/i, '');
  return FileService.sanitizeFileName(nameWithoutExt);
}

/**
 * Register all IPC handlers. Call once after the BrowserWindow is created.
 */
export function registerIpcHandlers(win: BrowserWindow): void {
  // Initialize feedback store
  feedbackStore = new FeedbackStore();

  // ---- Open file dialog ----
  ipcMain.handle(IPC.OPEN_FILE_DIALOG, async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Audio File',
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'] },
        { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'webm', 'mov'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    logger.info(`File selected: ${path.basename(filePath)}`);
    return filePath;
  });

  // ---- Start processing ----
  ipcMain.on(IPC.START_PROCESSING, (_event, filePath: string, startTime: number, sensitivity: number, language: string) => {
    // If pipeline is paused, resume it instead of creating a new one
    if (pipeline && pipeline.isPaused()) {
      pipeline.resume();
      logger.info('Processing resumed');
      return;
    }

    // Validate input file
    const validatedPath = validateInputFile(filePath);
    if (!validatedPath) {
      logger.error('Invalid or missing input file path');
      return;
    }

    // Validate numeric arguments
    const validStartTime = typeof startTime === 'number' && isFinite(startTime) && startTime >= 0 ? startTime : 0;
    const sens = typeof sensitivity === 'number' && sensitivity >= 1 && sensitivity <= 10
      ? Math.round(sensitivity) : 5;

    // Validate language
    const validLanguage: SupportedLanguage = VALID_LANGUAGES.has(language as SupportedLanguage)
      ? (language as SupportedLanguage) : 'auto';

    logger.info(`Processing requested from ${formatTime(validStartTime)} for: ${path.basename(validatedPath)} (sensitivity: ${sens}, language: ${validLanguage})`);

    if (pipeline) {
      pipeline.stop();
    }

    // Check for learned profile bias
    let thresholdBias = 0;
    if (feedbackStore) {
      const fileHash = simpleHash(validatedPath);
      const profile = feedbackStore.getProfile(fileHash);
      if (profile) {
        thresholdBias = profile.thresholdBias;
        logger.info(`Applying learned profile: bias=${thresholdBias.toFixed(3)}, suggested sensitivity=${profile.adjustedSensitivity}`);
      }
    }

    // Lazily create shared model instances
    if (!sharedSpeechDetector) {
      sharedSpeechDetector = new SpeechDetector();
    }
    if (!sharedSpeechRecognizer) {
      sharedSpeechRecognizer = new SpeechRecognizer();
    }

    pipeline = new ProcessingPipeline(win, validatedPath, validStartTime, {
      sensitivity: sens,
      thresholdBias,
      language: validLanguage,
      speechDetector: sharedSpeechDetector,
      speechRecognizer: sharedSpeechRecognizer,
    });
    pipeline.start().catch((err) => {
      logger.error(`Processing failed: ${err.message}`);
    });
  });

  // ---- Pause processing ----
  ipcMain.on(IPC.PAUSE_PROCESSING, () => {
    if (pipeline) {
      pipeline.pause();
      logger.info('Processing paused');
    }
  });

  // ---- Stop processing ----
  ipcMain.on(IPC.STOP_PROCESSING, () => {
    if (pipeline) {
      pipeline.stop();
      pipeline = null;
      logger.info('Processing stopped');
    }
  });

  // ---- Rename output file ----
  ipcMain.handle(IPC.RENAME_FILE, async (_event, id: string, newName: string) => {
    try {
      if (!pipeline) return null;
      if (!id || typeof id !== 'string') return null;

      const outputFile = pipeline.getOutputFile(id);
      if (!outputFile) return null;

      // Validate the new name (path traversal protection)
      const sanitized = validateRenameInput(newName);
      if (!sanitized) {
        logger.warn('Rename rejected: invalid name');
        return null;
      }

      // Check that the source file still exists before renaming
      if (!fs.existsSync(outputFile.filePath)) {
        logger.warn(`Rename skipped: source file no longer exists at ${outputFile.filePath}`);
        return null;
      }

      const dir = path.dirname(outputFile.filePath);
      const uniqueName = FileService.uniqueName(dir, sanitized);
      const newPath = path.join(dir, uniqueName);

      // Final safety check: ensure new path stays within the output directory
      const resolvedDir = path.resolve(dir);
      const resolvedNewPath = path.resolve(newPath);
      if (!resolvedNewPath.startsWith(resolvedDir)) {
        logger.warn(`Rename rejected: resolved path escapes output directory`);
        return null;
      }

      fs.renameSync(outputFile.filePath, newPath);
      outputFile.filePath = newPath;
      outputFile.fileName = uniqueName;
      outputFile.needsRename = false;

      logger.info(`File renamed to: ${uniqueName}`);
      return { fileName: uniqueName, filePath: newPath };
    } catch (err: any) {
      logger.error(`Rename failed: ${err.message}`);
      return null;
    }
  });

  // ---- Submit feedback ----
  ipcMain.on(IPC.SUBMIT_FEEDBACK, (_event, feedback: SegmentFeedback) => {
    if (feedbackStore && feedback && typeof feedback.segmentId === 'string' && typeof feedback.fileHash === 'string') {
      feedbackStore.submitFeedback(feedback);
    }
  });

  // ---- Get profile ----
  ipcMain.handle(IPC.GET_PROFILE, async (_event, fileHash: string) => {
    if (feedbackStore && fileHash && typeof fileHash === 'string') {
      return feedbackStore.getProfile(fileHash);
    }
    return null;
  });
}
