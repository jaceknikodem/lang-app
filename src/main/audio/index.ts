/**
 * Audio generation, playback, and speech recognition module
 */

export { TTSAudioGenerator } from './audio-generator';
export { ElevenLabsAudioGenerator } from './elevenlabs-generator';
export { AudioService } from './audio-service';
export { AudioRecorder } from './audio-recorder';
export { SpeechRecognitionService } from './speech-recognition';
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