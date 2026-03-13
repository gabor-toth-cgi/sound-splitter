// ---------------------------------------------------------------------------
// TLS fix for corporate / self-signed certificate environments
// ---------------------------------------------------------------------------
// Node v24's built-in fetch() (undici-based) does NOT respect
// NODE_TLS_REJECT_UNAUTHORIZED=0.  The only reliable workaround is the
// --use-system-ca Node flag, which tells Node to trust the OS certificate
// store.  Electron doesn't expose a way to pass Node flags after launch,
// so we check early: if NODE_OPTIONS doesn't already contain --use-system-ca,
// we set it and relaunch the app.  The relaunch inherits the env var, so
// the second launch picks up the flag via NODE_OPTIONS and fetch() works.
// ---------------------------------------------------------------------------

import { app, BrowserWindow } from 'electron';

const nodeOpts = process.env.NODE_OPTIONS || '';
if (!nodeOpts.includes('--use-system-ca')) {
  process.env.NODE_OPTIONS = (nodeOpts + ' --use-system-ca').trim();
  // Also keep NODE_TLS_REJECT_UNAUTHORIZED for Node's https module (ffmpeg downloads, etc.)
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  app.relaunch();
  app.exit(0);
  // TypeScript doesn't know this is unreachable – the block above exits the process.
}

// If we reach here, --use-system-ca is active.
// NOTE: NODE_TLS_REJECT_UNAUTHORIZED=0 is a known security trade-off required
// for this environment (corporate proxy / self-signed certs). It only affects
// Node's built-in https module (used by ffmpeg-static downloads, etc.).
// The --use-system-ca flag handles fetch() TLS via the OS certificate store.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import * as path from 'path';
import { logger } from './services/logger';
import { registerIpcHandlers } from './ipc-handlers';

let mainWindow: BrowserWindow | null = null;
let ipcRegistered = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    title: 'Sound Splitter',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false is required because the preload script uses require()
      // to import shared type definitions (../shared/types). With sandbox: true,
      // require() is restricted to only the 'electron' module, breaking the preload.
      sandbox: false,
    },
  });

  // Point the logger at the window so it can forward messages
  logger.setWindow(mainWindow);

  // Register all IPC handlers only once
  if (!ipcRegistered) {
    registerIpcHandlers(mainWindow);
    ipcRegistered = true;
  }

  // Load the renderer HTML
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));

  // Send initial log after page has loaded
  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('Sound Splitter started');
  });

  // Open DevTools in dev mode (uncomment for debugging)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  // NOTE: The 'activate' event (macOS dock click) is not handled because this app
  // targets Windows only. On macOS, IPC handlers would need a window getter pattern
  // (e.g., () => mainWindow) to avoid stale BrowserWindow references.
});

app.on('window-all-closed', () => {
  app.quit();
});
