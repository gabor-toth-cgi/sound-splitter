// ============================================================
// Shared type definitions for Sound Splitter
// ============================================================

/** Supported languages for speech recognition */
export type SupportedLanguage = 'auto' | 'en' | 'hu';

/** Display labels for supported languages */
export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  auto: 'Auto-detect',
  en: 'English',
  hu: 'Hungarian',
};

export enum ProcessingState {
  IDLE = 'idle',
  PROCESSING = 'processing',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  ERROR = 'error',
}

/** A detected speech or non-speech segment from VAD */
export interface SpeechSegment {
  startTime: number; // seconds in source file
  endTime: number;   // seconds in source file
  isSpeech: boolean;
}

/** A produced output file */
export interface OutputFile {
  id: string;
  filePath: string;
  fileName: string;
  suggestedName: string | null;
  confidence: number;       // 0-1 speech-recognition confidence
  startTime: number;        // source start time (seconds)
  endTime: number;          // source end time (seconds)
  duration: number;         // seconds
  needsRename: boolean;     // true when confidence < 0.8
  status: 'processing' | 'ready' | 'error';
  feedback: 'correct' | 'wrong' | null;  // user feedback on split quality
}

/** VAD threshold parameters derived from sensitivity level */
export interface VADThresholds {
  /** Speech probability threshold (0.0-1.0) for Silero VAD */
  speechThreshold: number;
  /** Minimum silence duration in ms to split segments */
  minSilenceDurationMs: number;
  /** Minimum speech duration in ms to keep a segment */
  minSpeechDurationMs: number;
  /** Padding in ms added to start/end of each segment */
  speechPadMs: number;
}

/** User feedback on a specific segment */
export interface SegmentFeedback {
  segmentId: string;
  fileHash: string;          // hash of the source file for matching
  rating: 'correct' | 'wrong';
  action?: 'merge-prev' | 'merge-next' | 'not-speech';
  sensitivity: number;       // sensitivity level used
  startTime: number;
  endTime: number;
  energySignature?: number[];  // energy histogram for profile matching
}

/** Stored VAD profile learned from user feedback */
export interface VADProfile {
  fileHash: string;
  adjustedSensitivity: number;
  thresholdBias: number;     // additive bias to speech threshold
  sampleCount: number;       // number of feedback samples
  energySignature: number[]; // average energy histogram
}

/** Entry shown in the collapsible console log */
export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

/** IPC channel name constants */
export const IPC = {
  // File
  OPEN_FILE_DIALOG: 'open-file-dialog',
  FILE_LOADED: 'file-loaded',

  // Processing control
  START_PROCESSING: 'start-processing',
  PAUSE_PROCESSING: 'pause-processing',
  STOP_PROCESSING: 'stop-processing',
  PROCESSING_STATE: 'processing-state',

  // Results
  SEGMENT_PRODUCED: 'segment-produced',
  RECOGNITION_RESULT: 'recognition-result',
  RENAME_FILE: 'rename-file',

  // Feedback
  SUBMIT_FEEDBACK: 'submit-feedback',
  GET_PROFILE: 'get-profile',

  // Logging
  LOG: 'log-message',

  // Misc
  GET_FFMPEG_PATH: 'get-ffmpeg-path',
} as const;

/**
 * Map sensitivity level (1-10) to VAD threshold parameters.
 * 1 = Very Aggressive (catches everything), 10 = Very Conservative (only clear speech).
 */
export function sensitivityToThresholds(level: number): VADThresholds {
  // Clamp to 1-10
  const s = Math.max(1, Math.min(10, level));
  // Linear interpolation between aggressive (1) and conservative (10)
  const t = (s - 1) / 9; // 0.0 to 1.0

  return {
    speechThreshold: lerp(0.3, 0.8, t),
    minSilenceDurationMs: Math.round(lerp(50, 800, t)),
    minSpeechDurationMs: Math.round(lerp(100, 500, t)),
    speechPadMs: Math.round(lerp(10, 100, t)),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Format a time value in seconds to a human-readable "m:ss" string.
 * Shared utility to avoid duplication across main/renderer code.
 */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Simple non-cryptographic hash of a string for feedback profile matching.
 * Must stay in sync between renderer and main process.
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32-bit integer
  }
  return 'f' + Math.abs(hash).toString(16);
}
