/**
 * Content generation workflows using LLM client
 */

import { GeneratedWord, GeneratedSentence } from '../../shared/types/core.js';
import { LLMClient, LLMError } from '../../shared/types/llm.js';
import { DatabaseLayer } from '../../shared/types/database.js';
import { LLMFactory, LLMFactoryConfig, LLMProvider } from './llm-factory.js';
import { FrequencyWordManager } from './frequency-word-manager.js';

export interface ContentGeneratorConfig {
  defaultLanguage: string;
  defaultWordCount: number;
  defaultSentenceCount: number;
  retryAttempts: number;
  retryDelay: number;
  llmProvider?: LLMProvider;
  geminiApiKey?: string;
}

export class ContentGenerator {
  private llmClient: LLMClient;
  private config: ContentGeneratorConfig;
  private frequencyWordManager: FrequencyWordManager;

  constructor(llmClient?: LLMClient, config?: Partial<ContentGeneratorConfig>) {
    this.config = {
      defaultLanguage: config?.defaultLanguage || 'Spanish',
      defaultWordCount: config?.defaultWordCount || 5,
      defaultSentenceCount: config?.defaultSentenceCount || 3,
      retryAttempts: config?.retryAttempts || 2,
      retryDelay: config?.retryDelay || 1000,
      llmProvider: config?.llmProvider || 'ollama',
      geminiApiKey: config?.geminiApiKey
    };

    // Create LLM client using factory if not provided
    if (llmClient) {
      this.llmClient = llmClient;
    } else {
      this.llmClient = this.createLLMClient();
    }

    this.frequencyWordManager = new FrequencyWordManager();
  }

  /**
   * Initialize the content generator and frequency word manager
   */
  async initialize(): Promise<void> {
    await this.frequencyWordManager.initialize();
  }

  /**
   * Create LLM client based on configuration
   */
  private createLLMClient(): LLMClient {
    const factoryConfig: LLMFactoryConfig = {
      provider: this.config.llmProvider || 'ollama'
    };

    if (this.config.llmProvider === 'gemini') {
      factoryConfig.geminiConfig = {
        apiKey: this.config.geminiApiKey || ''
      };
    }

    console.log('Creating LLM client:', {
      provider: this.config.llmProvider,
      hasApiKey: !!(this.config.geminiApiKey && this.config.geminiApiKey.trim())
    });

    return LLMFactory.createClient(factoryConfig);
  }

  /**
   * Switch LLM provider and recreate client
   */
  switchProvider(provider: LLMProvider, geminiApiKey?: string): void {
    console.log('Switching provider:', {
      from: this.config.llmProvider,
      to: provider,
      providedApiKey: !!geminiApiKey,
      existingApiKey: !!(this.config.geminiApiKey && this.config.geminiApiKey.trim())
    });

    this.config.llmProvider = provider;
    if (provider === 'gemini') {
      // Update API key if provided, otherwise keep existing one
      if (geminiApiKey !== undefined) {
        this.config.geminiApiKey = geminiApiKey;
      }
    }
    this.llmClient = this.createLLMClient();
  }

  /**
   * Get current LLM provider
   */
  getCurrentProvider(): LLMProvider {
    return this.config.llmProvider || 'ollama';
  }

  /**
   * Set Gemini API key and optionally switch to Gemini
   */
  setGeminiApiKey(apiKey: string, switchToGemini: boolean = false): void {
    this.config.geminiApiKey = apiKey;

    // If we're currently using Gemini, update the API key in the client
    if (this.config.llmProvider === 'gemini' && 'setApiKey' in this.llmClient) {
      (this.llmClient as any).setApiKey(apiKey);
    }

    if (switchToGemini) {
      this.switchProvider('gemini', apiKey);
    }
  }

  /**
   * Get current LLM client instance
   */
  getCurrentClient(): LLMClient {
    return this.llmClient;
  }

  /**
   * Generate vocabulary words for a given topic with frequency classification
   * If no topic is provided, uses frequency-ordered word lists
   */
  async generateTopicVocabulary(
    topic?: string,
    language?: string,
    count?: number,
    database?: DatabaseLayer
  ): Promise<GeneratedWord[]> {
    const targetLanguage = language || this.config.defaultLanguage;
    const wordCount = count || this.config.defaultWordCount;
    const topicText = topic?.trim() || '';

    try {
      // If no topic is provided and we have a database, use frequency-based selection
      if (!topicText && database) {
        return await this.generateFrequencyBasedVocabulary(targetLanguage.toLowerCase(), wordCount, database);
      }

      // Otherwise, use LLM-based topic generation
      return await this.generateLLMTopicVocabulary(topicText, targetLanguage, wordCount);

    } catch (error) {
      throw this.handleContentGenerationError(error, 'vocabulary generation');
    }
  }

