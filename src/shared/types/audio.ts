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
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  elevenLabsModel?: string;
}

export interface AudioError extends Error {
  code: 'GENERATION_FAILED' | 'PLAYBACK_FAILED' | 'FILE_NOT_FOUND' | 'INVALID_PATH' | 'RECORDING_FAILED' | 'FILE_OPERATION_FAILED' | 'API_ERROR';
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

export interface TranscriptionOptions {
  language?: string;
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  temperature?: number;
  best_of?: number;
  beam_size?: number;
  patience?: number;
  length_penalty?: number;
  suppress_tokens?: string;
  initial_prompt?: string;
  condition_on_previous_text?: boolean;
  fp16?: boolean;
  compression_ratio_threshold?: number;
  logprob_threshold?: number;
  no_speech_threshold?: number;
}

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  language?: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export interface TranscriptionComparison {
  similarity: number;
  normalizedTranscribed: string;
  normalizedExpected: string;
  matchingWords: string[];
  missingWords: string[];
  extraWords: string[];
}