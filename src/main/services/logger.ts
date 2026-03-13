import log from 'electron-log';
import { BrowserWindow } from 'electron';
import { IPC, LogEntry } from '../../shared/types';

// Configure electron-log
log.transports.file.level = 'debug';
log.transports.console.level = 'debug';
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB

/**
 * Centralized logger that writes to file via electron-log
 * and forwards messages to the renderer console panel.
 */
class Logger {
  private window: BrowserWindow | null = null;

  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  private send(level: LogEntry['level'], message: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    // Write to electron-log (file + terminal)
    switch (level) {
      case 'info':
        log.info(message);
        break;
      case 'warn':
        log.warn(message);
        break;
      case 'error':
        log.error(message);
        break;
      case 'debug':
        log.debug(message);
        break;
    }

    // Forward to renderer console panel
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(IPC.LOG, entry);
    }
  }

  info(msg: string): void {
    this.send('info', msg);
  }
  warn(msg: string): void {
    this.send('warn', msg);
  }
  error(msg: string): void {
    this.send('error', msg);
  }
  debug(msg: string): void {
    this.send('debug', msg);
  }
}

export const logger = new Logger();
