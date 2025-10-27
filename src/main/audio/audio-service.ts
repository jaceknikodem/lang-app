import { TTSAudioGenerator } from './audio-generator';
import { ElevenLabsAudioGenerator } from './elevenlabs-generator';
import { AudioGenerator, AudioError } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';
import { AudioRecorder, RecordingSession, RecordingOptions } from './audio-recorder';
import { SpeechRecognitionService, TranscriptionOptions, TranscriptionResult } from './speech-recognition';

/**
 * Audio service that coordinates audio generation and playback
 * Provides high-level interface for UI integration
 */
export class AudioService {
  private audioGenerator: AudioGenerator;
  private audioRecorder: AudioRecorder;
  private speechRecognition: SpeechRecognitionService;
  private database?: DatabaseLayer;

  constructor(audioGenerator?: AudioGenerator, database?: DatabaseLayer) {
    this.database = database;
    this.audioGenerator = audioGenerator || this.createDefaultAudioGenerator(database);
    this.audioRecorder = new AudioRecorder();
    this.speechRecognition = new SpeechRecognitionService();
  }

  /**
   * Create default audio generator based on available settings
   */
  private createDefaultAudioGenerator(database?: DatabaseLayer): AudioGenerator {
    // Try to get ElevenLabs API key from database settings asynchronously
    if (database) {
      // Check for ElevenLabs settings in the background and switch if available
      this.checkAndSwitchToElevenLabs(database);
    }
    
    // Default to system TTS initially
    return new TTSAudioGenerator(undefined, database);
  }

  /**
   * Check for ElevenLabs settings and switch if available
   */
  private async checkAndSwitchToElevenLabs(database: DatabaseLayer): Promise<void> {
    try {
      const model = await database.getSetting('elevenlabs_model');
      
      // If model is disabled, use system TTS
      if (model === 'disabled') {
        return; // Keep using system TTS
      }

      const apiKey = await database.getSetting('elevenlabs_api_key');
      if (apiKey && apiKey.trim()) {
        console.log('ElevenLabs API key found, switching to ElevenLabs TTS');
        const config = {
          elevenLabsApiKey: apiKey,
          elevenLabsModel: model || 'eleven_flash_v2_5'
        };
        this.audioGenerator = new ElevenLabsAudioGenerator(config, database);
      }
    } catch (error) {
      console.warn('Failed to check ElevenLabs settings, using system TTS:', error);
    }
  }

  /**
   * Switch to ElevenLabs TTS if API key is provided
   */
  async switchToElevenLabs(apiKey: string): Promise<void> {
    try {
      // Get model from database if available
      let model = 'eleven_flash_v2_5'; // Default to flash model
      if (this.database) {
        try {
          const savedModel = await this.database.getSetting('elevenlabs_model');
          if (savedModel && savedModel !== 'disabled') {
            model = savedModel;
          } else if (savedModel === 'disabled') {
            // If model is disabled, switch to system TTS instead
            await this.switchToSystemTTS();
            return;
          }
        } catch (error) {
          console.warn('Failed to get ElevenLabs model from database, using default');
        }
      }

      const config = {
        elevenLabsApiKey: apiKey,
        elevenLabsModel: model
      };
      this.audioGenerator = new ElevenLabsAudioGenerator(config, this.database);
      console.log('Switched to ElevenLabs TTS with model:', model);
    } catch (error) {
      console.error('Failed to switch to ElevenLabs TTS:', error);
      throw error;
    }
  }

  /**
   * Switch back to system TTS
   */
  async switchToSystemTTS(): Promise<void> {
    try {
      this.audioGenerator = new TTSAudioGenerator(undefined, this.database);
      console.log('Switched to system TTS');
    } catch (error) {
      console.error('Failed to switch to system TTS:', error);
      throw error;
    }
  }

