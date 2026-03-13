// ============================================================
// Speech Recognizer – Whisper-based transcription for naming
// ============================================================

import { AudioProcessor } from './audio-processor';
import { FileService } from '../services/file-service';
import { SupportedLanguage } from '../../shared/types';
import * as fs from 'fs';

const MAX_FILENAME_LENGTH = 32;

interface RecognitionResult {
  text: string;
  confidence: number; // 0-1
}

export class SpeechRecognizer {
  private pipeline: any = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private audioProcessor: AudioProcessor;

  /**
   * @param audioProcessor Optional shared AudioProcessor instance. If not provided, creates its own.
   */
  constructor(audioProcessor?: AudioProcessor) {
    this.audioProcessor = audioProcessor ?? new AudioProcessor();
  }

  /**
   * Load the Whisper model. This may download ~75 MB on first run.
   * Safe to call multiple times — subsequent calls are no-ops once loaded.
   * @param onProgress Optional progress callback
   */
  async init(onProgress?: (pct: number) => void): Promise<void> {
    if (this.ready) return;

    // Prevent concurrent init attempts
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this._doInit(onProgress);
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async _doInit(onProgress?: (pct: number) => void): Promise<void> {
    try {
      const { pipeline, env } = await import('@xenova/transformers');

      // Allow local model caching
      env.allowLocalModels = true;
      env.useBrowserCache = false;

      this.pipeline = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-small',
        {
          revision: 'main',
          progress_callback: (progress: any) => {
            if (onProgress && progress.progress !== undefined) {
              onProgress(progress.progress);
            }
          },
        }
      );

      this.ready = true;
    } catch (err) {
      this.ready = false;
      throw new Error(`Failed to load Whisper model: ${err}`);
    }
  }

  /**
   * Transcribe an audio file and return text + confidence.
   * @param audioFilePath Path to audio file to transcribe
   * @param language Language code ('en', 'hu') or 'auto' for auto-detection
   */
  async recognize(audioFilePath: string, language: SupportedLanguage = 'auto'): Promise<RecognitionResult> {
    if (!this.ready || !this.pipeline) {
      throw new Error('Speech recognizer not initialized');
    }

    try {
      // Decode to raw PCM for the model
      const rawPath = await this.audioProcessor.decodeToRawPCM(audioFilePath);

      // Read raw PCM data
      const buffer = fs.readFileSync(rawPath);
      // Slice the underlying ArrayBuffer to avoid Node.js Buffer pool offset issues
      const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      const samples = new Float32Array(ab);

      // Clean up temp file
      this.audioProcessor.cleanupTempFile(rawPath);

      // Run Whisper inference — request timestamps to get chunk-level data
      // For 'auto', omit the language parameter to let Whisper detect it
      const whisperOpts: Record<string, any> = {
        task: 'transcribe',
        return_timestamps: true,
      };
      if (language !== 'auto') {
        whisperOpts.language = language;
      }
      const result = await this.pipeline(samples, whisperOpts);

      const text = (result.text || '').trim();

      // Estimate confidence from the result.
      // Whisper via @xenova/transformers may provide chunk-level confidence
      // scores when return_timestamps is enabled. If not available, we use
      // text-quality heuristics instead of a flat default.
      let confidence = 0;
      if (text.length > 0) {
        // First, try to extract actual chunk confidence scores
        if (result.chunks && Array.isArray(result.chunks)) {
          const scores = result.chunks
            .filter((c: any) => typeof c.confidence === 'number')
            .map((c: any) => c.confidence);
          if (scores.length > 0) {
            confidence = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
          }
        }

        // If no chunk scores available, estimate from text quality
        if (confidence === 0) {
          confidence = this.estimateConfidenceFromText(text, language);
        }
      }

      return { text, confidence };
    } catch (err: any) {
      return { text: '', confidence: 0 };
    }
  }

