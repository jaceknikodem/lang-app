/**
 * Google Gemini API client for cloud-based LLM communication
 */

import { GeneratedWord, GeneratedSentence } from '../../shared/types/core.js';
import { LLMClient, LLMConfig, LLMError } from '../../shared/types/llm.js';
import { LLM_CONFIG } from '../../shared/constants/index.js';
import { z } from 'zod';

// Zod schemas for response validation (reusing from Ollama client)
const GeneratedWordSchema = z.object({
  word: z.string().min(1, "Word cannot be empty").trim(),
  translation: z.string().min(1, "Translation cannot be empty").trim()
});

const GeneratedSentenceSchema = z.object({
  sentence: z.string().min(1, "Sentence cannot be empty").trim(),
  translation: z.string().min(1, "Translation cannot be empty").trim(),
  contextBefore: z.string().optional(),
  contextAfter: z.string().optional(),
  contextBeforeTranslation: z.string().optional(),
  contextAfterTranslation: z.string().optional()
});

// Flexible schemas for various response formats
const WordGenerationResponseSchema = z.union([
  z.array(GeneratedWordSchema),
  GeneratedWordSchema.transform(word => [word]),
  z.object({
    words: z.array(GeneratedWordSchema)
  }).transform(obj => obj.words),
  z.object({
    response: z.array(GeneratedWordSchema)
  }).transform(obj => obj.response),
  z.array(z.record(z.any())).transform(arr =>
    arr.filter(item => item.word && item.translation).map(item => ({
      word: String(item.word).trim(),
      translation: String(item.translation).trim()
    }))
  )
]);

const SentenceGenerationResponseSchema = z.union([
  z.array(GeneratedSentenceSchema),
  GeneratedSentenceSchema.transform(sentence => [sentence]),
  z.object({
    sentences: z.array(GeneratedSentenceSchema)
  }).transform(obj => obj.sentences),
  z.object({
    response: z.array(GeneratedSentenceSchema)
  }).transform(obj => obj.response),
  z.array(z.record(z.any())).transform(arr =>
    arr.filter(item => item.sentence && item.translation).map(item => ({
      sentence: String(item.sentence).trim(),
      translation: String(item.translation).trim()
    }))
  )
]);

const ContextSentenceSchema = z.object({
  contextBefore: z.string().optional(),
  contextAfter: z.string().optional(),
  contextBeforeTranslation: z.string().optional(),
  contextAfterTranslation: z.string().optional()
});

const ContextSentenceResponseSchema = z.union([
  ContextSentenceSchema,
  z.object({
    response: ContextSentenceSchema
  }).transform(obj => obj.response),
  z.record(z.any()).transform(obj => ({
    contextBefore: obj.contextBefore ? String(obj.contextBefore).trim() : undefined,
    contextAfter: obj.contextAfter ? String(obj.contextAfter).trim() : undefined,
    contextBeforeTranslation: obj.contextBeforeTranslation ? String(obj.contextBeforeTranslation).trim() : undefined,
    contextAfterTranslation: obj.contextAfterTranslation ? String(obj.contextAfterTranslation).trim() : undefined
  }))
]);

interface GeminiConfig extends LLMConfig {
  apiKey: string;
  model: string;
}

interface GeminiRequest {
  contents: Array<{
    parts: Array<{
      text: string;
    }>;
  }>;
  generationConfig?: {
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}

export class GeminiClient implements LLMClient {
  private config: GeminiConfig;
  private databaseLayer?: any;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(apiKey: string, config: Partial<LLMConfig> = {}) {
    this.config = {
      apiKey: apiKey || '',
      baseUrl: config.baseUrl || this.baseUrl,
      model: config.model || LLM_CONFIG.GEMINI_DEFAULT_MODEL,
      wordGenerationModel: config.wordGenerationModel || LLM_CONFIG.GEMINI_DEFAULT_WORD_MODEL,
      sentenceGenerationModel: config.sentenceGenerationModel || LLM_CONFIG.GEMINI_DEFAULT_SENTENCE_MODEL,
      timeout: config.timeout || LLM_CONFIG.GEMINI_DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || LLM_CONFIG.MAX_RETRIES
    };
  }

  /**
   * Set database layer for duplicate checking
   */
  setDatabaseLayer(databaseLayer: any): void {
    this.databaseLayer = databaseLayer;
  }

  /**
   * Update the API key after construction
   */
  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey || '';
  }

  async isAvailable(): Promise<boolean> {
    console.log('Gemini isAvailable check - API key length:', this.config.apiKey?.length || 0);
    
    if (!this.config.apiKey || this.config.apiKey.trim() === '') {
      console.log('Gemini isAvailable: No API key configured');
      return false;
    }
    
    try {
      // Use a simpler endpoint to test API availability
      const url = `${this.baseUrl}?key=${this.config.apiKey}`;
      console.log('Gemini isAvailable: Testing models list endpoint');
      
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(10000) // Increased timeout
      });
      