  /**
   * Generate audio for text with error handling and validation
   */
  async generateAudio(text: string, language?: string, word?: string): Promise<string> {
    try {
      // Validate inputs
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Text must be a non-empty string');
      }

      // Language is now optional - will be retrieved from database if not provided
      const targetLanguage = language ? language.toLowerCase() : undefined;

      // Generate audio and return path
      const audioPath = await this.audioGenerator.generateAudio(text.trim(), targetLanguage, word);

      // Verify the file was actually created
      if (!await this.audioExists(audioPath)) {
        throw new Error(`Audio generation succeeded but file not found: ${audioPath}`);
      }

      return audioPath;
    } catch (error) {
      // Re-throw AudioError as-is, wrap other errors
      if (this.isAudioError(error)) {
        throw error;
      }

      const audioError = new Error(`Audio generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'GENERATION_FAILED';
      throw audioError;
    }
  }

  /**
   * Play audio file with validation and error handling
   */
  async playAudio(audioPath: string): Promise<void> {
    try {
      // Validate input
      if (!audioPath || typeof audioPath !== 'string') {
        throw new Error('Audio path must be specified');
      }

      // Check if file exists before attempting playback
      if (!await this.audioExists(audioPath)) {
        const error = new Error(`Audio file not found: ${audioPath}`) as AudioError;
        error.code = 'FILE_NOT_FOUND';
        error.audioPath = audioPath;
        throw error;
      }

      // Play the audio
      await this.audioGenerator.playAudio(audioPath);
    } catch (error) {
      // Re-throw AudioError as-is, wrap other errors
      if (this.isAudioError(error)) {
        throw error;
      }

      const audioError = new Error(`Audio playback failed: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'PLAYBACK_FAILED';
      audioError.audioPath = audioPath;
      throw audioError;
    }
  }

  /**
   * Stop currently playing audio
   */
  stopAudio(): void {
    this.audioGenerator.stopAudio();
  }

