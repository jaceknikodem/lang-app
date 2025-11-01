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
import './topic-selector.js';
import './word-selector.js';
import './learning-mode.js';
import './quiz-mode.js';
import './progress-summary.js';
import './settings-panel.js';

@customElement('app-root')
export class AppRoot extends LitElement {
  @state()
  private currentRoute: RouteState = { mode: 'learning' };

  @state()
  private appState: AppState = {
    currentMode: 'learning',
    quizDirection: 'foreign-to-english'
  };

  @state()
  private isLoading = true;

  @state()
  private sessionState: SessionState | null = null;

  @state()
  private hasExistingWords: boolean | null = null;

  @state()
  private currentLanguage = '';

  private routerUnsubscribe?: () => void;
  private keyboardUnsubscribe?: () => void;

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
      }

      .language-dropdown {
        position: relative;
        margin-left: var(--spacing-sm);
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

      .close-button {
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--error-color);
        background: var(--background-primary);
        color: var(--error-color);
        border-radius: var(--border-radius-small);
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s ease;
        margin-left: var(--spacing-sm);
      }

      .close-button:hover {
        background: var(--error-light);
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

      // Load saved session
      console.log('Loading session...');
      await this.loadSession();
      console.log('Session loaded');

      // Check for existing words in database (non-blocking - deferred)
      // This optimization speeds up initial render by deferring the check
      setImmediate(async () => {
        try {
          await this.checkExistingWords();
        } catch (error) {
          console.error('Failed to check existing words:', error);
        }
      });

      console.log('Ensuring learning session...');
      await this.ensureLearningSession();
      console.log('Learning session ready');

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
      if (this.hasExistingWords === false && router.isCurrentMode('learning')) {
        router.goToTopicSelection();
      }
    } catch (error) {
      console.error('Failed to check existing words:', error);
      this.hasExistingWords = false;
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
  };

  private async handleLanguageDropdownChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedLanguage = select.value;

    if (!selectedLanguage || selectedLanguage === this.currentLanguage) return;

    try {
      await window.electronAPI.database.setCurrentLanguage(selectedLanguage);
      this.currentLanguage = selectedLanguage;

      sessionManager.setActiveLanguage(selectedLanguage);
      this.sessionState = sessionManager.getCurrentSession();
      await this.checkExistingWords();
      await this.ensureLearningSession();
      this.requestUpdate();

      // Dispatch event to notify other components (like settings panel)
      this.dispatchEvent(new CustomEvent('language-changed', {
        detail: { language: selectedLanguage },
        bubbles: true,
        composed: true
      }));

      console.log('Language changed to:', this.currentLanguage);
    } catch (error) {
      console.error('Failed to change language:', error);
      // Revert the selection
      select.value = this.currentLanguage;
    }
  }

  private capitalizeLanguage(language: string): string {
    return language.charAt(0).toUpperCase() + language.slice(1);
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

  private updateAppState() {
    // Update legacy app state based on current route
    const routeData = router.getRouteData();

    this.appState = {
      ...this.appState,
      currentMode: this.currentRoute.mode === 'quiz' ? 'quiz' : 'learning',
      selectedTopic: routeData?.topic,
      quizDirection: routeData?.direction || this.appState.quizDirection
    };
  }

  private updateSessionFromRoute() {
    // Update session manager with current route state
    const routeData = router.getRouteData();

    sessionManager.updateCurrentMode(this.currentRoute.mode);

    if (routeData?.topic) {
      sessionManager.updateSelectedTopic(routeData.topic);
    }

    if (routeData?.direction) {
      sessionManager.updateQuizDirection(routeData.direction);
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
        const direction = this.sessionState?.quizDirection || this.appState.quizDirection;
        router.goToQuiz(undefined, direction);
        break;
      case 'progress':
        router.goToProgress();
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



  private setupKeyboardBindings() {
    const bindings = [
      // Global navigation shortcuts
      {
        ...GlobalShortcuts.LEARN,
        action: () => this.handleNavigation('topic-selection'),
        context: 'global'
      },
      {
        ...GlobalShortcuts.REVIEW,
        action: () => this.handleNavigation('learning'),
        context: 'global'
      },
      {
        ...GlobalShortcuts.QUIZ,
        action: () => this.handleNavigation('quiz'),
        context: 'global'
      },
      {
        ...GlobalShortcuts.PROGRESS,
        action: () => this.handleNavigation('progress'),
        context: 'global'
      },
      {
        ...GlobalShortcuts.SETTINGS,
        action: () => this.handleNavigation('settings'),
        context: 'global'
      }
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
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
              class="nav-button ${router.isCurrentMode('progress') ? 'active' : ''}"
              @click=${() => this.handleNavigation('progress')}
              title="View progress (Ctrl+4)"
            >
              Progress
            </button>
            <button 
              class="nav-button ${router.isCurrentMode('settings') ? 'active' : ''}"
              @click=${() => this.handleNavigation('settings')}
              title="Settings (Ctrl+5)"
            >
              Settings
            </button>
            <button 
              class="close-button"
              @click=${this.handleCloseApp}
              title="Close Application"
            >
              ✕ Close
            </button>
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
              </div>
            ` : ''}
          </nav>
        </header>

        <main class="content-area">
          <div class="route-content">
            ${this.renderCurrentRoute()}
          </div>
        </main>
      </div>
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
          <quiz-mode
            .direction=${routeData?.direction || 'foreign-to-english'}
          ></quiz-mode>
        `;

      case 'progress':
        return html`<progress-summary></progress-summary>`;

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


}