  /**
   * Generate vocabulary using frequency-ordered word lists
   */
  private async generateFrequencyBasedVocabulary(
    language: string,
    count: number,
    database: DatabaseLayer
  ): Promise<GeneratedWord[]> {
    console.log(`Generating frequency-based vocabulary for ${language}, count: ${count}`);

    // Check if there are more words to process
    const hasMore = await this.frequencyWordManager.hasMoreWords(language, database);
    if (!hasMore) {
      throw new Error(`All words from the frequency list have been processed for ${language}. Consider using a topic instead.`);
    }

    // Get the next words from the frequency list
    const nextWordEntries = await this.frequencyWordManager.getNextWordsToProcess(language, database, count);

    if (nextWordEntries.length === 0) {
      throw new Error(`No new words available from frequency list for ${language}`);
    }

    console.log(`Selected ${nextWordEntries.length} words from frequency list:`, nextWordEntries.map(e => e.word));

    // Process word entries - use existing translations or generate them
    const generatedWords: GeneratedWord[] = [];

    for (const wordEntry of nextWordEntries) {
      try {
        let translation = wordEntry.translation;

        // If no translation is available, use LLM to generate it
        if (!translation) {
          translation = await this.getWordTranslation(wordEntry.word, language);
        }

        // Get frequency position and tier information
        const frequencyPosition = wordEntry.position;
        const frequencyTier = frequencyPosition ? this.frequencyWordManager.getFrequencyTier(frequencyPosition) : undefined;

        generatedWords.push({
          word: wordEntry.word,
          translation: translation,
          frequencyPosition,
          frequencyTier
        });
      } catch (error) {
        console.warn(`Failed to get translation for word "${wordEntry.word}":`, error);
        // Continue with other words even if one fails
      }
    }

    if (generatedWords.length === 0) {
      throw new Error('Failed to generate translations for frequency-based words');
    }

    return generatedWords;
  }

  /**
   * Generate vocabulary using LLM for a specific topic
   */
  private async generateLLMTopicVocabulary(
    topicText: string,
    targetLanguage: string,
    wordCount: number
  ): Promise<GeneratedWord[]> {
    // Validate LLM availability before attempting generation
    const isAvailable = await this.llmClient.isAvailable();
    if (!isAvailable) {
      const providerName = this.getCurrentProvider();
      if (providerName === 'ollama') {
        throw new Error('LLM service is not available. Please ensure Ollama is running.');
      } else if (providerName === 'gemini') {
        throw new Error('Gemini API is not available. Please check your API key and internet connection.');
      } else {
        throw new Error('LLM service is not available. Please check your configuration.');
      }
    }

    console.log(`Generating LLM vocabulary: topic="${topicText}", language="${targetLanguage}", count=${wordCount}`);

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

    // Add frequency position information for words that exist in frequency lists
    const wordsWithFrequencyInfo = validWords.map(word => {
      const frequencyPosition = this.frequencyWordManager.getWordFrequencyPosition(word.word, targetLanguage.toLowerCase());
      const frequencyTier = frequencyPosition ? this.frequencyWordManager.getFrequencyTier(frequencyPosition) : undefined;

      return {
        ...word,
        frequencyPosition,
        frequencyTier
      };
    });

    // Shuffle the words to ensure variety in presentation order
    return this.shuffleArray(wordsWithFrequencyInfo);
  }

  /**
   * Get translation for a specific word using LLM
   */
  private async getWordTranslation(word: string, language: string): Promise<string> {
    const isAvailable = await this.llmClient.isAvailable();
    if (!isAvailable) {
      throw new Error('LLM service is not available for translation');
    }

    // Use a simple prompt to get just the translation
    const prompt = `Translate the ${language} word "${word}" to English. Respond with only the English translation, no additional text.`;

    try {
      // Use the word generation model for simple translations
      const wordModel = this.llmClient.getWordGenerationModel();
      const response = await this.llmClient.generateResponse(prompt, wordModel);
      return response.trim();
    } catch (error) {
      throw new Error(`Failed to translate word "${word}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate contextual sentences for a vocabulary word with translations
   */
  async generateWordSentences(
    word: string,
    language?: string,
    count?: number,
    database?: DatabaseLayer,
    topic?: string
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
        const providerName = this.getCurrentProvider();
        if (providerName === 'ollama') {
          throw new Error('LLM service is not available. Please ensure Ollama is running.');
        } else if (providerName === 'gemini') {
          throw new Error('Gemini API is not available. Please check your API key and internet connection.');
        } else {
          throw new Error('LLM service is not available. Please check your configuration.');
        }
      }

      // Check if context sentences are enabled
      let useContextSentences = false;
      if (database) {
        try {
          const contextSetting = await database.getSetting('context_sentences');
          useContextSentences = contextSetting === 'true';
        } catch (error) {
          console.warn('Failed to get context sentences setting:', error);
        }
      }

      const sentences = await this.executeWithRetry(
        () => this.llmClient.generateSentences(word.trim(), targetLanguage, sentenceCount, useContextSentences, topic),
        `generate sentences for word: ${word}`
      );

      // Validate and filter results
      const validSentences = this.validateGeneratedSentences(sentences, word);

      if (validSentences.length === 0) {
        throw new Error(`No valid sentences were generated for word: ${word}. Please try again.`);
      }

      // Shuffle the sentences to ensure variety in presentation order
      return this.shuffleArray(validSentences);

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
   * Get frequency-based progress for a language
   */
  async getFrequencyProgress(language: string, database: DatabaseLayer): Promise<{
    totalWords: number;
    processedWords: number;
    currentPosition: number;
    percentComplete: number;
  }> {
    return await this.frequencyWordManager.getLanguageProgress(language, database);
  }

  /**
   * Get available languages from frequency word lists
   */
  getAvailableFrequencyLanguages(): string[] {
    return this.frequencyWordManager.getAvailableLanguages();
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
      if (!word.word || !word.translation) {
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

      // Note: Removed rigid word inclusion check as it was too restrictive
      // LLM may use word variations, conjugations, or related forms

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
   * Shuffle an array using Fisher-Yates algorithm
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}