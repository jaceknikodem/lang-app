/**
 * Session manager for persisting and restoring application state
 */



export interface SessionState {
  currentMode: 'topic-selection' | 'word-selection' | 'learning' | 'quiz' | 'progress' | 'settings';
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
   * Create default session state
   */
  private createDefaultSession(): SessionState {
    return {
      currentMode: 'topic-selection',
      quizDirection: 'foreign-to-english',
      lastActivity: new Date()
    };
  }
}

// Export singleton instance
export const sessionManager = SessionManager.getInstance();