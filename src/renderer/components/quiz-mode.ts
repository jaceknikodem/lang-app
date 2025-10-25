/**
 * Quiz mode component for vocabulary assessment
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Word, Sentence, QuizQuestion, QuizSession, QuizResult } from '../../shared/types/core.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { sessionManager } from '../utils/session-manager.js';
import './session-complete.js';
import type { SessionSummary } from './session-complete.js';

@customElement('quiz-mode')
export class QuizMode extends LitElement {

  @property({ type: String })
  direction: 'foreign-to-english' | 'english-to-foreign' = 'foreign-to-english';

  @state()
  private quizSession: QuizSession | null = null;

  @state()
  private isLoading = false;

  @state()
  private error: string | null = null;

  @state()
  private currentQuestion: QuizQuestion | null = null;

  @state()
  private showResult = false;

  @state()
  private lastResult: QuizResult | null = null;

  @state()
  private showCompletion = false;

  @state()
  private sessionSummary: SessionSummary | null = null;

  @state()
  private selectedWords: Word[] = [];

  private sessionStartTime = Date.now();

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .quiz-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-width: 800px;
        margin: 0 auto;
        padding: var(--spacing-lg);
      }

      .quiz-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-xl);
        padding-bottom: var(--spacing-md);
        border-bottom: 2px solid var(--border-color);
      }

      .quiz-title {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
      }

      .quiz-progress {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        font-size: 16px;
        color: var(--text-secondary);
      }

      .progress-bar {
        width: 200px;
        height: 8px;
        background: var(--background-secondary);
        border-radius: 4px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: var(--primary-color);
        transition: width 0.3s ease;
      }

      .quiz-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
        gap: var(--spacing-xl);
      }

      .question-container {
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        padding: var(--spacing-xl);
        width: 100%;
        max-width: 600px;
        box-shadow: var(--shadow-medium);
      }

      .question-text {
        font-size: 28px;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: var(--spacing-lg);
        line-height: 1.4;
      }

      .question-translation {
        font-size: 18px;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-lg);
        font-style: italic;
      }

      .direction-indicator {
        font-size: 14px;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-md);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .audio-button {
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: var(--border-radius);
        padding: var(--spacing-md) var(--spacing-lg);
        font-size: 16px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin: 0 auto var(--spacing-lg);
      }

      .audio-button:hover {
        background: var(--primary-dark);
        transform: translateY(-1px);
      }

      .answer-buttons {
        display: flex;
        gap: var(--spacing-lg);
        justify-content: center;
        flex-wrap: wrap;
      }

      .answer-button {
        padding: var(--spacing-lg) var(--spacing-xl);
        border: 2px solid var(--border-color);
        background: var(--background-primary);
        color: var(--text-primary);
        border-radius: var(--border-radius);
        font-size: 18px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 150px;
      }

      .answer-button:hover {
        border-color: var(--primary-color);
        background: var(--primary-light);
      }

      .answer-button.correct {
        background: var(--success-color);
        border-color: var(--success-color);
        color: white;
      }

      .answer-button.incorrect {
        background: var(--error-color);
        border-color: var(--error-color);
        color: white;
      }

      .result-feedback {
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
        margin-top: var(--spacing-lg);
        text-align: center;
      }

      .result-feedback.correct {
        border-left: 4px solid var(--success-color);
      }

      .result-feedback.incorrect {
        border-left: 4px solid var(--error-color);
      }

      .next-button {
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: var(--border-radius);
        padding: var(--spacing-md) var(--spacing-xl);
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-top: var(--spacing-lg);
      }

      .next-button:hover {
        background: var(--primary-dark);
      }

      .quiz-complete {
        text-align: center;
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        padding: var(--spacing-xl);
        max-width: 500px;
        margin: 0 auto;
      }

      .final-score {
        font-size: 48px;
        font-weight: 700;
        color: var(--primary-color);
        margin-bottom: var(--spacing-md);
      }

      .score-details {
        font-size: 18px;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-lg);
      }

      .performance-message {
        font-weight: 500;
        margin-top: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--border-radius-small);
      }

      .performance-message.excellent {
        background: var(--success-light);
        color: var(--success-dark);
      }

      .performance-message.good {
        background: var(--primary-light);
        color: var(--primary-dark);
      }

      .performance-message.okay {
        background: var(--warning-light);
        color: var(--warning-dark);
      }

      .performance-message.needs-work {
        background: var(--error-light);
        color: var(--error-dark);
      }

      .score-breakdown {
        display: flex;
        gap: var(--spacing-lg);
        justify-content: center;
        margin-bottom: var(--spacing-xl);
      }

      .score-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        min-width: 80px;
      }

      .score-item.correct {
        background: var(--success-light);
        color: var(--success-dark);
      }

      .score-item.incorrect {
        background: var(--error-light);
        color: var(--error-dark);
      }

      .score-label {
        font-size: 14px;
        font-weight: 500;
        margin-bottom: var(--spacing-xs);
      }

      .score-value {
        font-size: 24px;
        font-weight: 700;
      }

      .quiz-actions {
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
      }

      .setup-container {
        text-align: center;
        max-width: 500px;
        margin: 0 auto;
      }

      .setup-title {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: var(--spacing-lg);
      }

      .direction-selector {
        display: flex;
        gap: var(--spacing-md);
        justify-content: center;
        margin-bottom: var(--spacing-xl);
      }

      .direction-button {
        padding: var(--spacing-md) var(--spacing-lg);
        border: 2px solid var(--border-color);
        background: var(--background-primary);
        color: var(--text-primary);
        border-radius: var(--border-radius);
        font-size: 16px;
        cursor: pointer;
        transition: all 0.2s ease;
        flex: 1;
        max-width: 200px;
      }

      .direction-button:hover {
        border-color: var(--primary-color);
      }

      .direction-button.selected {
        background: var(--primary-color);
        border-color: var(--primary-color);
        color: white;
      }

      .start-button {
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: var(--border-radius);
        padding: var(--spacing-lg) var(--spacing-xl);
        font-size: 18px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .start-button:hover {
        background: var(--primary-dark);
        transform: translateY(-1px);
      }

      .start-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      @media (max-width: 768px) {
        .quiz-container {
          padding: var(--spacing-md);
        }

        .quiz-header {
          flex-direction: column;
          gap: var(--spacing-md);
          align-items: stretch;
        }

        .quiz-progress {
          justify-content: center;
        }

        .question-text {
          font-size: 24px;
        }

        .answer-buttons {
          flex-direction: column;
          align-items: center;
        }

        .answer-button {
          width: 100%;
          max-width: 300px;
        }

        .direction-selector {
          flex-direction: column;
          align-items: center;
        }

        .direction-button {
          width: 100%;
          max-width: 250px;
        }
      }
    `
  ];

  async connectedCallback() {
    super.connectedCallback();
    
    // Load words from database first
    await this.loadSelectedWords();
    
    if (this.selectedWords.length === 0) {
      this.error = 'No words available for quiz. Please start a new learning session first.';
      return;
    }

    // Try to restore quiz session from session manager
    this.restoreQuizSession();

    // If we don't have a quiz session, show setup
    if (!this.quizSession) {
      // Quiz setup will be shown in render
      return;
    }
  }

  private async startQuiz() {
    if (this.selectedWords.length === 0) {
      this.error = 'No words selected for quiz';
      return;
    }

    this.isLoading = true;
    this.error = null;

    try {
      // If no words provided, get weakest words from database
      let wordsToQuiz = this.selectedWords;
      if (wordsToQuiz.length === 0) {
        wordsToQuiz = await window.electronAPI.quiz.getWeakestWords(10);
      }

      // Generate quiz questions from words
      const questions: QuizQuestion[] = [];
      
      for (const word of wordsToQuiz) {
        // Get a random sentence for this word
        const sentence = await window.electronAPI.quiz.getRandomSentenceForWord(word.id);
        
        if (sentence) {
          questions.push({
            word,
            sentence,
            direction: this.direction
          });
        }
      }

      if (questions.length === 0) {
        this.error = 'No sentences found for the selected words. Please review words in learning mode first.';
        return;
      }

      // Shuffle questions for variety
      const shuffledQuestions = this.shuffleArray(questions);

      this.quizSession = {
        questions: shuffledQuestions,
        currentQuestionIndex: 0,
        direction: this.direction,
        score: 0,
        totalQuestions: shuffledQuestions.length,
        isComplete: false
      };

      this.currentQuestion = shuffledQuestions[0];
      
      // Save initial quiz state to session
      this.saveQuizProgressToSession();
      
    } catch (error) {
      console.error('Error starting quiz:', error);
      this.error = 'Failed to start quiz. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private async loadSelectedWords() {
    try {
      // Get weak words first for targeted practice, fallback to all words
      let words = await window.electronAPI.quiz.getWeakestWords(20);
      if (words.length === 0) {
        words = await window.electronAPI.database.getAllWords(true, false);
      }
      this.selectedWords = words;
      console.log('Loaded words for quiz:', this.selectedWords.length);
    } catch (error) {
      console.error('Failed to load words:', error);
      this.error = 'Failed to load words from database.';
    }
  }

  private restoreQuizSession() {
    const session = sessionManager.getCurrentSession();
    if (session.quizProgress) {
      // We have a saved quiz session, but we need to rebuild the quiz questions
      // For now, we'll just restore the direction preference
      this.direction = session.quizDirection;
      console.log('Restored quiz direction:', this.direction);
    }
  }

  private saveQuizProgressToSession() {
    if (this.quizSession) {
      sessionManager.updateQuizProgress(
        this.quizSession.currentQuestionIndex,
        this.quizSession.score,
        this.quizSession.totalQuestions
      );
    }
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private async handleAnswer(correct: boolean) {
    if (!this.quizSession || !this.currentQuestion) return;

    this.showResult = true;
    this.lastResult = {
      wordId: this.currentQuestion.word.id,
      correct,
      responseTime: Date.now() // Simple timestamp for now
    };

    if (correct) {
      this.quizSession.score++;
    }

    // Update word strength based on answer with adaptive scoring
    try {
      const currentStrength = this.currentQuestion.word.strength;
      let newStrength: number;

      if (correct) {
        // Adaptive increase: lower strength words get bigger boosts
        const strengthBoost = currentStrength < 30 ? 20 : 
                             currentStrength < 60 ? 15 : 10;
        newStrength = Math.min(100, currentStrength + strengthBoost);
      } else {
        // Adaptive decrease: higher strength words lose more points
        const strengthPenalty = currentStrength > 70 ? 15 :
                               currentStrength > 40 ? 10 : 5;
        newStrength = Math.max(0, currentStrength - strengthPenalty);
      }

      await window.electronAPI.database.updateWordStrength(this.currentQuestion.word.id, newStrength);
      await window.electronAPI.database.updateLastStudied(this.currentQuestion.word.id);
      
      // Update the word in our local data
      this.currentQuestion.word.strength = newStrength;
      
    } catch (error) {
      console.error('Error updating word strength:', error);
    }
  }

  private async nextQuestion() {
    if (!this.quizSession) return;

    this.showResult = false;
    this.lastResult = null;

    if (this.quizSession.currentQuestionIndex + 1 >= this.quizSession.totalQuestions) {
      // Quiz complete - record the session
      await this.recordQuizSession();
      this.quizSession.isComplete = true;
      this.currentQuestion = null;
    } else {
      // Move to next question
      this.quizSession.currentQuestionIndex++;
      this.currentQuestion = this.quizSession.questions[this.quizSession.currentQuestionIndex];
      
      // Save progress to session
      this.saveQuizProgressToSession();
    }
  }

  private async recordQuizSession() {
    if (!this.quizSession) return;

    try {
      // Record the study session in the database
      await window.electronAPI.database.recordStudySession(this.quizSession.totalQuestions);
      
      // Clear session progress since we're completing
      sessionManager.clearSession();
      
      // Show completion screen
      this.showQuizCompletion();
      
    } catch (error) {
      console.error('Error recording quiz session:', error);
      // Don't block the UI for this error
      this.showQuizCompletion();
    }
  }

  private showQuizCompletion() {
    if (!this.quizSession) return;

    const timeSpent = Math.round((Date.now() - this.sessionStartTime) / (1000 * 60)); // minutes
    const percentage = Math.round((this.quizSession.score / this.quizSession.totalQuestions) * 100);
    
    // Determine next recommendation based on quiz performance
    let nextRecommendation: SessionSummary['nextRecommendation'] = 'new-topic';
    
    if (percentage < 50) {
      nextRecommendation = 'continue-learning';
    } else if (percentage < 70) {
      nextRecommendation = 'practice-weak';
    }

    this.sessionSummary = {
      type: 'quiz',
      wordsStudied: this.quizSession.totalQuestions,
      timeSpent,
      quizScore: this.quizSession.score,
      quizTotal: this.quizSession.totalQuestions,
      completedWords: this.selectedWords,
      nextRecommendation
    };

    this.showCompletion = true;
  }

  private async playAudio() {
    if (!this.currentQuestion) return;

    try {
      const audioPath = this.currentQuestion.sentence.audioPath;
      if (audioPath) {
        await window.electronAPI.audio.playAudio(audioPath);
      }
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  }

  private restartQuiz() {
    this.quizSession = null;
    this.currentQuestion = null;
    this.showResult = false;
    this.lastResult = null;
    this.error = null;
  }

  private goToLearning() {
    router.goToLearning();
  }

  private goToTopicSelection() {
    router.goToTopicSelection();
  }

  private handleDirectionChange(direction: 'foreign-to-english' | 'english-to-foreign') {
    this.direction = direction;
    sessionManager.updateQuizDirection(direction);
  }

  render() {
    if (this.error) {
      return html`
        <div class="quiz-container">
          <div class="error-container">
            <div class="error-message">${this.error}</div>
            <button class="action-button primary" @click=${this.goToTopicSelection}>
              Select Words
            </button>
          </div>
        </div>
      `;
    }

    if (this.isLoading) {
      return html`
        <div class="quiz-container">
          <div class="loading-container">
            <div class="loading">
              <div class="spinner"></div>
              Preparing quiz...
            </div>
          </div>
        </div>
      `;
    }

    // Show quiz setup if no session
    if (!this.quizSession) {
      return this.renderQuizSetup();
    }

    // Show quiz complete screen
    if (this.quizSession.isComplete) {
      if (this.showCompletion && this.sessionSummary) {
        return html`
          <div class="quiz-container">
            <session-complete .sessionSummary=${this.sessionSummary}></session-complete>
          </div>
        `;
      }
      return this.renderQuizComplete();
    }

    // Show current question
    return this.renderQuestion();
  }

  private renderQuizSetup() {
    return html`
      <div class="quiz-container">
        <div class="setup-container">
          <h2 class="setup-title">Quiz Setup</h2>
          
          <p>You have ${this.selectedWords.length} words selected for the quiz.</p>
          
          <div class="direction-selector">
            <button 
              class="direction-button ${this.direction === 'foreign-to-english' ? 'selected' : ''}"
              @click=${() => this.handleDirectionChange('foreign-to-english')}
            >
              Foreign → English
            </button>
            <button 
              class="direction-button ${this.direction === 'english-to-foreign' ? 'selected' : ''}"
              @click=${() => this.handleDirectionChange('english-to-foreign')}
            >
              English → Foreign
            </button>
          </div>

          <button 
            class="start-button"
            @click=${this.startQuiz}
            ?disabled=${this.isLoading}
          >
            Start Quiz
          </button>
        </div>
      </div>
    `;
  }

  private renderQuestion() {
    if (!this.quizSession || !this.currentQuestion) return html``;

    const progress = ((this.quizSession.currentQuestionIndex + 1) / this.quizSession.totalQuestions) * 100;
    const question = this.currentQuestion;
    
    // Determine what to show based on quiz direction
    const displayText = this.direction === 'foreign-to-english' 
      ? question.sentence.sentence 
      : question.sentence.translation;
    
    // The word we're asking about (not the answer!)
    const questionWord = this.direction === 'foreign-to-english'
      ? `"${question.word.word}"`
      : `"${question.word.translation}"`;

    return html`
      <div class="quiz-container">
        <div class="quiz-header">
          <h2 class="quiz-title">Quiz Mode</h2>
          <div class="quiz-progress">
            <span>${this.quizSession.currentQuestionIndex + 1} / ${this.quizSession.totalQuestions}</span>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <span>Score: ${this.quizSession.score}</span>
          </div>
        </div>

        <div class="quiz-content">
          <div class="question-container">
            <div class="direction-indicator">
              ${this.direction === 'foreign-to-english' ? 'Foreign → English' : 'English → Foreign'}
            </div>
            
            <div class="question-text">${displayText}</div>
            
            <button class="audio-button" @click=${this.playAudio}>
              🔊 Play Audio
            </button>

            <div class="question-translation">
              Do you know what ${questionWord} means in this context?
            </div>

            ${this.showResult ? this.renderResult() : this.renderAnswerButtons()}
          </div>
        </div>
      </div>
    `;
  }

  private renderAnswerButtons() {
    return html`
      <div class="answer-buttons">
        <button 
          class="answer-button"
          @click=${() => this.handleAnswer(true)}
        >
          I knew it ✓
        </button>
        <button 
          class="answer-button"
          @click=${() => this.handleAnswer(false)}
        >
          Not yet ✗
        </button>
      </div>
    `;
  }

  private renderResult() {
    if (!this.lastResult || !this.currentQuestion) return html``;

    const isCorrect = this.lastResult.correct;
    const word = this.currentQuestion.word;

    return html`
      <div class="result-feedback ${isCorrect ? 'correct' : 'incorrect'}">
        <h3>${isCorrect ? 'Correct!' : 'Keep practicing!'}</h3>
        <p>
          <strong>${word.word}</strong> = <strong>${word.translation}</strong>
        </p>
        <p>Word strength: ${word.strength}/100</p>
        
        <button class="next-button" @click=${this.nextQuestion}>
          ${this.quizSession!.currentQuestionIndex + 1 >= this.quizSession!.totalQuestions ? 'Finish Quiz' : 'Next Question'}
        </button>
      </div>
    `;
  }

  private renderQuizComplete() {
    if (!this.quizSession) return html``;

    const percentage = Math.round((this.quizSession.score / this.quizSession.totalQuestions) * 100);
    const correctAnswers = this.quizSession.score;
    const incorrectAnswers = this.quizSession.totalQuestions - this.quizSession.score;

    // Calculate performance message
    let performanceMessage = '';
    let performanceClass = '';
    
    if (percentage >= 90) {
      performanceMessage = 'Excellent work! You have mastered these words.';
      performanceClass = 'excellent';
    } else if (percentage >= 70) {
      performanceMessage = 'Good job! Keep practicing to improve further.';
      performanceClass = 'good';
    } else if (percentage >= 50) {
      performanceMessage = 'Not bad! Review the words you missed and try again.';
      performanceClass = 'okay';
    } else {
      performanceMessage = 'Keep studying! These words need more practice.';
      performanceClass = 'needs-work';
    }

    return html`
      <div class="quiz-container">
        <div class="quiz-content">
          <div class="quiz-complete">
            <h2>Quiz Complete!</h2>
            
            <div class="final-score">${percentage}%</div>
            
            <div class="score-details">
              <p>You got <strong>${correctAnswers}</strong> out of <strong>${this.quizSession.totalQuestions}</strong> questions correct.</p>
              <p class="performance-message ${performanceClass}">${performanceMessage}</p>
            </div>

            <div class="score-breakdown">
              <div class="score-item correct">
                <span class="score-label">Correct</span>
                <span class="score-value">${correctAnswers}</span>
              </div>
              <div class="score-item incorrect">
                <span class="score-label">Incorrect</span>
                <span class="score-value">${incorrectAnswers}</span>
              </div>
            </div>

            <div class="quiz-actions">
              <button class="action-button" @click=${this.restartQuiz}>
                Retake Quiz
              </button>
              <button class="action-button" @click=${this.goToLearning}>
                Review Words
              </button>
              <button class="action-button primary" @click=${this.goToTopicSelection}>
                New Topic
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}