/**
 * Ollama HTTP client for local LLM communication
 */

import { LLMClient, LLMConfig } from '../../shared/types/llm.js';
import { LLM_CONFIG } from '../../shared/constants/index.js';
import { cleanLLMResponse } from './utils.js';
import { BaseLLMClient } from './base-llm-client.js';
import { ensureError } from '../../shared/utils/error.js';
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
      sentenceGenerationModel:
        config.sentenceGenerationModel || LLM_CONFIG.DEFAULT_SENTENCE_GENERATION_MODEL,
      timeout: config.timeout || LLM_CONFIG.DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || LLM_CONFIG.MAX_RETRIES,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/tags`, {
        timeout: 5000,
        validateStatus: () => true, // Don't throw on any status
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/api/tags`, {
        timeout: 5000,
      });

      const data = response.data;

      if (!data.models || !Array.isArray(data.models)) {
        return [];
      }

      return data.models
        .map((model: unknown) => {
          if (
            model &&
            typeof model === 'object' &&
            'name' in model &&
            typeof model.name === 'string'
          ) {
            return model.name;
          }
          return '';
        })
        .filter(Boolean);
    } catch (error) {
      this.logger.error({ error }, 'Error fetching available models');
      return [];
    }
  }

  protected async generateResponse(prompt: string, model?: string): Promise<string> {
    try {
      const requestBody: OllamaRequest = {
        model: model || this.config.model,
        prompt,
        stream: false,
      };

      const response = await axios.post<OllamaResponse>(
        `${this.config.baseUrl}/api/generate`,
        requestBody,
        {
          timeout: this.config.timeout || 60000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = response.data;

      if (!data.response) {
        throw new Error('Empty response from Ollama');
      }

      return data.response.trim();
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        (error.code === 'ECONNABORTED' || error.message.includes('timeout'))
      ) {
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
      stream: false,
      // Removed format: 'json' as it forces single objects instead of arrays
    };

    return this.retryWithBackoff(async () => {
      const response = await axios.post<OllamaResponse>(
        `${this.config.baseUrl}/api/generate`,
        requestBody,
        {
          timeout: this.config.timeout || 60000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = response.data;

      if (!data.response) {
        throw new Error('Empty response from Ollama');
      }

      // Clean the response - remove any markdown formatting or extra text
      const cleanResponse = cleanLLMResponse(data.response);

      // Parse JSON
      try {
        return JSON.parse(cleanResponse);
      } catch {
        throw new Error(`Invalid JSON response: ${cleanResponse.substring(0, 100)}...`);
      }
    });
  }
}
