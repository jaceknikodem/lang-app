import { LLMClient, LLMConfig } from '../../shared/types/llm.js';
import { LLM_CONFIG } from '../../shared/constants/index.js';
import { BaseLLMClient } from './base-llm-client.js';
import { ensureError } from '../../shared/utils/error.js';
import axios from 'axios';

interface MlxLmRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: false;
}

interface MlxLmResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class MlxLmClient extends BaseLLMClient implements LLMClient {
  constructor(config: Partial<LLMConfig> = {}) {
    super({
      baseUrl: config.baseUrl || LLM_CONFIG.MLX_LM_DEFAULT_BASE_URL,
      model: config.model || LLM_CONFIG.MLX_LM_DEFAULT_MODEL,
      wordGenerationModel: config.wordGenerationModel || LLM_CONFIG.MLX_LM_DEFAULT_MODEL,
      sentenceGenerationModel: config.sentenceGenerationModel || LLM_CONFIG.MLX_LM_DEFAULT_MODEL,
      timeout: config.timeout || LLM_CONFIG.MLX_LM_DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || LLM_CONFIG.MAX_RETRIES,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/v1/models`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/v1/models`, {
        timeout: 5000,
      });
      const data = response.data;
      if (!data.data || !Array.isArray(data.data)) {
        return [];
      }
      return data.data
        .map((model: unknown) => {
          if (
            model &&
            typeof model === 'object' &&
            'id' in model &&
            typeof (model as any).id === 'string'
          ) {
            return (model as any).id as string;
          }
          return '';
        })
        .filter(Boolean);
    } catch (error) {
      this.logger.error({ error }, 'Error fetching available models from mlx-lm');
      return [];
    }
  }

  protected async fetchText(prompt: string, model?: string): Promise<string> {
    const requestBody: MlxLmRequest = {
      model: model || this.config.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    };
    const response = await axios.post<MlxLmResponse>(
      `${this.config.baseUrl}/v1/chat/completions`,
      requestBody,
      {
        timeout: this.config.timeout || 60000,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from mlx-lm');
    }
    return content;
  }

  protected async generateResponse(prompt: string, model?: string): Promise<string> {
    try {
      return (await this.fetchText(prompt, model)).trim();
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
}
