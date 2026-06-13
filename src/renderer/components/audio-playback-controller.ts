import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { audioPlayer } from '../utils/audio-player-service.js';

/**
 * Shared audio stop utility used across learning, quiz, and dialog modes.
 * Stops the in-process audioPlayer and the IPC audio channel, then waits
 * 100 ms to ensure playback has fully halted before the caller starts new audio.
 */
export class AudioPlaybackController implements ReactiveController {
  constructor(host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {}
  hostDisconnected(): void {}

  async stop(): Promise<void> {
    audioPlayer.stop();
    try {
      await window.electronAPI.audio.stopAudio();
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      // ignore — audio may not have been playing
    }
  }

  stopSync(): void {
    audioPlayer.stop();
    window.electronAPI.audio.stopAudio().catch(() => {});
  }
}
