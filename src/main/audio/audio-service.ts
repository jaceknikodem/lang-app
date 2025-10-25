import { TTSAudioGenerator } from './audio-generator';
import { AudioGenerator, AudioError } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';

/**
 * Audio service that coordinates audio generation and playback
 * Provides high-level interface for UI integration
 */
export class AudioService {
  private audioGenerator: AudioGenerator;

  constructor(audioGenerator?: AudioGenerator, database?: DatabaseLayer) {
    this.audioGenerator = audioGenerator || new TTSAudioGenerator(undefined, database);
  }

  /**
   * Generate audio for text with error handling and validation
   */
  async generateAudio(text: string, language?: string): Promise<string> {
    try {
      // Validate inputs
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Text must be a non-empty string');
      }

      // Language is now optional - will be retrieved from database if not provided
      const targetLanguage = language ? language.toLowerCase() : undefined;

      // Generate audio and return path
      const audioPath = await this.audioGenerator.generateAudio(text.trim(), targetLanguage);
      
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
  async generateSentenceAudio(sentence: string, language?: string): Promise<string> {
    return this.generateAudio(sentence, language);
  }

  /**
   * Batch generate audio for multiple texts
   * Returns array of paths in same order as input
   */
  async generateBatchAudio(texts: string[], language?: string): Promise<string[]> {
    const results: string[] = [];
    
    for (const text of texts) {
      try {
        const audioPath = await this.generateAudio(text, language);
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
   * Type guard to check if error is AudioError
   */
  private isAudioError(error: unknown): error is AudioError {
    return error instanceof Error && 'code' in error && 
           ['GENERATION_FAILED', 'PLAYBACK_FAILED', 'FILE_NOT_FOUND', 'INVALID_PATH'].includes((error as AudioError).code);
  }
}