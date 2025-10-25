/**
 * Session manager for persisting and restoring application state
 */

import { Word } from '../../shared/types/core.js';

export interface SessionState {
  selectedWords: Word[];
  currentMode: 'topic-selection' | 'word-selection' | 'learning' | 'quiz' | 'progress';
  selectedTopic?: string;
  quizDirection: 'foreign-to-english' | 'english-to-foreign';
  learningProgress?: {
    currentWordIndex: number;
    currentSentenceIndex: number;
  };
  quizProgress?: {
    currentQuestionIndex: number;
    score: number;
    totalQuestions: number;
  };
  lastActivity: Date;
}

const SESSION_STORAGE_KEY = 'language-learning-session';
const SESSION_EXPIRY_HOURS = 24; // Sessions expire after 24 hours

export class SessionManager {
  private static instance: SessionManager;
  private currentSession: SessionState | null = null;

  private constructor() {}

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Save current session state to localStorage
   */
  saveSession(sessionState: Partial<SessionState>): void {
    try {
      const currentSession = this.getCurrentSession();
      
      const updatedSession: SessionState = {
        ...currentSession,
        ...sessionState,
        lastActivity: new Date()
      };

      this.currentSession = updatedSession;
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updatedSession));
      
      console.log('Session saved:', updatedSession.currentMode);
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }

  /**
   * Load session state from localStorage
   */
  loadSession(): SessionState | null {
    try {
      const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
      
      if (!savedSession) {
        return null;
      }

      const parsedSession: SessionState = JSON.parse(savedSession);
      
      // Check if session has expired
      const lastActivity = new Date(parsedSession.lastActivity);
      const now = new Date();
      const hoursSinceLastActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastActivity > SESSION_EXPIRY_HOURS) {
        console.log('Session expired, clearing...');
        this.clearSession();
        return null;
      }

      this.currentSession = parsedSession;
      console.log('Session loaded:', parsedSession.currentMode);
      return parsedSession;
      
    } catch (error) {
      console.error('Failed to load session:', error);
      this.clearSession();
      return null;
    }
  }

  /**
   * Get current session or create a default one
   */
  getCurrentSession(): SessionState {
    if (!this.currentSession) {
      this.currentSession = this.createDefaultSession();
    }
    return this.currentSession;
  }

  /**
   * Clear current session
   */
  clearSession(): void {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      this.currentSession = null;
      console.log('Session cleared');
    } catch (error) {
      console.error('Failed to clear session:', error);
    }
  }

  /**
   * Update selected words in session
   */
  updateSelectedWords(words: Word[]): void {
    this.saveSession({ selectedWords: words });
  }

  /**
   * Update current mode in session
   */
  updateCurrentMode(mode: SessionState['currentMode']): void {
    this.saveSession({ currentMode: mode });
  }

  /**
   * Update learning progress
   */
  updateLearningProgress(wordIndex: number, sentenceIndex: number): void {
    this.saveSession({
      learningProgress: {
        currentWordIndex: wordIndex,
        currentSentenceIndex: sentenceIndex
      }
    });
  }

  /**
   * Update quiz progress
   */
  updateQuizProgress(questionIndex: number, score: number, totalQuestions: number): void {
    this.saveSession({
      quizProgress: {
        currentQuestionIndex: questionIndex,
        score,
        totalQuestions
      }
    });
  }

  /**
   * Update quiz direction
   */
  updateQuizDirection(direction: 'foreign-to-english' | 'english-to-foreign'): void {
    this.saveSession({ quizDirection: direction });
  }

  /**
   * Update selected topic
   */
  updateSelectedTopic(topic: string | undefined): void {
    this.saveSession({ selectedTopic: topic });
  }

  /**
   * Check if there's an active learning session
   */
  hasActiveSession(): boolean {
    const session = this.getCurrentSession();
    return session.selectedWords.length > 0 && 
           (session.currentMode === 'learning' || session.currentMode === 'quiz');
  }

  /**
   * Get session summary for display
   */
  getSessionSummary(): string | null {
    if (!this.hasActiveSession()) {
      return null;
    }

    const session = this.getCurrentSession();
    const wordCount = session.selectedWords.length;
    const mode = session.currentMode === 'learning' ? 'Learning' : 'Quiz';
    
    return `${mode} session with ${wordCount} words`;
  }

  /**
   * Create default session state
   */
  private createDefaultSession(): SessionState {
    return {
      selectedWords: [],
      currentMode: 'topic-selection',
      quizDirection: 'foreign-to-english',
      lastActivity: new Date()
    };
  }
}

// Export singleton instance
export const sessionManager = SessionManager.getInstance();