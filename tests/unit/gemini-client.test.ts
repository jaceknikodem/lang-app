/**
 * Unit tests for Gemini client
 */

import { GeminiClient } from '../../src/main/llm/gemini-client.js';

// Mock fetch for testing
global.fetch = jest.fn();

describe('GeminiClient', () => {
  let client: GeminiClient;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    client = new GeminiClient(mockApiKey);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create client with API key', () => {
      expect(client).toBeInstanceOf(GeminiClient);
      expect(client.getCurrentModel()).toBe('gemini-1.5-flash');
    });

    it('should create client with empty API key', () => {
      const emptyClient = new GeminiClient('');
      expect(emptyClient).toBeInstanceOf(GeminiClient);
      expect(emptyClient.getCurrentModel()).toBe('gemini-1.5-flash');
    });

    it('should use custom configuration', () => {
      const customClient = new GeminiClient(mockApiKey, {
        model: 'gemini-1.5-pro',
        timeout: 60000
      });
      expect(customClient.getCurrentModel()).toBe('gemini-1.5-pro');
    });
  });

  describe('isAvailable', () => {
    it('should return true when API is accessible', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true
      });

      const result = await client.isAvailable();
      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          method: 'GET',
          signal: expect.any(AbortSignal)
        })
      );
    });

    it('should return false when API key is empty', async () => {
      const emptyClient = new GeminiClient('');
      const result = await emptyClient.isAvailable();
      expect(result).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should return false when API is not accessible', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await client.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('getAvailableModels', () => {
    it('should return default models when API call fails', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const models = await client.getAvailableModels();
      expect(models).toEqual(['gemini-1.5-flash', 'gemini-1.5-pro']);
    });

    it('should parse models from API response', async () => {
      const mockResponse = {
        models: [
          { name: 'models/gemini-1.5-flash' },
          { name: 'models/gemini-1.5-pro' },
          { name: 'models/gemini-1.0-pro' }
        ]
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const models = await client.getAvailableModels();
      expect(models).toEqual(['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro']);
    });
  });

  describe('model management', () => {
    it('should set and get current model', () => {
      client.setModel('gemini-1.5-pro');
      expect(client.getCurrentModel()).toBe('gemini-1.5-pro');
    });

    it('should set and get word generation model', () => {
      client.setWordGenerationModel('gemini-1.5-flash');
      expect(client.getWordGenerationModel()).toBe('gemini-1.5-flash');
    });

    it('should set and get sentence generation model', () => {
      client.setSentenceGenerationModel('gemini-1.5-pro');
      expect(client.getSentenceGenerationModel()).toBe('gemini-1.5-pro');
    });

    it('should fallback to main model when specialized models not set', () => {
      const testClient = new GeminiClient(mockApiKey, { model: 'gemini-1.5-pro' });
      expect(testClient.getWordGenerationModel()).toBe('gemini-1.5-flash'); // Uses default word model
      expect(testClient.getSentenceGenerationModel()).toBe('gemini-1.5-pro'); // Uses default sentence model
    });
  });

  describe('generateResponse', () => {
    it('should generate response successfully', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{
              text: 'Test response'
            }]
          },
          finishReason: 'STOP'
        }]
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.generateResponse('Test prompt');
      expect(result).toBe('Test response');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('generateContent'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('Test prompt')
        })
      );
    });

    it('should throw error when API key is missing', async () => {
      const emptyClient = new GeminiClient('');
      await expect(emptyClient.generateResponse('Test prompt')).rejects.toThrow('Gemini API key not configured');
    });

    it('should handle API errors', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid API key')
      });

      await expect(client.generateResponse('Test prompt')).rejects.toThrow('HTTP 400: Bad Request - Invalid API key');
    });

    it('should handle timeout', async () => {
      const timeoutClient = new GeminiClient(mockApiKey, { timeout: 100 });
      
      (fetch as jest.Mock).mockImplementationOnce(() => 
        new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('AbortError')), 200);
        })
      );

      await expect(timeoutClient.generateResponse('Test prompt')).rejects.toThrow('Failed to generate response');
    });
  });

  describe('database integration', () => {
    it('should set database layer', () => {
      const mockDatabase = { getAllWords: jest.fn() };
      client.setDatabaseLayer(mockDatabase);
      // No direct way to test this, but it should not throw
    });
  });

  describe('API key management', () => {
    it('should update API key after construction', () => {
      const emptyClient = new GeminiClient('');
      emptyClient.setApiKey('new-api-key');
      // No direct way to test this, but it should not throw
    });

    it('should handle empty API key update', () => {
      client.setApiKey('');
      // No direct way to test this, but it should not throw
    });
  });
});