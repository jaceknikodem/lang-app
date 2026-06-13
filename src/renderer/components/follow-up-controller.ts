import { ReactiveController, ReactiveControllerHost } from 'lit';
import { logger } from '../utils/logger.js';

type FollowUpContext = {
  variantId: number;
  conversationHistory: string[];
};

interface FollowUpCallbacks {
  getContext: () => FollowUpContext | null;
  onGenerated: () => void;
}

export class FollowUpController implements ReactiveController {
  private host: ReactiveControllerHost;
  private callbacks: FollowUpCallbacks;

  followUpText = '';
  followUpTranslation = '';
  followUpPronunciation = '';
  followUpAudio: string | null = null;
  showFollowUp = false;
  isGeneratingFollowUp = false;

  constructor(host: ReactiveControllerHost, callbacks: FollowUpCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
    host.addController(this);
  }

  hostConnected(): void {}

  hostDisconnected(): void {
    this.clear();
  }

  async generate(): Promise<void> {
    if (this.isGeneratingFollowUp) return;

    const context = this.callbacks.getContext();
    if (!context) return;

    try {
      this.isGeneratingFollowUp = true;
      this.host.requestUpdate();

      const followUp = await window.electronAPI.dialog.generateFollowUp(
        context.variantId,
        context.conversationHistory.length > 0 ? context.conversationHistory : undefined
      );

      this.followUpText = followUp.text || '';
      this.followUpTranslation = followUp.translation || '';
      this.followUpPronunciation = followUp.pronunciation || '';
      this.followUpAudio = followUp.audio || null;
      this.showFollowUp = true;

      this.host.requestUpdate();
      this.callbacks.onGenerated();
    } catch (error) {
      logger.error({ error }, 'Failed to generate follow-up');
      this.followUpText = '';
      this.followUpTranslation = '';
    } finally {
      this.isGeneratingFollowUp = false;
      this.host.requestUpdate();
    }
  }

  clear(): void {
    this.followUpText = '';
    this.followUpTranslation = '';
    this.followUpPronunciation = '';
    this.followUpAudio = null;
    this.showFollowUp = false;
    this.isGeneratingFollowUp = false;
    this.host.requestUpdate();
  }
}
