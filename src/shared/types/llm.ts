/**
 * LLM client interfaces and types
 */

import { GeneratedWord, GeneratedSentence } from './core.js';

export interface LLMClient {
  generateTopicWords(topic: string, language: string, count: number): Promise<GeneratedWord[]>;
  generateSentences(word: string, language: string, count: number, useContextSentences?: boolean, topic?: string): Promise<GeneratedSentence[]>;
  generateResponse(prompt: string, model?: string): Promise<string>;
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