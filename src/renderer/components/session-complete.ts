/**
 * Session completion component for handling end of learning/quiz sessions
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router, AppMode } from '../utils/router.js';
import { Word, StudyStats } from '../../shared/types/core.js';
import { useKeyboardBindings, CommonKeys } from '../utils/keyboard-manager.js';
import { sessionManager } from '../utils/session-manager.js';

export interface SessionSummary {
  type: 'learning' | 'quiz';
  wordsStudied: number;
  timeSpent?: number; // in minutes
  quizScore?: number;
  quizTotal?: number;
  completedWords: Word[];
  nextRecommendation: 'continue-learning' | 'take-quiz' | 'new-topic' | 'practice-weak';
}

@customElement('session-complete')
export class SessionComplete extends LitElement {
  @property({ type: Object })
  sessionSummary!: SessionSummary;

  @state()
  private studyStats: StudyStats | null = null;

  @state()
  private isLoading = false;

  private keyboardUnsubscribe?: () => void;

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        max-width: 900px;
        margin: 0 auto;
      }

      .completion-container {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xl);
        text-align: center;
      }

      .completion-header {
        background: var(--success-light);
        border: 2px solid var(--success-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-xl);
      }

      .completion-icon {
        font-size: 48px;
        margin-bottom: var(--spacing-md);
      }

      .completion-title {
        font-size: 28px;
        font-weight: 600;
        color: var(--success-dark);
        margin: 0 0 var(--spacing-sm) 0;
      }

      .completion-subtitle {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0;
      }

      .summary-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: var(--spacing-md);
      }

      .stat-item {
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
      }

      .stat-value {
        font-size: 24px;
        font-weight: 700;
        color: var(--primary-color);
        margin: 0 0 var(--spacing-xs) 0;
      }

      .stat-label {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .quiz-score {
        background: var(--primary-light);
        border: 2px solid var(--primary-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
        margin: var(--spacing-md) 0;
      }

      .score-percentage {
        font-size: 36px;
        font-weight: 700;
        color: var(--primary-color);
        margin: 0 0 var(--spacing-xs) 0;
      }

      .score-details {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0;
      }

      .words-practiced {
        text-align: left;
      }

      .words-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-md) 0;
      }

      .words-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .word-tag {
        background: var(--primary-light);
        color: var(--primary-dark);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: 12px;
        font-size: 14px;
        font-weight: 500;
      }

      .recommendation {
        background: var(--background-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
      }

      .recommendation-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-sm) 0;
      }

      .recommendation-text {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0 0 var(--spacing-md) 0;
      }

      .action-buttons {
        display: flex;
        gap: var(--spacing-md);
        justify-content: center;
        flex-wrap: wrap;
      }

      .action-button {
        padding: var(--spacing-md) var(--spacing-lg);
        border: 2px solid var(--primary-color);
        background: var(--background-primary);
        color: var(--primary-color);
        border-radius: var(--border-radius);
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 140px;
      }

      .action-button:hover {
        background: var(--primary-color);
        color: white;
      }

      .action-button.primary {
        background: var(--primary-color);
        color: white;
      }

      .action-button.primary:hover {
        background: var(--primary-dark);
        color: white;
      }

      @media (max-width: 768px) {
        .summary-stats {
          grid-template-columns: 1fr;
        }

        .action-buttons {
          flex-direction: column;
        }

        .action-button {
          width: 100%;
        }
      }
    `
  ];

  connectedCallback() {
    super.connectedCallback();
    
    // Clear quiz session when quiz is finished to prevent reloading
    if (this.sessionSummary?.type === 'quiz') {
      sessionManager.clearQuizSession();
    }
    
    this.loadUpdatedStats();
    this.setupKeyboardBindings();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }
  }

  private setupKeyboardBindings() {
    const bindings = [
      {
        key: CommonKeys.ENTER,
        action: () => {
          if (!this.isLoading) {
            this.handleRecommendedAction();
          }
        },
        description: 'Keep going'
      }
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
  }

  private async loadUpdatedStats() {
    try {
      this.studyStats = await window.electronAPI.database.getStudyStats();
    } catch (error) {
      console.error('Failed to load updated stats:', error);
    }
  }

  private getRecommendationText(): string {
    switch (this.sessionSummary.nextRecommendation) {
      case 'take-quiz':
        return 'Ready to test your knowledge? Take a quiz to reinforce what you\'ve learned.';
      case 'continue-learning':
        return 'Keep the momentum going! Continue learning with more sentences.';
      case 'practice-weak':
        return 'Focus on your weakest words to improve your overall mastery.';
      case 'new-topic':
        return 'Great progress! Try exploring a new topic to expand your vocabulary.';
      default:
        return 'Choose your next learning activity.';
    }
  }

  private async handleRecommendedAction() {
    this.isLoading = true;

    try {
      // Get current language
      const currentLanguage = await window.electronAPI.database.getCurrentLanguage();
      
      // Get current mode based on session type
      const currentMode: AppMode = this.sessionSummary.type === 'quiz' ? 'quiz' : 'learning';
      
      // Get next mode from scoring service (scores are calculated internally and never exposed)
      const result = await window.electronAPI.scoring.getNextMode({
        currentMode: currentMode as 'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow' | null,
        language: currentLanguage || null,
        initialTakeover: false
      });
      
      if (result.nextMode) {
        // Navigate to the recommended mode
        switch (result.nextMode) {
          case 'learning':
            router.goToLearning(this.sessionSummary.completedWords);
            break;
          case 'quiz':
            router.goToQuiz(this.sessionSummary.completedWords);
            break;
          case 'dialog':
            router.goToDialog();
            break;
          case 'flow':
            // Flow mode is just an overlay, trigger play from app-root
            const appRoot = document.querySelector('app-root') as any;
            if (appRoot && typeof appRoot.handleFlowPlay === 'function') {
              appRoot.handleFlowPlay();
            }
            break;
          default:
            router.goToTopicSelection();
            break;
        }
      } else {
        // Fallback to topic selection if no valid mode found or navigation not recommended
        router.goToTopicSelection();
      }
    } catch (error) {
      console.error('Failed to get next mode and navigate:', error);
      // Fallback to topic selection on error
      router.goToTopicSelection();
    } finally {
      this.isLoading = false;
    }
  }

  private handleTakeQuiz() {
    router.goToQuiz(this.sessionSummary.completedWords);
  }

  private handleNewSession() {
    this.dispatchEvent(new CustomEvent('start-new-learning-session', {
      bubbles: true,
      composed: true
    }));
  }

  render() {
    const isQuiz = this.sessionSummary.type === 'quiz';
    return html`
      <div class="completion-container">
        ${isQuiz && this.sessionSummary.quizScore !== undefined && this.sessionSummary.quizTotal !== undefined ? html`
          <div class="quiz-score">
            <div class="score-percentage">
              ${Math.round((this.sessionSummary.quizScore / this.sessionSummary.quizTotal) * 100)}%
            </div>
            <div class="score-details">
              ${this.sessionSummary.quizScore} out of ${this.sessionSummary.quizTotal} correct
            </div>
          </div>
        ` : ''}

        <div class="summary-stats">
          <div class="stat-item">
            <div class="stat-value">${this.sessionSummary.wordsStudied}</div>
            <div class="stat-label">Words ${isQuiz ? 'Tested' : 'Studied'}</div>
          </div>

          ${this.sessionSummary.timeSpent ? html`
            <div class="stat-item">
              <div class="stat-value">${this.sessionSummary.timeSpent}</div>
              <div class="stat-label">Minutes</div>
            </div>
          ` : ''}

          ${this.studyStats ? html`
            <div class="stat-item">
              <div class="stat-value">${Math.round(this.studyStats.averageStrength)}%</div>
              <div class="stat-label">Avg Strength</div>
            </div>
          ` : ''}
        </div>

        ${this.sessionSummary.completedWords.length > 0 ? html`
          <div class="words-practiced">
            <h3 class="words-title">Words ${isQuiz ? 'Tested' : 'Practiced'}</h3>
            <div class="words-list">
              ${this.sessionSummary.completedWords.slice(0, 10).map(word => html`
                <span class="word-tag">${word.word}</span>
              `)}
              ${this.sessionSummary.completedWords.length > 10 ? html`
                <span class="word-tag">+${this.sessionSummary.completedWords.length - 10} more</span>
              ` : ''}
            </div>
          </div>
        ` : ''}

        <div class="recommendation">
          <button
            class="action-button primary"
            @click=${this.handleRecommendedAction}
            ?disabled=${this.isLoading}
          >
            Keep going!
          </button>
        </div>
      </div>
    `;
  }
}
