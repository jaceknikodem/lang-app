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
}

export interface Sentence {
  id: number;
  wordId: number;
  sentence: string;
  translation: string;
  audioPath: string;
  createdAt: Date;
  lastShown?: Date;
}

export interface StudySession {
  selectedWords: Word[];
  currentIndex: number;
  mode: 'learning' | 'quiz';
  quizDirection?: 'foreign-to-english' | 'english-to-foreign';
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
  frequency: 'high' | 'medium' | 'low';
}

export interface GeneratedSentence {
  sentence: string;    // Foreign language sentence
  translation: string; // English translation
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
  selectedWords?: Word[];
  quizDirection: 'foreign-to-english' | 'english-to-foreign';
}