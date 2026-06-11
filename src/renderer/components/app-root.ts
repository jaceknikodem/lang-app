/**
 * Main application root component with routing
 */

import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { router, RouteState, AppMode } from '../utils/router.js';
import { sessionManager, SessionState } from '../utils/session-manager.js';
import { sharedStyles } from '../styles/shared.js';
import { appRootStyles } from './app-root.styles.js';
import {
  keyboardManager,
  useKeyboardBindings,
  GlobalShortcuts,
} from '../utils/keyboard-manager.js';
import { autoAddNewWords } from '../utils/auto-add-words.js';
import {
  loadCurrentLanguageWithSession,
  changeLanguage,
  capitalizeLanguage,
  getLanguageFlag,
  getSupportedLanguages,
} from '../utils/language-manager.js';
import { calculateWordCategoryStats } from '../utils/word-stats.js';
import {
  checkElectronAPI,
  checkLLMAvailability,
  loadAutoplayAudioSetting,
  checkExistingWords,
  checkFlowSentences,
  checkProficiencyLevel,
  scheduleDeferred,
} from '../utils/app-initializer.js';
import {
  transformDialogSessionData,
  queueDialogSessions,
} from '../utils/dialog-session-helpers.js';
import type { ProficiencyLevel } from './language-proficiency-selector.js';
import type { LanguageDataState, UIState } from './app-root-state.js';
import { createInitialLanguageDataState, createInitialUIState } from './app-root-state.js';
import { AutopilotManager } from '../utils/autopilot-manager.js';
import { logger } from '../utils/logger.js';
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
  private uiState: UIState = createInitialUIState();

  @state()
  private sessionState: SessionState | null = null;

  @state()
  private languageDataState: LanguageDataState = createInitialLanguageDataState();

  @state()
  private languageStats: Array<{
    language: string;
    totalWords: number;
    studiedWords: number;
    averagePronunciationScore: number | null;
    pronunciationAttemptCount: number;
  }> = [];

  @state()
  private proficiencyScores: Map<string, number> = new Map();

  private routerUnsubscribe?: () => void;
  private keyboardUnsubscribe?: () => void;
  private autopilotManager?: AutopilotManager;
  private transitionMessageTimeout: number | null = null;

  static styles = [sharedStyles, appRootStyles];

  async connectedCallback() {
    super.connectedCallback();

    // Initialize autopilot manager
    this.autopilotManager = new AutopilotManager({
      onCheck: (initialTakeover) => this.checkScoresAndNavigate(initialTakeover),
    });

    // Subscribe to router changes
    this.routerUnsubscribe = router.subscribe((route) => {
      this.currentRoute = route;
      this.updateSessionFromRoute();
      this.updateKeyboardContext();
    });

    // Listen for language changes
    this.addEventListener('language-changed', this.handleLanguageChanged);

    // Listen for word updates to refresh stats
    this.addEventListener('words-updated', this.handleWordsUpdated);

    // Listen for dialog session completion to trigger pregeneration
    window.addEventListener('dialog-session-complete', this.handleDialogSessionComplete);

    // Initialize current route
    this.currentRoute = router.getCurrentRoute();
    // Ensure keyboard context is set on initial load
    this.updateKeyboardContext();

    // Setup keyboard bindings
    this.setupKeyboardBindings();

    // Listen for manual proficiency adjustment
    window.addEventListener('show-proficiency-selector', this.handleShowProficiencySelector);

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
    window.removeEventListener('dialog-session-complete', this.handleDialogSessionComplete);
    window.removeEventListener('show-proficiency-selector', this.handleShowProficiencySelector);
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

      // Load language stats (for all languages)
      await this.loadLanguageStats();

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
      logger.error({ error }, 'Failed to initialize app');
      this.uiState = { ...this.uiState, isLoading: false };
    }
  }

  private async loadSession() {
    try {
      // Load persisted session state (includes learning session metadata)
      this.sessionState = sessionManager.getCurrentSession();
    } catch (error) {
      logger.error({ error }, 'Failed to load session');
      this.sessionState = sessionManager.getCurrentSession();
    }
  }

  private async checkExistingWords() {
    this.languageDataState = {
      ...this.languageDataState,
      hasExistingWords: await checkExistingWords(
        this.languageDataState.currentLanguage ||
          (await window.electronAPI.database.getCurrentLanguage())
      ),
    };

    // Check proficiency level (will show selector if no words and no proficiency set)
    if (this.languageDataState.currentLanguage) {
      await this.checkProficiencyLevelInternal();
    }

    if (this.languageDataState.hasExistingWords === false && router.isCurrentMode('learning')) {
      router.goToTopicSelection();
    }
  }

  private handleShowProficiencySelector = () => {
    this.languageDataState = { ...this.languageDataState, showProficiencySelector: true };
  };

  private async checkProficiencyLevelInternal() {
    if (!this.languageDataState.currentLanguage) {
      return;
    }

    const proficiency = await checkProficiencyLevel(this.languageDataState.currentLanguage);
    this.languageDataState = {
      ...this.languageDataState,
      currentProficiencyLevel: proficiency as ProficiencyLevel | null,
      showProficiencySelector: !this.languageDataState.hasExistingWords && !proficiency,
    };
  }

  private async checkFlowSentences() {
    this.languageDataState = {
      ...this.languageDataState,
      hasFlowSentences: await checkFlowSentences(),
    };
  }

  private async loadCurrentLanguage() {
    const language = await loadCurrentLanguageWithSession('spanish', true);
    this.languageDataState = { ...this.languageDataState, currentLanguage: language };
  }

  private async ensureLearningSession() {
    try {
      const existingSession = sessionManager.getLearningSession();
      if (existingSession && existingSession.wordIds.length > 0 && !existingSession.completed) {
        return;
      }

      if (this.languageDataState.hasExistingWords === false) {
        return;
      }

      const language =
        this.languageDataState.currentLanguage ||
        (await window.electronAPI.database.getCurrentLanguage());
      const candidates = await window.electronAPI.database.getWordsWithSentencesOrderedByStrength(
        language,
        true,
        false
      );

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
      logger.error({ error }, 'Failed to ensure learning session');
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

    if (newLanguage && newLanguage === this.languageDataState.currentLanguage) {
      return;
    }

    await this.refreshCurrentLanguage();
    // Reload stats for new language
    await this.loadWordStats();
  };

  private handleWordsUpdated = async () => {
    // Reload word stats when words are added/updated
    await this.loadWordStats();
    // Also reload language stats (pronunciation scores may have changed)
    await this.loadLanguageStats();
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
        logger.error({ error }, 'Failed to pre-generate dialog session after language change');
        // Non-critical - continue without cached dialog session
      }
    }, 1000);
  }

  private async handleLanguageDropdownChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedLanguage = select.value;

    if (!selectedLanguage || selectedLanguage === this.languageDataState.currentLanguage) return;

    try {
      await changeLanguage(selectedLanguage, async (newLanguage) => {
        this.languageDataState = { ...this.languageDataState, currentLanguage: newLanguage };
        // Reload language stats after language change
        await this.loadLanguageStats();
        this.sessionState = sessionManager.getCurrentSession();

        await this.checkExistingWords();
        await this.checkFlowSentences();
        await this.ensureLearningSession();

        // Reload stats for new language
        await this.loadWordStats();

        this.requestUpdate();

        // Dispatch event to notify other components (like settings panel)
        // Dispatch on window instead of this element to ensure it reaches all listeners
        window.dispatchEvent(
          new CustomEvent('language-changed', {
            detail: { language: newLanguage },
            bubbles: true,
            composed: true,
          })
        );

        // Pre-generate dialog session for the new language
        this.pregenerateDialogSessionAfterLanguageChange();
      });
    } catch (error) {
      logger.error({ error, newLanguage: select.value }, 'Failed to change language');
      // Revert the selection
      select.value = this.languageDataState.currentLanguage;
    }
  }

  private async handleProficiencySelected(event: CustomEvent<{ level: ProficiencyLevel }>) {
    const { level } = event.detail;

    if (!this.languageDataState.currentLanguage) {
      return;
    }

    try {
      const proficiencyKey = `language_proficiency_${this.languageDataState.currentLanguage}`;
      await window.electronAPI.database.setSetting(proficiencyKey, level);
      this.languageDataState = {
        ...this.languageDataState,
        currentProficiencyLevel: level,
        showProficiencySelector: false,
      };
    } catch (error) {
      logger.error({ error, level }, 'Failed to save proficiency level');
    }
  }

  private handleProficiencyCancelled() {
    // User cancelled, but we still don't want to show it again until next session
    // or they can dismiss it manually - for now, just hide it
    this.languageDataState = { ...this.languageDataState, showProficiencySelector: false };
  }

  private async loadLanguageStats() {
    try {
      this.languageStats = await window.electronAPI.database.getLanguageStats();

      // Load proficiency scores for all languages
      const proficiencyMap = new Map<string, number>();
      for (const langStat of this.languageStats) {
        try {
          const proficiency = await window.electronAPI.scoring.getLanguageProficiency(
            langStat.language
          );
          proficiencyMap.set(langStat.language, proficiency);
        } catch (error) {
          logger.warn({ error, language: langStat.language }, 'Failed to get proficiency');
        }
      }
      this.proficiencyScores = proficiencyMap;
    } catch (error) {
      logger.error({ error }, 'Failed to load language stats');
      this.languageStats = [];
    }
  }

  private async loadWordStats() {
    try {
      if (!this.languageDataState.currentLanguage) {
        return;
      }

      const allWords = await window.electronAPI.database.getAllWordsWithSentences(
        this.languageDataState.currentLanguage
      );
      this.languageDataState = {
        ...this.languageDataState,
        wordCategoryStats: calculateWordCategoryStats(allWords),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to load word stats');
      this.languageDataState = { ...this.languageDataState, wordCategoryStats: null };
    }
  }

  private updateSessionFromRoute() {
    // Update session manager with current route state
    const routeData = router.getRouteData();

    // Update mode (flow is not a route, so it won't be in currentRoute)
    sessionManager.updateCurrentMode(
      this.currentRoute.mode as
        | 'topic-selection'
        | 'word-selection'
        | 'learning'
        | 'quiz'
        | 'dialog'
        | 'settings'
    );

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
          const language =
            this.languageDataState.currentLanguage ||
            (await window.electronAPI.database.getCurrentLanguage());
          const wordsWithSentences =
            await window.electronAPI.database.getWordsWithSentencesOrderedByStrength(
              language,
              true,
              false
            );
          if (wordsWithSentences.length > 0) {
            router.goToLearning();
          } else {
            // Still navigate to learning mode - it will show appropriate empty state
            router.goToLearning();
          }
        } catch (error) {
          logger.error({ error }, 'Failed to load words for learning');
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
      logger.error({ error }, 'Error closing app');
    }
  }

  async handleFlowPlay() {
    // Prevent playing if there are no flow sentences available
    if (!this.languageDataState.hasFlowSentences) {
      return;
    }

    // Stop previously played audio
    try {
      await window.electronAPI.audio.stopAudio();
    } catch {
      // Ignore errors when stopping (might not be playing)
    }

    // If we were in review mode (learning mode), stop auto-scroll
    if (this.currentRoute.mode === 'learning') {
      window.dispatchEvent(
        new CustomEvent('stop-auto-scroll', {
          bubbles: true,
          composed: true,
        })
      );
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

    window.electronAPI.database
      .setSetting('autoplay_audio', this.uiState.autoplayAudioEnabled ? 'true' : 'false')
      .catch((error: Error) => {
        logger.error({ error }, 'Failed to save autoplay audio setting');
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
      const validScoringModes: Set<'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow'> =
        new Set(['topic-selection', 'learning', 'quiz', 'dialog', 'flow']);
      const isScoringMode = (
        mode: AppMode
      ): mode is 'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow' => {
        return validScoringModes.has(mode as any);
      };

      // Only pass current mode if it's a valid scoring mode
      const currentScoringMode = isScoringMode(currentMode) ? currentMode : undefined;

      // Get next mode and ranked modes from scoring service
      const result = await window.electronAPI.scoring.getNextMode({
        currentMode: currentScoringMode ?? null,
        language: this.languageDataState.currentLanguage || null,
        initialTakeover: initialTakeover ?? false,
      });

      // Check if we have fewer than 5 unreviewed words, and if so, add more
      const unreviewedCount = await window.electronAPI.database.getNewWordCount(
        this.languageDataState.currentLanguage ||
          (await window.electronAPI.database.getCurrentLanguage())
      );

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
      logger.error({ error }, 'Error checking scores for autopilot');
    }
  }

  /**
   * Automatically add new words by selecting a random topic, generating words,
   * and processing 5 top words automatically.
   */
  private async handleAutoAddNew(): Promise<void> {
    try {
      const result = await autoAddNewWords(this.languageDataState.currentLanguage);

      if (result.success) {
        // Reload stats and check existing words after adding
        await this.loadWordStats();
        await this.checkExistingWords();

        // Trigger autopilot check
        window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));
      } else {
        logger.error({ error: result.error }, '[Auto Add] Failed');
      }
    } catch (error) {
      logger.error({ error }, '[Auto Add] Error in handleAutoAddNew');
    }
  }

  private updateKeyboardContext() {
    // Set keyboard context based on current route
    keyboardManager.setContext(this.currentRoute.mode);
  }

  private setupKeyboardBindings() {
    const bindings = [
      {
        ...GlobalShortcuts.ESCAPE,
        action: () => {
          // Close proficiency pop-up if it's shown
          if (this.languageDataState.showProficiencySelector) {
            this.handleProficiencyCancelled();
          }
        },
        description: 'Close proficiency pop-up',
      },
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
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
              ${!this.uiState.autopilotEnabled
                ? html`
                    <button
                      class="nav-button flow-button"
                      @click=${() => this.handleFlowPlay()}
                      ?disabled=${!this.languageDataState.hasFlowSentences}
                      title=${this.languageDataState.hasFlowSentences
                        ? 'Get into the Flow'
                        : 'Not enough sentences with audio available'}
                    >
                      ▶
                    </button>
                    <button
                      class="nav-button ${router.isCurrentMode('topic-selection') ||
                      router.isCurrentMode('word-selection')
                        ? 'active'
                        : ''}"
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
                  `
                : ''}
              ${this.languageDataState.currentLanguage
                ? html`
                    <div class="language-dropdown">
                      <select
                        class="language-select"
                        .value=${this.languageDataState.currentLanguage}
                        @change=${this.handleLanguageDropdownChange}
                        title="Select Language"
                      >
                        ${getSupportedLanguages().map(
                          (language) => html`
                            <option
                              value=${language}
                              ?selected=${language === this.languageDataState.currentLanguage}
                            >
                              ${getLanguageFlag(language)} ${capitalizeLanguage(language)}
                            </option>
                          `
                        )}
                      </select>
                      ${(() => {
                        const currentLangStats = this.languageStats.find(
                          (s) => s.language === this.languageDataState.currentLanguage
                        );
                        const pronunciationScore = currentLangStats?.averagePronunciationScore;
                        const pronunciationAttemptCount =
                          currentLangStats?.pronunciationAttemptCount || 0;
                        const proficiencyScore = this.proficiencyScores.get(
                          this.languageDataState.currentLanguage
                        );
                        const hasStats =
                          this.languageDataState.wordCategoryStats ||
                          (pronunciationScore !== null && pronunciationScore !== undefined) ||
                          (proficiencyScore !== undefined && proficiencyScore !== null);
                        const proficiencyLevelDisplay = this.languageDataState
                          .currentProficiencyLevel
                          ? (this.languageDataState.currentProficiencyLevel === 'newbie'
                              ? 'New'
                              : this.languageDataState.currentProficiencyLevel.toUpperCase()
                            ).substring(0, 3)
                          : null;

                        if (!hasStats && !proficiencyLevelDisplay) return '';

                        return html`
                          <div class="stats-display">
                            ${this.languageDataState.wordCategoryStats
                              ? html`
                                  <div class="stat-box known">
                                    <span class="stat-value"
                                      >${this.languageDataState.wordCategoryStats.known}</span
                                    >
                                    <div class="tooltip">
                                      Known: confidently remembered (strength > 80)
                                    </div>
                                  </div>
                                  <div class="stat-box strong">
                                    <span class="stat-value"
                                      >${this.languageDataState.wordCategoryStats.strong}</span
                                    >
                                    <div class="tooltip">Strong: mostly remembered (30–80)</div>
                                  </div>
                                  <div class="stat-box weak">
                                    <span class="stat-value"
                                      >${this.languageDataState.wordCategoryStats.weak}</span
                                    >
                                    <div class="tooltip">Weak: shaky or forgotten (&lt;30)</div>
                                  </div>
                                  <div class="stat-box new">
                                    <span class="stat-value"
                                      >${this.languageDataState.wordCategoryStats.new}</span
                                    >
                                    <div class="tooltip">New: not yet reviewed</div>
                                  </div>
                                `
                              : ''}
                            ${pronunciationScore !== null && pronunciationScore !== undefined
                              ? html`
                                  <div class="stat-box pronunciation">
                                    <span class="stat-value">${pronunciationScore.toFixed(1)}</span>
                                    <div class="tooltip">
                                      Average pronunciation score (0-10 scale) based on
                                      ${pronunciationAttemptCount}
                                      attempt${pronunciationAttemptCount !== 1 ? 's' : ''}
                                    </div>
                                  </div>
                                `
                              : ''}
                            ${proficiencyScore !== undefined && proficiencyScore !== null
                              ? html`
                                  <div class="stat-box proficiency-score">
                                    <span class="stat-value">${proficiencyScore.toFixed(0)}%</span>
                                    <div class="tooltip">
                                      Overall proficiency score (0-100%) based on pronunciation,
                                      audio speed, engagement, word position, and strength
                                    </div>
                                  </div>
                                `
                              : ''}
                            ${proficiencyLevelDisplay
                              ? html`
                                  <div
                                    class="stat-box proficiency"
                                    @click=${() =>
                                      (this.languageDataState = {
                                        ...this.languageDataState,
                                        showProficiencySelector: true,
                                      })}
                                  >
                                    <span class="stat-value">${proficiencyLevelDisplay}</span>
                                    <div class="tooltip">Click to adjust proficiency level</div>
                                  </div>
                                `
                              : ''}
                          </div>
                        `;
                      })()}
                    </div>
                  `
                : ''}
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
              <button class="close-button" @click=${this.handleCloseApp} title="Close Application">
                ×
              </button>
            </div>
          </nav>
        </header>

        <main class="content-area">
          <div class="route-content">${this.renderCurrentRoute()}</div>
        </main>
      </div>

      ${html`
        <div class="transition-indicator ${this.uiState.transitionMessage ? 'visible' : ''}">
          ${this.uiState.transitionMessage || ''}
        </div>
      `}

      <!-- Flow mode overlay - always rendered, appears on top when active -->
      <flow-mode></flow-mode>

      ${this.languageDataState.showProficiencySelector
        ? html`
            <language-proficiency-selector
              .language=${this.languageDataState.currentLanguage}
              .currentLevel=${this.languageDataState.currentProficiencyLevel}
              @proficiency-selected=${this.handleProficiencySelected}
              @proficiency-cancelled=${this.handleProficiencyCancelled}
            ></language-proficiency-selector>
          `
        : ''}
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
        return html` <quiz-mode></quiz-mode> `;

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
   * Handle dialog session completion - trigger pregeneration of new sessions
   */
  private handleDialogSessionComplete = async (): Promise<void> => {
    // Pre-generate new dialog sessions after summary is shown
    scheduleDeferred(async () => {
      await this.pregenerateDialogSession();
    });
  };

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
      logger.error({ error }, 'Failed to pre-generate dialog sessions');
      // Non-critical error - don't throw
    }
  }
}
