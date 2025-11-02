/**
 * Session manager for persisting and restoring application state
 */


export interface LearningSessionState {
  id: string;
  wordIds: number[];
  sentenceIds?: number[];
  audioPaths?: string[];
  maxSentences: number;
  createdAt: string;
  completed: boolean;
}

export interface QuizSessionState {
  id: string;
  wordIds: number[]; // Word IDs in the order they appear in the quiz (preserves shuffle)
  currentQuestionIndex: number;
  direction: 'foreign-to-english' | 'english-to-foreign';
  score: number;
  totalQuestions: number;
  isComplete: boolean;
  audioOnlyMode: boolean;
  createdAt: string;
}

export interface DialogSessionState {
  id: string;
  sentenceId: number;
  sentence: string;
  translation: string;
  contextBefore?: string;
  contextBeforeTranslation?: string;
  beforeSentenceAudio?: string;
  responseOptions: Array<{
    id: number;
    sentenceId: number;
    variantSentence: string;
    variantTranslation: string;
    createdAt: string;
  }>;
  createdAt: string;
}

export interface SessionState {
  currentMode: 'topic-selection' | 'word-selection' | 'learning' | 'quiz' | 'dialog' | 'progress' | 'settings';
  selectedTopic?: string;
  quizDirection: 'foreign-to-english' | 'english-to-foreign';
  playbackSpeed?: number;
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
  quizSession?: QuizSessionState;
  dialogSessions?: DialogSessionState[];
  currentDialogIndex?: number;
  lastActivity: Date;
}

const SESSION_STORAGE_KEY = 'language-learning-session';
const SESSION_STORAGE_VERSION = 2;
const LEGACY_LANGUAGE_KEY = '__legacy__';

type PersistedSessionState = Omit<SessionState, 'lastActivity'> & {
  lastActivity: string;
};

interface SessionStoragePayload {
  version: number;
  activeLanguage?: string;
  sessions: Record<string, PersistedSessionState>;
}

export class SessionManager {
  private static instance: SessionManager;
  private currentSession: SessionState | null = null;
  private sessionsByLanguage: Record<string, SessionState> = {};
  private activeLanguage: string | null = null;
  private storageLoaded = false;

  private constructor() {}

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Set the active language for session storage
   */
  setActiveLanguage(language: string): void {
    if (!language) {
      return;
    }

    this.ensureStorageLoaded();

    const normalizedLanguage = language.trim();
    if (!normalizedLanguage) {
      return;
    }

    if (this.activeLanguage === normalizedLanguage) {
      return;
    }

    if (!this.sessionsByLanguage[normalizedLanguage]) {
      const legacySession = this.sessionsByLanguage[LEGACY_LANGUAGE_KEY];

      if (legacySession) {
        this.sessionsByLanguage[normalizedLanguage] = legacySession;
        delete this.sessionsByLanguage[LEGACY_LANGUAGE_KEY];
      } else {
        this.sessionsByLanguage[normalizedLanguage] = this.createDefaultSession();
      }
    }

    this.activeLanguage = normalizedLanguage;
    this.currentSession = this.sessionsByLanguage[normalizedLanguage];
    this.persistSessions();
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

      const languageKey = this.getActiveLanguageKey();
      this.sessionsByLanguage[languageKey] = updatedSession;
      this.currentSession = updatedSession;
      this.persistSessions();

      console.log('Session saved:', updatedSession.currentMode);
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }

  /**
   * Get current session or create a default one
   */
  getCurrentSession(): SessionState {
    this.ensureStorageLoaded();

    const languageKey = this.getActiveLanguageKey();
    let session = this.sessionsByLanguage[languageKey];

    if (!session) {
      session = this.createDefaultSession();
      this.sessionsByLanguage[languageKey] = session;
      this.persistSessions();
    }

    this.currentSession = session;
    return session;
  }

