/**
 * LLM client interfaces and types
 */

import { GeneratedWord, GeneratedSentence, TranscriptionAnalysis } from './core.js';

export interface LLMClient {
  generateTopicWords(
    topic: string,
    language: string,
    count: number,
    proficiencyLevel?: string
  ): Promise<GeneratedWord[]>;
  generateSentences(
    word: string,
    language: string,
    count: number,
    topic?: string,
    proficiencyLevel?: string,
    translation?: string
  ): Promise<GeneratedSentence[]>;
  generateContextSentences(
    sentence: string,
    translation: string,
    language: string,
    proficiencyLevel?: string
  ): Promise<{
    contextBefore?: string;
    contextAfter?: string;
    contextBeforeTranslation?: string;
    contextAfterTranslation?: string;
  }>;
  generateDialogueVariants(
    triggerSentence: string,
    triggerTranslation: string,
    language: string,
    knownWords: string[],
    count: number,
    proficiencyLevel?: string
  ): Promise<Array<{ sentence: string; translation: string }>>;
  generateFollowUp(
    conversationHistory: string[],
    language: string,
    proficiencyLevel?: string
  ): Promise<{ text: string; translation: string }>;
  analyzeTranscription(
    transcription: string,
    language: string,
    assistantSentence: string,
    topic?: string
  ): Promise<TranscriptionAnalysis>;
  explainGrammar(
    word: string,
    sentence: string,
    language: string,
    proficiencyLevel?: string
  ): Promise<string>;
  convertToPronunciation(sentences: string[], language: string): Promise<string[]>;
  isAvailable(): Promise<boolean>;
  getAvailableModels(): Promise<string[]>;
  setModel(model: string): void;
  getCurrentModel(): string;
  setWordGenerationModel(model: string): void;
  setSentenceGenerationModel(model: string): void;
  getWordGenerationModel(): string;
  getSentenceGenerationModel(): string;
  setDatabaseLayer(databaseLayer: any): void;
}

export interface LLMConfig {
  baseUrl: string;
  model: string;
  wordGenerationModel?: string; // Small model for word generation
  sentenceGenerationModel?: string; // Big model for sentence generation
  timeout?: number;
  maxRetries?: number;
}

export interface LLMError extends Error {
  code: 'CONNECTION_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'MODEL_ERROR';
  retryable: boolean;
}
