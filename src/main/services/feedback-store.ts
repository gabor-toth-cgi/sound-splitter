// ============================================================
// Feedback Store – Persists user feedback and learned VAD profiles
//
// Stores data in app.getPath('userData')/vad-profiles.json
// Uses simple online gradient descent on threshold bias.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { SegmentFeedback, VADProfile } from '../../shared/types';
import { logger } from './logger';

const STORE_FILENAME = 'vad-profiles.json';
const LEARNING_RATE = 0.05;  // small step per feedback sample

interface StoreData {
  profiles: Record<string, VADProfile>;
  feedbackLog: SegmentFeedback[];
}

export class FeedbackStore {
  private storePath: string;
  private data: StoreData;

  constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILENAME);
    this.data = this.load();
  }

  /**
   * Load stored data from disk.
   */
  private load(): StoreData {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf-8');
        const parsed = JSON.parse(raw);
        // Validate structure: profiles must be a plain object, feedbackLog must be an array
        if (
          parsed &&
          typeof parsed.profiles === 'object' &&
          parsed.profiles !== null &&
          !Array.isArray(parsed.profiles) &&
          Array.isArray(parsed.feedbackLog)
        ) {
          logger.debug(`Loaded ${Object.keys(parsed.profiles).length} VAD profile(s) from store`);
          return parsed as StoreData;
        }
        logger.warn('Feedback store has invalid structure, resetting to defaults');
      }
    } catch (err: any) {
      logger.warn(`Failed to load feedback store: ${err.message}`);
    }
    return { profiles: {}, feedbackLog: [] };
  }

  /**
   * Persist data to disk.
   */
  private save(): void {
    try {
      fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err: any) {
      logger.warn(`Failed to save feedback store: ${err.message}`);
    }
  }

  /**
   * Record user feedback and update the corresponding profile.
   */
  submitFeedback(feedback: SegmentFeedback): void {
    // Append to log
    this.data.feedbackLog.push(feedback);

    // Trim log to last 1000 entries to prevent unbounded growth
    if (this.data.feedbackLog.length > 1000) {
      this.data.feedbackLog = this.data.feedbackLog.slice(-1000);
    }

    // Get or create profile for this file
    let profile = this.data.profiles[feedback.fileHash];
    if (!profile) {
      profile = {
        fileHash: feedback.fileHash,
        adjustedSensitivity: feedback.sensitivity,
        thresholdBias: 0,
        sampleCount: 0,
        energySignature: feedback.energySignature || [],
      };
      this.data.profiles[feedback.fileHash] = profile;
    }

    // Update profile via online gradient descent
    profile.sampleCount += 1;

    if (feedback.rating === 'correct') {
      // Positive feedback: reinforce current settings (small pull toward 0 bias)
      profile.thresholdBias *= (1 - LEARNING_RATE);
    } else {
      // Wrong split: adjust threshold bias
      switch (feedback.action) {
        case 'merge-prev':
        case 'merge-next':
          // Splits are too aggressive → increase threshold (more conservative)
          profile.thresholdBias += LEARNING_RATE;
          break;
        case 'not-speech':
          // False positive → increase threshold significantly
          profile.thresholdBias += LEARNING_RATE * 2;
          break;
        default:
          // Generic wrong → slight increase in threshold
          profile.thresholdBias += LEARNING_RATE;
          break;
      }
    }

    // Clamp bias to reasonable range [-0.3, +0.3]
    profile.thresholdBias = Math.max(-0.3, Math.min(0.3, profile.thresholdBias));

    // Update adjusted sensitivity based on bias direction
    if (profile.thresholdBias > 0.1) {
      profile.adjustedSensitivity = Math.min(10, feedback.sensitivity + 1);
    } else if (profile.thresholdBias < -0.1) {
      profile.adjustedSensitivity = Math.max(1, feedback.sensitivity - 1);
    } else {
      profile.adjustedSensitivity = feedback.sensitivity;
    }

    // Update energy signature (running average)
    if (feedback.energySignature && feedback.energySignature.length > 0) {
      if (profile.energySignature.length === 0) {
        profile.energySignature = [...feedback.energySignature];
      } else {
        // Weighted running average — use the shorter length to avoid index-out-of-bounds
        const weight = 1 / profile.sampleCount;
        const len = Math.min(profile.energySignature.length, feedback.energySignature.length);
        const merged: number[] = [];
        for (let i = 0; i < len; i++) {
          merged.push(profile.energySignature[i] * (1 - weight) + feedback.energySignature[i] * weight);
        }
        profile.energySignature = merged;
      }
    }

    this.save();
    logger.info(
      `Feedback recorded: ${feedback.rating} for segment ${feedback.segmentId}. ` +
      `Profile bias: ${profile.thresholdBias.toFixed(3)}, ` +
      `adjusted sensitivity: ${profile.adjustedSensitivity}`,
    );
  }

  /**
   * Get the learned profile for a given file hash, or null if none exists.
   */
  getProfile(fileHash: string): VADProfile | null {
    return this.data.profiles[fileHash] ?? null;
  }

  /**
   * Find the best matching profile by energy signature similarity.
   * Returns null if no profiles exist or similarity is too low.
   */
  findSimilarProfile(energySignature: number[]): VADProfile | null {
    if (energySignature.length === 0) return null;

    let bestProfile: VADProfile | null = null;
    let bestSimilarity = -1;
    const threshold = 0.7; // minimum cosine similarity

    for (const profile of Object.values(this.data.profiles)) {
      if (profile.energySignature.length === 0) continue;
      const similarity = this.cosineSimilarity(energySignature, profile.energySignature);
      if (similarity > threshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestProfile = profile;
      }
    }

    return bestProfile;
  }

  /**
   * Cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < len; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}
