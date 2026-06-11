import { ReactiveController, ReactiveControllerHost } from 'lit';
import { logger } from '../utils/logger.js';

type WordUpdate = {
  wordId: number;
  processingStatus: 'queued' | 'processing' | 'ready' | 'failed';
  sentenceCount: number;
};

export type QueueSummary = {
  queued: number;
  processing: number;
  failed: number;
  queuedWords: Array<{
    wordId: number;
    word: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    language: string;
    topic?: string;
  }>;
  processingWords: Array<{
    wordId: number;
    word: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    language: string;
    topic?: string;
  }>;
};

interface JobMonitorCallbacks {
  getCurrentLanguage: () => string | null;
  loadCurrentLanguage: () => Promise<void>;
  onWordReady: (wordId: number) => Promise<void>;
  onWordFailed: () => void;
}

export class JobMonitorController implements ReactiveController {
  private host: ReactiveControllerHost;
  private callbacks: JobMonitorCallbacks;

  queueSummary: QueueSummary = {
    queued: 0,
    processing: 0,
    failed: 0,
    queuedWords: [],
    processingWords: [],
  };

  private failureMessageExpiresAt: number | null = null;
  private queueIntervalId: number | undefined;
  private jobListenerCleanup?: () => void;

  constructor(host: ReactiveControllerHost, callbacks: JobMonitorCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
    host.addController(this);
  }

  hostConnected(): void {}

  hostDisconnected(): void {
    this.stop();
  }

  start(): void {
    if (!window.electronAPI?.jobs) return;

    void this.refreshQueueSummary();

    this.queueIntervalId = window.setInterval(() => {
      void this.refreshQueueSummary();
    }, 5000);

    this.jobListenerCleanup = window.electronAPI.jobs.onWordUpdated((update) => {
      void this.handleWordUpdate(update);
    });
  }

  stop(): void {
    if (this.queueIntervalId !== undefined) {
      window.clearInterval(this.queueIntervalId);
      this.queueIntervalId = undefined;
    }
    if (this.jobListenerCleanup) {
      this.jobListenerCleanup();
      this.jobListenerCleanup = undefined;
    }
  }

  async refreshQueueSummary(): Promise<void> {
    if (!window.electronAPI?.jobs) return;

    try {
      if (!this.callbacks.getCurrentLanguage()) {
        await this.callbacks.loadCurrentLanguage();
      }

      const summary = await window.electronAPI.jobs.getQueueSummary(
        this.callbacks.getCurrentLanguage() ?? undefined
      );
      this.queueSummary = summary;

      if (summary.failed > 0) {
        if (this.failureMessageExpiresAt === null || Date.now() > this.failureMessageExpiresAt) {
          this.failureMessageExpiresAt = Date.now() + 10000;
        }
      } else {
        this.failureMessageExpiresAt = null;
      }

      this.host.requestUpdate();
    } catch (error) {
      logger.warn({ error }, 'Failed to refresh queue summary');
    }
  }

  private handleWordUpdate = async (update: WordUpdate): Promise<void> => {
    await this.refreshQueueSummary();

    if (update.processingStatus === 'ready') {
      await this.callbacks.onWordReady(update.wordId);
    } else if (update.processingStatus === 'failed') {
      this.failureMessageExpiresAt = Date.now() + 10000;
      this.callbacks.onWordFailed();
    }
  };
}
