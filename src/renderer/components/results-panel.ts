// ============================================================
// Results Panel Component
// ============================================================

import { OutputFile, SegmentFeedback, formatTime } from '../../shared/types';

declare const api: import('../../main/preload').SoundSplitterAPI;

export class ResultsPanel {
  private listEl: HTMLElement;
  private results: Map<string, OutputFile> = new Map();
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private _fileHash: string = '';
  private _sensitivity: number = 5;

  constructor() {
    this.listEl = document.getElementById('results-list')!;
  }

  /** Set the source file hash (used for feedback context) */
  set fileHash(hash: string) {
    this._fileHash = hash;
  }

  /** Set the sensitivity level used for current processing run */
  set sensitivity(val: number) {
    this._sensitivity = val;
  }

  addResult(file: OutputFile): void {
    this.results.set(file.id, file);
    this.renderList();
  }

  updateResult(file: OutputFile): void {
    // Remove stale audio element if the file path changed
    const existing = this.results.get(file.id);
    if (existing && existing.filePath !== file.filePath) {
      this.disposeAudio(file.id);
    }
    this.results.set(file.id, file);
    this.renderList();
  }

  clear(): void {
    this.stopAll();
    this.disposeAllAudio();
    this.results.clear();
    this.renderList();
  }

  private disposeAudio(id: string): void {
    const audio = this.audioElements.get(id);
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load(); // release media resource
      this.audioElements.delete(id);
    }
  }

  private disposeAllAudio(): void {
    this.audioElements.forEach((_audio, id) => this.disposeAudio(id));
  }

  private stopAll(): void {
    this.audioElements.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
  }

  private renderList(): void {
    if (this.results.size === 0) {
      this.listEl.innerHTML =
        '<p class="results-empty">No results yet. Load a file and start processing.</p>';
      return;
    }

    // Remove the empty placeholder if present
    const placeholder = this.listEl.querySelector('.results-empty');
    if (placeholder) placeholder.remove();

    // Build a set of current IDs for cleanup
    const currentIds = new Set(this.results.keys());

    // Remove rows that are no longer in results
    this.listEl.querySelectorAll('.result-row').forEach((row) => {
      const id = (row as HTMLElement).dataset.id;
      if (id && !currentIds.has(id)) {
        row.remove();
      }
    });

    // Update existing rows or append new ones
    this.results.forEach((file) => {
      const existing = this.listEl.querySelector(`.result-row[data-id="${file.id}"]`);
      if (existing) {
        // Update in-place: replace the row with a freshly built one
        const newRow = this.buildRow(file);
        existing.replaceWith(newRow);
      } else {
        // Append new row
        this.listEl.appendChild(this.buildRow(file));
      }
    });
  }

  /**
   * Build a single result row DOM element for a given file.
   */
  private buildRow(file: OutputFile): HTMLElement {
    const row = document.createElement('div');
    row.className = 'result-row';
    row.dataset.id = file.id;

      // Name (with rename input if needed)
      const nameEl = document.createElement('div');
      nameEl.className = 'result-name';
      if (file.needsRename && file.status === 'ready') {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = file.suggestedName || file.fileName.replace('.mp3', '');
        input.title = `Suggested: ${file.suggestedName || file.fileName} (${Math.round(file.confidence * 100)}% confidence)`;
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            this.renameFile(file.id, input.value);
          }
        });
        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn btn-sm';
        renameBtn.textContent = 'Rename';
        renameBtn.addEventListener('click', () => this.renameFile(file.id, input.value));
        nameEl.appendChild(input);
        nameEl.appendChild(renameBtn);
      } else {
        nameEl.textContent = file.fileName;
        nameEl.title = file.filePath;
      }

      // Duration
      const durEl = document.createElement('span');
      durEl.className = 'result-duration';
      durEl.textContent = formatTime(file.duration);

      // Confidence badge
      const confEl = document.createElement('span');
      const confPct = Math.round(file.confidence * 100);
      confEl.className = 'confidence';
      if (file.status === 'processing') {
        confEl.textContent = '...';
      } else if (file.confidence > 0) {
        confEl.textContent = `${confPct}%`;
        confEl.classList.add(confPct >= 80 ? 'high' : confPct >= 60 ? 'medium' : 'low');
      }

      // Warning icon
      const warnEl = document.createElement('span');
      warnEl.className = 'result-warn';
      if (file.needsRename && file.status === 'ready') {
        warnEl.textContent = '!';
        warnEl.title = 'Low confidence \u2013 please verify the filename';
      }

      // Feedback buttons (thumbs up / thumbs down)
      const thumbsUpBtn = document.createElement('button');
      thumbsUpBtn.className = 'feedback-btn' + (file.feedback === 'correct' ? ' active-correct' : '');
      thumbsUpBtn.innerHTML = '&#x1F44D;';
      thumbsUpBtn.title = 'Split is correct';
      thumbsUpBtn.disabled = file.status !== 'ready';
      thumbsUpBtn.addEventListener('click', () => this.submitFeedback(file, 'correct'));

      const thumbsDownBtn = document.createElement('button');
      thumbsDownBtn.className = 'feedback-btn' + (file.feedback === 'wrong' ? ' active-wrong' : '');
      thumbsDownBtn.innerHTML = '&#x1F44E;';
      thumbsDownBtn.title = 'Split is wrong';
      thumbsDownBtn.disabled = file.status !== 'ready';
      thumbsDownBtn.addEventListener('click', () => this.submitFeedback(file, 'wrong'));

      // Play / Stop buttons
      const playBtn = document.createElement('button');
      playBtn.className = 'btn btn-sm';
      playBtn.textContent = '\u25B6';
      playBtn.title = 'Play';
      playBtn.disabled = file.status !== 'ready';
      playBtn.addEventListener('click', () => this.playResult(file));

      const stopBtn = document.createElement('button');
      stopBtn.className = 'btn btn-sm';
      stopBtn.textContent = '\u25A0';
      stopBtn.title = 'Stop';
      stopBtn.disabled = file.status !== 'ready';
      stopBtn.addEventListener('click', () => this.stopResult(file.id));

      row.appendChild(nameEl);
      row.appendChild(durEl);
      row.appendChild(confEl);
      row.appendChild(warnEl);
      row.appendChild(thumbsUpBtn);
      row.appendChild(thumbsDownBtn);
      row.appendChild(playBtn);
      row.appendChild(stopBtn);

      return row;
  }

  private submitFeedback(file: OutputFile, rating: 'correct' | 'wrong'): void {
    // Toggle: if clicking same rating, clear it
    if (file.feedback === rating) {
      file.feedback = null;
      this.renderList();
      return;
    }

    file.feedback = rating;

    const feedback: SegmentFeedback = {
      segmentId: file.id,
      fileHash: this._fileHash,
      rating,
      sensitivity: this._sensitivity,
      startTime: file.startTime,
      endTime: file.endTime,
    };

    // If wrong, default action is generic (could be extended with a dropdown later)
    if (rating === 'wrong') {
      feedback.action = undefined;
    }

    api.submitFeedback(feedback);
    this.renderList();
  }

  private playResult(file: OutputFile): void {
    // Stop any currently playing
    this.stopAll();

    let audio = this.audioElements.get(file.id);
    if (!audio) {
      const fileUrl = 'file:///' + file.filePath.replace(/\\/g, '/').replace(/^\/+/, '');
      audio = new Audio(fileUrl);
      this.audioElements.set(file.id, audio);
    }
    audio.currentTime = 0;
    audio.play().catch((e) => console.error('Playback error:', e));
  }

  private stopResult(id: string): void {
    const audio = this.audioElements.get(id);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  private async renameFile(id: string, newName: string): Promise<void> {
    const result = await api.renameFile(id, newName);
    if (result) {
      const file = this.results.get(id);
      if (file) {
        // Remove stale audio element for the old path
        this.disposeAudio(id);
        // Update local state with new file info
        file.fileName = result.fileName;
        file.filePath = result.filePath;
        file.needsRename = false;
        this.renderList();
      }
    }
  }
}
