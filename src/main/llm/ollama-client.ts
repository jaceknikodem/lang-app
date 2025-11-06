/**
 * Ollama HTTP client for local LLM communication
 */

import { LLMClient, LLMConfig, LLMError } from '../../shared/types/llm.js';
import { LLM_CONFIG } from '../../shared/constants/index.js';
import { cleanLLMResponse } from './utils.js';
import { BaseLLMClient } from './base-llm-client.js';
import { ensureError } from '../../shared/utils/error.js';
import { getLogger } from '../utils/logger.js';
import { z } from 'zod';
import axios from 'axios';

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
      const response = await axios.get(`${this.config.baseUrl}/api/tags`, {
        timeout: 5000,
        validateStatus: () => true // Don't throw on any status
      });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/tags`, {
        timeout: 5000
      });

      const data = response.data;

      if (!data.models || !Array.isArray(data.models)) {
        return [];
      }

      return data.models.map((model: any) => model.name || '').filter(Boolean);
    } catch (error) {
      const logger = getLogger();
      logger.error({ error }, 'Error fetching available models');
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

      const response = await axios.post<OllamaResponse>(
        `${this.config.baseUrl}/api/generate`,
        requestBody,
        {
          timeout: this.config.timeout || 60000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      const data = response.data;

      if (!data.response) {
        throw new Error('Empty response from Ollama');
      }

      return data.response.trim();
    } catch (error) {
      if (axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.message.includes('timeout'))) {
        throw super.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
      }
      throw super.createLLMError(ensureError(error), 'Failed to generate response');
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

    const maxRetries = this.config.maxRetries!;
    const minTimeout = 1000; // 1 second minimum
    const maxTimeout = 120000; // 2 minutes maximum
    const factor = 2; // Exponential backoff factor

    let lastError: unknown;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const response = await axios.post<OllamaResponse>(
          `${this.config.baseUrl}/api/generate`,
          requestBody,
          {
            timeout: this.config.timeout || 60000,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        const data = response.data;

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
      } catch (error: unknown) {
        lastError = error;
        
        // Don't retry on certain errors
        if (error instanceof Error) {
          // Timeout errors - don't retry
          if (axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.message.includes('timeout'))) {
            throw super.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
          }
          
          // JSON parsing errors - don't retry (unless it's "Insufficient" which might be retryable)
          if (error.message.includes('JSON') && !error.message.includes('Insufficient')) {
            throw super.createLLMError(error, 'Invalid response format', 'INVALID_RESPONSE', false);
          }

          // If we've exhausted retries, throw the error
          if (attempt > maxRetries) {
            if (axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.message.includes('timeout'))) {
              throw super.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
            }
            throw super.createLLMError(ensureError(error), 'Max retries exceeded', 'CONNECTION_ERROR', false);
          }

          // Use exponential backoff for other errors
          const backoffSeconds = Math.min(Math.max(Math.pow(factor, attempt - 1), minTimeout / 1000), maxTimeout / 1000);
          const logger = getLogger();
          logger.info({ attemptNumber: attempt, retryDelay: backoffSeconds }, `Attempt ${attempt} failed, retrying in ${backoffSeconds}s...`);
          await new Promise(resolve => setTimeout(resolve, backoffSeconds * 1000));
        } else {
          // If we've exhausted retries, throw the error
          if (attempt > maxRetries) {
            throw super.createLLMError(ensureError(error), 'Max retries exceeded', 'CONNECTION_ERROR', false);
          }
          
          // Use exponential backoff for unknown errors
          const backoffSeconds = Math.min(Math.max(Math.pow(factor, attempt - 1), minTimeout / 1000), maxTimeout / 1000);
          const logger = getLogger();
          logger.info({ attemptNumber: attempt, retryDelay: backoffSeconds }, `Attempt ${attempt} failed, retrying in ${backoffSeconds}s...`);
          await new Promise(resolve => setTimeout(resolve, backoffSeconds * 1000));
        }
      }
    }

    // Should never reach here, but TypeScript needs it
    throw super.createLLMError(ensureError(lastError), 'Max retries exceeded', 'CONNECTION_ERROR', false);
  }
}