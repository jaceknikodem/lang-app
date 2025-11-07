/**
 * Audio generation, playback, and speech recognition module
 */

export { AudioService } from './audio-service';
export type { 
  AudioGenerator, 
  AudioConfig, 
  AudioError, 
  RecordingOptions, 
  RecordingSession,
  TranscriptionOptions,
  TranscriptionResult,
  TranscriptionComparison
} from '../../shared/types/audio';