  /**
   * Check if audio file exists
   */
  async audioExists(audioPath: string): Promise<boolean> {
    try {
      if (!audioPath || typeof audioPath !== 'string') {
        return false;
      }

      return await this.audioGenerator.audioExists(audioPath);
    } catch (error) {
      // If there's an error checking existence, assume file doesn't exist
      console.warn(`Error checking audio file existence: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Generate audio for a word and return the path
   * Convenience method for word-specific audio generation
   */
  async generateWordAudio(word: string, language?: string): Promise<string> {
    return this.generateAudio(word, language);
  }

  /**
   * Generate audio for a sentence and return the path
   * Convenience method for sentence-specific audio generation
   */
  async generateSentenceAudio(sentence: string, language?: string, word?: string): Promise<string> {
    return this.generateAudio(sentence, language, word);
  }

  /**
   * Batch generate audio for multiple texts
   * Returns array of paths in same order as input
   */
  async generateBatchAudio(texts: string[], language?: string, word?: string): Promise<string[]> {
    const results: string[] = [];

    for (const text of texts) {
      try {
        const audioPath = await this.generateAudio(text, language, word);
        results.push(audioPath);
      } catch (error) {
        // Log error but continue with other texts
        console.error(`Failed to generate audio for "${text}":`, error);
        // Push empty string to maintain array alignment
        results.push('');
      }
    }

    return results;
  }

  /**
   * Start recording audio
   */
  async startRecording(options?: RecordingOptions): Promise<RecordingSession> {
    try {
      return await this.audioRecorder.startRecording(options);
    } catch (error) {
      let errorMessage = 'Failed to start recording';

      if (error instanceof Error) {
        if (error.message.includes('sox')) {
          errorMessage = 'Audio recording requires sox. Please install it with: brew install sox';
        } else {
          errorMessage = `Failed to start recording: ${error.message}`;
        }
      }

      const audioError = new Error(errorMessage) as AudioError;
      audioError.code = 'RECORDING_FAILED';
      throw audioError;
    }
  }

  /**
   * Stop current recording
   */
  async stopRecording(): Promise<RecordingSession | null> {
    try {
      return await this.audioRecorder.stopRecording();
    } catch (error) {
      const audioError = new Error(`Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'RECORDING_FAILED';
      throw audioError;
    }
  }

  /**
   * Cancel current recording
   */
  async cancelRecording(): Promise<void> {
    try {
      await this.audioRecorder.cancelRecording();
    } catch (error) {
      const audioError = new Error(`Failed to cancel recording: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'RECORDING_FAILED';
      throw audioError;
    }
  }

  /**
   * Get current recording session
   */
  getCurrentRecordingSession(): RecordingSession | null {
    return this.audioRecorder.getCurrentSession();
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.audioRecorder.isRecording();
  }

  /**
   * Get available recording devices
   */
  async getAvailableRecordingDevices(): Promise<string[]> {
    try {
      return await this.audioRecorder.getAvailableDevices();
    } catch (error) {
      console.error('Error getting recording devices:', error);
      return ['default'];
    }
  }

  /**
   * Delete a recording file
   */
  async deleteRecording(filePath: string): Promise<void> {
    try {
      await this.audioRecorder.deleteRecording(filePath);
    } catch (error) {
      const audioError = new Error(`Failed to delete recording: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'FILE_OPERATION_FAILED';
      throw audioError;
    }
  }

  /**
   * Get recording file information
   */
  async getRecordingInfo(filePath: string): Promise<{ size: number; duration?: number } | null> {
    try {
      return await this.audioRecorder.getRecordingInfo(filePath);
    } catch (error) {
      console.error('Error getting recording info:', error);
      return null;
    }
  }

  /**
   * Initialize speech recognition service
   */
  async initializeSpeechRecognition(): Promise<void> {
    try {
      console.log('AudioService: Initializing speech recognition...');
      await this.speechRecognition.initialize();
      console.log('AudioService: Speech recognition initialized successfully');
    } catch (error) {
      console.error('AudioService: Speech recognition initialization failed:', error);

      // Provide more specific error messages
      let errorMessage = 'Failed to initialize speech recognition';

      if (error instanceof Error) {
        if (error.message.includes('whisper-node')) {
          errorMessage = 'Whisper speech recognition is not available. This feature requires additional setup.';
        } else if (error.message.includes('compilation')) {
          errorMessage = 'Speech recognition is setting up for first use. Please try again in a moment.';
        } else {
          errorMessage = `Speech recognition initialization failed: ${error.message}`;
        }
      }

      const audioError = new Error(errorMessage) as AudioError;
      audioError.code = 'RECORDING_FAILED';
      throw audioError;
    }
  }

  /**
   * Transcribe recorded audio to text
   */
  async transcribeAudio(filePath: string, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    try {
      return await this.speechRecognition.transcribeAudio(filePath, options);
    } catch (error) {
      const audioError = new Error(`Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'RECORDING_FAILED';
      throw audioError;
    }
  }

  /**
   * Compare transcribed text with expected sentence
   * Returns similarity analysis for pronunciation feedback
   */
  compareTranscription(transcribed: string, expected: string): {
    similarity: number;
    normalizedTranscribed: string;
    normalizedExpected: string;
    matchingWords: string[];
    missingWords: string[];
    extraWords: string[];
  } {
    return this.speechRecognition.compareTranscription(transcribed, expected);
  }

  /**
   * Get available speech recognition models
   */
  getAvailableSpeechModels(): string[] {
    return this.speechRecognition.getAvailableModels();
  }

  /**
   * Set speech recognition model path
   */
  async setSpeechModel(modelPath: string): Promise<void> {
    try {
      await this.speechRecognition.setModelPath(modelPath);
    } catch (error) {
      const audioError = new Error(`Failed to set speech model: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'RECORDING_FAILED';
      throw audioError;
    }
  }

  /**
   * Get current speech recognition model path
   */
  getCurrentSpeechModel(): string {
    return this.speechRecognition.getCurrentModelPath();
  }

  /**
   * Check if speech recognition is initialized
   */
  isSpeechRecognitionReady(): boolean {
    return this.speechRecognition.isServiceInitialized();
  }

  /**
   * Type guard to check if error is AudioError
   */
  private isAudioError(error: unknown): error is AudioError {
    return error instanceof Error && 'code' in error &&
      ['GENERATION_FAILED', 'PLAYBACK_FAILED', 'FILE_NOT_FOUND', 'INVALID_PATH', 'RECORDING_FAILED', 'FILE_OPERATION_FAILED'].includes((error as AudioError).code);
  }
}