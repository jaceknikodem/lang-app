/**
 * Audio generation and playback interfaces
 */

export interface AudioGenerator {
  generateAudio(text: string, language?: string): Promise<string>;
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
  code: 'GENERATION_FAILED' | 'PLAYBACK_FAILED' | 'FILE_NOT_FOUND' | 'INVALID_PATH';
  audioPath?: string;
}