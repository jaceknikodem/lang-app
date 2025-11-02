/**
 * Base class for LLM clients with shared functionality
 */

import { GeneratedWord, GeneratedSentence } from '../../shared/types/core.js';
import { LLMConfig, LLMError } from '../../shared/types/llm.js';
import { LLM_CONFIG } from '../../shared/constants/index.js';
import {
  WordGenerationResponseSchema,
  SentenceGenerationResponseSchema,
  ContextSentenceResponseSchema
} from './schemas.js';
import { z } from 'zod';

/**
 * Abstract base class for LLM clients that implements common functionality
 */
export abstract class BaseLLMClient {
  protected config: LLMConfig;
  protected databaseLayer?: any;

  constructor(config: Partial<LLMConfig> = {}) {
    this.config = {
      baseUrl: config.baseUrl || '',
      model: config.model || '',
      wordGenerationModel: config.wordGenerationModel,
      sentenceGenerationModel: config.sentenceGenerationModel,
      timeout: config.timeout || LLM_CONFIG.DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || LLM_CONFIG.MAX_RETRIES
    };
  }

  /**
   * Set database layer for duplicate checking
   */
  setDatabaseLayer(databaseLayer: any): void {
    this.databaseLayer = databaseLayer;
  }

  // Model management methods
  setModel(model: string): void {
    this.config.model = model;
  }

  getCurrentModel(): string {
    return this.config.model;
  }

  setWordGenerationModel(model: string): void {
    this.config.wordGenerationModel = model;
  }

  setSentenceGenerationModel(model: string): void {
    this.config.sentenceGenerationModel = model;
  }

  getWordGenerationModel(): string {
    return this.config.wordGenerationModel ?? this.config.model;
  }

  getSentenceGenerationModel(): string {
    return this.config.sentenceGenerationModel ?? this.config.model;
  }

  /**
   * Abstract method for making requests - must be implemented by subclasses
   */
  protected abstract makeRequest(prompt: string, model?: string): Promise<any>;

