/**
 * Ollama HTTP client for local LLM communication
 */

import { LLMClient, LLMConfig, LLMError } from '../../shared/types/llm.js';
import { LLM_CONFIG } from '../../shared/constants/index.js';
import { cleanLLMResponse } from './utils.js';
import { BaseLLMClient } from './base-llm-client.js';
import { z } from 'zod';

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

export class OllamaClient extends BaseLLMClient implements LLMClient {
  constructor(config: Partial<LLMConfig> = {}) {
    super({
      baseUrl: config.baseUrl || LLM_CONFIG.DEFAULT_BASE_URL,
      model: config.model || LLM_CONFIG.DEFAULT_MODEL,
      wordGenerationModel: config.wordGenerationModel || LLM_CONFIG.DEFAULT_WORD_GENERATION_MODEL,
      sentenceGenerationModel: config.sentenceGenerationModel || LLM_CONFIG.DEFAULT_SENTENCE_GENERATION_MODEL,
      timeout: config.timeout || LLM_CONFIG.DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || LLM_CONFIG.MAX_RETRIES
    });
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
        throw super.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
      }
      throw super.createLLMError(error instanceof Error ? error : new Error(String(error)), 'Failed to generate response');
    }
  }

  protected async makeRequest(prompt: string, model?: string): Promise<any> {
    const selectedModel = model || this.config.model;
    const requestBody: OllamaRequest = {
      model: selectedModel,
      prompt,
      stream: false
      // Removed format: 'json' as it forces single objects instead of arrays
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

        // Clean the response - remove any markdown formatting or extra text
        const cleanResponse = cleanLLMResponse(data.response);

        // Parse JSON
        let parsed: any;
        try {
          parsed = JSON.parse(cleanResponse);
        } catch (parseError) {
          throw new Error(`Invalid JSON response: ${cleanResponse.substring(0, 100)}...`);
        }

        return parsed;

      } catch (error) {
        lastError = error as Error;

        // Don't retry on certain errors
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            throw super.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
          }
          if (error.message.includes('JSON') && !error.message.includes('Insufficient')) {
            throw super.createLLMError(error, 'Invalid response format', 'INVALID_RESPONSE', false);
          }
        }

        // Wait before retry (exponential backoff)
        if (attempt < this.config.maxRetries!) {
          await super.delay(Math.pow(2, attempt - 1) * 1000);
        }
      }
    }

    throw super.createLLMError(lastError!, 'Max retries exceeded', 'CONNECTION_ERROR', false);
  }
}