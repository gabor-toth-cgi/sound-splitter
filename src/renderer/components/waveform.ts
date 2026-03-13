// ============================================================
// Waveform Component – wraps wavesurfer.js
// ============================================================

// wavesurfer.js is an ESM module; we load it dynamically
// since this renderer code is compiled to CommonJS.
let WaveSurfer: any = null;

export class Waveform {
  private container: HTMLElement;
  private ws: any = null;
  private _duration = 0;
  private _ready = false;
  private onTimeUpdate: ((time: number) => void) | null = null;
  private onReady: (() => void) | null = null;
  private onFinish: (() => void) | null = null;

  constructor() {
    this.container = document.getElementById('waveform')!;
  }

  set onTimeUpdateCb(cb: (time: number) => void) { this.onTimeUpdate = cb; }
  set onReadyCb(cb: () => void) { this.onReady = cb; }
  set onFinishCb(cb: () => void) { this.onFinish = cb; }

  get duration(): number { return this._duration; }
  get ready(): boolean { return this._ready; }

  async init(): Promise<void> {
    // Dynamic import of ESM wavesurfer
    const mod = await import('wavesurfer.js');
    WaveSurfer = mod.default;
  }

  async loadAudio(filePath: string): Promise<void> {
    // Destroy previous instance
    if (this.ws) {
      this.ws.destroy();
      this.ws = null;
      this._ready = false;
      this._duration = 0;
    }

    if (!WaveSurfer) {
      await this.init();
    }

    // Convert Windows path to file:// URL
    const fileUrl = 'file:///' + filePath.replace(/\\/g, '/').replace(/^\/+/, '');

    this.ws = WaveSurfer.create({
      container: this.container,
      waveColor: '#7c6ff7',
      progressColor: '#b0a4ff',
      cursorColor: '#ffffff',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 'auto',
      normalize: true,
      url: fileUrl,
    });

    this.ws.on('ready', () => {
      this._duration = this.ws.getDuration();
      this._ready = true;
      if (this.onReady) this.onReady();
    });

    this.ws.on('timeupdate', (time: number) => {
      if (this.onTimeUpdate) this.onTimeUpdate(time);
    });

    this.ws.on('finish', () => {
      if (this.onFinish) this.onFinish();
    });

    this.ws.on('error', (err: Error) => {
      console.error('WaveSurfer error:', err);
    });
  }

  play(): void {
    if (this.ws && this._ready) this.ws.play();
  }

  pause(): void {
    if (this.ws && this._ready) this.ws.pause();
  }

  stop(): void {
    if (this.ws && this._ready) {
      this.ws.pause();
      this.ws.seekTo(0);
    }
  }

  isPlaying(): boolean {
    return this.ws ? this.ws.isPlaying() : false;
  }

  getCurrentTime(): number {
    return this.ws ? this.ws.getCurrentTime() : 0;
  }

  seekTo(fraction: number): void {
    if (this.ws && this._ready) {
      this.ws.seekTo(fraction); // 0-1
    }
  }

  seekToTime(seconds: number): void {
    if (this._duration > 0) {
      this.seekTo(seconds / this._duration);
    }
  }

  setVolume(vol: number): void {
    if (this.ws) this.ws.setVolume(vol); // 0-1
  }

  getVolume(): number {
    return this.ws ? this.ws.getVolume() : 1;
  }

  destroy(): void {
    if (this.ws) {
      this.ws.destroy();
      this.ws = null;
    }
  }
}
