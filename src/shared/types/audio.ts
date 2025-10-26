/**
 * Audio generation and playback interfaces
 */

export interface AudioGenerator {
  generateAudio(text: string, language?: string, word?: string): Promise<string>;
  playAudio(audioPath: string): Promise<void>;
  audioExists(audioPath: string): Promise<boolean>;
}

export interface AudioConfig {
  audioDirectory: string;
  ttsCommand: string;
  fileExtension: string;
  rate?: number;
}

export interface AudioError extends Error {
  code: 'GENERATION_FAILED' | 'PLAYBACK_FAILED' | 'FILE_NOT_FOUND' | 'INVALID_PATH' | 'RECORDING_FAILED' | 'FILE_OPERATION_FAILED';
  audioPath?: string;
}

export interface RecordingOptions {
  sampleRate?: number;
  channels?: number;
  threshold?: number;
  silence?: string;
  endOnSilence?: boolean;
  device?: string;
}

export interface RecordingSession {
  id: string;
  filePath: string;
  isRecording: boolean;
  startTime: number;
  duration?: number;
}