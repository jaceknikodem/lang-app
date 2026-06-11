import type { ReactiveController, ReactiveControllerHost } from 'lit';

export class TranscriptionController implements ReactiveController {
  private host: ReactiveControllerHost;
  private unsubscribe: (() => void) | null = null;

  streamingTranscriptionText: string | null = null;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected(): void {
    this.unsubscribe = window.electronAPI.audio.onTranscriptionProgress((payload) => {
      if (payload.isFinal) {
        this.streamingTranscriptionText = null;
      } else {
        this.streamingTranscriptionText = payload.text;
        this.host.requestUpdate();
      }
    });
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.streamingTranscriptionText = null;
  }

  clear(): void {
    this.streamingTranscriptionText = null;
    this.host.requestUpdate();
  }
}