  /**
   * Estimate transcription confidence from text quality heuristics when
   * Whisper doesn't provide per-chunk confidence scores.
   *
   * Scoring factors:
   *  - Longer text with real words → higher confidence
   *  - Repeated characters/words → lower (likely hallucination)
   *  - Pure punctuation or noise markers → low
   *  - Contains common function words (English or Hungarian) → higher
   */
  private estimateConfidenceFromText(text: string, language: SupportedLanguage = 'auto'): number {
    if (!text || text.length === 0) return 0;

    const cleaned = text.trim();

    // Very short text (1-3 chars) — likely noise
    if (cleaned.length <= 3) return 0.4;

    // Start at a base confidence
    let score = 0.7;

    // Word count bonus: more real words = more likely correct
    const words = cleaned.split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 3) score += 0.1;
    if (words.length >= 6) score += 0.05;

    // Check for common function words (strong signal of real speech)
    const commonEnglishWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'and', 'or',
      'to', 'of', 'in', 'for', 'on', 'it', 'that', 'this', 'with', 'have', 'has',
      'will', 'would', 'can', 'could', 'do', 'does', 'not', 'but', 'so', 'if',
      'we', 'you', 'they', 'he', 'she', 'my', 'your', 'our', 'what', 'how',
      'i', 'me', 'be', 'been', 'just', 'about', 'like', 'all', 'get', 'know']);

    const commonHungarianWords = new Set(['a', 'az', 'egy', 'ez', 'van', 'nem', 'hogy',
      'meg', 'is', 'de', 'mit', 'aki', 'ami', 'volt', 'lesz', 'mint', 'csak',
      'vagy', 'fel', 'ki', 'be', 'el', 'ide', 'oda', 'itt', 'ott', 'most',
      'igen', 'hol', 'mi', 'te', 'en', 'azt', 'ezt', 'nem', 'ha', 'sem',
      'pedig', 'mert', 'nagyon', 'kell', 'fog', 'lett', 'már', 'még', 'után']);

    const lowerWords = words.map(w => w.toLowerCase().replace(/[^a-záéíóöőúüű]/g, ''));

    // For 'auto', check both languages; for specific language, check that one primarily
    let commonCount = 0;
    if (language === 'en') {
      commonCount = lowerWords.filter(w => commonEnglishWords.has(w)).length;
    } else if (language === 'hu') {
      commonCount = lowerWords.filter(w => commonHungarianWords.has(w)).length;
    } else {
      // Auto: count from both, take the higher
      const enCount = lowerWords.filter(w => commonEnglishWords.has(w)).length;
      const huCount = lowerWords.filter(w => commonHungarianWords.has(w)).length;
      commonCount = Math.max(enCount, huCount);
    }

    if (commonCount >= 2) score += 0.05;
    if (commonCount >= 4) score += 0.05;

    // Penalty: text looks like Whisper hallucination (repeated patterns)
    const uniqueWords = new Set(lowerWords);
    if (words.length > 3 && uniqueWords.size / words.length < 0.4) {
      score -= 0.2; // Very repetitive
    }

    // Penalty: mostly non-alphabetic characters
    // Include Hungarian accented characters in the alpha check
    const alphaRatio = (cleaned.match(/[a-zA-ZáéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g) || []).length / cleaned.length;
    if (alphaRatio < 0.5) score -= 0.15;

    // Penalty: known Whisper noise hallucinations
    const noisePatterns = /^(\[.*\]|music|♪|\.{3,}|…+)$/i;
    if (noisePatterns.test(cleaned)) score -= 0.3;

    // Clamp to [0.1, 0.95]
    return Math.max(0.1, Math.min(0.95, score));
  }

  /**
   * Generate a sanitized filename from recognized text.
   */
  static generateFileName(text: string, existingNames: Set<string>): {
    fileName: string;
    truncated: boolean;
  } {
    if (!text || text.trim().length === 0) {
      return { fileName: 'untitled', truncated: false };
    }

    // Use FileService.sanitizeFileName to avoid duplicating sanitization logic
    let name = FileService.sanitizeFileName(text);

    // Truncate if too long
    const truncated = name.length > MAX_FILENAME_LENGTH;
    if (truncated) {
      name = name.substring(0, MAX_FILENAME_LENGTH);
      // Don't end with a hyphen
      name = name.replace(/-+$/, '');
    }

    if (!name) name = 'untitled';

    // Deduplicate
    let candidate = name;
    let counter = 1;
    while (existingNames.has(candidate)) {
      candidate = `${name}-${counter}`;
      counter++;
    }

    return { fileName: candidate, truncated };
  }
}
