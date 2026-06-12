/**
 * Core data models for the Local Language Learning App
 */

export interface Word {
  id: number;
  word: string;
  language: string;
  translation: string;
  strength: number; // User mastery level (0+), can exceed 100
  known: boolean;
  ignored: boolean;
  createdAt: Date;
  lastStudied?: Date;
  // SRS fields
  intervalDays: number; // Days until next review
  easeFactor: number; // Multiplier for interval calculation (starts at 2.5)
  lastReview?: Date; // When word was last reviewed
  nextDue: Date; // When word is next due for review
  // FSRS fields (optional until migration initialized)
  fsrsDifficulty?: number;
  fsrsStability?: number;
  fsrsLapses?: number;
  fsrsLastRating?: number;
  processingStatus?: 'queued' | 'processing' | 'ready' | 'failed';
  sentenceCount?: number;
  grammarExplanationCount?: number; // Number of times grammar explanation has been generated
  topic?: string; // Topic the word was generated for
  addedVia?: string; // How the word was added: 'manual', 'auto', or 'context_menu'
  zipfFrequency?: number; // Zipf frequency (typically 1-7), cached from wordfreq
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
  language: string;
  sentence: string;
  sentenceParts?: string[];
  translation: string;
  audioPath: string;
  createdAt: Date;
  lastShown?: Date;
  playCount: number;
  contextBefore?: string;
  contextAfter?: string;
  contextBeforeTranslation?: string;
  contextAfterTranslation?: string;
  sentenceGenerationModel?: string;
  audioGenerationService?: string;
  audioGenerationModel?: string;
  audioGenerationVoiceId?: string;
  tokenizedTokens?: PrecomputedToken[];
  beforeSentenceAudioPath?: string;
  afterSentenceAudioPath?: string;
  ignored?: boolean;
  relatedWords?: string[];
  pronunciation?: string; // Phonetic reading (hiragana for Japanese)
  contextBeforePronunciation?: string; // Pronunciation of context before
  contextAfterPronunciation?: string; // Pronunciation of context after
}

/**
 * Precomputed token data for a sentence word/phrase.
 * Contains all tokenization and dictionary lookup results.
 */
export interface PrecomputedToken {
  text: string;
  isTargetWord: boolean;
  wordId?: number; // ID of matching word in database at creation time
  dictionaryForm?: string;
  dictionaryKey?: string;
  dictionaryEntries?: DictionaryEntry[]; // Fully cached dictionary lookup results
  lemma?: string; // Lemmatized form of the word (base form)
}

export interface QuizQuestion {
  word: Word;
  sentence: Sentence;
}

export interface StudyStats {
  wordsStudied: number;
  totalWords: number;
  averageStrength: number;
  lastStudyDate?: Date;
}

export interface GeneratedWord {
  word: string; // Foreign language word
  translation: string; // English translation
  frequencyPosition?: number; // 1-based position in frequency list
  frequencyTier?: string; // Human-readable tier like "top 100", "top 500"
  zipfFrequency?: number; // Zipf frequency (typically 1-7)
}

export interface GeneratedSentence {
  sentence: string; // Foreign language sentence
  translation: string; // English translation
  contextBefore?: string; // Optional sentence before for context
  contextAfter?: string; // Optional sentence after for context
  contextBeforeTranslation?: string; // Translation of context before
  contextAfterTranslation?: string; // Translation of context after
  audioUrl?: string; // Optional external audio source URL
  pronunciation?: string; // Phonetic reading (hiragana for Japanese)
  contextBeforePronunciation?: string; // Pronunciation of context before
  contextAfterPronunciation?: string; // Pronunciation of context after
}

export interface CreateWordRequest {
  word: string;
  language: string;
  translation: string;
  topic?: string;
  addedVia?: 'manual' | 'auto' | 'context_menu';
}

export interface QuizSession {
  questions: QuizQuestion[];
  currentQuestionIndex: number;
  score: number;
  totalQuestions: number;
  isComplete: boolean;
}

export interface QuizResult {
  wordId: number;
  correct: boolean;
  responseTime?: number;
}

export interface DialogueVariant {
  id: number;
  sentenceId: number;
  variantSentence: string;
  variantTranslation: string;
  variantPronunciation?: string;
  createdAt: Date;
  continuationText?: string;
  continuationTranslation?: string;
  continuationAudio?: string;
}

export interface DialogResponseOption {
  id: number;
  sentenceId: number;
  variantSentence: string;
  variantTranslation: string;
  variantPronunciation?: string;
  createdAt: Date;
}

export interface DialogSession {
  sentenceId: number;
  sentence: string;
  translation: string;
  contextBefore?: string;
  contextBeforeTranslation?: string;
  contextAfter?: string;
  contextAfterTranslation?: string;
  beforeSentenceAudio?: string;
  afterSentenceAudio?: string;
  responseOptions: DialogResponseOption[];
  isTopicBasedFlow?: boolean;
}

export interface TranscriptionAnalysis {
  correction?: string;
  grammarExplanation?: string;
  hasGrammarMistakes: boolean;
}

export interface ModeScores {
  addWords: number;
  review: number;
  quiz: number;
  dialog: number;
  flow: number;
}
