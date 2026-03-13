// ============================================================
// Processing Controls Component
// ============================================================

import { ProcessingState, SupportedLanguage } from '../../shared/types';

declare const api: import('../../main/preload').SoundSplitterAPI;

const SENSITIVITY_LABELS: Record<number, string> = {
  1: 'Very Aggressive',
  2: 'Aggressive',
  3: 'Moderately Aggressive',
  4: 'Slightly Aggressive',
  5: 'Balanced',
  6: 'Slightly Conservative',
  7: 'Moderately Conservative',
  8: 'Conservative',
  9: 'Very Conservative',
  10: 'Ultra Conservative',
};

export class ProcessingControls {
  private startBtn: HTMLButtonElement;
  private pauseBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private statusEl: HTMLElement;
  private sensitivitySlider: HTMLInputElement;
  private sensitivityValueEl: HTMLElement;
  private sensitivityDescEl: HTMLElement;
  private languageSelect: HTMLSelectElement;
  private state: ProcessingState = ProcessingState.IDLE;

  private _filePath: string | null = null;
  private _getCurrentTime: (() => number) | null = null;
  private _onProcessingStart: ((sensitivity: number) => void) | null = null;

  constructor() {
    this.startBtn = document.getElementById('btn-start-proc') as HTMLButtonElement;
    this.pauseBtn = document.getElementById('btn-pause-proc') as HTMLButtonElement;
    this.stopBtn = document.getElementById('btn-stop-proc') as HTMLButtonElement;
    this.statusEl = document.getElementById('proc-status')!;
    this.sensitivitySlider = document.getElementById('sensitivity-slider') as HTMLInputElement;
    this.sensitivityValueEl = document.getElementById('sensitivity-value')!;
    this.sensitivityDescEl = document.getElementById('sensitivity-desc')!;
    this.languageSelect = document.getElementById('language-select') as HTMLSelectElement;

    this.startBtn.addEventListener('click', () => this.start());
    this.pauseBtn.addEventListener('click', () => this.pause());
    this.stopBtn.addEventListener('click', () => this.stop());

    // Sensitivity slider
    this.sensitivitySlider.addEventListener('input', () => {
      this.updateSensitivityDisplay();
    });
    this.updateSensitivityDisplay();

    // Listen for state changes from main process
    api.onProcessingState((newState: ProcessingState) => {
      this.state = newState;
      this.updateUI();
    });
  }

  get sensitivity(): number {
    return parseInt(this.sensitivitySlider.value, 10);
  }

  get language(): SupportedLanguage {
    return (this.languageSelect.value as SupportedLanguage) || 'auto';
  }

  set sensitivity(val: number) {
    this.sensitivitySlider.value = String(Math.max(1, Math.min(10, val)));
    this.updateSensitivityDisplay();
  }

  set filePath(p: string | null) {
    this._filePath = p;
    this.startBtn.disabled = !p;
  }

  set getCurrentTime(fn: () => number) {
    this._getCurrentTime = fn;
  }

  set onProcessingStart(cb: (sensitivity: number) => void) {
    this._onProcessingStart = cb;
  }

  private updateSensitivityDisplay(): void {
    const val = this.sensitivity;
    this.sensitivityValueEl.textContent = String(val);
    this.sensitivityDescEl.textContent = SENSITIVITY_LABELS[val] || 'Balanced';
  }

  private start(): void {
    if (!this._filePath) return;
    const startTime = this._getCurrentTime ? this._getCurrentTime() : 0;
    const sens = this.sensitivity;
    const lang = this.language;
    if (this._onProcessingStart) this._onProcessingStart(sens);
    api.startProcessing(this._filePath, startTime, sens, lang);
  }

  private pause(): void {
    if (this.state === ProcessingState.PAUSED) {
      // Resume: sends startProcessing which the main process ipc-handlers.ts
      // intercepts as a resume when pipeline.isPaused() is true.
      // The filePath and startTime params are unused on resume — the pipeline
      // continues from where it was paused. This avoids a dedicated resume IPC.
      if (this._filePath) {
        api.startProcessing(this._filePath, this._getCurrentTime ? this._getCurrentTime() : 0, this.sensitivity, this.language);
      }
    } else {
      api.pauseProcessing();
    }
  }

  private stop(): void {
    api.stopProcessing();
  }

  private updateUI(): void {
    this.statusEl.className = 'proc-status';

    switch (this.state) {
      case ProcessingState.PROCESSING:
        this.statusEl.textContent = 'Processing...';
        this.statusEl.classList.add('active');
        this.startBtn.disabled = true;
        this.pauseBtn.disabled = false;
        this.pauseBtn.textContent = 'Pause';
        this.stopBtn.disabled = false;
        this.sensitivitySlider.disabled = true;
        this.languageSelect.disabled = true;
        break;
      case ProcessingState.PAUSED:
        this.statusEl.textContent = 'Paused';
        this.statusEl.classList.add('paused');
        this.startBtn.disabled = true;
        this.pauseBtn.disabled = false;
        this.pauseBtn.textContent = 'Resume';
        this.stopBtn.disabled = false;
        this.sensitivitySlider.disabled = true;
        this.languageSelect.disabled = true;
        break;
      case ProcessingState.STOPPED:
      case ProcessingState.IDLE:
      case ProcessingState.ERROR:
        this.statusEl.textContent =
          this.state === ProcessingState.STOPPED ? 'Stopped' :
          this.state === ProcessingState.ERROR ? 'Error' : 'Idle';
        if (this.state === ProcessingState.ERROR) {
          this.statusEl.classList.add('error');
        }
        this.startBtn.disabled = !this._filePath;
        this.pauseBtn.disabled = true;
        this.pauseBtn.textContent = 'Pause';
        this.stopBtn.disabled = true;
        this.sensitivitySlider.disabled = false;
        this.languageSelect.disabled = false;
        break;
    }
  }
}
