/**
 * Main application root component with routing
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AppState } from '../../shared/types/core.js';
import { router, RouteState, AppMode } from '../utils/router.js';
import { sessionManager, SessionState } from '../utils/session-manager.js';
import { sharedStyles } from '../styles/shared.js';
import { keyboardManager } from '../utils/keyboard-manager.js';
import { autoAddNewWords } from '../utils/auto-add-words.js';
import { loadCurrentLanguageWithSession, changeLanguage, loadLemmatizationModel, capitalizeLanguage, getLanguageFlag, getSupportedLanguages } from '../utils/language-manager.js';
import { calculateWordCategoryStats } from '../utils/word-stats.js';
import { checkElectronAPI, checkLLMAvailability, loadAutoplayAudioSetting, checkExistingWords, checkFlowSentences, checkProficiencyLevel, scheduleDeferred } from '../utils/app-initializer.js';
import { transformDialogSessionData, queueDialogSessions } from '../utils/dialog-session-helpers.js';
import type { ProficiencyLevel } from './language-proficiency-selector.js';
import type { LanguageState, SessionDataState, UIState } from './app-root-state.js';
import { createInitialLanguageState, createInitialSessionDataState, createInitialUIState } from './app-root-state.js';
import { AutopilotManager } from '../utils/autopilot-manager.js';
import './topic-selector.js';
import './word-selector.js';
import './learning-mode.js';
import './quiz-mode.js';
import './dialog-mode.js';
import './flow-mode.js';
import './settings-panel.js';
import './language-proficiency-selector.js';
import './toggle-switch.js';

@customElement('app-root')
export class AppRoot extends LitElement {
  @state()
  private currentRoute: RouteState = { mode: 'learning' };

  @state()
  private appState: AppState = {
    currentMode: 'learning'
  };

  @state()
  private uiState: UIState = createInitialUIState();

  @state()
  private sessionState: SessionState | null = null;

  @state()
  private languageState: LanguageState = createInitialLanguageState();

  @state()
  private sessionDataState: SessionDataState = createInitialSessionDataState();


  private routerUnsubscribe?: () => void;
  private keyboardUnsubscribe?: () => void;
  private autopilotManager?: AutopilotManager;
  private transitionMessageTimeout: number | null = null;

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

      .transition-indicator {
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000;
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius-small);
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: 13px;
        color: var(--text-secondary);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease-in-out;
        white-space: nowrap;
      }

      .transition-indicator.visible {
        opacity: 1;
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

      .settings-button {
        padding: var(--spacing-xs) var(--spacing-sm);
        border: none;
        background: transparent;
        color: var(--text-tertiary);
        border-radius: var(--border-radius-small);
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        transition: all 0.2s ease;
        opacity: 0.5;
      }

      .settings-button:hover {
        color: var(--text-secondary);
        opacity: 0.8;
        background: var(--background-secondary);
      }

      .settings-button.active {
        opacity: 1;
        color: var(--primary-color);
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

    // Initialize autopilot manager
    this.autopilotManager = new AutopilotManager({
      onCheck: (initialTakeover) => this.checkScoresAndNavigate(initialTakeover)
    });

    // Subscribe to router changes
    this.routerUnsubscribe = router.subscribe((route) => {
      this.currentRoute = route;
      this.updateAppState();
      this.updateSessionFromRoute();
      this.updateKeyboardContext();
    });

    // Listen for language changes
    this.addEventListener('language-changed', this.handleLanguageChanged);

    // Listen for word updates to refresh stats
    this.addEventListener('words-updated', this.handleWordsUpdated);


    // Initialize current route
    this.currentRoute = router.getCurrentRoute();
    // Ensure keyboard context is set on initial load
    this.updateKeyboardContext();

    await this.initializeApp();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.autopilotManager) {
      this.autopilotManager.stop();
    }
    if (this.routerUnsubscribe) {
      this.routerUnsubscribe();
    }
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }
    if (this.transitionMessageTimeout !== null) {
      clearTimeout(this.transitionMessageTimeout);
      this.transitionMessageTimeout = null;
    }
    this.removeEventListener('language-changed', this.handleLanguageChanged);
    this.removeEventListener('words-updated', this.handleWordsUpdated);
  }

  private async initializeApp() {
    try {
      // Check if electronAPI is available
      if (!checkElectronAPI()) {
        this.uiState = { ...this.uiState, isLoading: false };
        return;
      }

      // Check if LLM is available (non-blocking)
      await checkLLMAvailability();

      // Load current language
      await this.loadCurrentLanguage();

      // Load autoplay audio setting
      await this.loadAutoplayAudioSetting();

      // Load stats for current language
      await this.loadWordStats();

      // Load saved session
      await this.loadSession();

      // Check for existing words in database (non-blocking - deferred)
      // This optimization speeds up initial render by deferring the check
      scheduleDeferred(async () => {
        await this.checkExistingWords();
        await this.checkFlowSentences();
      });

      await this.ensureLearningSession();

      // Pre-generate dialog session asynchronously (non-blocking)
      scheduleDeferred(async () => {
        await this.pregenerateDialogSession();
      });

      this.uiState = { ...this.uiState, isLoading: false };
    } catch (error) {
      console.error('Failed to initialize app:', error);
      this.uiState = { ...this.uiState, isLoading: false };
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
    this.sessionDataState = { 
      ...this.sessionDataState, 
      hasExistingWords: await checkExistingWords(this.languageState.currentLanguage || undefined)
    };
    
    // Check proficiency level (will show selector if no words and no proficiency set)
    if (this.languageState.currentLanguage) {
      await this.checkProficiencyLevelInternal();
    }
    
    if (this.sessionDataState.hasExistingWords === false && router.isCurrentMode('learning')) {
      router.goToTopicSelection();
    }
  }

  private async checkProficiencyLevelInternal() {
    if (!this.languageState.currentLanguage) {
      return;
    }

    const proficiency = await checkProficiencyLevel(this.languageState.currentLanguage);
    this.languageState = {
      ...this.languageState,
      currentProficiencyLevel: proficiency as ProficiencyLevel | null,
      showProficiencySelector: !this.sessionDataState.hasExistingWords && !proficiency
    };
  }

  private async checkFlowSentences() {
    this.sessionDataState = { 
      ...this.sessionDataState, 
      hasFlowSentences: await checkFlowSentences() 
    };
  }

  private async loadCurrentLanguage() {
    const language = await loadCurrentLanguageWithSession('spanish', true);
    this.languageState = { ...this.languageState, currentLanguage: language };
  }

  private async ensureLearningSession() {
    try {
      const existingSession = sessionManager.getLearningSession();
      if (existingSession && existingSession.wordIds.length > 0 && !existingSession.completed) {
        return;
      }

      if (this.sessionDataState.hasExistingWords === false) {
        return;
      }

      const language = this.languageState.currentLanguage || (await window.electronAPI.database.getCurrentLanguage());
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

    if (newLanguage && newLanguage === this.languageState.currentLanguage) {
      return;
    }

      await this.refreshCurrentLanguage();
      // Reload stats for new language
      await this.loadWordStats();
    };

  private handleWordsUpdated = async () => {
    // Reload word stats when words are added/updated
    await this.loadWordStats();
    this.requestUpdate();
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

    if (!selectedLanguage || selectedLanguage === this.languageState.currentLanguage) return;

    try {
      await changeLanguage(selectedLanguage, async (newLanguage) => {
        this.languageState = { ...this.languageState, currentLanguage: newLanguage };
        this.sessionState = sessionManager.getCurrentSession();
        
        await this.checkExistingWords();
        await this.checkFlowSentences();
        await this.ensureLearningSession();
        
        // Reload stats for new language
        await this.loadWordStats();
        
        this.requestUpdate();

        // Dispatch event to notify other components (like settings panel)
        this.dispatchEvent(new CustomEvent('language-changed', {
          detail: { language: newLanguage },
          bubbles: true,
          composed: true
        }));

        // Pre-generate dialog session for the new language
        this.pregenerateDialogSessionAfterLanguageChange();
      });
    } catch (error) {
      console.error('Failed to change language:', error);
      // Revert the selection
      select.value = this.languageState.currentLanguage;
    }
  }

  private async handleProficiencySelected(event: CustomEvent<{ level: ProficiencyLevel }>) {
    const { level } = event.detail;
    
    if (!this.languageState.currentLanguage) {
      return;
    }

    try {
      const proficiencyKey = `language_proficiency_${this.languageState.currentLanguage}`;
      await window.electronAPI.database.setSetting(proficiencyKey, level);
      this.languageState = {
        ...this.languageState,
        currentProficiencyLevel: level,
        showProficiencySelector: false
      };
    } catch (error) {
      console.error('Failed to save proficiency level:', error);
    }
  }

  private handleProficiencyCancelled() {
    // User cancelled, but we still don't want to show it again until next session
    // or they can dismiss it manually - for now, just hide it
    this.languageState = { ...this.languageState, showProficiencySelector: false };
  }


  private async loadWordStats() {
    try {
      if (!this.languageState.currentLanguage) {
        return;
      }

      const allWords = await window.electronAPI.database.getAllWords(true, false, this.languageState.currentLanguage);
      this.sessionDataState = {
        ...this.sessionDataState,
        wordCategoryStats: calculateWordCategoryStats(allWords)
      };
    } catch (error) {
      console.error('Failed to load word stats:', error);
      this.sessionDataState = { ...this.sessionDataState, wordCategoryStats: null };
    }
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
        // Check if there are words with sentences available for review in the current language
        try {
          const wordsWithSentences = await window.electronAPI.database.getWordsWithSentencesOrderedByStrength(true, false, this.languageState.currentLanguage || undefined);
          if (wordsWithSentences.length > 0) {
            router.goToLearning();
          } else {
            // Still navigate to learning mode - it will show appropriate empty state
            router.goToLearning();
          }
        } catch (error) {
          console.error('Failed to load words for learning:', error);
          router.goToLearning();
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
    if (!this.sessionDataState.hasFlowSentences) {
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
    this.handleToggleAutopilot(event);
  }

  private handleToggleAutopilot(event: Event) {
    const customEvent = event as CustomEvent<{ checked: boolean }>;
    this.uiState = { ...this.uiState, autopilotEnabled: customEvent.detail.checked };
    
    if (this.uiState.autopilotEnabled && this.autopilotManager) {
      this.autopilotManager.start(true);
    } else if (this.autopilotManager) {
      this.autopilotManager.stop();
    }
  }

  private handleToggleAutoplayAudio(event: Event) {
    const customEvent = event as CustomEvent<{ checked: boolean }>;
    const previousValue = this.uiState.autoplayAudioEnabled;
    this.uiState = { ...this.uiState, autoplayAudioEnabled: customEvent.detail.checked };

    window.electronAPI.database.setSetting('autoplay_audio', this.uiState.autoplayAudioEnabled ? 'true' : 'false')
      .catch((error: Error) => {
        console.error('Failed to save autoplay audio setting:', error);
        // Revert the state if saving failed
        this.uiState = { ...this.uiState, autoplayAudioEnabled: previousValue };
      });
  }

  private async loadAutoplayAudioSetting() {
    this.uiState = { ...this.uiState, autoplayAudioEnabled: await loadAutoplayAudioSetting() };
  }



  /**
   * Show transition message and clear it after a delay
   */
  private showTransitionMessage(message: string): void {
    // Clear any existing timeout
    if (this.transitionMessageTimeout !== null) {
      clearTimeout(this.transitionMessageTimeout);
      this.transitionMessageTimeout = null;
    }

    // Set the message first
    this.uiState = { ...this.uiState, transitionMessage: message };

    // Force a re-render and then add visible class after a tiny delay
    this.requestUpdate();
    requestAnimationFrame(() => {
      const indicator = this.shadowRoot?.querySelector('.transition-indicator');
      if (indicator) {
        indicator.classList.add('visible');
      }
    });

    // Clear after 3 seconds
    this.transitionMessageTimeout = window.setTimeout(() => {
      const indicator = this.shadowRoot?.querySelector('.transition-indicator');
      if (indicator) {
        indicator.classList.remove('visible');
      }
      // Clear the message after transition completes
      setTimeout(() => {
        this.uiState = { ...this.uiState, transitionMessage: null };
      }, 300); // Wait for transition to complete
      this.transitionMessageTimeout = null;
    }, 3000);
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
      
      // Get next mode and ranked modes from scoring service
      const result = await window.electronAPI.scoring.getNextMode({
        currentMode: currentScoringMode ?? null,
        language: this.languageState.currentLanguage || null,
        initialTakeover: initialTakeover ?? false
      });
      
      // Check if we have fewer than 5 unreviewed words, and if so, add more
      const unreviewedCount = await window.electronAPI.database.getNewWordCount(this.languageState.currentLanguage);
      
      if (unreviewedCount < 5) {
        void this.handleAutoAddNew();
      }
      
      // If no mode returned, navigation is not recommended
      if (!result.nextMode) {
        return;
      }
      
      // Show transition message
      const message = AutopilotManager.getTransitionMessage(result.nextMode);
      this.showTransitionMessage(message);
      
      // Navigate to the recommended mode
      await this.handleNavigation(result.nextMode);
      
      // If it's flow mode, also start playing
      if (result.nextMode === 'flow') {
        setTimeout(async () => {
          await this.handleFlowPlay();
        }, 100);
      }
    } catch (error) {
      console.error('Error checking scores for autopilot:', error);
    }
  }

  /**
   * Automatically add new words by selecting a random topic, generating words,
   * and processing 5 top words automatically.
   */
  private async handleAutoAddNew(): Promise<void> {
    try {
      const result = await autoAddNewWords(this.languageState.currentLanguage);
      
      if (result.success) {
        // Reload stats and check existing words after adding
        await this.loadWordStats();
        await this.checkExistingWords();
        
        // Trigger autopilot check
        window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));
      } else {
        console.error(`[Auto Add] Failed: ${result.error}`);
      }
    } catch (error) {
      console.error('[Auto Add] Error in handleAutoAddNew:', error);
    }
  }





  private updateKeyboardContext() {
    // Set keyboard context based on current route
    keyboardManager.setContext(this.currentRoute.mode);
  }



  render() {
    if (this.uiState.isLoading) {
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
              ${!this.uiState.autopilotEnabled ? html`
                <button 
                  class="nav-button flow-button"
                  @click=${() => this.handleFlowPlay()}
                  ?disabled=${!this.sessionDataState.hasFlowSentences}
                  title=${this.sessionDataState.hasFlowSentences ? 'Get into the Flow' : 'Not enough sentences with audio available'}
                >
                  ▶
                </button>
                <button 
                  class="nav-button ${router.isCurrentMode('topic-selection') || router.isCurrentMode('word-selection') ? 'active' : ''}"
                  @click=${() => this.handleNavigation('topic-selection')}
                  title="Learn new words"
                >
                  Add new
                </button>
                <button 
                  class="nav-button ${router.isCurrentMode('learning') ? 'active' : ''}"
                  @click=${() => this.handleNavigation('learning')}
                  title="Review existing words"
                >
                  Review
                </button>
                <button 
                  class="nav-button ${router.isCurrentMode('quiz') ? 'active' : ''}"
                  @click=${() => this.handleNavigation('quiz')}
                  title="Take a quiz"
                >
                  Quiz
                </button>
                <button 
                  class="nav-button ${router.isCurrentMode('dialog') ? 'active' : ''}"
                  @click=${() => this.handleNavigation('dialog')}
                  title="Practice speaking"
                >
                  Dialog
                </button>
              ` : ''}
              ${this.languageState.currentLanguage ? html`
                <div class="language-dropdown">
                  <select 
                    class="language-select"
                    .value=${this.languageState.currentLanguage}
                    @change=${this.handleLanguageDropdownChange}
                    title="Select Language"
                  >
                    ${getSupportedLanguages().map(language => html`
                      <option value=${language} ?selected=${language === this.languageState.currentLanguage}>
                        ${getLanguageFlag(language)} ${capitalizeLanguage(language)}
                      </option>
                    `)}
                  </select>
                  ${this.sessionDataState.wordCategoryStats ? html`
                    <div class="stats-display">
                      <div class="stat-box known">
                        <span class="stat-value">${this.sessionDataState.wordCategoryStats.known}</span>
                        <div class="tooltip">Known: confidently remembered (strength > 80)</div>
                      </div>
                      <div class="stat-box strong">
                        <span class="stat-value">${this.sessionDataState.wordCategoryStats.strong}</span>
                        <div class="tooltip">Strong: mostly remembered (30–80)</div>
                      </div>
                      <div class="stat-box weak">
                        <span class="stat-value">${this.sessionDataState.wordCategoryStats.weak}</span>
                        <div class="tooltip">Weak: shaky or forgotten (&lt;30)</div>
                      </div>
                      <div class="stat-box new">
                        <span class="stat-value">${this.sessionDataState.wordCategoryStats.new}</span>
                        <div class="tooltip">New: not yet reviewed</div>
                      </div>
                    </div>
                  ` : ''}
                </div>
              ` : ''}
            </div>
            <div class="nav-right-group">
              <toggle-switch
                label="Auto-play"
                ?checked=${this.uiState.autoplayAudioEnabled}
                title="Auto-play: Automatically play sentence audio when reviewing"
                @toggle-changed=${this.handleToggleAutoplayAudio}
              ></toggle-switch>
              <toggle-switch
                label="Autopilot"
                ?checked=${this.uiState.autopilotEnabled}
                title="Autopilot: Automatically navigate to highest-scoring mode"
                @toggle-changed=${this.handleToggleAutopilot}
              ></toggle-switch>
              <button 
                class="settings-button ${router.isCurrentMode('settings') ? 'active' : ''}"
                @click=${() => this.handleNavigation('settings')}
                title="Settings"
              >
                ⚙️
              </button>
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

      ${html`
        <div class="transition-indicator ${this.uiState.transitionMessage ? 'visible' : ''}">
          ${this.uiState.transitionMessage || ''}
        </div>
      `}

      <!-- Flow mode overlay - always rendered, appears on top when active -->
      <flow-mode></flow-mode>

      ${this.languageState.showProficiencySelector ? html`
        <language-proficiency-selector
          .language=${this.languageState.currentLanguage}
          .currentLevel=${this.languageState.currentProficiencyLevel}
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
      const currentSession = sessionManager.getCurrentSession();
      const existingSessions = currentSession.dialogSessions || [];
      if (existingSessions.length >= 5) {
        return;
      }

      const sessionsToGenerate = 5 - existingSessions.length;
      
      // Generate all sessions in one batch (batches DB queries, processes LLM calls sequentially)
      const sessionsData = await window.electronAPI.dialog.pregenerateSessions(sessionsToGenerate);
      
      // Transform API response to DialogSessionState
      const generatedSessions = transformDialogSessionData(sessionsData, existingSessions.length);

      // Queue sessions into session manager
      queueDialogSessions(
        generatedSessions,
        existingSessions,
        currentSession.currentDialogIndex,
        (sessions, startIndex) => sessionManager.setDialogSessions(sessions, startIndex),
        (session) => sessionManager.addDialogSession(session)
      );
    } catch (error) {
      console.error('Failed to pre-generate dialog sessions:', error);
      // Non-critical error - don't throw
    }
  }

}
