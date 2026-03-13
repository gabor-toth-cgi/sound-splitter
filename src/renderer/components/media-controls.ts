// ============================================================
// Media Controls Component – play, pause, stop, seek, volume
// ============================================================

import { Waveform } from './waveform';
import { formatTime } from '../../shared/types';

export class MediaControls {
  private playBtn: HTMLButtonElement;
  private pauseBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private seekSlider: HTMLInputElement;
  private volumeSlider: HTMLInputElement;
  private muteBtn: HTMLButtonElement;
  private timeCurrent: HTMLElement;
  private timeTotal: HTMLElement;

  private waveform: Waveform;
  private muted = false;
  private savedVolume = 0.8;

  constructor(waveform: Waveform) {
    this.waveform = waveform;

    this.playBtn = document.getElementById('btn-play') as HTMLButtonElement;
    this.pauseBtn = document.getElementById('btn-pause') as HTMLButtonElement;
    this.stopBtn = document.getElementById('btn-stop') as HTMLButtonElement;
    this.seekSlider = document.getElementById('seek-slider') as HTMLInputElement;
    this.volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;
    this.muteBtn = document.getElementById('btn-mute') as HTMLButtonElement;
    this.timeCurrent = document.getElementById('time-current')!;
    this.timeTotal = document.getElementById('time-total')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.playBtn.addEventListener('click', () => {
      this.waveform.play();
      this.updateButtonStates(true);
    });

    this.pauseBtn.addEventListener('click', () => {
      this.waveform.pause();
      this.updateButtonStates(false);
    });

    this.stopBtn.addEventListener('click', () => {
      this.waveform.stop();
      this.updateButtonStates(false);
      this.seekSlider.value = '0';
      this.timeCurrent.textContent = '0:00';
    });

    this.seekSlider.addEventListener('input', () => {
      const frac = parseFloat(this.seekSlider.value) / 100;
      this.waveform.seekTo(frac);
    });

    this.volumeSlider.addEventListener('input', () => {
      const vol = parseInt(this.volumeSlider.value, 10) / 100;
      this.waveform.setVolume(vol);
      this.savedVolume = vol;
      this.muted = false;
      this.muteBtn.textContent = vol === 0 ? '\u{1F507}' : '\u{1F50A}';
    });

    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      if (this.muted) {
        this.savedVolume = this.waveform.getVolume();
        this.waveform.setVolume(0);
        this.muteBtn.textContent = '\u{1F507}';
      } else {
        this.waveform.setVolume(this.savedVolume);
        this.muteBtn.textContent = '\u{1F50A}';
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.waveform.isPlaying()) {
          this.waveform.pause();
          this.updateButtonStates(false);
        } else {
          this.waveform.play();
          this.updateButtonStates(true);
        }
      }
    });

    // Wire up waveform callbacks
    this.waveform.onTimeUpdateCb = (time: number) => {
      this.timeCurrent.textContent = formatTime(time);
      if (this.waveform.duration > 0) {
        this.seekSlider.value = String((time / this.waveform.duration) * 100);
      }
    };

    this.waveform.onReadyCb = () => {
      this.timeTotal.textContent = formatTime(this.waveform.duration);
      this.enableControls(true);
    };

    this.waveform.onFinishCb = () => {
      this.updateButtonStates(false);
    };
  }

  enableControls(enabled: boolean): void {
    this.playBtn.disabled = !enabled;
    this.pauseBtn.disabled = !enabled;
    this.stopBtn.disabled = !enabled;
    this.seekSlider.disabled = !enabled;
  }

  getCurrentTime(): number {
    return this.waveform.getCurrentTime();
  }

  private updateButtonStates(playing: boolean): void {
    this.playBtn.disabled = playing;
    this.pauseBtn.disabled = !playing;
  }
}
