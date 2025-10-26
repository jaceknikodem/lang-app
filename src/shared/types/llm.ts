/**
 * LLM client interfaces and types
 */

import { GeneratedWord, GeneratedSentence } from './core.js';

export interface LLMClient {
  generateTopicWords(topic: string, language: string, count: number): Promise<GeneratedWord[]>;
  generateSentences(word: string, language: string, count: number, useContextSentences?: boolean): Promise<GeneratedSentence[]>;
  generateResponse(prompt: string): Promise<string>;
  isAvailable(): Promise<boolean>;
  getAvailableModels(): Promise<string[]>;
  setModel(model: string): void;
  getCurrentModel(): string;
  setDatabaseLayer(databaseLayer: any): void;
}

export interface LLMConfig {
  baseUrl: string;
  model: string;
  timeout?: number;
  maxRetries?: number;
}

export interface LLMError extends Error {
  code: 'CONNECTION_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'MODEL_ERROR';
  retryable: boolean;
}