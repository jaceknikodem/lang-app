/**
 * Main application root component with routing
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AppState } from '../../shared/types/core.js';
import { router, RouteState, AppMode } from '../utils/router.js';
import { sharedStyles } from '../styles/shared.js';
import './topic-selector.js';
import './word-selector.js';
import './learning-mode.js';
import './quiz-mode.js';

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
    
    // Subscribe to router changes
    this.routerUnsubscribe = router.subscribe((route) => {
      this.currentRoute = route;
      this.updateAppState();
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
      // Check if LLM is available
      const llmAvailable = await window.electronAPI.llm.isAvailable();
      console.log('LLM Available:', llmAvailable);
      
      this.isLoading = false;
    } catch (error) {
      console.error('Failed to initialize app:', error);
      this.isLoading = false;
    }
  }

  private updateAppState() {
    // Update legacy app state based on current route
    const routeData = router.getRouteData();
    
    this.appState = {
      ...this.appState,
      currentMode: this.currentRoute.mode === 'quiz' ? 'quiz' : 'learning',
      selectedTopic: routeData?.topic,
      selectedWords: routeData?.selectedWords,
      quizDirection: routeData?.direction || this.appState.quizDirection
    };
  }

  private handleNavigation(mode: AppMode) {
    switch (mode) {
      case 'topic-selection':
        router.goToTopicSelection();
        break;
      case 'learning':
        // Only navigate if we have selected words
        if (this.appState.selectedWords?.length) {
          router.goToLearning(this.appState.selectedWords);
        } else {
          router.goToTopicSelection();
        }
        break;
      case 'quiz':
        // Only navigate if we have selected words
        if (this.appState.selectedWords?.length) {
          router.goToQuiz(this.appState.selectedWords, this.appState.quizDirection);
        } else {
          router.goToTopicSelection();
        }
        break;
      case 'progress':
        router.goToProgress();
        break;
    }
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
              ?disabled=${!this.appState.selectedWords?.length}
            >
              Review
            </button>
            <button 
              class="nav-button ${router.isCurrentMode('quiz') ? 'active' : ''}"
              @click=${() => this.handleNavigation('quiz')}
              ?disabled=${!this.appState.selectedWords?.length}
            >
              Quiz
            </button>
            <button 
              class="nav-button ${router.isCurrentMode('progress') ? 'active' : ''}"
              @click=${() => this.handleNavigation('progress')}
            >
              Progress
            </button>
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
        return html`<topic-selector language="Spanish"></topic-selector>`;
      
      case 'word-selection':
        return html`
          <word-selector
            .generatedWords=${routeData?.generatedWords || []}
            .topic=${routeData?.topic}
            .language=${routeData?.language || 'Spanish'}
          ></word-selector>
        `;
      
      case 'learning':
        return html`
          <learning-mode
            .selectedWords=${routeData?.selectedWords || []}
          ></learning-mode>
        `;
      
      case 'quiz':
        return html`
          <quiz-mode
            .selectedWords=${routeData?.selectedWords || []}
            .direction=${routeData?.direction || 'foreign-to-english'}
          ></quiz-mode>
        `;
      
      case 'progress':
        return html`
          <div class="placeholder">
            <h3>Progress Summary</h3>
            <p>View your learning statistics and word mastery progress.</p>
            <p><em>Progress tracking will be implemented in task 8.</em></p>
          </div>
        `;
      
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