/**
 * Core data models for the Local Language Learning App
 */

export interface Word {
  id: number;
  word: string;
  language: string;
  translation: string;
  audioPath: string;
  strength: number;        // 0-100 scale representing user mastery
  known: boolean;
  ignored: boolean;
  createdAt: Date;
  lastStudied?: Date;
  // SRS fields
  intervalDays: number;    // Days until next review
  easeFactor: number;      // Multiplier for interval calculation (starts at 2.5)
  lastReview?: Date;       // When word was last reviewed
  nextDue: Date;          // When word is next due for review
  // FSRS fields (optional until migration initialized)
  fsrsDifficulty?: number;
  fsrsStability?: number;
  fsrsLapses?: number;
  fsrsLastRating?: number;
  fsrsVersion?: string;
  processingStatus?: 'queued' | 'processing' | 'ready' | 'failed';
  sentenceCount?: number;
}

export interface DictionaryEntry {
  word: string;
  pos: string;
  glosses: string[];
  lang: string;
}

export interface Sentence {
  id: number;
  wordId: number;
  sentence: string;
  sentenceParts?: string[];
  translation: string;
  audioPath: string;
  createdAt: Date;
  lastShown?: Date;
  contextBefore?: string;
  contextAfter?: string;
  contextBeforeTranslation?: string;
  contextAfterTranslation?: string;
}



export interface QuizQuestion {
  word: Word;
  sentence: Sentence;
  direction: 'foreign-to-english' | 'english-to-foreign';
}

export interface StudyStats {
  wordsStudied: number;
  totalWords: number;
  averageStrength: number;
  lastStudyDate?: Date;
}

export interface GeneratedWord {
  word: string;        // Foreign language word
  translation: string; // English translation
  frequencyPosition?: number; // 1-based position in frequency list
  frequencyTier?: string; // Human-readable tier like "top 100", "top 500"
}

export interface GeneratedSentence {
  sentence: string;    // Foreign language sentence
  translation: string; // English translation
  contextBefore?: string; // Optional sentence before for context
  contextAfter?: string;  // Optional sentence after for context
  contextBeforeTranslation?: string; // Translation of context before
  contextAfterTranslation?: string;  // Translation of context after
}

export interface CreateWordRequest {
  word: string;
  language: string;
  translation: string;
  audioPath?: string;
}

export interface AppState {
  currentMode: 'learning' | 'quiz';
  selectedTopic?: string;
  quizDirection: 'foreign-to-english' | 'english-to-foreign';
}

export interface QuizSession {
  questions: QuizQuestion[];
  currentQuestionIndex: number;
  direction: 'foreign-to-english' | 'english-to-foreign';
  score: number;
  totalQuestions: number;
  isComplete: boolean;
}

export interface QuizResult {
  wordId: number;
  correct: boolean;
  responseTime?: number;
}
