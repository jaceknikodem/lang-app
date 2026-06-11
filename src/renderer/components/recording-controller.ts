import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { RecordingOptions } from '../../shared/types/audio.js';
import type { RecordingResult } from './audio-recorder.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../shared/utils/error.js';

const RECORDING_OPTIONS: RecordingOptions = {
  sampleRate: 16000,
  channels: 1,
  threshold: 0.5,
  silence: '1.0',
  endOnSilence: true,
};

export class RecordingController implements ReactiveController {
  private host: ReactiveControllerHost;
  private onBeforeStart?: () => void;
  private onRecordingComplete: () => Promise<void>;
  private onError: (message: string) => void;

  isRecording = false;
  recordingTime = 0;
  currentRecording: RecordingResult | null = null;

  private recordingTimer: number | null = null;
  private recordingStatusCheckTimer: number | null = null;

  constructor(
    host: ReactiveControllerHost,
    callbacks: {
      onBeforeStart?: () => void;
      onRecordingComplete: () => Promise<void>;
      onError?: (message: string) => void;
    }
  ) {
    this.host = host;
    host.addController(this);
    this.onBeforeStart = callbacks.onBeforeStart;
    this.onRecordingComplete = callbacks.onRecordingComplete;
    this.onError = callbacks.onError ?? (() => {});
  }

  hostConnected(): void {}

  hostDisconnected(): void {
    if (this.isRecording) {
      this.cancelRecording().catch((err) => {
        logger.error({ error: err }, 'Error cancelling recording on disconnect');
      });
    }
  }

  startRecording = async (): Promise<void> => {
    if (this.isRecording) return;
    this.onBeforeStart?.();
    try {
      await window.electronAPI.audio.startRecording(RECORDING_OPTIONS);
      this.isRecording = true;
      this.recordingTime = 0;
      this.currentRecording = null;
      this.host.requestUpdate();

      this.recordingTimer = window.setInterval(() => {
        this.recordingTime += 1;
        this.host.requestUpdate();
      }, 1000);

      this.setupRecordingStatusCheck();
    } catch (error) {
      logger.error({ error }, 'Error starting recording');
      this.isRecording = false;
      this.onError(`Failed to start recording: ${getErrorMessage(error)}`);
      this.host.requestUpdate();
    }
  };

  stopRecording = async (): Promise<void> => {
    if (!this.isRecording) return;
    try {
      const completedSession = await window.electronAPI.audio.stopRecording();
      this.isRecording = false;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();
      this.host.requestUpdate();

      if (completedSession && !completedSession.isRecording) {
        const filePath = completedSession.filePath;
        const duration =
          completedSession.duration || (Date.now() - completedSession.startTime) / 1000;
        this.currentRecording = { session: completedSession, filePath, duration };
        this.host.requestUpdate();
        await this.onRecordingComplete();
      }
    } catch (error) {
      logger.error({ error }, 'Error stopping recording');
      this.isRecording = false;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();
      this.onError(`Failed to stop recording: ${getErrorMessage(error)}`);
      this.host.requestUpdate();
    }
  };

  cancelRecording = async (): Promise<void> => {
    if (!this.isRecording) return;
    try {
      await window.electronAPI.audio.cancelRecording();
    } catch (error) {
      logger.error({ error }, 'Error cancelling recording');
    } finally {
      this.isRecording = false;
      this.currentRecording = null;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();
      this.host.requestUpdate();
    }
  };

  clearRecordingState(): void {
    this.currentRecording = null;
    this.host.requestUpdate();
  }

  private clearRecordingTimer(): void {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  private setupRecordingStatusCheck(): void {
    this.clearRecordingStatusCheck();
    this.recordingStatusCheckTimer = window.setInterval(async () => {
      if (this.isRecording) {
        try {
          const isStillRecording = await window.electronAPI.audio.isRecording();
          if (!isStillRecording) {
            await this.handleRecordingAutoStop();
          }
        } catch (error) {
          logger.error({ error }, 'Error checking recording status');
        }
      }
    }, 500);
  }

  private clearRecordingStatusCheck(): void {
    if (this.recordingStatusCheckTimer) {
      clearInterval(this.recordingStatusCheckTimer);
      this.recordingStatusCheckTimer = null;
    }
  }

  private async handleRecordingAutoStop(): Promise<void> {
    this.isRecording = false;
    this.clearRecordingTimer();
    this.clearRecordingStatusCheck();
    this.host.requestUpdate();

    try {
      const completedSession = await window.electronAPI.audio.getCurrentRecordingSession();
      if (completedSession && !completedSession.isRecording) {
        const filePath = completedSession.filePath;
        const duration =
          completedSession.duration || (Date.now() - completedSession.startTime) / 1000;
        this.currentRecording = { session: completedSession, filePath, duration };
        this.host.requestUpdate();
        await this.onRecordingComplete();
      }
    } catch (error) {
      logger.error({ error }, 'Error handling auto-stop');
      this.onError('Recording stopped automatically but there was an error processing it.');
      this.host.requestUpdate();
    }
  }
}
