/**
 * Main application root component with routing
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AppState } from '../../shared/types/core.js';
import { router, RouteState, AppMode } from '../utils/router.js';
import { sessionManager, SessionState } from '../utils/session-manager.js';
import { sharedStyles } from '../styles/shared.js';
import './topic-selector.js';
import './word-selector.js';
import './learning-mode.js';
import './quiz-mode.js';
import './progress-summary.js';
import './settings-panel.js';

@customElement('app-root')
export class AppRoot extends LitElement {
  @state()
  private currentRoute: RouteState = { mode: 'topic-selection' };

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
  private showSessionRestore = false;

  @state()
  private hasExistingWords = false;

  private routerUnsubscribe?: () => void;

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
        padding: var(--spacing-lg);
        box-sizing: border-box;
      }

      .app-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-xl);
        padding-bottom: var(--spacing-md);
        border-bottom: 2px solid var(--border-color);
      }

      .app-title {
        font-size: 28px;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
      }

      .navigation {
        display: flex;
        gap: var(--spacing-sm);
      }

      .nav-button {
        padding: var(--spacing-xs) var(--spacing-md);
        border: 2px solid var(--primary-color);
        background: var(--background-primary);
        color: var(--primary-color);
        border-radius: var(--border-radius-small);
        cursor: pointer;
        font-size: 14px;
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

      .session-restore {
        background: var(--primary-light);
        border: 2px solid var(--primary-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
        margin-bottom: var(--spacing-lg);
        text-align: center;
      }

      .session-restore-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-color);
        margin: 0 0 var(--spacing-sm) 0;
      }

      .session-restore-description {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0 0 var(--spacing-md) 0;
      }

      .session-restore-actions {
        display: flex;
        gap: var(--spacing-md);
        justify-content: center;
        flex-wrap: wrap;
      }

      .session-restore-button {
        padding: var(--spacing-sm) var(--spacing-lg);
        border: 2px solid var(--primary-color);
        background: var(--primary-color);
        color: white;
        border-radius: var(--border-radius);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .session-restore-button:hover {
        background: var(--primary-dark);
        border-color: var(--primary-dark);
      }

      .session-restore-button.secondary {
        background: var(--background-primary);
        color: var(--primary-color);
      }

      .session-restore-button.secondary:hover {
        background: var(--primary-light);
      }

      @media (max-width: 768px) {
        .app-container {
          padding: var(--spacing-md);
        }
        
        .app-header {
          flex-direction: column;
          gap: var(--spacing-md);
          align-items: stretch;
        }
        
        .navigation {
          justify-content: center;
        }
        
        .nav-button {
          flex: 1;
          text-align: center;
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
    });

    // Initialize current route
    this.currentRoute = router.getCurrentRoute();

    await this.initializeApp();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.routerUnsubscribe) {
      this.routerUnsubscribe();
    }
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

      // Load saved session
      console.log('Loading session...');
      await this.loadSession();
      console.log('Session loaded');

      // Check for existing words in database
      console.log('Checking existing words...');
      await this.checkExistingWords();
      console.log('Existing words check complete');

      console.log('App initialization complete');
      this.isLoading = false;
    } catch (error) {
      console.error('Failed to initialize app:', error);
      this.isLoading = false;
    }
  }

  private async loadSession() {
    try {
      const savedSession = sessionManager.loadSession();

      if (savedSession && sessionManager.hasActiveSession()) {
        this.sessionState = savedSession;
        this.showSessionRestore = true;
        console.log('Found active session:', savedSession.currentMode);
      } else {
        // No active session, start fresh
        this.sessionState = sessionManager.getCurrentSession();
      }
    } catch (error) {
      console.error('Failed to load session:', error);
      this.sessionState = sessionManager.getCurrentSession();
    }
  }

  private async checkExistingWords() {
    try {
      console.log('Calling database.getAllWords...');
      const allWords = await window.electronAPI.database.getAllWords(true, false);
      console.log('Database call successful, words found:', allWords.length);
      this.hasExistingWords = allWords.length > 0;
      console.log('Found existing words:', allWords.length);
    } catch (error) {
      console.error('Failed to check existing words:', error);
      this.hasExistingWords = false;
    }
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

  private handleRestoreSession() {
    if (!this.sessionState) return;

    this.showSessionRestore = false;

    // Navigate to the saved session mode
    switch (this.sessionState.currentMode) {
      case 'learning':
        // Use the navigation handler which will fetch words from database
        this.handleNavigation('learning');
        break;
      case 'quiz':
        // Use the navigation handler which will fetch words from database
        this.handleNavigation('quiz');
        break;
      default:
        router.goToTopicSelection();
        break;
    }
  }

  private handleStartFresh() {
    this.showSessionRestore = false;
    sessionManager.clearSession();
    this.sessionState = sessionManager.getCurrentSession();
    router.goToTopicSelection();
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
          <h1 class="app-title">Local Language Learning</h1>
          <nav class="navigation">
            <button 
              class="nav-button ${router.isCurrentMode('topic-selection') || router.isCurrentMode('word-selection') ? 'active' : ''}"
              @click=${() => this.handleNavigation('topic-selection')}
            >
              Start Learning
            </button>
            <button 
              class="nav-button ${router.isCurrentMode('learning') ? 'active' : ''}"
              @click=${() => this.handleNavigation('learning')}
              ?disabled=${!this.hasExistingWords}
            >
              Review
            </button>
            <button 
              class="nav-button ${router.isCurrentMode('quiz') ? 'active' : ''}"
              @click=${() => this.handleNavigation('quiz')}
            >
              Quiz
            </button>
            <button 
              class="nav-button ${router.isCurrentMode('progress') ? 'active' : ''}"
              @click=${() => this.handleNavigation('progress')}
            >
              Progress
            </button>
            <button 
              class="nav-button ${router.isCurrentMode('settings') ? 'active' : ''}"
              @click=${() => this.handleNavigation('settings')}
            >
              Settings
            </button>
          </nav>
        </header>

        <main class="content-area">
          ${this.showSessionRestore ? this.renderSessionRestore() : ''}
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

  private renderSessionRestore() {
    if (!this.sessionState || !sessionManager.hasActiveSession()) {
      return html``;
    }

    const sessionSummary = sessionManager.getSessionSummary();

    return html`
      <div class="session-restore">
        <h3 class="session-restore-title">Continue Previous Session?</h3>
        <p class="session-restore-description">
          ${sessionSummary} • Last activity: ${this.formatLastActivity()}
        </p>
        <div class="session-restore-actions">
          <button 
            class="session-restore-button"
            @click=${this.handleRestoreSession}
          >
            Continue Session
          </button>
          <button 
            class="session-restore-button secondary"
            @click=${this.handleStartFresh}
          >
            Start Fresh
          </button>
        </div>
      </div>
    `;
  }

  private formatLastActivity(): string {
    if (!this.sessionState?.lastActivity) {
      return 'Unknown';
    }

    const lastActivity = new Date(this.sessionState.lastActivity);
    const now = new Date();
    const diffMs = now.getTime() - lastActivity.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);

    if (diffMinutes < 1) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else {
      return lastActivity.toLocaleDateString();
    }
  }
}