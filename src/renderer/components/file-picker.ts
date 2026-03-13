// ============================================================
// File Picker Component
// ============================================================

declare const api: import('../../main/preload').SoundSplitterAPI;

export class FilePicker {
  private btn: HTMLButtonElement;
  private label: HTMLElement;
  private _filePath: string | null = null;
  private _onFileSelected: ((path: string) => void) | null = null;

  constructor() {
    this.btn = document.getElementById('btn-choose-file') as HTMLButtonElement;
    this.label = document.getElementById('file-name')!;

    this.btn.addEventListener('click', () => this.openDialog());
  }

  set onFileSelected(cb: (path: string) => void) {
    this._onFileSelected = cb;
  }

  get filePath(): string | null {
    return this._filePath;
  }

  private async openDialog(): Promise<void> {
    try {
      const result = await api.openFileDialog();
      if (result) {
        this._filePath = result;
        // Show just the filename
        const name = result.replace(/\\/g, '/').split('/').pop() || result;
        this.label.textContent = name;
        this.label.title = result;
        if (this._onFileSelected) {
          this._onFileSelected(result);
        }
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  }
}
