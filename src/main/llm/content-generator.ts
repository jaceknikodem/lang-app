/**
 * Content generation workflows using LLM client
 */

import { GeneratedWord, GeneratedSentence } from '../../shared/types/core.js';
import { LLMClient, LLMError } from '../../shared/types/llm.js';
import { OllamaClient } from './ollama-client.js';

export interface ContentGeneratorConfig {
  defaultLanguage: string;
  defaultWordCount: number;
  defaultSentenceCount: number;
  retryAttempts: number;
  retryDelay: number;
}

export class ContentGenerator {
  private llmClient: LLMClient;
  private config: ContentGeneratorConfig;

  constructor(llmClient?: LLMClient, config?: Partial<ContentGeneratorConfig>) {
    this.llmClient = llmClient || new OllamaClient();
    this.config = {
      defaultLanguage: config?.defaultLanguage || 'Spanish',
      defaultWordCount: config?.defaultWordCount || 10,
      defaultSentenceCount: config?.defaultSentenceCount || 3,
      retryAttempts: config?.retryAttempts || 2,
      retryDelay: config?.retryDelay || 1000
    };
  }

  /**
   * Generate vocabulary words for a given topic with frequency classification
   */
  async generateTopicVocabulary(
    topic?: string, 
    language?: string, 
    count?: number
  ): Promise<GeneratedWord[]> {
    const targetLanguage = language || this.config.defaultLanguage;
    const wordCount = count || this.config.defaultWordCount;
    const topicText = topic?.trim() || '';

    try {
      // Validate LLM availability before attempting generation
      const isAvailable = await this.llmClient.isAvailable();
      if (!isAvailable) {
        throw new Error('LLM service is not available. Please ensure Ollama is running.');
      }

      console.log(`Generating vocabulary: topic="${topicText}", language="${targetLanguage}", count=${wordCount}`);
      
      const words = await this.executeWithRetry(
        () => this.llmClient.generateTopicWords(topicText, targetLanguage, wordCount),
        `generate vocabulary for topic: ${topicText || 'general'}`
      );
      
      console.log(`LLM returned ${words?.length || 0} words:`, words);

      // Validate and filter results
      const validWords = this.validateGeneratedWords(words);
      
      if (validWords.length === 0) {
        throw new Error('No valid words were generated. Please try again.');
      }

      return validWords;

    } catch (error) {
      throw this.handleContentGenerationError(error, 'vocabulary generation');
    }
  }

  /**
   * Generate contextual sentences for a vocabulary word with translations
   */
  async generateWordSentences(
    word: string, 
    language?: string, 
    count?: number
  ): Promise<GeneratedSentence[]> {
    const targetLanguage = language || this.config.defaultLanguage;
    const sentenceCount = count || this.config.defaultSentenceCount;

    if (!word?.trim()) {
      throw new Error('Word parameter is required for sentence generation');
    }

    try {
      // Validate LLM availability
      const isAvailable = await this.llmClient.isAvailable();
      if (!isAvailable) {
        throw new Error('LLM service is not available. Please ensure Ollama is running.');
      }

      const sentences = await this.executeWithRetry(
        () => this.llmClient.generateSentences(word.trim(), targetLanguage, sentenceCount),
        `generate sentences for word: ${word}`
      );

      // Validate and filter results
      const validSentences = this.validateGeneratedSentences(sentences, word);
      
      if (validSentences.length === 0) {
        throw new Error(`No valid sentences were generated for word: ${word}. Please try again.`);
      }

      return validSentences;

    } catch (error) {
      throw this.handleContentGenerationError(error, 'sentence generation');
    }
  }

  /**
   * Check if the LLM service is available and ready
   */
  async isServiceAvailable(): Promise<boolean> {
    try {
      return await this.llmClient.isAvailable();
    } catch (error) {
      return false;
    }
  }

  /**
   * Execute a function with retry logic and error handling
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts + 1; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Check if error is retryable
        if (error instanceof Error && 'retryable' in error) {
          const llmError = error as LLMError;
          if (!llmError.retryable) {
            throw error;
          }
        }

        // Don't retry on the last attempt
        if (attempt > this.config.retryAttempts) {
          break;
        }

        console.warn(`Attempt ${attempt} failed for ${operationName}: ${error}. Retrying...`);
        
        // Wait before retry
        await this.delay(this.config.retryDelay * attempt);
      }
    }

    throw lastError || new Error(`Failed to ${operationName} after ${this.config.retryAttempts + 1} attempts`);
  }

  /**
   * Validate generated words and filter out invalid entries
   */
  private validateGeneratedWords(words: GeneratedWord[]): GeneratedWord[] {
    if (!Array.isArray(words)) {
      return [];
    }

    return words.filter(word => {
      // Check required fields
      if (!word.word || !word.translation || !word.frequency) {
        console.warn('Skipping invalid word entry:', word);
        return false;
      }

      // Check word length (reasonable bounds)
      if (word.word.trim().length === 0 || word.word.length > 50) {
        console.warn('Skipping word with invalid length:', word.word);
        return false;
      }

      // Check translation length
      if (word.translation.trim().length === 0 || word.translation.length > 100) {
        console.warn('Skipping word with invalid translation length:', word.translation);
        return false;
      }

      // Check frequency value
      if (!['high', 'medium', 'low'].includes(word.frequency)) {
        console.warn('Skipping word with invalid frequency:', word.frequency);
        return false;
      }

      return true;
    });
  }

  /**
   * Validate generated sentences and filter out invalid entries
   */
  private validateGeneratedSentences(sentences: GeneratedSentence[], targetWord: string): GeneratedSentence[] {
    if (!Array.isArray(sentences)) {
      return [];
    }

    return sentences.filter(sentence => {
      // Check required fields
      if (!sentence.sentence || !sentence.translation) {
        console.warn('Skipping invalid sentence entry:', sentence);
        return false;
      }

      // Check sentence length (reasonable bounds)
      if (sentence.sentence.trim().length === 0 || sentence.sentence.length > 200) {
        console.warn('Skipping sentence with invalid length:', sentence.sentence);
        return false;
      }

      // Check translation length
      if (sentence.translation.trim().length === 0 || sentence.translation.length > 300) {
        console.warn('Skipping sentence with invalid translation length:', sentence.translation);
        return false;
      }

      // Verify the target word appears in the sentence (case-insensitive)
      const sentenceLower = sentence.sentence.toLowerCase();
      const wordLower = targetWord.toLowerCase();
      if (!sentenceLower.includes(wordLower)) {
        console.warn(`Skipping sentence that doesn't contain target word "${targetWord}":`, sentence.sentence);
        return false;
      }

      return true;
    });
  }

  /**
   * Handle and format content generation errors
   */
  private handleContentGenerationError(error: unknown, operation: string): Error {
    if (error instanceof Error) {
      // If it's already an LLMError, preserve it
      if ('code' in error) {
        return error;
      }
      
      // Wrap other errors with context
      return new Error(`${operation} failed: ${error.message}`);
    }
    
    return new Error(`${operation} failed: Unknown error occurred`);
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}