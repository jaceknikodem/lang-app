/**
 * Ollama HTTP client for local LLM communication
 */

import { GeneratedWord, GeneratedSentence } from '../../shared/types/core.js';
import { LLMClient, LLMConfig, LLMError } from '../../shared/types/llm.js';
import { LLM_CONFIG } from '../../shared/constants/index.js';
import { z } from 'zod';

// Zod schemas for response validation with coercion and fallbacks
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

// Fallback schemas for when LLM returns unexpected formats
const LooseWordSchema = z.object({
  word: z.string().transform(s => s.trim()).pipe(z.string().min(1)),
  translation: z.string().transform(s => s.trim()).pipe(z.string().min(1))
}).transform(obj => ({
  word: obj.word,
  translation: obj.translation
}));

const LooseSentenceSchema = z.object({
  sentence: z.string().transform(s => s.trim()).pipe(z.string().min(1)),
  translation: z.string().transform(s => s.trim()).pipe(z.string().min(1)),
  contextBefore: z.string().optional().transform(s => s?.trim()),
  contextAfter: z.string().optional().transform(s => s?.trim()),
  contextBeforeTranslation: z.string().optional().transform(s => s?.trim()),
  contextAfterTranslation: z.string().optional().transform(s => s?.trim())
});

// More flexible schemas that can handle various response formats
const WordGenerationResponseSchema = z.union([
  z.array(GeneratedWordSchema),
  z.array(LooseWordSchema), // Fallback for loose validation
  GeneratedWordSchema.transform(word => [word]), // Single word -> array
  LooseWordSchema.transform(word => [word]), // Single loose word -> array
  z.object({
    words: z.array(GeneratedWordSchema)
  }).transform(obj => obj.words),
  z.object({
    words: z.array(LooseWordSchema)
  }).transform(obj => obj.words),
  z.object({
    response: z.array(GeneratedWordSchema)
  }).transform(obj => obj.response),
  z.object({
    response: z.array(LooseWordSchema)
  }).transform(obj => obj.response),
  // Handle any array of objects with word/translation properties
  z.array(z.record(z.any())).transform(arr =>
    arr.filter(item => item.word && item.translation).map(item => ({
      word: String(item.word).trim(),
      translation: String(item.translation).trim()
    }))
  )
]);

const SentenceGenerationResponseSchema = z.union([
  z.array(GeneratedSentenceSchema),
  z.array(LooseSentenceSchema), // Fallback for loose validation
  GeneratedSentenceSchema.transform(sentence => [sentence]), // Single sentence -> array
  LooseSentenceSchema.transform(sentence => [sentence]), // Single loose sentence -> array
  z.object({
    sentences: z.array(GeneratedSentenceSchema)
  }).transform(obj => obj.sentences),
  z.object({
    sentences: z.array(LooseSentenceSchema)
  }).transform(obj => obj.sentences),
  z.object({
    response: z.array(GeneratedSentenceSchema)
  }).transform(obj => obj.response),
  z.object({
    response: z.array(LooseSentenceSchema)
  }).transform(obj => obj.response),
  // Handle any array of objects with sentence/translation properties
  z.array(z.record(z.any())).transform(arr =>
    arr.filter(item => item.sentence && item.translation).map(item => ({
      sentence: String(item.sentence).trim(),
      translation: String(item.translation).trim()
    }))
  )
]);

interface OllamaRequest {
  model: string;
  prompt: string;
  stream: false;
  format?: 'json'; // Make format optional
}

interface OllamaResponse {
  response: string;
  done: boolean;
}

export class OllamaClient implements LLMClient {
  private config: LLMConfig;
  private databaseLayer?: any; // Will be injected to check for duplicates

