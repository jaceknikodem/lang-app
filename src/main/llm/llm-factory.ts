/**
 * Factory for creating LLM clients based on configuration
 */

import { LLMClient, LLMConfig } from '../../shared/types/llm.js';
import { OllamaClient } from './ollama-client.js';
import { GeminiClient } from './gemini-client.js';
import { MlxLmClient } from './mlx-lm-client.js';

export type LLMProvider = 'ollama' | 'gemini' | 'mlx-lm';

export interface LLMFactoryConfig {
  provider: LLMProvider;
  ollamaConfig?: Partial<LLMConfig>;
  geminiConfig?: {
    apiKey: string;
    config?: Partial<LLMConfig>;
  };
  mlxLmConfig?: Partial<LLMConfig>;
}

export class LLMFactory {
  /**
   * Create an LLM client based on the provided configuration
   */
  static createClient(config: LLMFactoryConfig): LLMClient {
    switch (config.provider) {
      case 'ollama':
        return new OllamaClient(config.ollamaConfig);

      case 'gemini': {
        const apiKey = config.geminiConfig?.apiKey || '';
        return new GeminiClient(apiKey, config.geminiConfig?.config);
      }

      case 'mlx-lm':
        return new MlxLmClient(config.mlxLmConfig);

      default:
        throw new Error(`Unsupported LLM provider: ${config.provider}`);
    }
  }

  /**
   * Create an Ollama client with default configuration
   */
  static createOllamaClient(config?: Partial<LLMConfig>): OllamaClient {
    return new OllamaClient(config);
  }

  /**
   * Create a Gemini client with API key and optional configuration
   */
  static createGeminiClient(apiKey: string, config?: Partial<LLMConfig>): GeminiClient {
    return new GeminiClient(apiKey, config);
  }

  static createMlxLmClient(config?: Partial<LLMConfig>): MlxLmClient {
    return new MlxLmClient(config);
  }

  /**
   * Validate configuration for a specific provider
   */
  static validateConfig(config: LLMFactoryConfig): { valid: boolean; error?: string } {
    switch (config.provider) {
      case 'ollama':
        // Ollama doesn't require additional validation
        return { valid: true };

      case 'gemini':
        return { valid: true };

      case 'mlx-lm':
        return { valid: true };

      default:
        return { valid: false, error: `Unsupported LLM provider: ${config.provider}` };
    }
  }

  /**
   * Get available providers
   */
  static getAvailableProviders(): LLMProvider[] {
    return ['ollama', 'gemini', 'mlx-lm'];
  }
}
