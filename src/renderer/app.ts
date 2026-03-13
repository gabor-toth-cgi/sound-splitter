// ============================================================
// Renderer Entry Point – wires all UI components together
// ============================================================

import { LogEntry, OutputFile, ProcessingState, simpleHash } from '../shared/types';
import { ConsoleLog } from './components/console-log';
import { FilePicker } from './components/file-picker';
import { Waveform } from './components/waveform';
import { MediaControls } from './components/media-controls';
import { ProcessingControls } from './components/processing-controls';
import { ResultsPanel } from './components/results-panel';

declare const api: import('../main/preload').SoundSplitterAPI;

// ---- Initialize components ----
const consoleLog = new ConsoleLog();
const filePicker = new FilePicker();
const waveform = new Waveform();
const mediaControls = new MediaControls(waveform);
const processingControls = new ProcessingControls();
const resultsPanel = new ResultsPanel();

// ---- Wire file selection to waveform + processing ----
filePicker.onFileSelected = async (path: string) => {
  try {
    await waveform.loadAudio(path);
    processingControls.filePath = path;
    resultsPanel.clear();
    // Compute and set file hash for feedback correlation
    resultsPanel.fileHash = simpleHash(path);
  } catch (err: any) {
    console.error('Failed to load audio:', err);
  }
};

// ---- Processing controls need current playback time ----
processingControls.getCurrentTime = () => mediaControls.getCurrentTime();

// ---- Wire processing start to update resultsPanel sensitivity ----
processingControls.onProcessingStart = (sensitivity: number) => {
  resultsPanel.sensitivity = sensitivity;
};

// ---- Listen for events from main process ----
// Store cleanup functions so listeners can be removed if needed
const cleanupLog = api.onLog((entry: LogEntry) => {
  consoleLog.addEntry(entry);
});

const cleanupSegment = api.onSegmentProduced((file: OutputFile) => {
  // Use updateResult for idempotent handling (handles both add and update)
  resultsPanel.updateResult(file);
});

const cleanupRecognition = api.onRecognitionResult((file: OutputFile) => {
  resultsPanel.updateResult(file);
});

// ---- Boot message ----
consoleLog.addEntry({
  timestamp: new Date().toISOString(),
  level: 'info',
  message: 'Sound Splitter ready. Choose an audio file to begin.',
});
