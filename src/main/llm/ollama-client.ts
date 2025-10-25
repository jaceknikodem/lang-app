/**
 * Ollama HTTP client for local LLM communication
 */

import { GeneratedWord, GeneratedSentence } from '../../shared/types/core.js';
import { LLMClient, LLMConfig, LLMError } from '../../shared/types/llm.js';
import { z } from 'zod';

// Zod schemas for response validation
const GeneratedWordSchema = z.object({
  word: z.string(),
  translation: z.string(),
  frequency: z.enum(['high', 'medium', 'low'])
});

const GeneratedSentenceSchema = z.object({
  sentence: z.string(),
  translation: z.string()
});

const WordGenerationResponseSchema = z.array(GeneratedWordSchema);
const SentenceGenerationResponseSchema = z.array(GeneratedSentenceSchema);

interface OllamaRequest {
  model: string;
  prompt: string;
  stream: false;
  format: 'json';
}

interface OllamaResponse {
  response: string;
  done: boolean;
}

export class OllamaClient implements LLMClient {
  private config: LLMConfig;

  constructor(config: Partial<LLMConfig> = {}) {
    this.config = {
      baseUrl: config.baseUrl || 'http://localhost:11434',
      model: config.model || 'qwen3:8b',
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3
    };
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

  async generateTopicWords(topic: string, language: string, count: number): Promise<GeneratedWord[]> {
    const allWords: GeneratedWord[] = [];
    const maxAttempts = count * 2; // Allow more attempts for individual word generation
    let attempts = 0;

    // Create a set of different prompt variations to encourage variety
    const promptVariations = [
      'common', 'basic', 'essential', 'important', 'useful',
      'frequent', 'popular', 'everyday', 'practical', 'fundamental'
    ];

    while (allWords.length < count && attempts < maxAttempts) {
      attempts++;

      // Use different prompt variations to encourage variety
      const variation = promptVariations[attempts % promptVariations.length];
      const prompt = this.createSingleWordPrompt(topic, language, variation, allWords.map(w => w.word));

      console.log(`Attempt ${attempts}: Requesting 1 word with variation "${variation}" (have ${allWords.length}/${count})`);

      try {
        const response = await this.makeRequest(prompt);
        const parsed = WordGenerationResponseSchema.parse(response);

        // Filter out duplicates based on the word text
        const existingWords = new Set(allWords.map(w => w.word.toLowerCase()));
        const newWords = parsed.filter(word =>
          word.word &&
          word.translation &&
          !existingWords.has(word.word.toLowerCase())
        );

        if (newWords.length > 0) {
          allWords.push(newWords[0]); // Take only the first new word
          console.log(`Got new word: "${newWords[0].word}" (${newWords[0].translation}), total: ${allWords.length}/${count}`);
        } else {
          console.log('No new words received in this attempt');
        }

        // Add a small delay between requests to avoid overwhelming the LLM
        if (allWords.length < count) {
          await this.delay(100);
        }

      } catch (error) {
        console.error(`Attempt ${attempts} failed:`, error);
        // Continue to next attempt unless we've exhausted all attempts
        if (attempts >= maxAttempts && allWords.length === 0) {
          throw this.createLLMError(error instanceof Error ? error : new Error(String(error)), 'Failed to generate any words');
        }
      }
    }

    if (allWords.length === 0) {
      throw this.createLLMError(new Error('No words generated after all attempts'), 'Failed to generate any words');
    }

    console.log(`Final result: ${allWords.length} words generated out of ${count} requested`);
    return allWords;
  }

  async generateSentences(word: string, language: string, count: number): Promise<GeneratedSentence[]> {
    const prompt = this.createSentencesPrompt(word, language, count);

    try {
      const response = await this.makeRequest(prompt);
      const parsed = SentenceGenerationResponseSchema.parse(response);
      return parsed;
    } catch (error) {
      throw this.createLLMError(error instanceof Error ? error : new Error(String(error)), 'Failed to generate sentences');
    }
  }

  private createSingleWordPrompt(topic: string, language: string, variation: string, excludeWords: string[]): string {
    const excludeText = excludeWords.length > 0 ?
      `\n\nDo NOT use these words (already used): ${excludeWords.join(', ')}` : '';

    if (topic.trim()) {
      return `Generate 1 ${variation} ${language} word related to "${topic}".

Return exactly this JSON object:
{"word": "your_word", "translation": "english_translation", "frequency": "high"}${excludeText}

Return only the JSON object, nothing else.`;
    } else {
      return `Generate 1 ${variation} ${language} word for basic conversation.

Return exactly this JSON object:
{"word": "your_word", "translation": "english_translation", "frequency": "high"}${excludeText}

Return only the JSON object, nothing else.`;
    }
  }

  private createTopicWordsPrompt(topic: string, language: string, count: number): string {
    const baseInstructions = `CRITICAL: Return exactly ${count} words as a JSON array. No explanations, no reasoning, just the JSON array.`;

    if (topic.trim()) {
      return `${baseInstructions}

Generate ${count} different ${language} words about "${topic}":

[
${Array.from({ length: count }, (_, i) => `  {"word": "${language.toLowerCase()}_word_${i + 1}", "translation": "english_translation_${i + 1}", "frequency": "high"}`).join(',\n')}
]

Replace the example words above with real ${language} words related to "${topic}". Each word must be different.`;
    } else {
      return `${baseInstructions}

Generate ${count} common ${language} words for basic conversation:

[
${Array.from({ length: count }, (_, i) => `  {"word": "${language.toLowerCase()}_word_${i + 1}", "translation": "english_translation_${i + 1}", "frequency": "high"}`).join(',\n')}
]

Replace the example words above with real high-frequency ${language} words. Each word must be different.`;
    }
  }

  private createSentencesPrompt(word: string, language: string, count: number): string {
    return `Create ${count} natural, short spoken sentences in ${language} using the word '${word}'. 
Each sentence should:
- Be conversational and natural (like something you'd hear in daily speech)
- Be relatively short (5-15 words)
- Clearly demonstrate the meaning and usage of '${word}'
- Include the English translation

Return a JSON array where each object has:
- "sentence": the ${language} sentence containing '${word}'
- "translation": the English translation of the sentence

Example format:
[
  {"sentence": "example sentence with ${word}", "translation": "example English translation"},
  {"sentence": "another sentence with ${word}", "translation": "another English translation"}
]`;
  }

  private async makeRequest(prompt: string): Promise<any> {
    const requestBody: OllamaRequest = {
      model: this.config.model,
      prompt,
      stream: false,
      format: 'json'
    };

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

        // Parse the JSON response
        try {
          const parsed = JSON.parse(data.response);

          // Handle different response structures from LLM
          let actualData = parsed;

          // Check if the LLM wrapped the response in an object with 'response' field
          if (parsed && typeof parsed === 'object' && parsed.response && typeof parsed.response === 'string') {
            console.log('LLM returned wrapped response, extracting inner JSON...');
            try {
              actualData = JSON.parse(parsed.response);
            } catch (innerParseError) {
              console.error('Failed to parse inner response:', parsed.response);
              throw new Error(`Invalid inner JSON response: ${parsed.response}`);
            }
          }

          // Check if the LLM returned reasoning text instead of data
          if (parsed && typeof parsed === 'object' && (parsed.user || parsed.user_query) && !parsed.word && !parsed.sentence && !Array.isArray(parsed)) {
            console.error('LLM returned reasoning text instead of data:', parsed);
            throw new Error('LLM returned reasoning text instead of requested JSON data. Please try again.');
          }

          // If the response is a single object but we expect an array, wrap it
          if (actualData && typeof actualData === 'object' && !Array.isArray(actualData)) {
            // Check if it looks like a word object (has word and translation properties)
            if (actualData.word && actualData.translation) {
              console.log('Wrapping single word object in array:', actualData);
              return [actualData];
            }
            // Check if it looks like a sentence object
            if (actualData.sentence && actualData.translation) {
              console.log('Wrapping single sentence object in array:', actualData);
              return [actualData];
            }
            // If it's an object but doesn't match expected structure, log and throw error
            console.error('Unexpected object structure from LLM:', actualData);
            throw new Error(`Unexpected response structure: expected array or valid word/sentence object, got: ${JSON.stringify(actualData)}`);
          }

          // If it's an array, validate it's not empty
          if (Array.isArray(actualData)) {
            if (actualData.length === 0) {
              throw new Error('LLM returned empty array');
            }
            return actualData;
          }

          // If it's neither an object nor an array, it's invalid
          throw new Error(`Invalid response type: expected array or object, got ${typeof actualData}`);

        } catch (parseError) {
          if (parseError instanceof SyntaxError) {
            console.error('JSON parsing failed for response:', data.response);
            throw new Error(`Invalid JSON response: ${data.response}`);
          }
          throw parseError;
        }

      } catch (error) {
        lastError = error as Error;

        // Don't retry on certain errors
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            throw this.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
          }
          if (error.message.includes('JSON')) {
            throw this.createLLMError(error, 'Invalid response format', 'INVALID_RESPONSE', false);
          }
        }

        // Wait before retry (exponential backoff)
        if (attempt < this.config.maxRetries!) {
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