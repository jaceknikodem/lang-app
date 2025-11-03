/**
 * Main application root component with routing
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AppState } from '../../shared/types/core.js';
import { router, RouteState, AppMode } from '../utils/router.js';
import { sessionManager, SessionState } from '../utils/session-manager.js';
import { sharedStyles } from '../styles/shared.js';
import { keyboardManager, useKeyboardBindings, GlobalShortcuts } from '../utils/keyboard-manager.js';
import type { ProficiencyLevel } from './language-proficiency-selector.js';
import './topic-selector.js';
import './word-selector.js';
import './learning-mode.js';
import './quiz-mode.js';
import './dialog-mode.js';
import './flow-mode.js';
import './settings-panel.js';
import './language-proficiency-selector.js';

@customElement('app-root')
export class AppRoot extends LitElement {
  @state()
  private currentRoute: RouteState = { mode: 'learning' };

  @state()
  private appState: AppState = {
    currentMode: 'learning'
  };

  @state()
  private isLoading = true;

  @state()
  private sessionState: SessionState | null = null;

  @state()
  private hasExistingWords: boolean | null = null;

  @state()
  private currentLanguage = '';

  @state()
  private autopilotEnabled = false;

  @state()
  private autoplayAudioEnabled = false;

  @state()
  private hasFlowSentences = false;

  @state()
  private wordCategoryStats: { known: number; strong: number; weak: number; new: number } | null = null;

  @state()
  private showProficiencySelector = false;

  @state()
  private currentProficiencyLevel: ProficiencyLevel | null = null;

  private static readonly WEAK_THRESHOLD = 30;
  private static readonly STRONG_THRESHOLD = 80;

  private routerUnsubscribe?: () => void;
  private keyboardUnsubscribe?: () => void;
  private autopilotIntervalId: number | null = null;

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .app-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-width: 1000px;
        margin: 0 auto;
        padding: var(--spacing-md);
        box-sizing: border-box;
      }

      .app-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-lg);
        padding-bottom: var(--spacing-sm);
        border-bottom: 1px solid var(--border-color);
      }

      .app-title {
        font-size: 22px;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
      }

      .navigation {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
        flex: 1;
      }

      .language-dropdown {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .language-select {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius-small);
        font-size: 12px;
        color: var(--text-primary);
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 100px;
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
      }

      .stats-display {
        display: flex;
        gap: var(--spacing-xs);
        align-items: center;
      }

      .stat-box {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--border-radius-small);
        cursor: help;
        font-size: 12px;
      }

      .stat-box .stat-value {
        font-size: 13px;
        font-weight: 500;
      }

      .stat-box.known {
        background: rgba(76, 175, 80, 0.05);
      }

      .stat-box.known .stat-value {
        color: rgba(76, 175, 80, 0.7);
      }

      .stat-box.strong {
        background: rgba(33, 150, 243, 0.05);
      }

      .stat-box.strong .stat-value {
        color: rgba(33, 150, 243, 0.7);
      }

      .stat-box.weak {
        background: rgba(255, 152, 0, 0.05);
      }

      .stat-box.weak .stat-value {
        color: rgba(255, 152, 0, 0.7);
      }

      .stat-box.new {
        background: rgba(158, 158, 158, 0.05);
      }

      .stat-box.new .stat-value {
        color: rgba(158, 158, 158, 0.7);
      }

      .tooltip {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius-small);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        white-space: nowrap;
        font-size: 11px;
        color: var(--text-primary);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        z-index: 1000;
      }

      .stat-box:hover .tooltip {
        opacity: 1;
      }

      .language-select:hover {
        border-color: var(--primary-color);
        background: var(--primary-light);
      }

      .language-select:focus {
        outline: none;
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
      }

      .language-option {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs);
      }

      .language-flag {
        font-size: 14px;
      }

      .language-name {
        font-weight: 500;
      }

      .nav-button {
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--primary-color);
        background: var(--background-primary);
        color: var(--primary-color);
        border-radius: var(--border-radius-small);
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s ease;
      }

      .nav-button:hover {
        background: var(--primary-light);
      }

      .nav-button.active {
        background: var(--primary-color);
        color: white;
      }

      .nav-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .flow-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.95);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        cursor: pointer;
      }

      .flow-pause-icon {
        font-size: 200px;
        color: white;
        opacity: 0.9;
        user-select: none;
      }

      .flow-pause-icon:hover {
        opacity: 1;
      }

      .close-button {
        padding: var(--spacing-xs) var(--spacing-sm);
        border: none;
        background: transparent;
        color: var(--text-tertiary);
        border-radius: var(--border-radius-small);
        cursor: pointer;
        font-size: 18px;
        font-weight: 300;
        line-height: 1;
        transition: all 0.2s ease;
        opacity: 0.5;
      }

      .close-button:hover {
        color: var(--text-secondary);
        opacity: 0.8;
        background: var(--background-secondary);
      }

      .nav-left-group {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .nav-right-group {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        margin-left: auto;
      }

      .autopilot-toggle-container {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        margin-right: var(--spacing-xs);
      }

      .autopilot-label {
        font-size: 12px;
        color: var(--text-secondary);
        font-weight: 500;
      }

      .autopilot-switch {
        position: relative;
        width: 44px;
        height: 24px;
        cursor: pointer;
      }

      .autopilot-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .autopilot-slider {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: 24px;
        transition: 0.3s;
      }

      .autopilot-slider:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 2px;
        bottom: 2px;
        background-color: white;
        border-radius: 50%;
        transition: 0.3s;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      }

      .autopilot-switch input:checked + .autopilot-slider {
        background-color: var(--primary-color);
        border-color: var(--primary-color);
      }

      .autopilot-switch input:checked + .autopilot-slider:before {
        transform: translateX(20px);
      }

      .autopilot-switch:hover .autopilot-slider {
        border-color: var(--primary-color);
      }

      .autoplay-toggle-container {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        margin-right: var(--spacing-xs);
      }

      .autoplay-label {
        font-size: 12px;
        color: var(--text-secondary);
        font-weight: 500;
      }

      .autoplay-switch {
        position: relative;
        width: 44px;
        height: 24px;
        cursor: pointer;
      }

      .autoplay-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .autoplay-slider {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: 24px;
        transition: 0.3s;
      }

      .autoplay-slider:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 2px;
        bottom: 2px;
        background-color: white;
        border-radius: 50%;
        transition: 0.3s;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      }

      .autoplay-switch input:checked + .autoplay-slider {
        background-color: var(--primary-color);
        border-color: var(--primary-color);
      }

      .autoplay-switch input:checked + .autoplay-slider:before {
        transform: translateX(20px);
      }

      .autoplay-switch:hover .autoplay-slider {
        border-color: var(--primary-color);
      }

      .content-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .route-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: auto;
      }

      .placeholder {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        color: var(--text-secondary);
        gap: var(--spacing-md);
      }

      .placeholder h3 {
        font-size: 24px;
        color: var(--text-primary);
        margin: 0;
      }

      .placeholder p {
        font-size: 16px;
        margin: 0;
        max-width: 400px;
      }

      .loading-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
      }



      @media (max-width: 768px) {
        .app-container {
          padding: var(--spacing-sm);
        }
        
        .app-header {
          flex-direction: column;
          gap: var(--spacing-md);
          align-items: stretch;
        }
        
        .navigation {
          justify-content: center;
          flex-wrap: wrap;
        }
        
        .nav-button {
          flex: 1;
          text-align: center;
          min-width: 80px;
        }

        .language-dropdown {
          margin-left: 0;
          margin-top: var(--spacing-xs);
          order: 10;
          flex-basis: 100%;
          display: flex;
          justify-content: center;
        }

        .language-select {
          min-width: 120px;
        }
      }
    `
  ];

  async connectedCallback() {
    super.connectedCallback();
    console.log('AppRoot connected!');

    // Subscribe to router changes
    this.routerUnsubscribe = router.subscribe((route) => {
      this.currentRoute = route;
      this.updateAppState();
      this.updateSessionFromRoute();
      this.updateKeyboardContext();
    });

    // Listen for language changes
    this.addEventListener('language-changed', this.handleLanguageChanged);

    // Setup keyboard bindings
    this.setupKeyboardBindings();

    // Initialize current route
    this.currentRoute = router.getCurrentRoute();
    // Ensure keyboard context is set on initial load
    this.updateKeyboardContext();

    await this.initializeApp();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopAutopilot();
    if (this.routerUnsubscribe) {
      this.routerUnsubscribe();
    }
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }
    this.removeEventListener('language-changed', this.handleLanguageChanged);
  }

  private async initializeApp() {
    try {
      console.log('Initializing app...');

      // Check if electronAPI is available
      if (!window.electronAPI) {
        console.error('electronAPI not available - preload script may have failed');
        this.isLoading = false;
        return;
      }
      console.log('electronAPI is available');

      // Check if LLM is available (non-blocking)
      try {
        console.log('Checking LLM availability...');
        const llmAvailable = await window.electronAPI.llm.isAvailable();
        console.log('LLM Available:', llmAvailable);
      } catch (error) {
        console.warn('LLM check failed (this is OK):', error);
      }

      // Load current language
      console.log('Loading current language...');
      await this.loadCurrentLanguage();
      console.log('Current language loaded');

      // Load autoplay audio setting
      await this.loadAutoplayAudioSetting();

      // Load stats for current language
      await this.loadWordStats();

      // Load saved session
      console.log('Loading session...');
      await this.loadSession();
      console.log('Session loaded');

      // Check for existing words in database (non-blocking - deferred)
      // This optimization speeds up initial render by deferring the check
      setTimeout(async () => {
        try {
          await this.checkExistingWords();
          await this.checkFlowSentences();
        } catch (error) {
          console.error('Failed to check existing words:', error);
        }
      }, 0);

      console.log('Ensuring learning session...');
      await this.ensureLearningSession();
      console.log('Learning session ready');

      // Pre-generate dialog session asynchronously (non-blocking)
      setTimeout(async () => {
        try {
          await this.pregenerateDialogSession();
        } catch (error) {
          console.error('Failed to pre-generate dialog session:', error);
          // Non-critical - continue without cached dialog session
        }
      }, 0);

      console.log('App initialization complete');
      this.isLoading = false;
    } catch (error) {
      console.error('Failed to initialize app:', error);
      this.isLoading = false;
    }
  }

  private async loadSession() {
    try {
      // Load persisted session state (includes learning session metadata)
      this.sessionState = sessionManager.getCurrentSession();
    } catch (error) {
      console.error('Failed to load session:', error);
      this.sessionState = sessionManager.getCurrentSession();
    }
  }

  private async checkExistingWords() {
    try {
      console.log('Checking if words exist...');
      // Use getStudyStats which is much faster than loading all words
      // It only returns a count, not the full word data
      const stats = await window.electronAPI.database.getStudyStats(this.currentLanguage || undefined);
      this.hasExistingWords = stats.totalWords > 0;
      console.log('Words check complete, found:', stats.totalWords);
      
      // Check proficiency level (will show selector if no words and no proficiency set)
      if (this.currentLanguage) {
        await this.checkProficiencyLevel();
      }
      
      if (this.hasExistingWords === false && router.isCurrentMode('learning')) {
        router.goToTopicSelection();
      }
    } catch (error) {
      console.error('Failed to check existing words:', error);
      this.hasExistingWords = false;
    }
  }

  private async checkProficiencyLevel() {
    if (!this.currentLanguage) {
      return;
    }

    try {
      const proficiencyKey = `language_proficiency_${this.currentLanguage}`;
      const proficiency = await window.electronAPI.database.getSetting(proficiencyKey);
      this.currentProficiencyLevel = proficiency as ProficiencyLevel | null;
      
      // Show proficiency selector if NO words exist and proficiency is not set
      if (!this.hasExistingWords && !proficiency) {
        this.showProficiencySelector = true;
      }
    } catch (error) {
      console.error('Failed to check proficiency level:', error);
    }
  }

  private async checkFlowSentences() {
    try {
      console.log('Checking if flow sentences are available...');
      const flowSentences = await window.electronAPI.flow.getFlowSentences();
      
      // Collect all audio paths using the same logic as handleFlowPlay()
      const audioPaths: string[] = [];
      for (const item of flowSentences) {
        if (item.beforeSentenceAudio) {
          audioPaths.push(item.beforeSentenceAudio);
        }
        if (item.sentence.audioPath) {
          audioPaths.push(item.sentence.audioPath);
        }
        audioPaths.push(...item.continuationAudios);
      }
      
      // Only enable Flow button if we have at least one audio file
      this.hasFlowSentences = audioPaths.length > 0;
      console.log('Flow sentences check complete, found:', flowSentences.length, 'sentences with', audioPaths.length, 'audio files');
    } catch (error) {
      console.error('Failed to check flow sentences:', error);
      this.hasFlowSentences = false;
    }
  }

  private async loadCurrentLanguage() {
    try {
      this.currentLanguage = await window.electronAPI.database.getCurrentLanguage();
    } catch (error) {
      console.error('Failed to load current language:', error);
      this.currentLanguage = 'spanish'; // Default fallback
    }

    const languageToUse = this.currentLanguage || 'spanish';
    sessionManager.setActiveLanguage(languageToUse);
    
    // Load lemmatization model for the current language (async, non-blocking)
    void this.loadLemmatizationModel(languageToUse);
  }

  private async ensureLearningSession() {
    try {
      const existingSession = sessionManager.getLearningSession();
      if (existingSession && existingSession.wordIds.length > 0 && !existingSession.completed) {
        return;
      }

      if (this.hasExistingWords === false) {
        return;
      }

      const language = this.currentLanguage || (await window.electronAPI.database.getCurrentLanguage());
      const candidates = await window.electronAPI.database.getWordsWithSentencesOrderedByStrength(true, false, language);

      const sessionWordIds: number[] = [];
      for (const word of candidates) {
        const sentences = await window.electronAPI.database.getSentencesByWord(word.id);
        if (!sentences.length) {
          continue;
        }

        sessionWordIds.push(word.id);
        if (sessionWordIds.length >= 20) {
          break;
        }
      }

      if (sessionWordIds.length) {
        sessionManager.startNewLearningSession(sessionWordIds, Math.min(20, sessionWordIds.length));
        console.log(`Initialized learning session with ${sessionWordIds.length} words`);
      }
    } catch (error) {
      console.error('Failed to ensure learning session:', error);
    }
  }

  // Method to refresh current language (can be called when language changes)
  async refreshCurrentLanguage() {
    await this.loadCurrentLanguage();
    this.sessionState = sessionManager.getCurrentSession();
    await this.checkExistingWords();
    await this.checkFlowSentences();
    await this.ensureLearningSession();
    this.requestUpdate();
  }

  private handleLanguageChanged = async (event: Event) => {
    if (event.target === this) {
      return;
    }

    const customEvent = event as CustomEvent<{ language?: string }>;
    const newLanguage = customEvent.detail?.language;

    if (newLanguage && newLanguage === this.currentLanguage) {
      return;
    }

      console.log('Language changed event received:', customEvent.detail);
      await this.refreshCurrentLanguage();
      // Reload stats for new language
      await this.loadWordStats();
    };

  /**
   * Pre-generate dialog session after language changes
   */
  private async pregenerateDialogSessionAfterLanguageChange() {
    // Wait a bit for the language change to fully propagate
    setTimeout(async () => {
      try {
        await this.pregenerateDialogSession();
      } catch (error) {
        console.error('Failed to pre-generate dialog session after language change:', error);
        // Non-critical - continue without cached dialog session
      }
    }, 1000);
  }

  private async handleLanguageDropdownChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedLanguage = select.value;

    if (!selectedLanguage || selectedLanguage === this.currentLanguage) return;

    try {
      await window.electronAPI.database.setCurrentLanguage(selectedLanguage);
      this.currentLanguage = selectedLanguage;

      sessionManager.setActiveLanguage(selectedLanguage);
      this.sessionState = sessionManager.getCurrentSession();
      
      // Load lemmatization model for the new language (async, non-blocking)
      void this.loadLemmatizationModel(selectedLanguage);
      
      await this.checkExistingWords();
      await this.checkFlowSentences();
      await this.ensureLearningSession();
      
      // Reload stats for new language
      await this.loadWordStats();
      
      this.requestUpdate();

      // Dispatch event to notify other components (like settings panel)
      this.dispatchEvent(new CustomEvent('language-changed', {
        detail: { language: selectedLanguage },
        bubbles: true,
        composed: true
      }));

      console.log('Language changed to:', this.currentLanguage);

      // Pre-generate dialog session for the new language
      this.pregenerateDialogSessionAfterLanguageChange();
    } catch (error) {
      console.error('Failed to change language:', error);
      // Revert the selection
      select.value = this.currentLanguage;
    }
  }

  private async handleProficiencySelected(event: CustomEvent<{ level: ProficiencyLevel }>) {
    const { level } = event.detail;
    
    if (!this.currentLanguage) {
      return;
    }

    try {
      const proficiencyKey = `language_proficiency_${this.currentLanguage}`;
      await window.electronAPI.database.setSetting(proficiencyKey, level);
      this.currentProficiencyLevel = level;
      this.showProficiencySelector = false;
      console.log(`Proficiency level set for ${this.currentLanguage}:`, level);
    } catch (error) {
      console.error('Failed to save proficiency level:', error);
    }
  }

  private handleProficiencyCancelled() {
    // User cancelled, but we still don't want to show it again until next session
    // or they can dismiss it manually - for now, just hide it
    this.showProficiencySelector = false;
  }

  private capitalizeLanguage(language: string): string {
    return language.charAt(0).toUpperCase() + language.slice(1);
  }

  /**
   * Load lemmatization model asynchronously (non-blocking)
   */
  private async loadLemmatizationModel(language: string): Promise<void> {
    try {
      console.log(`[Lemmatization] Loading model for language: ${language}`);
      await window.electronAPI.lemmatization.loadModel(language);
      console.log(`[Lemmatization] Model loaded successfully for ${language}`);
    } catch (error) {
      console.warn(`[Lemmatization] Failed to load model for ${language} (non-critical):`, error);
    }
  }

  private getLanguageFlag(language: string): string {
    const flags: Record<string, string> = {
      'italian': '🇮🇹',
      'spanish': '🇪🇸',
      'portuguese': '🇵🇹',
      'polish': '🇵🇱',
      'indonesian': '🇮🇩'
    };
    return flags[language] || '🌐';
  }

  private getSupportedLanguages(): string[] {
    return ['italian', 'spanish', 'portuguese', 'polish', 'indonesian'];
  }

  private async loadWordStats() {
    try {
      if (!this.currentLanguage) {
        return;
      }

      const allWords = await window.electronAPI.database.getAllWords(true, false, this.currentLanguage);
      this.wordCategoryStats = this.calculateWordCategoryStats(allWords);
    } catch (error) {
      console.error('Failed to load word stats:', error);
      this.wordCategoryStats = null;
    }
  }

  private calculateWordCategoryStats(words: any[]): { known: number; strong: number; weak: number; new: number } {
    const stats = {
      known: 0,
      strong: 0,
      weak: 0,
      new: 0
    };

    words.forEach(word => {
      if (!word.lastStudied) {
        // Not yet reviewed
        stats.new++;
      } else if (word.strength > AppRoot.STRONG_THRESHOLD) {
        // Confidently remembered (strength > 80)
        stats.known++;
      } else if (word.strength >= AppRoot.WEAK_THRESHOLD) {
        // Mostly remembered (30-80)
        stats.strong++;
      } else {
        // Shaky or forgotten (<30)
        stats.weak++;
      }
    });

    return stats;
  }

  private updateAppState() {
    // Update legacy app state based on current route
    const routeData = router.getRouteData();

    this.appState = {
      ...this.appState,
      currentMode: this.currentRoute.mode === 'quiz' ? 'quiz' : 'learning',
      selectedTopic: routeData?.topic
    };
  }

  private updateSessionFromRoute() {
    // Update session manager with current route state
    const routeData = router.getRouteData();

      // Update mode (flow is not a route, so it won't be in currentRoute)
      sessionManager.updateCurrentMode(this.currentRoute.mode as 'topic-selection' | 'word-selection' | 'learning' | 'quiz' | 'dialog' | 'settings');

    if (routeData?.topic) {
      sessionManager.updateSelectedTopic(routeData.topic);
    }
  }

  private async handleNavigation(mode: AppMode) {
    switch (mode) {
      case 'topic-selection':
        router.goToTopicSelection();
        break;
      case 'learning':
        // Get all words from database for review
        try {
          const allWords = await window.electronAPI.database.getAllWords(true, false);
          if (allWords.length > 0) {
            router.goToLearning();
          } else {
            router.goToTopicSelection();
          }
        } catch (error) {
          console.error('Failed to load words for learning:', error);
          router.goToTopicSelection();
        }
        break;
      case 'quiz':
        // Always navigate to quiz - the quiz component will handle empty state
        router.goToQuiz();
        break;
      case 'dialog':
        router.goToDialog();
        break;
      case 'flow':
        // Flow mode is now just an overlay, no navigation needed
        // Just trigger play in flow-mode component
        break;
      case 'settings':
        router.goToSettings();
        break;
    }
  }

  private async handleCloseApp() {
    try {
      await window.electronAPI.lifecycle.closeApp();
    } catch (error) {
      console.error('Error closing app:', error);
    }
  }

  async handleFlowPlay() {
    // Prevent playing if there are no flow sentences available
    if (!this.hasFlowSentences) {
      return;
    }

    // Stop previously played audio
    try {
      await window.electronAPI.audio.stopAudio();
    } catch (err) {
      // Ignore errors when stopping (might not be playing)
    }

    // If we were in review mode (learning mode), stop auto-scroll
    if (this.currentRoute.mode === 'learning') {
      window.dispatchEvent(new CustomEvent('stop-auto-scroll', {
        bubbles: true,
        composed: true
      }));
    }

    // Don't navigate - flow mode is just an overlay
    // Trigger play in flow-mode component
    setTimeout(() => {
      const flowModeElement = this.shadowRoot?.querySelector('flow-mode') as any;
      if (flowModeElement && typeof flowModeElement.handlePlay === 'function') {
        flowModeElement.handlePlay();
      }
    }, 50);
  }

  private handleAutopilotToggle(event: Event) {
    const target = event.target as HTMLInputElement;
    this.autopilotEnabled = target.checked;
    
    if (this.autopilotEnabled) {
      this.startAutopilot();
    } else {
      this.stopAutopilot();
    }
  }

  private async loadAutoplayAudioSetting() {
    try {
      const autoplaySetting = await window.electronAPI.database.getSetting('autoplay_audio');
      this.autoplayAudioEnabled = autoplaySetting === 'true';
    } catch (error) {
      console.error('Failed to load autoplay audio setting:', error);
      this.autoplayAudioEnabled = false;
    }
  }

  private async toggleAutoplayAudio(event: Event) {
    const target = event.target as HTMLInputElement;
    this.autoplayAudioEnabled = target.checked;

    try {
      await window.electronAPI.database.setSetting('autoplay_audio', target.checked ? 'true' : 'false');
    } catch (error) {
      console.error('Failed to save autoplay audio setting:', error);
      // Revert the checkbox state if saving failed
      this.autoplayAudioEnabled = !target.checked;
      target.checked = !target.checked;
    }
  }

  private startAutopilot() {
    // Stop existing intervals if any
    this.stopAutopilot();
    
    // Check scores immediately - take over control on first run
    this.checkScoresAndNavigate(true);
    
    // Set up event listeners for specific actions
    window.addEventListener('autopilot-check-trigger', this.handleAutopilotCheckTrigger);
    
    // Set up 30-second interval for checking scores periodically
    this.autopilotIntervalId = window.setInterval(() => {
      this.checkScoresAndNavigate();
    }, 30000);
  }

  private stopAutopilot() {
    if (this.autopilotIntervalId) {
      clearInterval(this.autopilotIntervalId);
      this.autopilotIntervalId = null;
    }
    
    // Remove event listener
    window.removeEventListener('autopilot-check-trigger', this.handleAutopilotCheckTrigger);
  }

  private handleAutopilotCheckTrigger = () => {
    if (this.autopilotEnabled) {
      this.checkScoresAndNavigate();
    }
  }

  private async checkScoresAndNavigate(initialTakeover = false) {
    try {
      // Get current mode - only pass valid scoring modes to the service
      const currentMode = router.getCurrentRoute().mode;
      const validScoringModes: Set<'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow'> = new Set(['topic-selection', 'learning', 'quiz', 'dialog', 'flow']);
      const isScoringMode = (mode: AppMode): mode is 'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow' => {
        return validScoringModes.has(mode as any);
      };
      
      // Only pass current mode if it's a valid scoring mode
      const currentScoringMode = isScoringMode(currentMode) ? currentMode : undefined;
      
      // Get next mode from scoring service (scores are calculated internally and never exposed)
      const nextMode = await window.electronAPI.scoring.getNextMode({
        currentMode: currentScoringMode ?? null,
        language: this.currentLanguage || null,
        initialTakeover: initialTakeover ?? false
      });
      
      // If no mode returned, navigation is not recommended
      if (!nextMode) {
        return;
      }
      
      // Navigate to the recommended mode
      await this.handleNavigation(nextMode);
      
      // If it's flow mode, also start playing
      if (nextMode === 'flow') {
        setTimeout(async () => {
          await this.handleFlowPlay();
        }, 100);
      }
    } catch (error) {
      console.error('Error checking scores for autopilot:', error);
    }
  }




  private setupKeyboardBindings() {
    // Flow-mode component handles its own keyboard bindings
    this.keyboardUnsubscribe = useKeyboardBindings([]);
  }

  private updateKeyboardContext() {
    // Set keyboard context based on current route
    keyboardManager.setContext(this.currentRoute.mode);
  }



  render() {
    if (this.isLoading) {
      return html`
        <div class="app-container">
          <div class="loading-container">
            <div class="loading">
              <div class="spinner"></div>
              Initializing application...
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="app-container">
        <header class="app-header">
          <nav class="navigation">
            <div class="nav-left-group">
              ${!this.autopilotEnabled ? html`
                <button 
                  class="nav-button flow-button"
                  @click=${() => this.handleFlowPlay()}
                  ?disabled=${!this.hasFlowSentences}
                  title=${this.hasFlowSentences ? 'Get into the Flow' : 'Not enough sentences with audio available'}
                >
                  ▶
                </button>
                <button 
                  class="nav-button ${router.isCurrentMode('topic-selection') || router.isCurrentMode('word-selection') ? 'active' : ''}"
                  @click=${() => this.handleNavigation('topic-selection')}
                  title="Learn new words (Ctrl+1)"
                >
                  Add new
                </button>
                <button 
                  class="nav-button ${router.isCurrentMode('learning') ? 'active' : ''}"
                  @click=${() => this.handleNavigation('learning')}
                  ?disabled=${this.hasExistingWords === false}
                  title="Review existing words (Ctrl+2)"
                >
                  Review
                </button>
                <button 
                  class="nav-button ${router.isCurrentMode('quiz') ? 'active' : ''}"
                  @click=${() => this.handleNavigation('quiz')}
                  title="Take a quiz (Ctrl+3)"
                >
                  Quiz
                </button>
                <button 
                  class="nav-button ${router.isCurrentMode('dialog') ? 'active' : ''}"
                  @click=${() => this.handleNavigation('dialog')}
                  title="Practice speaking (Ctrl+4)"
                >
                  Dialog
                </button>
                <button 
                  class="nav-button ${router.isCurrentMode('settings') ? 'active' : ''}"
                  @click=${() => this.handleNavigation('settings')}
                  title="Settings (Ctrl+6)"
                >
                  Settings
                </button>
              ` : ''}
              ${this.currentLanguage ? html`
                <div class="language-dropdown">
                  <select 
                    class="language-select"
                    .value=${this.currentLanguage}
                    @change=${this.handleLanguageDropdownChange}
                    title="Select Language"
                  >
                    ${this.getSupportedLanguages().map(language => html`
                      <option value=${language} ?selected=${language === this.currentLanguage}>
                        ${this.getLanguageFlag(language)} ${this.capitalizeLanguage(language)}
                      </option>
                    `)}
                  </select>
                  ${this.wordCategoryStats ? html`
                    <div class="stats-display">
                      <div class="stat-box known">
                        <span class="stat-value">${this.wordCategoryStats.known}</span>
                        <div class="tooltip">Known: confidently remembered (strength > 80)</div>
                      </div>
                      <div class="stat-box strong">
                        <span class="stat-value">${this.wordCategoryStats.strong}</span>
                        <div class="tooltip">Strong: mostly remembered (30–80)</div>
                      </div>
                      <div class="stat-box weak">
                        <span class="stat-value">${this.wordCategoryStats.weak}</span>
                        <div class="tooltip">Weak: shaky or forgotten (&lt;30)</div>
                      </div>
                      <div class="stat-box new">
                        <span class="stat-value">${this.wordCategoryStats.new}</span>
                        <div class="tooltip">New: not yet reviewed</div>
                      </div>
                    </div>
                  ` : ''}
                </div>
              ` : ''}
            </div>
            <div class="nav-right-group">
              <div class="autoplay-toggle-container">
                <span class="autoplay-label">Auto-play</span>
                <label class="autoplay-switch">
                  <input 
                    type="checkbox"
                    .checked=${this.autoplayAudioEnabled}
                    @change=${this.toggleAutoplayAudio}
                    title="Auto-play: Automatically play sentence audio when reviewing"
                  />
                  <span class="autoplay-slider"></span>
                </label>
              </div>
              <div class="autopilot-toggle-container">
                <span class="autopilot-label">Autopilot</span>
                <label class="autopilot-switch">
                  <input 
                    type="checkbox"
                    .checked=${this.autopilotEnabled}
                    @change=${this.handleAutopilotToggle}
                    title="Autopilot: Automatically navigate to highest-scoring mode"
                  />
                  <span class="autopilot-slider"></span>
                </label>
              </div>
              <button 
                class="close-button"
                @click=${this.handleCloseApp}
                title="Close Application"
              >
                ×
              </button>
            </div>
          </nav>
        </header>

        <main class="content-area">
          <div class="route-content">
            ${this.renderCurrentRoute()}
          </div>
        </main>
      </div>

      <!-- Flow mode overlay - always rendered, appears on top when active -->
      <flow-mode></flow-mode>

      ${this.showProficiencySelector ? html`
        <language-proficiency-selector
          .language=${this.currentLanguage}
          .currentLevel=${this.currentProficiencyLevel}
          @proficiency-selected=${this.handleProficiencySelected}
          @proficiency-cancelled=${this.handleProficiencyCancelled}
        ></language-proficiency-selector>
      ` : ''}
    `;
  }

  private renderCurrentRoute() {
    const routeData = router.getRouteData();

    switch (this.currentRoute.mode) {
      case 'topic-selection':
        return html`<topic-selector></topic-selector>`;

      case 'word-selection':
        return html`
          <word-selector
            .generatedWords=${routeData?.generatedWords || []}
            .topic=${routeData?.topic}
            .language=${routeData?.language || 'Spanish'}
          ></word-selector>
        `;

      case 'learning':
        return html`<learning-mode></learning-mode>`;

      case 'quiz':
        return html`
          <quiz-mode></quiz-mode>
        `;

      case 'dialog':
        return html`<dialog-mode></dialog-mode>`;

      case 'settings':
        return html`<settings-panel></settings-panel>`;

      default:
        return html`
          <div class="placeholder">
            <h3>Unknown Route</h3>
            <p>Navigation error occurred.</p>
          </div>
        `;
    }
  }

  /**
   * Pre-generate 5 dialog sessions and cache them in the session manager
   */
  private async pregenerateDialogSession(): Promise<void> {
    try {
      // Check if we already have 5 sessions cached
      const existingSessions = sessionManager.getCurrentSession().dialogSessions || [];
      if (existingSessions.length >= 5) {
        console.log('Dialog session queue already has 5 sessions. Skipping pre-generation.');
        return;
      }

      const sessionsToGenerate = 5 - existingSessions.length;
      
      // Generate all sessions in one batch (batches DB queries, processes LLM calls sequentially)
      const sessionsData = await window.electronAPI.dialog.pregenerateSessions(sessionsToGenerate);
      
      // Convert response options dates from ISO strings back to Date objects
      const generatedSessions: import('../utils/session-manager.js').DialogSessionState[] = sessionsData.map((sessionData, index) => {
        const responseOptions = sessionData.responseOptions.map((v: {
          id: number;
          sentenceId: number;
          variantSentence: string;
          variantTranslation: string;
          createdAt: string;
        }) => ({
          id: v.id,
          sentenceId: v.sentenceId,
          variantSentence: v.variantSentence,
          variantTranslation: v.variantTranslation,
          createdAt: new Date(v.createdAt)
        }));

        // Create dialog session state
        const dialogSession: import('../utils/session-manager.js').DialogSessionState = {
          id: `dialog-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          sentenceId: sessionData.sentenceId,
          sentence: sessionData.sentence,
          translation: sessionData.translation,
          contextBefore: sessionData.contextBefore,
          contextBeforeTranslation: sessionData.contextBeforeTranslation,
          beforeSentenceAudio: sessionData.beforeSentenceAudio,
          responseOptions: responseOptions.map((v: {
            id: number;
            sentenceId: number;
            variantSentence: string;
            variantTranslation: string;
            createdAt: Date;
          }) => ({
            id: v.id,
            sentenceId: v.sentenceId,
            variantSentence: v.variantSentence,
            variantTranslation: v.variantTranslation,
            createdAt: v.createdAt.toISOString()
          })),
          createdAt: new Date().toISOString()
        };

        console.log(`Dialog session ${index + 1}/${sessionsData.length} pre-generated:`, {
          sentenceId: dialogSession.sentenceId,
          variantsCount: dialogSession.responseOptions.length
        });

        return dialogSession;
      });

      // Add all generated sessions to the queue
      if (generatedSessions.length > 0) {
        // If we have existing sessions, add them one by one
        // Otherwise, set them all at once with startIndex based on existing currentDialogIndex
        const currentSession = sessionManager.getCurrentSession();
        const startIndex = currentSession.currentDialogIndex ?? 0;
        
        if (existingSessions.length === 0) {
          // No existing sessions, set all at once
          sessionManager.setDialogSessions(generatedSessions, startIndex);
        } else {
          // Add to existing queue
          for (const session of generatedSessions) {
            sessionManager.addDialogSession(session);
          }
        }
        
        console.log(`Pre-generated ${generatedSessions.length} dialog session(s) and cached in queue. Total sessions: ${existingSessions.length + generatedSessions.length}`);
      }
    } catch (error) {
      console.error('Failed to pre-generate dialog sessions:', error);
      // Non-critical error - don't throw
    }
  }

}
