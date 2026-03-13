import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC, LogEntry, OutputFile, ProcessingState, SegmentFeedback, SupportedLanguage, VADProfile } from '../shared/types';

export interface SoundSplitterAPI {
  openFileDialog(): Promise<string | null>;
  startProcessing(filePath: string, startTime: number, sensitivity: number, language: SupportedLanguage): void;
  pauseProcessing(): void;
  stopProcessing(): void;
  renameFile(id: string, newName: string): Promise<{ fileName: string; filePath: string } | null>;

  // Feedback
  submitFeedback(feedback: SegmentFeedback): void;
  getProfile(fileHash: string): Promise<VADProfile | null>;

  onLog(cb: (entry: LogEntry) => void): () => void;
  onProcessingState(cb: (state: ProcessingState) => void): () => void;
  onSegmentProduced(cb: (file: OutputFile) => void): () => void;
  onRecognitionResult(cb: (file: OutputFile) => void): () => void;
}

contextBridge.exposeInMainWorld('api', {
  // ---- Commands ----
  openFileDialog: (): Promise<string | null> => {
    return ipcRenderer.invoke(IPC.OPEN_FILE_DIALOG);
  },

  startProcessing: (filePath: string, startTime: number, sensitivity: number, language: SupportedLanguage): void => {
    ipcRenderer.send(IPC.START_PROCESSING, filePath, startTime, sensitivity, language);
  },

  pauseProcessing: (): void => {
    ipcRenderer.send(IPC.PAUSE_PROCESSING);
  },

  stopProcessing: (): void => {
    ipcRenderer.send(IPC.STOP_PROCESSING);
  },

  renameFile: (id: string, newName: string): Promise<{ fileName: string; filePath: string } | null> => {
    return ipcRenderer.invoke(IPC.RENAME_FILE, id, newName);
  },

  // ---- Feedback ----
  submitFeedback: (feedback: SegmentFeedback): void => {
    ipcRenderer.send(IPC.SUBMIT_FEEDBACK, feedback);
  },

  getProfile: (fileHash: string): Promise<VADProfile | null> => {
    return ipcRenderer.invoke(IPC.GET_PROFILE, fileHash);
  },

  // ---- Events ----
  onLog: (cb: (entry: LogEntry) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, entry: LogEntry) => cb(entry);
    ipcRenderer.on(IPC.LOG, handler);
    return () => ipcRenderer.removeListener(IPC.LOG, handler);
  },

  onProcessingState: (cb: (state: ProcessingState) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, state: ProcessingState) => cb(state);
    ipcRenderer.on(IPC.PROCESSING_STATE, handler);
    return () => ipcRenderer.removeListener(IPC.PROCESSING_STATE, handler);
  },

  onSegmentProduced: (cb: (file: OutputFile) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, file: OutputFile) => cb(file);
    ipcRenderer.on(IPC.SEGMENT_PRODUCED, handler);
    return () => ipcRenderer.removeListener(IPC.SEGMENT_PRODUCED, handler);
  },

  onRecognitionResult: (cb: (file: OutputFile) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, file: OutputFile) => cb(file);
    ipcRenderer.on(IPC.RECOGNITION_RESULT, handler);
    return () => ipcRenderer.removeListener(IPC.RECOGNITION_RESULT, handler);
  },
} satisfies SoundSplitterAPI);
