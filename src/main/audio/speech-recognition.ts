/**
 * Speech recognition service using Whisper HTTP server
 * Handles transcription of recorded audio files for pronunciation practice
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { app } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
  onProgress?: (text: string, isFinal: boolean) => void;
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

export interface SpeechRecognitionError extends Error {
  code: 'MODEL_NOT_FOUND' | 'TRANSCRIPTION_FAILED' | 'FILE_NOT_FOUND' | 'INVALID_AUDIO_FORMAT' | 'WHISPER_NOT_AVAILABLE';
  filePath?: string;
}

export class SpeechRecognitionService {
  private whisperServerUrl: string = 'http://127.0.0.1:8080';

  // Map app language names to Whisper language codes
  private readonly LANGUAGE_CODE_MAP: Record<string, string> = {
    'spanish': 'es',
    'italian': 'it',
    'portuguese': 'pt',
    'polish': 'pl',
    'indonesian': 'id',
    // Also handle ISO codes directly
    'es': 'es',
    'it': 'it',
    'pt': 'pt',
    'pl': 'pl',
    'id': 'id'
  };

  constructor() {
    // Server URL can be overridden via environment variable
    if (process.env.WHISPER_SERVER_URL) {
      this.whisperServerUrl = process.env.WHISPER_SERVER_URL;
    }
  }

  /**
   * Convert app language name to Whisper language code
   */
  private mapLanguageToWhisperCode(language: string): string {
    const normalized = language.toLowerCase().trim();
    return this.LANGUAGE_CODE_MAP[normalized] || 'es'; // Default to Spanish if unknown
  }

  /**
   * Fix WAV file headers using ffmpeg to ensure correct format
   * Converts to: 16kHz sample rate, mono (1 channel), PCM s16le format
   * Returns path to fixed file, or null if ffmpeg is not available
   * Skips ffmpeg if the file is likely empty (small size)
   */
  private async fixWavFile(filePath: string): Promise<string> {
    // Check if file exists and get its size
    try {
      const stats = await fs.promises.stat(filePath);
      const fileSizeInBytes = stats.size;
      
      // Skip ffmpeg if file is too small (likely empty/silent recording)
      // Threshold: 2KB (2048 bytes) - WAV header is typically 44 bytes, so this allows
      // for a very short recording but catches empty files
      const MIN_FILE_SIZE = 2048; // 2KB
      
      if (fileSizeInBytes < MIN_FILE_SIZE) {
        console.log(`Skipping ffmpeg - file is too small (${fileSizeInBytes} bytes), likely empty audio`);
        // Return the original file path if too small - let Whisper handle it or fail gracefully
        return filePath;
      }
    } catch (error) {
      console.error('Failed to check file size:', error);
      // If we can't check size, proceed with ffmpeg (existing behavior)
    }
    
    // Create temporary file for the fixed WAV
    const fixedFilePath = filePath.replace(/\.wav$/i, '_fixed.wav');
    
    console.log('Fixing WAV file headers with ffmpeg...');
    
    // Run ffmpeg to fix the WAV file:
    // -ar 16000: Set audio sample rate to 16kHz
    // -ac 1: Set audio channels to 1 (mono)
    // -c:a pcm_s16le: Set audio codec to PCM signed 16-bit little-endian
    await execFileAsync('ffmpeg', [
      '-i', filePath,           // Input file
      '-ar', '16000',          // Sample rate: 16kHz
      '-ac', '1',              // Channels: 1 (mono)
      '-c:a', 'pcm_s16le',     // Codec: PCM signed 16-bit little-endian
      '-y',                    // Overwrite output file if it exists
      fixedFilePath            // Output file
    ], {
      timeout: 5000, // 5 second timeout
      maxBuffer: 1024 * 1024 // 1MB buffer
    });
    return fixedFilePath;
  }

  /**
   * Check if Whisper server is available
   * This is now just a convenience wrapper around isServerAvailable()
   */
  async initialize(): Promise<void> {
    try {
      console.log('Checking Whisper server availability...');
      const available = await this.isServerAvailable();
      if (!available) {
        throw new Error('Whisper server is not available at http://localhost:8080. Please ensure the server is running and responds with HTTP 200 to GET requests.');
      }
      console.log('Whisper server is available');
    } catch (error) {
      console.error('Speech recognition check failed:', error);
      const speechError = new Error(`Whisper server not available: ${error instanceof Error ? error.message : 'Unknown error'}`) as SpeechRecognitionError;
      speechError.code = 'WHISPER_NOT_AVAILABLE';
      throw speechError;
    }
  }

  /**
   * Transcribe audio file to text using Whisper HTTP server
   */
  async transcribeAudio(filePath: string, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
    try {
      // Check server availability before transcribing
      const available = await this.isServerAvailable();
      if (!available) {
        const error = new Error('Whisper server is not available') as SpeechRecognitionError;
        error.code = 'WHISPER_NOT_AVAILABLE';
        throw error;
      }

      // Validate input file
      if (!fs.existsSync(filePath)) {
        const error = new Error(`Audio file not found: ${filePath}`) as SpeechRecognitionError;
        error.code = 'FILE_NOT_FOUND';
        error.filePath = filePath;
        throw error;
      }
      // Check file size - if too small, likely no speech
      let stats = fs.statSync(filePath);
      console.log(`Transcribing audio: ${filePath} (${(stats.size / 1024).toFixed(1)} KB)`);

      // Fix WAV headers using ffmpeg to ensure correct sample rate, channels, and format
      // This prevents decoder issues where corrupted headers make the file appear hours long
      const fileToTranscribe = await this.fixWavFile(filePath);
      
      // Map language to Whisper language code (default to Spanish if not specified)
      const inputLanguage = options.language && options.language !== 'auto' ? options.language : 'spanish';
      const whisperLanguageCode = this.mapLanguageToWhisperCode(inputLanguage);
      console.log(`Using language: ${inputLanguage} -> Whisper code: ${whisperLanguageCode}`);

      // Use Whisper.cpp Server API format: /inference with file parameter
      // API: curl 127.0.0.1:8080/inference -H "Content-Type: multipart/form-data" 
      //      -F file="@<file-path>" -F temperature="0.0" -F response_format="json"
      //      -F translate="false" -F language="es"
      const url = `${this.whisperServerUrl}/inference`;
      console.log(`Transcribing audio via Whisper server: ${url}`);

      // Read the fixed file as a buffer for native FormData
      const fileBuffer = await fs.promises.readFile(fileToTranscribe);
      const filename = path.basename(fileToTranscribe);
      
      // Create native FormData (available in Node.js 18+)
      const formData = new FormData();
      
      // Create a Blob from the buffer and append to FormData
      // Native FormData works with Blob, which is compatible with fetch
      const audioBlob = new Blob([fileBuffer], { type: 'audio/wav' });
      formData.append('file', audioBlob, filename);
      
      // Add language code (mapped from app language name to Whisper code)
      formData.append('language', whisperLanguageCode);
      
      // Set temperature (default to 0.0 for deterministic output)
      const temperature = options.temperature !== undefined ? options.temperature : 0.0;
      formData.append('temperature', temperature.toString());
      
      // Request JSON response format
      formData.append('response_format', 'json');
      
      // Additional Whisper parameters for better transcription quality/speed
      formData.append('no_speech_thold', '0.8');  // Threshold for detecting no speech
      formData.append('no_timestamps', 'true');  // Don't include timestamps in output
      formData.append('best_of', '1');            // Use single best candidate
      formData.append('beam_size', '1');          // Use beam size of 1 for speed
      
      console.log('FormData fields:', {
        file: filename,
        language: whisperLanguageCode,
        temperature: temperature.toString(),
        response_format: 'json',
        no_speech_thold: '0.8',
        no_timestamps: 'true',
        best_of: '1',
        beam_size: '1'
      });

      let transcriptionResult: string | null = null;

      try {
        console.log('Sending request to Whisper server (streaming mode)...');
        const startTime = Date.now();
        
        // Use native FormData with fetch - fetch will automatically set Content-Type with boundary
        // Do NOT manually set Content-Type header - fetch handles it automatically
        const response = await fetch(url, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Whisper server ${url} returned ${response.status}: ${errorText}`);
          throw new Error(`Whisper server returned ${response.status}: ${errorText}`);
        }

        const responseContentType = response.headers.get('content-type');
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        
        if (!reader) {
          throw new Error('Response body is not readable');
        }

        let buffer = '';
        let accumulatedText = '';

        // Stream the response as it arrives
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }

          // Decode the chunk and add to buffer
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Try to parse JSON incrementally as buffer grows
          if (responseContentType && responseContentType.includes('application/json')) {
            try {
              // Attempt to parse the current buffer as JSON
              const json = JSON.parse(buffer);
              if (json.text && json.text !== accumulatedText) {
                // New text received, emit progress update
                accumulatedText = json.text;
                if (options.onProgress) {
                  options.onProgress(accumulatedText, false);
                }
              }
            } catch (e) {
              // JSON is incomplete, continue accumulating chunks
              // This is expected for streaming JSON responses
            }
          } else {
            // Plain text streaming - emit chunks as they arrive
            accumulatedText = buffer;
            if (options.onProgress) {
              options.onProgress(accumulatedText, false);
            }
          }
        }

        // Final parsing - the buffer should now contain complete JSON
        if (responseContentType && responseContentType.includes('application/json')) {
          try {
            const json = JSON.parse(buffer);
            transcriptionResult = json.text || '';
            // Emit final update if different from last progress update
            if (options.onProgress && transcriptionResult && transcriptionResult !== accumulatedText) {
              options.onProgress(transcriptionResult, true);
            } else if (options.onProgress && transcriptionResult) {
              // Finalize the last update
              options.onProgress(transcriptionResult, true);
            }
          } catch (parseError) {
            // If we accumulated text during streaming, use it
            if (accumulatedText) {
              transcriptionResult = accumulatedText;
              if (options.onProgress && transcriptionResult) {
                options.onProgress(transcriptionResult, true);
              }
            } else {
              throw new Error('Failed to parse Whisper server response as JSON');
            }
          }
        } else {
          // Plain text - use accumulated buffer
          transcriptionResult = buffer;
          if (options.onProgress && transcriptionResult && transcriptionResult !== accumulatedText) {
            options.onProgress(transcriptionResult, true);
          } else if (options.onProgress && transcriptionResult) {
            options.onProgress(transcriptionResult, true);
          }
        }

        // Fallback: use accumulated text if parsing failed
        if (!transcriptionResult && accumulatedText) {
          transcriptionResult = accumulatedText;
        }

        const elapsed = Date.now() - startTime;
        console.log(`Whisper server streaming completed in ${elapsed}ms`);

        if (!transcriptionResult || transcriptionResult.trim().length === 0) {
          throw new Error('Whisper server returned empty transcription result');
        }

        console.log(`Successfully transcribed using Whisper server endpoint: /inference (streaming)`);
        transcriptionResult = transcriptionResult.trim();
        
      } catch (fetchError) {
        console.error(`Error calling Whisper server endpoint /inference:`, fetchError);
        throw new Error(`Failed to transcribe audio via Whisper server: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
      }

      // Clean the transcription result: remove punctuation and trim
      const cleanedResult = transcriptionResult
        .replace(/[.,!?;:'"()\[\]{}—–-]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      console.log(`Transcription completed: "${transcriptionResult}"`);
      console.log(`Cleaned transcription: "${cleanedResult}"`);

      // Clean up temporary fixed file if it was created
      if (fileToTranscribe && fileToTranscribe !== filePath) {
        await fs.promises.unlink(fileToTranscribe);
      }

      return {
        text: cleanedResult,
        language: whisperLanguageCode
      };

    } catch (error) {
      console.error('Transcription error:', error);
      
      if (this.isSpeechRecognitionError(error)) {
        throw error;
      }

      // Handle network errors
      if (error instanceof Error) {
        if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
          const speechError = new Error('Cannot connect to Whisper server. Please ensure it is running at http://127.0.0.1:8080') as SpeechRecognitionError;
          speechError.code = 'WHISPER_NOT_AVAILABLE';
          throw speechError;
        }
      }

      const speechError = new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`) as SpeechRecognitionError;
      speechError.code = 'TRANSCRIPTION_FAILED';
      speechError.filePath = filePath;
      throw speechError;
    }
  }

  /**
   * Jaro-Winkler similarity algorithm
   * Returns a similarity score between 0 and 1
   */
  private jaroWinkler(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;

    // Jaro distance
    const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);

    let matches = 0;
    let transpositions = 0;

    // Find matches
    for (let i = 0; i < s1.length; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, s2.length);

      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    // Find transpositions
    let k = 0;
    for (let i = 0; i < s1.length; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    // Jaro distance
    const jaro = (
      matches / s1.length +
      matches / s2.length +
      (matches - transpositions / 2) / matches
    ) / 3.0;

    // Winkler modification: common prefix bonus
    let prefix = 0;
    const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
    for (let i = 0; i < maxPrefix; i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }

    // Jaro-Winkler similarity
    const winklerWeight = 0.1;
    return jaro + (prefix * winklerWeight * (1 - jaro));
  }

  /**
   * Compare transcribed text with expected text using Jaro-Winkler similarity
   * Returns similarity score and word-level analysis for color coding
   */
  compareTranscription(transcribed: string, expected: string): {
    similarity: number;
    normalizedTranscribed: string;
    normalizedExpected: string;
    expectedWords: Array<{ word: string; similarity: number; matched: boolean }>;
    transcribedWords: string[];
  } {
    // Normalize text for comparison
    const normalizeText = (text: string): string => {
      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    };

    const normalizedTranscribed = normalizeText(transcribed);
    const normalizedExpected = normalizeText(expected);

    // Split into words
    const transcribedWords = normalizedTranscribed.split(' ').filter(w => w.length > 0);
    const expectedWordsList = normalizedExpected.split(' ').filter(w => w.length > 0);

    // For each expected word, find best matching transcribed word using Jaro-Winkler
    const usedTranscribedIndices = new Set<number>();
    const expectedWordMatches: Array<{ word: string; similarity: number; matched: boolean }> = [];

    for (const expectedWord of expectedWordsList) {
      let bestSimilarity = 0;
      let bestIndex = -1;

      // Find the best matching transcribed word
      for (let i = 0; i < transcribedWords.length; i++) {
        if (usedTranscribedIndices.has(i)) continue;
        
        const similarity = this.jaroWinkler(expectedWord, transcribedWords[i]);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestIndex = i;
        }
      }

      // Use threshold: if similarity is above 0.7, consider it a match
      const threshold = 0.7;
      const matched = bestSimilarity >= threshold;

      if (matched && bestIndex >= 0) {
        usedTranscribedIndices.add(bestIndex);
      }

      expectedWordMatches.push({
        word: expectedWord,
        similarity: bestSimilarity,
        matched
      });
    }

    // Calculate overall similarity (average of word similarities)
    const overallSimilarity = expectedWordMatches.length > 0
      ? expectedWordMatches.reduce((sum, w) => sum + w.similarity, 0) / expectedWordMatches.length
      : 0;

    return {
      similarity: overallSimilarity,
      normalizedTranscribed,
      normalizedExpected,
      expectedWords: expectedWordMatches,
      transcribedWords
    };
  }

  /**
   * Check if Whisper server is available on localhost:8080
   * Performs a simple GET request to "/" endpoint and checks for HTTP 200
   * Returns true if available, false otherwise
   * Uses a short timeout to avoid blocking when server is unavailable
   */
  async isServerAvailable(): Promise<boolean> {
    // Use Node's http module for reliability in Electron main process
    const host = '127.0.0.1';
    const port = 8080;
    
    try {
      const result = await new Promise<boolean>((resolve) => {
        const req = http.request({
          hostname: host,
          port: port,
          path: '/',
          method: 'GET',
          timeout: 2000 // 2 second timeout
        }, (res) => {
          const isAvailable = res.statusCode === 200;
          resolve(isAvailable);
        });
        
        req.on('error', (error) => {
          console.log(`Failed to connect to http://${host}:${port}:`, error.message);
          resolve(false);
        });
        
        req.on('timeout', () => {
          console.log(`Whisper server check timed out for http://${host}:${port}`);
          req.destroy();
          resolve(false);
        });
        
        req.end();
      });
      
      return result;
    } catch (error) {
      console.log(`Error checking http://${host}:${port}:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }






  /**
   * Clean transcription text by removing unwanted tokens and repetitions
   */
  private cleanTranscriptionText(text: string): string {
    console.log('Starting cleaning process with:', text);
    
    // Remove bracketed tokens like [Música], [Music], [Applause], etc.
    let cleaned = text.replace(/\[.*?\]/g, '');
    console.log('After removing brackets:', cleaned);
    
    // Remove extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    console.log('After whitespace cleanup:', cleaned);
    
    // Remove non-Latin characters that indicate hallucination (Tamil, Chinese, etc.)
    cleaned = cleaned.replace(/[\u0B80-\u0BFF\u4E00-\u9FFF\u0900-\u097F]/g, '');
    console.log('After removing non-Latin chars:', cleaned);
    
    // Split into words and validate each word
    console.log('Words before filtering:', cleaned.split(' '));
    const words = cleaned.split(' ').filter(word => {
      const trimmed = word.trim();
      if (trimmed.length === 0) return false;
      
      // Filter out words with mixed scripts or obvious garbage
      // Allow letters, numbers, spaces, and Spanish accented characters
      const hasInvalidChars = /[^\w\sáéíóúüñ¿¡.,;:]/i.test(trimmed);
      if (hasInvalidChars) {
        console.log(`Filtering out word with invalid chars: "${trimmed}"`);
        return false;
      }
      
      // Filter out very short fragments that don't make sense (but allow common Spanish words like "al", "el", "la", "en")
      const isSingleInvalidChar = trimmed.length === 1 && !/[aeiouáéíóúy]/i.test(trimmed);
      if (isSingleInvalidChar) {
        console.log(`Filtering out single invalid char: "${trimmed}"`);
        return false;
      }
      
      return true;
    });
    
    console.log('Words after filtering:', words);
    
    // Remove repeated words (sometimes whisper repeats words)
    const filteredWords = [];
    let lastWord = '';
    let repeatCount = 0;
    
    for (const word of words) {
      if (word.toLowerCase() === lastWord.toLowerCase()) {
        repeatCount++;
        // Allow up to 1 repetition, then skip
        if (repeatCount <= 1) {
          filteredWords.push(word);
        }
      } else {
        filteredWords.push(word);
        lastWord = word;
        repeatCount = 0;
      }
    }
    
    // Final cleanup
    cleaned = filteredWords.join(' ').replace(/\s+/g, ' ').trim();
    
    // If the result is too short or looks like garbage, reject it
    if (cleaned.length < 3 || filteredWords.length === 0) {
      throw new Error('Transcription result appears to be invalid or too short.');
    }
    
    return cleaned;
  }

  /**
   * Type guard to check if error is SpeechRecognitionError
   */
  private isSpeechRecognitionError(error: unknown): error is SpeechRecognitionError {
    return error instanceof Error && 'code' in error && 
           ['MODEL_NOT_FOUND', 'TRANSCRIPTION_FAILED', 'FILE_NOT_FOUND', 'INVALID_AUDIO_FORMAT', 'WHISPER_NOT_AVAILABLE'].includes((error as SpeechRecognitionError).code);
  }
}