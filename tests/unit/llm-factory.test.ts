/**
 * Unit tests for LLM Factory
 */

import { LLMFactory } from '../../src/main/llm/llm-factory.js';
import { OllamaClient } from '../../src/main/llm/ollama-client.js';
import { GeminiClient } from '../../src/main/llm/gemini-client.js';

describe('LLMFactory', () => {
  describe('createClient', () => {
    it('should create Ollama client', () => {
      const client = LLMFactory.createClient({
        provider: 'ollama',
        ollamaConfig: { model: 'test-model' }
      });

      expect(client).toBeInstanceOf(OllamaClient);
    });

    it('should create Gemini client with API key', () => {
      const client = LLMFactory.createClient({
        provider: 'gemini',
        geminiConfig: {
          apiKey: 'test-api-key',
          config: { model: 'gemini-1.5-pro' }
        }
      });

      expect(client).toBeInstanceOf(GeminiClient);
    });

    it('should create Gemini client without API key', () => {
      const client = LLMFactory.createClient({
        provider: 'gemini'
      });
      expect(client).toBeInstanceOf(GeminiClient);
    });

    it('should throw error for unsupported provider', () => {
      expect(() => {
        LLMFactory.createClient({
          provider: 'unsupported' as any
        });
      }).toThrow('Unsupported LLM provider: unsupported');
    });
  });

  describe('createOllamaClient', () => {
    it('should create Ollama client with default config', () => {
      const client = LLMFactory.createOllamaClient();
      expect(client).toBeInstanceOf(OllamaClient);
    });

    it('should create Ollama client with custom config', () => {
      const client = LLMFactory.createOllamaClient({ model: 'custom-model' });
      expect(client).toBeInstanceOf(OllamaClient);
    });
  });

  describe('createGeminiClient', () => {
    it('should create Gemini client with API key', () => {
      const client = LLMFactory.createGeminiClient('test-api-key');
      expect(client).toBeInstanceOf(GeminiClient);
    });

    it('should create Gemini client with API key and config', () => {
      const client = LLMFactory.createGeminiClient('test-api-key', { model: 'gemini-1.5-pro' });
      expect(client).toBeInstanceOf(GeminiClient);
    });
  });

  describe('validateConfig', () => {
    it('should validate Ollama config', () => {
      const result = LLMFactory.validateConfig({
        provider: 'ollama'
      });
      expect(result.valid).toBe(true);
    });

    it('should validate Gemini config with API key', () => {
      const result = LLMFactory.validateConfig({
        provider: 'gemini',
        geminiConfig: { apiKey: 'test-api-key' }
      });
      expect(result.valid).toBe(true);
    });

    it('should accept Gemini config without API key', () => {
      const result = LLMFactory.validateConfig({
        provider: 'gemini'
      });
      expect(result.valid).toBe(true);
    });

    it('should accept Gemini config with empty API key', () => {
      const result = LLMFactory.validateConfig({
        provider: 'gemini',
        geminiConfig: { apiKey: '' }
      });
      expect(result.valid).toBe(true);
    });

    it('should reject unsupported provider', () => {
      const result = LLMFactory.validateConfig({
        provider: 'unsupported' as any
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Unsupported LLM provider: unsupported');
    });
  });

  describe('getAvailableProviders', () => {
    it('should return available providers', () => {
      const providers = LLMFactory.getAvailableProviders();
      expect(providers).toEqual(['ollama', 'gemini']);
    });
  });
});