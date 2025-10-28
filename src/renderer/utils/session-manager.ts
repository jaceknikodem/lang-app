/**
 * Session manager for persisting and restoring application state
 */


export interface LearningSessionState {
  id: string;
  wordIds: number[];
  maxSentences: number;
  createdAt: string;
  completed: boolean;
}

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
  learningSession?: LearningSessionState;
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
      const stored = this.loadSessionFromStorage();
      this.currentSession = stored ?? this.createDefaultSession();
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
   * Get the current learning session state if available
   */
  getLearningSession(): LearningSessionState | undefined {
    return this.getCurrentSession().learningSession;
  }

  /**
   * Start a brand new learning session with a predefined set of words
   */
  startNewLearningSession(wordIds: number[], maxSentences: number): void {
    const newSession: LearningSessionState = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      wordIds,
      maxSentences,
      createdAt: new Date().toISOString(),
      completed: false
    };

    this.saveSession({
      learningSession: newSession,
      learningProgress: {
        currentWordIndex: 0,
        currentSentenceIndex: 0
      }
    });
  }

  /**
   * Append new words to the active learning session (preserves original order)
   */
  appendWordsToLearningSession(wordIds: number[]): void {
    if (!wordIds.length) {
      return;
    }

    const session = this.getCurrentSession();
    if (!session.learningSession) {
      this.startNewLearningSession(wordIds, wordIds.length);
      return;
    }

    const existingIds = new Set(session.learningSession.wordIds);
    const mergedWordIds = [...session.learningSession.wordIds];

    for (const id of wordIds) {
      if (!existingIds.has(id)) {
        mergedWordIds.push(id);
        existingIds.add(id);
      }
    }

    this.saveSession({
      learningSession: {
        ...session.learningSession,
        wordIds: mergedWordIds
      }
    });
  }

  /**
   * Mark the active learning session as completed without wiping other state
   */
  markLearningSessionComplete(): void {
    const session = this.getCurrentSession();
    if (!session.learningSession) {
      return;
    }

    this.saveSession({
      learningSession: {
        ...session.learningSession,
        completed: true
      }
    });
  }

  /**
   * Clear only the learning session metadata while keeping other state intact
   */
  clearLearningSession(): void {
    const session = this.getCurrentSession();
    if (!session.learningSession) {
      return;
    }

    const updatedSession = { ...session };
    delete updatedSession.learningSession;
    delete updatedSession.learningProgress;
    this.currentSession = updatedSession;
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        ...updatedSession,
        lastActivity: updatedSession.lastActivity.toISOString()
      }));
    } catch (error) {
      console.error('Failed to clear learning session:', error);
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

  /**
   * Attempt to load a previously stored session from localStorage
   */
  private loadSessionFromStorage(): SessionState | null {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<SessionState> & { lastActivity?: string };
      if (!parsed) {
        return null;
      }

      const hydrated: SessionState = {
        currentMode: parsed.currentMode ?? 'topic-selection',
        quizDirection: parsed.quizDirection ?? 'foreign-to-english',
        selectedTopic: parsed.selectedTopic,
        learningProgress: parsed.learningProgress,
        quizProgress: parsed.quizProgress,
        learningSession: parsed.learningSession,
        lastActivity: parsed.lastActivity ? new Date(parsed.lastActivity) : new Date()
      };

      return hydrated;
    } catch (error) {
      console.error('Failed to load session from storage:', error);
      return null;
    }
  }
}

// Export singleton instance
export const sessionManager = SessionManager.getInstance();