  constructor(config: Partial<LLMConfig> = {}) {
    this.config = {
      baseUrl: config.baseUrl || LLM_CONFIG.DEFAULT_BASE_URL,
      model: config.model || LLM_CONFIG.DEFAULT_MODEL,
      wordGenerationModel: config.wordGenerationModel || LLM_CONFIG.DEFAULT_WORD_GENERATION_MODEL,
      sentenceGenerationModel: config.sentenceGenerationModel || LLM_CONFIG.DEFAULT_SENTENCE_GENERATION_MODEL,
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



  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.models || !Array.isArray(data.models)) {
        return [];
      }

      return data.models.map((model: any) => model.name || '').filter(Boolean);
    } catch (error) {
      console.error('Error fetching available models:', error);
      return [];
    }
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
    return this.config.wordGenerationModel || this.config.model;
  }

  getSentenceGenerationModel(): string {
    return this.config.sentenceGenerationModel || this.config.model;
  }

  async generateTopicWords(topic: string, language: string, count: number): Promise<GeneratedWord[]> {
    // Get existing words to check for duplicates
    const existingWords = await this.getExistingWords(language);
    const existingWordsSet = new Set(existingWords.map(w => w.toLowerCase()));

    const prompt = this.createTopicWordsPrompt(topic, language, count, existingWords);

    try {
      const response = await this.makeRequest(prompt, this.getWordGenerationModel());

      // Debug: Log the response structure
      console.log('Response type:', typeof response);
      console.log('Response is array:', Array.isArray(response));
      console.log('Response keys:', response && typeof response === 'object' ? Object.keys(response) : 'N/A');
      console.log('First item (if array):', Array.isArray(response) && response.length > 0 ? response[0] : 'N/A');

      // Use Zod to parse and validate the response
      const parseResult = WordGenerationResponseSchema.safeParse(response);

      if (!parseResult.success) {
        console.error('=== VALIDATION FAILED ===');
        console.error('Raw response:', JSON.stringify(response, null, 2));
        console.error('Zod errors:', parseResult.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
          received: 'received' in issue ? issue.received : 'unknown'
        })));

        // Try to understand what we got
        if (Array.isArray(response)) {
          console.error('Response is array with length:', response.length);
          if (response.length > 0) {
            console.error('First item structure:', Object.keys(response[0] || {}));
          }
        } else if (response && typeof response === 'object') {
          console.error('Response is object with keys:', Object.keys(response));
        }

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

  async generateSentences(word: string, language: string, count: number, useContextSentences: boolean = false): Promise<GeneratedSentence[]> {
    // Get known words to include in sentences when possible
    const knownWords = await this.getKnownWords(language);
    const prompt = this.createSentencesPrompt(word, language, count, knownWords, useContextSentences);

    try {
      const response = await this.makeRequest(prompt, this.getSentenceGenerationModel());

      // Debug: Log the response structure
      console.log('Sentence response type:', typeof response);
      console.log('Sentence response is array:', Array.isArray(response));
      console.log('Sentence response keys:', response && typeof response === 'object' ? Object.keys(response) : 'N/A');

      // Use Zod to parse and validate the response
      const parseResult = SentenceGenerationResponseSchema.safeParse(response);

      if (!parseResult.success) {
        console.error('=== SENTENCE VALIDATION FAILED ===');
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

  async generateResponse(prompt: string, model?: string): Promise<string> {
    try {
      const requestBody: OllamaRequest = {
        model: model || this.config.model,
        prompt,
        stream: false
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: OllamaResponse = await response.json();

      if (!data.response) {
        throw new Error('Empty response from Ollama');
      }

      return data.response.trim();
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
      // Get all words (learning, known, and ignored) for the language
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
      // Get only known words for the language
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

  private createSentencesPrompt(word: string, language: string, count: number, knownWords: string[] = [], useContextSentences: boolean = false): string {
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

    return `CRITICAL: You must return exactly ${count} sentences in a JSON array. No more, no less.
CRITICAL: Return ONLY the JSON array, no explanations or extra text.

Task: Generate exactly ${count} natural, conversational sentences in ${language} using the word '${word}' (note: this word is in its canonical dictionary form).${knownWordsText}

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

  private async makeRequest(prompt: string, model?: string): Promise<any> {
    const selectedModel = model || this.config.model;
    const requestBody: OllamaRequest = {
      model: selectedModel,
      prompt,
      stream: false
      // Removed format: 'json' as it forces single objects instead of arrays
    };

    // DEBUG: Print the full prompt being sent to Ollama
    console.log('=== OLLAMA PROMPT DEBUG ===');
    console.log('Model:', selectedModel);
    console.log('Full Prompt:');
    console.log(prompt);
    console.log('=== END PROMPT DEBUG ===');

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries!; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(`${this.config.baseUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: OllamaResponse = await response.json();

        if (!data.response) {
          throw new Error('Empty response from Ollama');
        }

        // Clean the response - remove any markdown formatting or extra text
        let cleanResponse = data.response.trim();

        // Remove markdown code blocks if present
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

        console.log('Original response:', data.response);
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