  /**
   * Generate topic words - shared implementation
   */
  async generateTopicWords(topic: string, language: string, count: number): Promise<GeneratedWord[]> {
    // Get existing words to check for duplicates
    const existingWords = await this.getExistingWords(language);
    const existingWordsSet = new Set(existingWords.map(w => w.toLowerCase()));

    const prompt = this.createTopicWordsPrompt(topic, language, count, existingWords);

    try {
      const response = await this.makeRequest(prompt, this.getWordGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = WordGenerationResponseSchema.safeParse(response);

      if (!parseResult.success) {
        console.error('Validation failed:', parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
        throw new Error(`Invalid response format: ${parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
      }

      const words = parseResult.data;

      // Remove duplicates within generated words (case-insensitive)
      const uniqueWords = words.filter((word, index, arr) =>
        arr.findIndex(w => w.word.toLowerCase() === word.word.toLowerCase()) === index
      );

      // Filter out words that already exist in database (learning, known, or ignored)
      const newWords = uniqueWords.filter(word =>
        !existingWordsSet.has(word.word.toLowerCase())
      );

      console.log(`Generated ${uniqueWords.length} unique words, ${newWords.length} are new (${uniqueWords.length - newWords.length} duplicates filtered)`);

      // If we got significantly fewer new words than requested, throw an error to trigger retry.
      const minWords = Math.max(1, Math.floor(count * LLM_CONFIG.MIN_WORD_COUNT_THRESHOLD));
      if (newWords.length < minWords) {
        throw new Error(`Insufficient new words generated: got ${newWords.length}, expected at least ${minWords}`);
      }

      return newWords;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw this.createLLMError(error, 'Response validation failed', 'INVALID_RESPONSE', false);
      }
      throw this.createLLMError(error instanceof Error ? error : new Error(String(error)), 'Failed to generate words');
    }
  }

  /**
   * Generate sentences - shared implementation
   */
  async generateSentences(word: string, language: string, count: number, topic?: string): Promise<GeneratedSentence[]> {
    // Get known words to include in sentences when possible
    const knownWords = await this.getKnownWords(language);
    const prompt = this.createSentencesPrompt(word, language, count, knownWords, topic);

    try {
      const response = await this.makeRequest(prompt, this.getSentenceGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = SentenceGenerationResponseSchema.safeParse(response);

      if (!parseResult.success) {
        console.error('Sentence validation failed:', parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
        throw new Error(`Invalid response format: ${parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
      }

      const sentences = parseResult.data;

      // If we got significantly fewer sentences than requested, throw an error to trigger retry
      const minSentences = Math.max(1, Math.floor(count * LLM_CONFIG.MIN_SENTENCE_COUNT_THRESHOLD));
      if (sentences.length < minSentences) {
        throw new Error(`Insufficient sentences generated: got ${sentences.length}, expected at least ${minSentences}`);
      }

      return sentences;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw this.createLLMError(error, 'Response validation failed', 'INVALID_RESPONSE', false);
      }
      throw this.createLLMError(error instanceof Error ? error : new Error(String(error)), 'Failed to generate sentences');
    }
  }

  /**
   * Generate context sentences - shared implementation
   */
  async generateContextSentences(sentence: string, translation: string, language: string): Promise<{ contextBefore?: string; contextAfter?: string; contextBeforeTranslation?: string; contextAfterTranslation?: string }> {
    const prompt = this.createContextSentencesPrompt(sentence, translation, language);

    try {
      const response = await this.makeRequest(prompt, this.getSentenceGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = ContextSentenceResponseSchema.safeParse(response);

      if (!parseResult.success) {
        console.warn('Context sentence validation failed:', parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
        return {};
      }

      const context = parseResult.data;

      // Filter out empty strings
      return {
        contextBefore: context.contextBefore && context.contextBefore.trim() ? context.contextBefore.trim() : undefined,
        contextAfter: context.contextAfter && context.contextAfter.trim() ? context.contextAfter.trim() : undefined,
        contextBeforeTranslation: context.contextBeforeTranslation && context.contextBeforeTranslation.trim() ? context.contextBeforeTranslation.trim() : undefined,
        contextAfterTranslation: context.contextAfterTranslation && context.contextAfterTranslation.trim() ? context.contextAfterTranslation.trim() : undefined
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.warn('Context sentence generation validation failed, returning empty context:', error);
        return {};
      }
      // On any error, return empty context instead of throwing
      console.warn('Context sentence generation failed, returning empty context:', error);
      return {};
    }
  }

  /**
   * Get existing words from database to avoid duplicates
   */
  protected async getExistingWords(language: string): Promise<string[]> {
    if (!this.databaseLayer) {
      console.warn('Database layer not set, cannot check for duplicates');
      return [];
    }

    try {
      return await this.databaseLayer.getExistingWordsForDuplicateChecking(language);
    } catch (error) {
      console.error('Failed to get existing words for duplicate checking:', error);
      return [];
    }
  }

  /**
   * Get known words from database to include in sentence generation
   */
  protected async getKnownWords(language: string): Promise<string[]> {
    if (!this.databaseLayer) {
      console.warn('Database layer not set, cannot get known words');
      return [];
    }

    try {
      return await this.databaseLayer.getKnownWordsForSentenceGeneration(language, 50);
    } catch (error) {
      console.error('Failed to get known words for sentence generation:', error);
      return [];
    }
  }

  /**
   * Create prompt for topic word generation
   */
  protected createTopicWordsPrompt(topic: string, language: string, count: number, existingWords: string[] = []): string {
    const example = `  {"word": "${language.toLowerCase()}_word1", "translation": "english_translation1"}`;

    // Create exclusion list for prompt
    const exclusionText = existingWords.length > 0
      ? `\nIMPORTANT: Do NOT include any of these existing words: ${existingWords.slice(0, 50).join(', ')}${existingWords.length > 50 ? '...' : ''}`
      : '';

    // Topic is always specified when this method is called
    return `CRITICAL: You must return exactly ${count} words in a JSON array. No more, no less.
CRITICAL: Return ONLY the JSON array, no explanations or extra text.
CRITICAL: All words must be in their canonical dictionary form (infinitive for verbs, singular for nouns, base form for adjectives).

Task: Generate exactly ${count} different ${language} words related to "${topic}".${exclusionText}

Expected output format (${count} items):
[
${example}
  ...
]

Rules:
1. Must be exactly ${count} words
2. Each word must be different and unique
3. All words should relate to "${topic}"
4. Include nouns, verbs, and adjectives
5. CRITICAL: Use only canonical dictionary forms:
   - Verbs: infinitive form (e.g., "robić" not "robimy", "do" not "does")
   - Nouns: singular form (e.g., "cat" not "cats", "dom" not "domy")
   - Adjectives: base form (e.g., "good" not "better", "dobry" not "dobrzy")
6. Do NOT use any words from the exclusion list above
7. Return ONLY the JSON array, nothing else`;
  }

  /**
   * Create prompt for sentence generation
   */
  protected createSentencesPrompt(word: string, language: string, count: number, knownWords: string[] = [], topic?: string): string {
    const example = `  {
    "sentence": "${language.toLowerCase()}_sentence1_with_${word}",
    "translation": "english_translation1",
    "contextBefore": "${language.toLowerCase()}_context_before1",
    "contextAfter": "${language.toLowerCase()}_context_after1",
    "contextBeforeTranslation": "english_context_before1",
    "contextAfterTranslation": "english_context_after1"
  }`;

    // Create known words guidance
    const knownWordsText = knownWords.length > 0
      ? `\nWhen possible, try to include some of these known words in your sentences (when it makes sense naturally): ${knownWords.join(', ')}`
      : '';

    // Create topic guidance
    const topicText = topic && topic.trim()
      ? `\nIMPORTANT: All sentences should relate to or be contextually relevant to the topic: "${topic.trim()}"`
      : '';

    return `CRITICAL: You must return exactly ${count} sentences in a JSON array. No more, no less.
CRITICAL: Return ONLY the JSON array, no explanations or extra text.

Task: Generate exactly ${count} natural, conversational sentences in ${language} using the word '${word}' (note: this word is in its canonical dictionary form).${knownWordsText}${topicText}

Expected output format (${count} items):
[
${example}
  ...
]

Rules:
1. Must be exactly ${count} sentences
2. Each sentence must contain the word '${word}' or its appropriate conjugated/inflected form
3. The word '${word}' is provided in its canonical dictionary form - use the appropriate conjugated/inflected form that fits naturally in each sentence
4. Keep sentences short (5-15 words)
5. Make them conversational and natural
6. Each sentence must be different
7. When natural and appropriate, include some known words from the provided list
8. Don't force known words if they don't fit naturally
9. Return ONLY the JSON array, nothing else
10. Include contextBefore and contextAfter sentences that provide meaningful context
11. The context sentences should form a natural dialog between two people
12. Provide English translations for all context sentences
13. Context sentences should be short (3-10 words each)
14. The main sentence should make sense when read with its context`;
  }

  /**
   * Create prompt for context sentence generation
   */
  protected createContextSentencesPrompt(sentence: string, translation: string, language: string): string {
    return `CRITICAL: Return ONLY a JSON object, no explanations or extra text.

Task: Given this sentence in ${language} and its English translation, suggest what sentence would make sense BEFORE and AFTER it to provide context for language learning.

Sentence in ${language}: "${sentence}"
English translation: "${translation}"

Expected output format:
{
  "contextBefore": "sentence_before_in_${language.toLowerCase()}",
  "contextAfter": "sentence_after_in_${language.toLowerCase()}",
  "contextBeforeTranslation": "english_translation_of_before",
  "contextAfterTranslation": "english_translation_of_after"
}

Rules:
1. Context sentences should be short (3-10 words each)
2. They should form a natural conversation or narrative flow with the given sentence
3. The contextBefore should logically precede the given sentence, like it's a dialog between two people.
4. The contextAfter should logically follow the given sentence
5. Provide English translations for both context sentences
6. The sentences should make sense when read together: [contextBefore] [given sentence] [contextAfter]
7. Return ONLY the JSON object, nothing else`;
  }

  /**
   * Create LLM error with proper typing
   */
  protected createLLMError(originalError: Error, message: string, code: LLMError['code'] = 'MODEL_ERROR', retryable: boolean = true): LLMError {
    const error = new Error(`${message}: ${originalError.message}`) as LLMError;
    error.code = code;
    error.retryable = retryable;
    return error;
  }

  /**
   * Delay helper for retry logic
   */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