      console.log('Gemini isAvailable: Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log('Gemini isAvailable: Error response:', errorText);
      }
      
      return response.ok;
    } catch (error) {
      console.log('Gemini isAvailable: Error:', error);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    // Return fixed list of supported Gemini models
    return [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite'
    ];
  }

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

  async generateTopicWords(topic: string, language: string, count: number): Promise<GeneratedWord[]> {
    if (!this.config.apiKey || this.config.apiKey.trim() === '') {
      throw this.createLLMError(
        new Error('Gemini API key is required'), 
        'Gemini API key not configured', 
        'MODEL_ERROR', 
        false
      );
    }

    // Get existing words to check for duplicates
    const existingWords = await this.getExistingWords(language);
    const existingWordsSet = new Set(existingWords.map(w => w.toLowerCase()));

    const prompt = this.createTopicWordsPrompt(topic, language, count, existingWords);

    try {
      const response = await this.makeRequest(prompt, this.getWordGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = WordGenerationResponseSchema.safeParse(response);

      if (!parseResult.success) {
        console.error('=== GEMINI VALIDATION FAILED ===');
        console.error('Raw response:', JSON.stringify(response, null, 2));
        console.error('Zod errors:', parseResult.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
          received: 'received' in issue ? issue.received : 'unknown'
        })));

        throw new Error(`Invalid response format: ${parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
      }

      const words = parseResult.data;

      // Remove duplicates within generated words (case-insensitive)
      const uniqueWords = words.filter((word, index, arr) =>
        arr.findIndex(w => w.word.toLowerCase() === word.word.toLowerCase()) === index
      );

      // Filter out words that already exist in database
      const newWords = uniqueWords.filter(word =>
        !existingWordsSet.has(word.word.toLowerCase())
      );

      console.log(`Generated ${uniqueWords.length} unique words, ${newWords.length} are new (${uniqueWords.length - newWords.length} duplicates filtered)`);

      // If we got significantly fewer new words than requested, throw an error to trigger retry
      if (newWords.length < Math.max(1, Math.floor(count * 0.4))) {
        throw new Error(`Insufficient new words generated: got ${newWords.length}, expected at least ${Math.floor(count * 0.4)}`);
      }

      return newWords;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw this.createLLMError(error, 'Response validation failed', 'INVALID_RESPONSE', false);
      }
      throw this.createLLMError(error instanceof Error ? error : new Error(String(error)), 'Failed to generate words');
    }
  }

  async generateSentences(word: string, language: string, count: number, useContextSentences: boolean = false, topic?: string): Promise<GeneratedSentence[]> {
    if (!this.config.apiKey || this.config.apiKey.trim() === '') {
      throw this.createLLMError(
        new Error('Gemini API key is required'), 
        'Gemini API key not configured', 
        'MODEL_ERROR', 
        false
      );
    }

    // Get known words to include in sentences when possible
    const knownWords = await this.getKnownWords(language);
    const prompt = this.createSentencesPrompt(word, language, count, knownWords, useContextSentences, topic);

    try {
      const response = await this.makeRequest(prompt, this.getSentenceGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = SentenceGenerationResponseSchema.safeParse(response);

      if (!parseResult.success) {
        console.error('=== GEMINI SENTENCE VALIDATION FAILED ===');
        console.error('Raw response:', JSON.stringify(response, null, 2));
        console.error('Zod errors:', parseResult.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
          received: 'received' in issue ? issue.received : 'unknown'
        })));

        throw new Error(`Invalid response format: ${parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
      }

      const sentences = parseResult.data;

      // If we got significantly fewer sentences than requested, throw an error to trigger retry
      if (sentences.length < Math.max(1, Math.floor(count * 0.7))) {
        throw new Error(`Insufficient sentences generated: got ${sentences.length}, expected at least ${Math.floor(count * 0.7)}`);
      }

      return sentences;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw this.createLLMError(error, 'Response validation failed', 'INVALID_RESPONSE', false);
      }
      throw this.createLLMError(error instanceof Error ? error : new Error(String(error)), 'Failed to generate sentences');
    }
  }

  async generateContextSentences(sentence: string, translation: string, language: string): Promise<{ contextBefore?: string; contextAfter?: string; contextBeforeTranslation?: string; contextAfterTranslation?: string }> {
    if (!this.config.apiKey || this.config.apiKey.trim() === '') {
      // Return empty context instead of throwing if API key not configured
      return {};
    }

    const prompt = this.createContextSentencesPrompt(sentence, translation, language);

    try {
      const response = await this.makeRequest(prompt, this.getSentenceGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = ContextSentenceResponseSchema.safeParse(response);

      if (!parseResult.success) {
        console.error('=== GEMINI CONTEXT SENTENCE VALIDATION FAILED ===');
        console.error('Raw response:', JSON.stringify(response, null, 2));
        console.error('Zod errors:', parseResult.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
          received: 'received' in issue ? issue.received : 'unknown'
        })));

        // Return empty context on validation failure instead of throwing
        console.warn('Context sentence generation validation failed, returning empty context');
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

  async generateResponse(prompt: string, model?: string): Promise<string> {
    if (!this.config.apiKey || this.config.apiKey.trim() === '') {
      throw this.createLLMError(
        new Error('Gemini API key is required'), 
        'Gemini API key not configured', 
        'MODEL_ERROR', 
        false
      );
    }

    try {
      const selectedModel = model || this.config.model;
      const requestBody: GeminiRequest = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.baseUrl}/${selectedModel}:generateContent?key=${this.config.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const data: GeminiResponse = await response.json();

      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('No response candidates from Gemini');
      }

      const candidate = data.candidates[0];
      if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
        throw new Error('Empty response from Gemini');
      }

      return candidate.content.parts[0].text.trim();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw this.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
      }
      throw this.createLLMError(error instanceof Error ? error : new Error(String(error)), 'Failed to generate response');
    }
  }

  /**
   * Get existing words from database to avoid duplicates
   */
  private async getExistingWords(language: string): Promise<string[]> {
    if (!this.databaseLayer) {
      console.warn('Database layer not set, cannot check for duplicates');
      return [];
    }

    try {
      const allWords = await this.databaseLayer.getAllWords(true, true);
      return allWords
        .filter((word: any) => word.language === language)
        .map((word: any) => word.word);
    } catch (error) {
      console.error('Failed to get existing words for duplicate checking:', error);
      return [];
    }
  }

  /**
   * Get known words from database to include in sentence generation
   */
  private async getKnownWords(language: string): Promise<string[]> {
    if (!this.databaseLayer) {
      console.warn('Database layer not set, cannot get known words');
      return [];
    }

    try {
      const allWords = await this.databaseLayer.getAllWords(true, false);
      const knownWords = allWords
        .filter((word: any) => word.language === language && word.known === true)
        .map((word: any) => word.word);

      // Limit to 50 words and randomize selection if more than 50
      if (knownWords.length > 50) {
        const shuffled = [...knownWords].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, 50);
      }

      return knownWords;
    } catch (error) {
      console.error('Failed to get known words for sentence generation:', error);
      return [];
    }
  }

  private createTopicWordsPrompt(topic: string, language: string, count: number, existingWords: string[] = []): string {
    const examples = Array.from({ length: count }, (_, i) =>
      `  {"word": "${language.toLowerCase()}_word${i + 1}", "translation": "english_translation${i + 1}"}`
    ).join(',\n');

    const baseInstructions = `CRITICAL: You must return exactly ${count} words in a JSON array. No more, no less.
CRITICAL: Return ONLY the JSON array, no explanations or extra text.
CRITICAL: All words must be in their canonical dictionary form (infinitive for verbs, singular for nouns, base form for adjectives).`;

    // Create exclusion list for prompt
    const exclusionText = existingWords.length > 0
      ? `\nIMPORTANT: Do NOT include any of these existing words: ${existingWords.slice(0, 50).join(', ')}${existingWords.length > 50 ? '...' : ''}`
      : '';

    if (topic.trim()) {
      return `${baseInstructions}

Task: Generate exactly ${count} different ${language} words related to "${topic}".${exclusionText}

Expected output format (${count} items):
[
${examples}
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
7. Do NOT use any words from the exclusion list above
8. Return ONLY the JSON array, nothing else`;
    } else {
      return `${baseInstructions}

Task: Generate exactly ${count} different ${language} words for basic conversation.${exclusionText}

Expected output format (${count} items):
[
${examples}
]

Rules:
1. Must be exactly ${count} words
2. Each word must be different and unique
3. Focus on essential everyday vocabulary
4. Include nouns, verbs, and adjectives
5. CRITICAL: Use only canonical dictionary forms:
   - Verbs: infinitive form (e.g., "robić" not "robimy", "do" not "does")
   - Nouns: singular form (e.g., "cat" not "cats", "dom" not "domy")
   - Adjectives: base form (e.g., "good" not "better", "dobry" not "dobrzy")
6. Do NOT use any words from the exclusion list above
7. Return ONLY the JSON array, nothing else`;
    }
  }

  private createSentencesPrompt(word: string, language: string, count: number, knownWords: string[] = [], useContextSentences: boolean = false, topic?: string): string {
    let examples: string;
    let contextInstructions = '';

    if (useContextSentences) {
      examples = Array.from({ length: count }, (_, i) =>
        `  {
    "sentence": "${language.toLowerCase()}_sentence${i + 1}_with_${word}",
    "translation": "english_translation${i + 1}",
    "contextBefore": "${language.toLowerCase()}_context_before${i + 1}",
    "contextAfter": "${language.toLowerCase()}_context_after${i + 1}",
    "contextBeforeTranslation": "english_context_before${i + 1}",
    "contextAfterTranslation": "english_context_after${i + 1}"
  }`
      ).join(',\n');

      contextInstructions = `
10. Include contextBefore and contextAfter sentences that provide meaningful context
11. The context sentences should form a natural conversation or narrative flow
12. Provide English translations for all context sentences
13. Context sentences should be short (3-10 words each)
14. The main sentence should make sense when read with its context`;
    } else {
      examples = Array.from({ length: count }, (_, i) =>
        `  {"sentence": "${language.toLowerCase()}_sentence${i + 1}_with_${word}", "translation": "english_translation${i + 1}"}`
      ).join(',\n');
    }

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
${examples}
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
9. Return ONLY the JSON array, nothing else${contextInstructions}`;
  }

  private createContextSentencesPrompt(sentence: string, translation: string, language: string): string {
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
3. The contextBefore should logically precede the given sentence
4. The contextAfter should logically follow the given sentence
5. Provide English translations for both context sentences
6. The sentences should make sense when read together: [contextBefore] [given sentence] [contextAfter]
7. Return ONLY the JSON object, nothing else`;
  }

  private async makeRequest(prompt: string, model?: string): Promise<any> {
    const selectedModel = model || this.config.model;
    const requestBody: GeminiRequest = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.3, // Lower temperature for more consistent JSON output
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048
      }
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries!; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(`${this.baseUrl}/${selectedModel}:generateContent?key=${this.config.apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
        }

        const data: GeminiResponse = await response.json();

        if (!data.candidates || data.candidates.length === 0) {
          throw new Error('No response candidates from Gemini');
        }

        const candidate = data.candidates[0];
        if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
          throw new Error('Empty response from Gemini');
        }

        let cleanResponse = candidate.content.parts[0].text.trim();

        // Clean the response - remove any markdown formatting or extra text
        cleanResponse = cleanResponse.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/i, '');

        // Remove common LLM prefixes
        cleanResponse = cleanResponse.replace(/^(Here's|Here is|The|Response:|JSON:)\s*/i, '');

        // Remove any text before the first [ or {
        const jsonStart = cleanResponse.search(/[\[{]/);
        if (jsonStart > 0) {
          cleanResponse = cleanResponse.substring(jsonStart);
        }

        // Remove any text after the last ] or }
        const jsonEnd = Math.max(
          cleanResponse.lastIndexOf(']'),
          cleanResponse.lastIndexOf('}')
        );
        if (jsonEnd >= 0 && jsonEnd < cleanResponse.length - 1) {
          cleanResponse = cleanResponse.substring(0, jsonEnd + 1);
        }

        console.log('Original response:', candidate.content.parts[0].text);
        console.log('Cleaned response:', cleanResponse);

        // Parse JSON
        let parsed: any;
        try {
          parsed = JSON.parse(cleanResponse);
        } catch (parseError) {
          console.error('JSON parsing failed for response:', cleanResponse);
          throw new Error(`Invalid JSON response: ${cleanResponse}...`);
        }

        return parsed;

      } catch (error) {
        lastError = error as Error;

        // Don't retry on certain errors
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            throw this.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
          }
          if (error.message.includes('JSON') && !error.message.includes('Insufficient')) {
            throw this.createLLMError(error, 'Invalid response format', 'INVALID_RESPONSE', false);
          }
        }

        // Wait before retry (exponential backoff)
        if (attempt < this.config.maxRetries!) {
          console.log(`Attempt ${attempt} failed, retrying in ${Math.pow(2, attempt - 1)}s...`);
          await this.delay(Math.pow(2, attempt - 1) * 1000);
        }
      }
    }

    throw this.createLLMError(lastError!, 'Max retries exceeded', 'CONNECTION_ERROR', false);
  }

  private createLLMError(originalError: Error, message: string, code: LLMError['code'] = 'MODEL_ERROR', retryable: boolean = true): LLMError {
    const error = new Error(`${message}: ${originalError.message}`) as LLMError;
    error.code = code;
    error.retryable = retryable;
    return error;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}