/**
 * Audio generation and playback interfaces
 */

export interface AudioGenerator {
  generateAudio(text: string, language: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number, voiceId?: string): Promise<string>;
  playAudio(audioPath: string): Promise<void>;
  stopAudio(): void;
  audioExists(audioPath: string): Promise<boolean>;
}

export interface RegenerateAudioOptions {
  text: string;
  language: string;
  word?: string;
  wordId?: number;
  sentenceId?: number;
  variantId?: number;
  existingPath?: string;
}

export interface AudioConfig {
  audioDirectory: string;
  ttsCommand: string;
  fileExtension: string;
  rate?: number;
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  elevenLabsModel?: string;
}

export interface AudioError extends Error {
  code: 'GENERATION_FAILED' | 'PLAYBACK_FAILED' | 'PLAYBACK_STOPPED' | 'FILE_NOT_FOUND' | 'INVALID_PATH' | 'RECORDING_FAILED' | 'FILE_OPERATION_FAILED' | 'API_ERROR';
  audioPath?: string;
}

export interface RecordingOptions {
  sampleRate?: number;
  channels?: number;
  threshold?: number;
  silence?: string;
  endOnSilence?: boolean;
}

export interface RecordingSession {
  id: string;
  filePath: string;
  isRecording: boolean;
  startTime: number;
  duration?: number;
}

export interface TranscriptionOptions {
  language: string; // Required - must be provided
  temperature?: number;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
}

export interface TranscriptionComparison {
  similarity: number;
  normalizedTranscribed: string;
  normalizedExpected: string;
  expectedWords: Array<{ word: string; similarity: number; matched: boolean }>;
  transcribedWords: string[];
}
