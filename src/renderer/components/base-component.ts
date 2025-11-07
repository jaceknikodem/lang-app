/**
 * Base component class with common state management
 * Provides shared state properties and language change handling
 */

import { LitElement } from 'lit';
import { state } from 'lit/decorators.js';
import { sessionManager } from '../utils/session-manager.js';

export abstract class BaseComponent extends LitElement {
  @state()
  protected isLoading = false;

  @state()
  protected error: string | null = null;

  @state()
  protected currentLanguage: string | null = null;

  private boundHandleExternalLanguageChange = this.handleExternalLanguageChange.bind(this);

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
    document.addEventListener('language-changed', this.boundHandleExternalLanguageChange);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('language-changed', this.boundHandleExternalLanguageChange);
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
}
