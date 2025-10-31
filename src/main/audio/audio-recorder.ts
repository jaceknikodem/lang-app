/**
 * Audio recording service using node-record-lpcm16
 * Handles microphone input recording for quiz pronunciation practice
 */

import * as fs from 'fs';
import * as path from 'path';
import { app, systemPreferences } from 'electron';

// Import the recorder module
const recorder = require('node-record-lpcm16');

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

export class AudioRecorder {
  private currentSession: RecordingSession | null = null;
  private recordingStream: any = null;
  private fileStream: fs.WriteStream | null = null;
  private audioDirectory: string;

  constructor() {
    // Set up audio directory for recordings
    this.audioDirectory = path.join(app.getPath('userData'), 'recordings');
    this.ensureAudioDirectory();
  }

  /**
   * Start recording audio to a file
   */
  async startRecording(options: RecordingOptions = {}): Promise<RecordingSession> {
    if (this.currentSession?.isRecording) {
      throw new Error('Recording already in progress');
    }

    // Check system requirements
    await this.checkSystemRequirements();

    // Generate unique session ID and file path
    const sessionId = `recording_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fileName = `${sessionId}.wav`;
    const filePath = path.join(this.audioDirectory, fileName);

    // Default recording options optimized for speech with silence detection
    const recordingOptions = {
      sampleRate: options.sampleRate || 16000,
      channels: options.channels || 1,
      threshold: options.threshold || 0.5,
      silence: options.silence || '1.5',
      endOnSilence: options.endOnSilence !== undefined ? options.endOnSilence : true,
      device: options.device || null,
      ...options
    };

    try {
      // Create recording session
      this.currentSession = {
        id: sessionId,
        filePath,
        isRecording: true,
        startTime: Date.now()
      };

      // Create file stream
      this.fileStream = fs.createWriteStream(filePath);

      // Start recording
      this.recordingStream = recorder.record(recordingOptions);
      
      // Set up silence detection if enabled
      if (recordingOptions.endOnSilence) {
        this.recordingStream.stream().on('silence', () => {
          console.log('Silence detected, stopping recording automatically');
          this.stopRecording().catch(error => {
            console.error('Error auto-stopping recording on silence:', error);
          });
        });
      }
      
      // Pipe audio data to file
      this.recordingStream.stream().pipe(this.fileStream);

      console.log(`Started recording: ${sessionId}`);
      return { ...this.currentSession };

    } catch (error) {
      // Clean up on error
      await this.cleanup();
      throw new Error(`Failed to start recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Stop current recording
   */
  async stopRecording(): Promise<RecordingSession | null> {
    if (!this.currentSession?.isRecording) {
      throw new Error('No recording in progress');
    }

    try {
      // Stop the recording stream
      if (this.recordingStream) {
        this.recordingStream.stop();
        this.recordingStream = null;
      }

      // Close file stream and ensure it's fully flushed to disk
      if (this.fileStream) {
        await new Promise<void>((resolve, reject) => {
          // Wait for the 'finish' event to ensure data is written
          this.fileStream!.on('finish', () => {
            this.fileStream = null;
            resolve();
          });
          this.fileStream!.on('error', (error: Error) => {
            this.fileStream = null;
            reject(error);
          });
          this.fileStream!.end();
        });
        
        // Additional small delay to ensure WAV header is fully written to disk
        // This prevents corruption when reading the file immediately after closing
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Update session
      const session = this.currentSession;
      session.isRecording = false;
      session.duration = Date.now() - session.startTime;

      // Verify file was created
      if (!fs.existsSync(session.filePath)) {
        throw new Error('Recording file was not created');
      }

      console.log(`Stopped recording: ${session.id}, duration: ${session.duration}ms`);
      
      const completedSession = { ...session };
      this.currentSession = null;
      
      return completedSession;

    } catch (error) {
      await this.cleanup();
      throw new Error(`Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Cancel current recording and delete the file
   */
  async cancelRecording(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    const filePath = this.currentSession.filePath;
    
    try {
      // Stop recording
      if (this.recordingStream) {
        this.recordingStream.stop();
        this.recordingStream = null;
      }

      // Close file stream
      if (this.fileStream) {
        this.fileStream.destroy();
        this.fileStream = null;
      }

      // Delete the file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      console.log(`Cancelled recording: ${this.currentSession.id}`);
      this.currentSession = null;

    } catch (error) {
      console.error('Error cancelling recording:', error);
      await this.cleanup();
    }
  }

  /**
   * Get current recording session info
   */
  getCurrentSession(): RecordingSession | null {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.currentSession?.isRecording || false;
  }

  /**
   * Get list of available recording devices
   */
  async getAvailableDevices(): Promise<string[]> {
    try {
      // This is a simplified implementation
      // In a real app, you might want to use a more sophisticated method
      // to enumerate audio input devices
      return ['default'];
    } catch (error) {
      console.error('Error getting available devices:', error);
      return ['default'];
    }
  }

  /**
   * Delete a recording file
   */
  async deleteRecording(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted recording: ${filePath}`);
      }
    } catch (error) {
      throw new Error(`Failed to delete recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get recording file info
   */
  async getRecordingInfo(filePath: string): Promise<{ size: number; duration?: number } | null> {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const stats = fs.statSync(filePath);
      return {
        size: stats.size,
        // Duration calculation would require audio analysis
        // For now, we'll rely on the session duration
      };
    } catch (error) {
      console.error('Error getting recording info:', error);
      return null;
    }
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    try {
      if (this.recordingStream) {
        this.recordingStream.stop();
        this.recordingStream = null;
      }

      if (this.fileStream) {
        this.fileStream.destroy();
        this.fileStream = null;
      }

      if (this.currentSession?.filePath && fs.existsSync(this.currentSession.filePath)) {
        // Only delete if recording was not completed successfully
        if (this.currentSession.isRecording) {
          fs.unlinkSync(this.currentSession.filePath);
        }
      }

      this.currentSession = null;
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  /**
   * Check system requirements for audio recording
   */
  private async checkSystemRequirements(): Promise<void> {
    // Check if sox is available
    try {
      const { spawn } = require('child_process');
      const soxCheck = spawn('sox', ['--version']);
      await new Promise((resolve, reject) => {
        soxCheck.on('close', (code: number | null) => {
          if (code === 0) resolve(code);
          else reject(new Error('sox not available'));
        });
        soxCheck.on('error', (error: Error) => {
          reject(new Error(`sox not found: ${error.message}`));
        });
      });
    } catch (error) {
      throw new Error('Audio recording requires sox to be installed. Please install sox using: brew install sox');
    }

    // Check microphone permissions on macOS
    if (process.platform === 'darwin') {
      try {
        const microphoneAccess = systemPreferences.getMediaAccessStatus('microphone');
        
        if (microphoneAccess === 'denied') {
          throw new Error('Microphone access denied. Please enable microphone access in System Preferences > Security & Privacy > Privacy > Microphone');
        }
        
        if (microphoneAccess === 'not-determined') {
          // Request permission
          const granted = await systemPreferences.askForMediaAccess('microphone');
          if (!granted) {
            throw new Error('Microphone access is required for audio recording');
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('Microphone')) {
          throw error;
        }
        console.warn('Could not check microphone permissions:', error);
        // Continue anyway - the recording will fail if permissions are actually missing
      }
    }
  }

  /**
   * Ensure audio directory exists
   */
  private ensureAudioDirectory(): void {
    try {
      if (!fs.existsSync(this.audioDirectory)) {
        fs.mkdirSync(this.audioDirectory, { recursive: true });
        console.log(`Created audio directory: ${this.audioDirectory}`);
      }
    } catch (error) {
      console.error('Error creating audio directory:', error);
      throw new Error('Failed to create audio directory');
    }
  }
}