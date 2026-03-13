import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/**
 * Manages output directories and file-naming utilities.
 */
export class FileService {
  /**
   * Get a stable base directory for output.
   * In packaged app: directory containing the executable.
   * In development: project root derived from __dirname
   *   (compiled to dist/main/services/ → go up 3 levels).
   */
  private static getBaseDir(): string {
    if (app.isPackaged) {
      return path.dirname(app.getPath('exe'));
    }
    // __dirname is dist/main/services when compiled; resolve to project root
    return path.resolve(__dirname, '..', '..', '..');
  }

  /**
   * Ensure the output directory exists for a given input file.
   * Pattern: <baseDir>/output/<inputFileNameWithoutExt>/
   */
  static ensureOutputDir(inputFilePath: string): string {
    const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
    const outputDir = path.join(FileService.getBaseDir(), 'output', baseName);
    fs.mkdirSync(outputDir, { recursive: true });
    return outputDir;
  }

  /**
   * Build a timestamp-based filename, e.g. "00m30s-01m15s.mp3"
   */
  static timestampFileName(startSec: number, endSec: number): string {
    const fmt = (s: number): string => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${String(m).padStart(2, '0')}m${String(sec).padStart(2, '0')}s`;
    };
    return `${fmt(startSec)}-${fmt(endSec)}.mp3`;
  }

  /**
   * Sanitize a string for use as a Windows filename.
   */
  static sanitizeFileName(name: string): string {
    // Remove characters illegal on Windows
    let clean = name.replace(/[\\/:*?"<>|]/g, '').trim();
    // Replace whitespace runs with hyphen
    clean = clean.replace(/\s+/g, '-').toLowerCase();
    // Remove leading/trailing dots or hyphens
    clean = clean.replace(/^[.\-]+|[.\-]+$/g, '');
    return clean || 'untitled';
  }

  /**
   * Generate a unique filename inside `dir`. Appends -1, -2, etc. if needed.
   */
  static uniqueName(dir: string, baseName: string, ext: string = '.mp3'): string {
    let candidate = baseName + ext;
    let counter = 1;
    while (fs.existsSync(path.join(dir, candidate))) {
      candidate = `${baseName}-${counter}${ext}`;
      counter++;
    }
    return candidate;
  }
}
