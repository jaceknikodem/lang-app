/**
 * Base component class with common state management
 * Provides shared state properties and language change handling
 */

import { LitElement } from 'lit';
import { state } from 'lit/decorators.js';
import { sessionManager } from '../utils/session-manager.js';
import { logger } from '../utils/logger.js';

export abstract class BaseComponent extends LitElement {
  @state()
  protected isLoading = false;

  @state()
  protected error: string | null = null;

  @state()
  protected currentLanguage: string | null = null;

  protected currentSessionId: number | undefined;
  protected audioPlayedCount = 0;
  protected sessionStartTime = Date.now();

  private boundHandleExternalLanguageChange?: (event: Event) => void;

  protected async handleExternalLanguageChange(event: Event): Promise<void> {
    const detail = (event as CustomEvent<{ language?: string }>).detail;
    const newLanguage = detail?.language;

    if (!newLanguage || newLanguage === this.currentLanguage) {
      return;
    }

    this.currentLanguage = newLanguage;

    // Update session manager with new language to ensure it uses correct language's session
    sessionManager.setActiveLanguage(newLanguage);
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Rebind in connectedCallback to ensure it uses the overridden method from subclasses
    this.boundHandleExternalLanguageChange = this.handleExternalLanguageChange.bind(this);
    window.addEventListener('language-changed', this.boundHandleExternalLanguageChange);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.boundHandleExternalLanguageChange) {
      window.removeEventListener('language-changed', this.boundHandleExternalLanguageChange);
      this.boundHandleExternalLanguageChange = undefined;
    }
  }

  /**
   * Helper method to set loading state
   */
  protected setLoading(loading: boolean): void {
    this.isLoading = loading;
  }

  /**
   * Helper method to set error state
   */
  protected setError(error: string | null): void {
    this.error = error;
  }

  /**
   * Helper method to clear error state
   */
  protected clearError(): void {
    this.error = null;
  }

  /**
   * Helper method to set language
   */
  protected setLanguage(language: string | null): void {
    this.currentLanguage = language;
  }

  protected async createTrackingSession(
    mode: 'learning' | 'quiz' | 'dialog' | 'flow',
    language: string
  ): Promise<void> {
    try {
      this.currentSessionId = await window.electronAPI.tracking.createSession(mode, language);
    } catch (error) {
      logger.warn({ error }, 'Failed to create tracking session');
    }
  }

  protected async finalizeTrackingSession(wordCount: number, sentenceCount: number): Promise<void> {
    if (!this.currentSessionId) return;
    try {
      await window.electronAPI.tracking.updateSession(this.currentSessionId, {
        wordCount,
        sentenceCount,
        audioPlayedCount: this.audioPlayedCount,
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to update tracking session');
    }
  }

  protected trackAudioPlayback(params: {
    sentenceId?: number;
    audioPath: string;
    language: string;
    mode: 'learning' | 'quiz' | 'dialog' | 'flow';
    playbackSpeed?: number;
  }): void {
    this.audioPlayedCount++;
    void window.electronAPI.tracking
      .recordAudioPlayback({
        sessionId: this.currentSessionId,
        ...params,
      })
      .catch((err: unknown) => {
        logger.warn({ error: err }, 'Failed to record audio playback');
      });
  }
}
