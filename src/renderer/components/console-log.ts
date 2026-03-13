// ============================================================
// Console Log Component – collapsible log panel
// ============================================================

import { LogEntry } from '../../shared/types';

export class ConsoleLog {
  private panel: HTMLElement;
  private header: HTMLElement;
  private body: HTMLElement;
  private logEl: HTMLElement;
  private clearBtn: HTMLElement;
  private collapsed = false;

  constructor() {
    this.panel = document.getElementById('console-panel')!;
    this.header = document.getElementById('console-header')!;
    this.body = document.getElementById('console-body')!;
    this.logEl = document.getElementById('console-log')!;
    this.clearBtn = document.getElementById('btn-clear-log')!;

    this.header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'btn-clear-log') return;
      this.toggle();
    });
    this.clearBtn.addEventListener('click', () => this.clear());
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    this.panel.classList.toggle('collapsed', this.collapsed);
    const title = this.panel.querySelector('.console-title')!;
    title.textContent = (this.collapsed ? '\u25B6' : '\u25BC') + ' Console Log';
  }

  clear(): void {
    this.logEl.innerHTML = '';
  }

  private static readonly VALID_LEVELS = new Set(['info', 'warn', 'error', 'debug']);
  private static readonly MAX_LOG_LINES = 500;

  addEntry(entry: LogEntry): void {
    const line = document.createElement('div');
    line.className = 'log-line';

    const time = new Date(entry.timestamp);
    const ts = time.toLocaleTimeString();

    // Validate log level to prevent injection via innerHTML class names
    const level = ConsoleLog.VALID_LEVELS.has(entry.level) ? entry.level : 'info';

    line.innerHTML =
      `<span class="log-time">[${ts}]</span> ` +
      `<span class="log-${level}">${level.toUpperCase().padEnd(5)}</span> ` +
      `${this.escapeHtml(entry.message)}`;

    this.logEl.appendChild(line);

    // Prevent unbounded DOM growth
    while (this.logEl.children.length > ConsoleLog.MAX_LOG_LINES) {
      this.logEl.removeChild(this.logEl.firstChild!);
    }

    // Auto-scroll to bottom
    this.body.scrollTop = this.body.scrollHeight;
  }

  private escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
}