  /**
   * Clear current session
   */
  clearSession(): void {
    try {
      this.ensureStorageLoaded();

      const languageKey = this.getActiveLanguageKey();
      const defaultSession = this.createDefaultSession();
      this.sessionsByLanguage[languageKey] = defaultSession;
      this.currentSession = defaultSession;

      this.persistSessions();
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
  startNewLearningSession(wordIds: number[], maxSentences: number, sentenceIds?: number[], audioPaths?: string[]): void {
    const newSession: LearningSessionState = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      wordIds,
      sentenceIds,
      audioPaths,
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
   * Append new sentences to the active learning session (preserves original order)
   */
  appendSentencesToLearningSession(sentenceIds: number[], audioPaths?: string[]): void {
    if (!sentenceIds.length) {
      return;
    }

    const session = this.getCurrentSession();
    if (!session.learningSession) {
      // If no session exists, we can't append sentences without words
      console.warn('Cannot append sentences to learning session: no active session exists');
      return;
    }

    const existingSentenceIds = new Set(session.learningSession.sentenceIds || []);
    const mergedSentenceIds = [...(session.learningSession.sentenceIds || [])];
    const mergedAudioPaths = [...(session.learningSession.audioPaths || [])];

    // Append sentence IDs that don't already exist, along with their audio paths
    for (let i = 0; i < sentenceIds.length; i++) {
      const sentenceId = sentenceIds[i];
      const audioPath = audioPaths?.[i];

      if (!existingSentenceIds.has(sentenceId)) {
        mergedSentenceIds.push(sentenceId);
        mergedAudioPaths.push(audioPath || '');
        existingSentenceIds.add(sentenceId);
      } else {
        // Update audio path if sentence already exists and we have a new audio path
        const existingIndex = mergedSentenceIds.indexOf(sentenceId);
        if (audioPath && existingIndex !== -1) {
          mergedAudioPaths[existingIndex] = audioPath;
        }
      }
    }

    this.saveSession({
      learningSession: {
        ...session.learningSession,
        sentenceIds: mergedSentenceIds,
        audioPaths: mergedAudioPaths.length > 0 ? mergedAudioPaths : undefined
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

    const updatedSession: SessionState = {
      ...session,
      learningSession: undefined,
      learningProgress: undefined,
      lastActivity: new Date()
    };
    delete updatedSession.learningSession;
    delete updatedSession.learningProgress;

    const languageKey = this.getActiveLanguageKey();
    this.sessionsByLanguage[languageKey] = updatedSession;
    this.currentSession = updatedSession;

    try {
      this.persistSessions();
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
   * Get the current quiz session state if available
   */
  getQuizSession(): QuizSessionState | undefined {
    return this.getCurrentSession().quizSession;
  }

  /**
   * Start a brand new quiz session with a predefined set of words
   */
  startNewQuizSession(
    wordIds: number[],
    direction: 'foreign-to-english' | 'english-to-foreign',
    audioOnlyMode: boolean = false
  ): void {
    const newSession: QuizSessionState = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      wordIds,
      currentQuestionIndex: 0,
      direction,
      score: 0,
      totalQuestions: wordIds.length,
      isComplete: false,
      audioOnlyMode,
      createdAt: new Date().toISOString()
    };

    this.saveSession({
      quizSession: newSession,
      quizDirection: direction,
      quizProgress: {
        currentQuestionIndex: 0,
        score: 0,
        totalQuestions: wordIds.length
      }
    });
  }

  /**
   * Update quiz session state (progress, score, etc.)
   */
  updateQuizSession(updates: Partial<QuizSessionState>): void {
    const session = this.getCurrentSession();
    if (!session.quizSession) {
      return;
    }

    const updatedQuizSession: QuizSessionState = {
      ...session.quizSession,
      ...updates
    };

    this.saveSession({
      quizSession: updatedQuizSession,
      quizProgress: {
        currentQuestionIndex: updatedQuizSession.currentQuestionIndex,
        score: updatedQuizSession.score,
        totalQuestions: updatedQuizSession.totalQuestions
      }
    });
  }

  /**
   * Mark the active quiz session as completed without wiping other state
   */
  markQuizSessionComplete(): void {
    const session = this.getCurrentSession();
    if (!session.quizSession) {
      return;
    }

    this.saveSession({
      quizSession: {
        ...session.quizSession,
        isComplete: true
      }
    });
  }

  /**
   * Clear only the quiz session metadata while keeping other state intact
   */
  clearQuizSession(): void {
    const session = this.getCurrentSession();
    if (!session.quizSession) {
      return;
    }

    const updatedSession: SessionState = {
      ...session,
      quizSession: undefined,
      quizProgress: undefined,
      lastActivity: new Date()
    };
    delete updatedSession.quizSession;
    delete updatedSession.quizProgress;

    const languageKey = this.getActiveLanguageKey();
    this.sessionsByLanguage[languageKey] = updatedSession;
    this.currentSession = updatedSession;

    try {
      this.persistSessions();
    } catch (error) {
      console.error('Failed to clear quiz session:', error);
    }
  }

  /**
   * Update selected topic
   */
  updateSelectedTopic(topic: string | undefined): void {
    this.saveSession({ selectedTopic: topic });
  }

  /**
   * Get the current dialog session state if available
   * @deprecated Use getCurrentDialogSession() instead
   */
  getDialogSession(): DialogSessionState | undefined {
    return this.getCurrentDialogSession();
  }

  /**
   * Get the current dialog session from the queue
   */
  getCurrentDialogSession(): DialogSessionState | undefined {
    const session = this.getCurrentSession();
    if (!session.dialogSessions || session.dialogSessions.length === 0) {
      console.log('[SessionManager] getCurrentDialogSession - no sessions in cache');
      return undefined;
    }
    
    // Ensure currentDialogIndex is always set if sessions exist (for persistence across restarts)
    let currentIndex = session.currentDialogIndex;
    if (currentIndex === undefined) {
      console.log('[SessionManager] getCurrentDialogSession - initializing undefined index to 0', {
        totalSessions: session.dialogSessions.length
      });
      currentIndex = 0;
      // Persist the initialized index so it's preserved across restarts
      this.saveSession({ currentDialogIndex: 0 });
    }
    
    if (currentIndex >= session.dialogSessions.length) {
      console.log('[SessionManager] getCurrentDialogSession - index out of bounds', {
        currentIndex,
        totalSessions: session.dialogSessions.length
      });
      return undefined;
    }
    
    const dialogSession = session.dialogSessions[currentIndex];
    console.log('[SessionManager] getCurrentDialogSession - returning cached session', {
      sessionId: dialogSession.id,
      sentenceId: dialogSession.sentenceId,
      currentIndex,
      totalSessions: session.dialogSessions.length,
      queueIndices: session.dialogSessions.map((s, i) => ({ index: i, sentenceId: s.sentenceId }))
    });
    
    return dialogSession;
  }

  /**
   * Add a dialog session to the queue (FIFO - up to 5 sessions)
   * If queue is full, removes the oldest session and adds the new one at the end
   */
  addDialogSession(newSession: DialogSessionState): void {
    const session = this.getCurrentSession();
    const languageKey = this.getActiveLanguageKey();
    
    const existingSessions = session.dialogSessions || [];
    let updatedSessions: DialogSessionState[];
    let updatedCurrentIndex: number | undefined;
    
    console.log('[SessionManager] addDialogSession - adding to cache', {
      newSessionId: newSession.id,
      newSentenceId: newSession.sentenceId,
      existingSessionsCount: existingSessions.length,
      currentIndex: session.currentDialogIndex
    });

    if (existingSessions.length >= 5) {
      // FIFO: Remove the oldest session (first in queue) and add new one at the end
      const removedSession = existingSessions.shift(); // Remove first element
      updatedSessions = [...existingSessions, newSession];
      
      // Adjust currentDialogIndex if needed
      const currentIndex = session.currentDialogIndex ?? 0;
      if (currentIndex > 0) {
        // Decrement index since we removed the first session
        updatedCurrentIndex = currentIndex - 1;
      } else {
        // We removed the current session, keep index at 0 (pointing to the next session)
        updatedCurrentIndex = 0;
      }
      
      console.log('[SessionManager] addDialogSession - queue full, FIFO removal', {
        removedSessionId: removedSession?.id,
        removedSentenceId: removedSession?.sentenceId,
        addedSessionId: newSession.id,
        addedSentenceId: newSession.sentenceId,
        oldIndex: currentIndex,
        newIndex: updatedCurrentIndex
      });
    } else {
      // Queue has space, just add to the end
      updatedSessions = [...existingSessions, newSession];
      // Ensure currentDialogIndex is set if sessions exist
      // If this is the first session, set to 0, otherwise preserve existing index
      updatedCurrentIndex = session.currentDialogIndex ?? (updatedSessions.length === 1 ? 0 : 0);
      
      console.log('[SessionManager] addDialogSession - added to queue', {
        addedSessionId: newSession.id,
        addedSentenceId: newSession.sentenceId,
        totalSessions: updatedSessions.length,
        currentIndex: updatedCurrentIndex
      });
    }

    const updatedSession: SessionState = {
      ...session,
      dialogSessions: updatedSessions,
      currentDialogIndex: updatedCurrentIndex,
      lastActivity: new Date()
    };

    this.sessionsByLanguage[languageKey] = updatedSession;
    this.currentSession = updatedSession;

    try {
      this.persistSessions();
    } catch (error) {
      console.error('Failed to add dialog session:', error);
    }
  }

  /**
   * Mark the current dialog session as used and advance to the next one
   */
  consumeCurrentDialogSession(): void {
    const session = this.getCurrentSession();
    if (!session.dialogSessions || session.dialogSessions.length === 0) {
      console.log('[SessionManager] consumeCurrentDialogSession - no sessions to consume');
      return;
    }

    const currentIndex = session.currentDialogIndex ?? 0;
    const nextIndex = currentIndex + 1;
    const consumedSession = session.dialogSessions[currentIndex];

    console.log('[SessionManager] consumeCurrentDialogSession - advancing index', {
      consumedSessionId: consumedSession?.id,
      consumedSentenceId: consumedSession?.sentenceId,
      oldIndex: currentIndex,
      newIndex: nextIndex < session.dialogSessions.length ? nextIndex : undefined,
      totalSessions: session.dialogSessions.length
    });

    const languageKey = this.getActiveLanguageKey();
    const updatedSession: SessionState = {
      ...session,
      currentDialogIndex: nextIndex < session.dialogSessions.length ? nextIndex : undefined,
      lastActivity: new Date()
    };

    this.sessionsByLanguage[languageKey] = updatedSession;
    this.currentSession = updatedSession;

    try {
      this.persistSessions();
    } catch (error) {
      console.error('Failed to consume dialog session:', error);
    }
  }

  /**
   * Clear all dialog sessions
   */
  clearDialogSession(): void {
    const session = this.getCurrentSession();
    const languageKey = this.getActiveLanguageKey();
    
    const updatedSession: SessionState = {
      ...session,
      dialogSessions: undefined,
      currentDialogIndex: undefined,
      lastActivity: new Date()
    };
    delete updatedSession.dialogSessions;
    delete updatedSession.currentDialogIndex;

    this.sessionsByLanguage[languageKey] = updatedSession;
    this.currentSession = updatedSession;

    try {
      this.persistSessions();
    } catch (error) {
      console.error('Failed to clear dialog sessions:', error);
    }
  }

  /**
   * Set multiple dialog sessions at once (used for initialization)
   */
  setDialogSessions(sessions: DialogSessionState[], startIndex: number = 0): void {
    const session = this.getCurrentSession();
    const languageKey = this.getActiveLanguageKey();
    
    const updatedSession: SessionState = {
      ...session,
      dialogSessions: sessions,
      currentDialogIndex: sessions.length > 0 ? startIndex : undefined,
      lastActivity: new Date()
    };

    this.sessionsByLanguage[languageKey] = updatedSession;
    this.currentSession = updatedSession;

    try {
      this.persistSessions();
    } catch (error) {
      console.error('Failed to set dialog sessions:', error);
    }
  }

  /**
   * Get playback speed for current language (defaults to 1.0 if not set)
   */
  getPlaybackSpeed(): number {
    const session = this.getCurrentSession();
    return session.playbackSpeed ?? 1.0;
  }

  /**
   * Set playback speed for current language
   */
  setPlaybackSpeed(speed: number): void {
    this.saveSession({ playbackSpeed: speed });
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

  private getActiveLanguageKey(): string {
    if (this.activeLanguage && this.activeLanguage.trim().length > 0) {
      return this.activeLanguage;
    }
    return LEGACY_LANGUAGE_KEY;
  }

  private ensureStorageLoaded(): void {
    if (this.storageLoaded) {
      return;
    }

    this.storageLoaded = true;

    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as SessionStoragePayload | (Partial<SessionState> & { lastActivity?: string });

      if (parsed && typeof parsed === 'object' && 'version' in parsed && parsed.version === SESSION_STORAGE_VERSION) {
        const payload = parsed as SessionStoragePayload;

        const sessionEntries = Object.entries(payload.sessions ?? {});
        for (const [language, sessionData] of sessionEntries) {
          this.sessionsByLanguage[language] = this.hydrateSession(sessionData);
        }

        const storedActiveLanguage = typeof payload.activeLanguage === 'string' ? payload.activeLanguage : undefined;
        if (storedActiveLanguage) {
          if (!this.sessionsByLanguage[storedActiveLanguage]) {
            this.sessionsByLanguage[storedActiveLanguage] = this.createDefaultSession();
          }
          this.activeLanguage = storedActiveLanguage;
          this.currentSession = this.sessionsByLanguage[storedActiveLanguage];
        } else if (this.sessionsByLanguage[LEGACY_LANGUAGE_KEY]) {
          this.currentSession = this.sessionsByLanguage[LEGACY_LANGUAGE_KEY];
        } else if (sessionEntries.length > 0) {
          const [firstLanguage] = sessionEntries[0];
          if (firstLanguage !== LEGACY_LANGUAGE_KEY) {
            this.activeLanguage = firstLanguage;
          }
          this.currentSession = this.sessionsByLanguage[firstLanguage];
        }
        return;
      }

      if (parsed && typeof parsed === 'object') {
        const legacySession = this.hydrateSession(
          parsed as Partial<Omit<SessionState, 'lastActivity'>> & { lastActivity?: string }
        );
        this.sessionsByLanguage[LEGACY_LANGUAGE_KEY] = legacySession;
        this.currentSession = legacySession;
      }
    } catch (error) {
      console.error('Failed to load session from storage:', error);
    }
  }

  private hydrateSession(
    sessionData: Partial<Omit<SessionState, 'lastActivity'>> & { lastActivity?: string | Date } & { dialogSession?: DialogSessionState }
  ): SessionState {
    // Handle backward compatibility: if there's an old dialogSession, convert it to dialogSessions array
    let dialogSessions = sessionData.dialogSessions;
    let currentDialogIndex = sessionData.currentDialogIndex;
    
    if (!dialogSessions && (sessionData as any).dialogSession) {
      // Migrate old single session to new array format
      const oldSession = (sessionData as any).dialogSession as DialogSessionState;
      dialogSessions = [oldSession];
      currentDialogIndex = 0;
    }
    
    return {
      currentMode: sessionData.currentMode ?? 'topic-selection',
      quizDirection: sessionData.quizDirection ?? 'foreign-to-english',
      selectedTopic: sessionData.selectedTopic,
      playbackSpeed: sessionData.playbackSpeed,
      learningProgress: sessionData.learningProgress,
      quizProgress: sessionData.quizProgress,
      learningSession: sessionData.learningSession,
      quizSession: sessionData.quizSession,
      dialogSessions,
      currentDialogIndex,
      lastActivity: sessionData.lastActivity ? new Date(sessionData.lastActivity) : new Date()
    };
  }

  private persistSessions(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const sessions: Record<string, PersistedSessionState> = {};

      for (const [language, session] of Object.entries(this.sessionsByLanguage)) {
        if (language === LEGACY_LANGUAGE_KEY && this.activeLanguage) {
          continue;
        }

        sessions[language] = {
          ...session,
          lastActivity: session.lastActivity.toISOString()
        };
      }

      const payload: SessionStoragePayload = {
        version: SESSION_STORAGE_VERSION,
        activeLanguage: this.activeLanguage ?? undefined,
        sessions
      };

      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error('Failed to persist session:', error);
    }
  }
}

// Export singleton instance
export const sessionManager = SessionManager.getInstance();
