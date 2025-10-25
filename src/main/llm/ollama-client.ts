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

  async generateTopicWords(topic: string, language: string, count: number): Promise<GeneratedWord[]> {
    const prompt = this.createTopicWordsPrompt(topic, language, count);
    
    try {
      const response = await this.makeRequest(prompt);
      const parsed = WordGenerationResponseSchema.parse(response);
      return parsed;
    } catch (error) {
      throw this.createLLMError(error instanceof Error ? error : new Error(String(error)), 'Failed to generate topic words');
    }
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

  private createTopicWordsPrompt(topic: string, language: string, count: number): string {
    if (topic.trim()) {
      return `Generate ${count} common spoken words about '${topic}' in ${language}. 
Return a JSON array where each object has:
- "word": the ${language} word
- "translation": the English translation
- "frequency": "high", "medium", or "low" based on how commonly the word is used in everyday speech

Focus on practical vocabulary that would be useful for conversation. Ensure all words are relevant to the topic "${topic}".

Example format:
[
  {"word": "example_word", "translation": "example translation", "frequency": "high"},
  {"word": "another_word", "translation": "another translation", "frequency": "medium"}
]`;
    } else {
      return `Generate ${count} high-frequency common spoken words in ${language} that are essential for basic conversation.
Return a JSON array where each object has:
- "word": the ${language} word  
- "translation": the English translation
- "frequency": "high", "medium", or "low" based on how commonly the word is used in everyday speech

Focus on the most practical and frequently used vocabulary for daily conversation.

Example format:
[
  {"word": "example_word", "translation": "example translation", "frequency": "high"},
  {"word": "another_word", "translation": "another translation", "frequency": "medium"}
]`;
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
          
          // If the response is a single object but we expect an array, wrap it
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            // Check if it looks like a word/sentence object
            if (parsed.word || parsed.sentence) {
              return [parsed];
            }
          }
          
          return parsed;
        } catch (parseError) {
          throw new Error(`Invalid JSON response: ${data.response}`);
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