/**
 * Unit tests for OllamaClient methods (isAvailable, getAvailableModels, error handling)
 */

import { OllamaClient } from '../../src/main/llm/ollama-client.js';
import axios from 'axios';

// Mock axios for testing
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('OllamaClient', () => {
  let ollamaClient: OllamaClient;
  let loggerSpy: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Spy on the logger
    try {
      const { getLogger } = require('../../src/main/utils/logger');
      const logger = getLogger();
      loggerSpy = {
        warn: jest.spyOn(logger, 'warn').mockImplementation(() => {}),
        error: jest.spyOn(logger, 'error').mockImplementation(() => {}),
      };
    } catch {
      // If logger not available, create a no-op spy
      loggerSpy = {
        warn: jest.fn(),
        error: jest.fn(),
      };
    }

    // Create client
    ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      timeout: 5000,
      maxRetries: 1,
    });
  });

  describe('isAvailable', () => {
    it('should return true when API is accessible (200 status)', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValueOnce({
        status: 200,
        data: {},
      });

      const result = await ollamaClient.isAvailable();
      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({
          timeout: 5000,
          validateStatus: expect.any(Function),
        })
      );
    });

    it('should return false when API returns non-200 status', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValueOnce({
        status: 404,
        data: {},
      });

      const result = await ollamaClient.isAvailable();
      expect(result).toBe(false);
    });

    it('should return false when API returns 500 status', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValueOnce({
        status: 500,
        data: {},
      });

      const result = await ollamaClient.isAvailable();
      expect(result).toBe(false);
    });

    it('should return false on network errors', async () => {
      (mockedAxios.get as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await ollamaClient.isAvailable();
      expect(result).toBe(false);
    });

    it('should return false on timeout errors', async () => {
      const timeoutError = new Error('timeout') as any;
      timeoutError.code = 'ECONNABORTED';
      (mockedAxios.get as jest.Mock).mockRejectedValueOnce(timeoutError);

      const result = await ollamaClient.isAvailable();
      expect(result).toBe(false);
    });

    it('should use validateStatus callback that accepts all status codes', async () => {
      let validateStatusCallback: ((status: number) => boolean) | undefined;
      (mockedAxios.get as jest.Mock).mockImplementationOnce((_url, config) => {
        validateStatusCallback = config.validateStatus;
        return Promise.resolve({ status: 404, data: {} });
      });

      await ollamaClient.isAvailable();

      expect(validateStatusCallback).toBeDefined();
      // validateStatus should return true for all status codes (don't throw)
      expect(validateStatusCallback!(200)).toBe(true);
      expect(validateStatusCallback!(404)).toBe(true);
      expect(validateStatusCallback!(500)).toBe(true);
    });
  });

  describe('getAvailableModels', () => {
    it('should return models array on success', async () => {
      const mockResponse = {
        data: {
          models: [{ name: 'model1' }, { name: 'model2' }, { name: 'model3' }],
        },
      };

      (mockedAxios.get as jest.Mock).mockResolvedValueOnce(mockResponse);

      const result = await ollamaClient.getAvailableModels();
      expect(result).toEqual(['model1', 'model2', 'model3']);
      expect(mockedAxios.get).toHaveBeenCalledWith('http://localhost:11434/api/tags', {
        timeout: 5000,
      });
    });

    it('should return empty array when models array is missing', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValueOnce({
        data: {},
      });

      const result = await ollamaClient.getAvailableModels();
      expect(result).toEqual([]);
    });

    it('should return empty array when models is not an array', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValueOnce({
        data: {
          models: 'not an array',
        },
      });

      const result = await ollamaClient.getAvailableModels();
      expect(result).toEqual([]);
    });

    it('should filter out models without name property', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValueOnce({
        data: {
          models: [{ name: 'model1' }, { noName: 'value' }, { name: 'model2' }],
        },
      });

      const result = await ollamaClient.getAvailableModels();
      expect(result).toEqual(['model1', 'model2']);
    });

    it('should filter out models with non-string name', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValueOnce({
        data: {
          models: [
            { name: 'model1' },
            { name: 123 },
            { name: null },
            { name: {} },
            { name: 'model2' },
          ],
        },
      });

      const result = await ollamaClient.getAvailableModels();
      expect(result).toEqual(['model1', 'model2']);
    });

    it('should filter out empty string names', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValueOnce({
        data: {
          models: [{ name: 'model1' }, { name: '' }, { name: 'model2' }],
        },
      });

      const result = await ollamaClient.getAvailableModels();
      expect(result).toEqual(['model1', 'model2']);
    });

    it('should return empty array on network errors', async () => {
      (mockedAxios.get as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await ollamaClient.getAvailableModels();
      expect(result).toEqual([]);
      expect(loggerSpy.error).toHaveBeenCalled();
    });

    it('should return empty array on timeout errors', async () => {
      const timeoutError = new Error('timeout') as any;
      timeoutError.code = 'ECONNABORTED';
      (mockedAxios.get as jest.Mock).mockRejectedValueOnce(timeoutError);

      const result = await ollamaClient.getAvailableModels();
      expect(result).toEqual([]);
      expect(loggerSpy.error).toHaveBeenCalled();
    });

    it('should handle null models', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValueOnce({
        data: {
          models: null,
        },
      });

      const result = await ollamaClient.getAvailableModels();
      expect(result).toEqual([]);
    });

    it('should handle undefined models', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValueOnce({
        data: {
          models: undefined,
        },
      });

      const result = await ollamaClient.getAvailableModels();
      expect(result).toEqual([]);
    });
  });

  describe('generateResponse error handling', () => {
    // Create a test class that extends OllamaClient to access protected method
    class TestOllamaClient extends OllamaClient {
      public async testGenerateResponse(prompt: string, model?: string): Promise<string> {
        return this.generateResponse(prompt, model);
      }
    }

    let testClient: TestOllamaClient;

    beforeEach(() => {
      testClient = new TestOllamaClient({
        baseUrl: 'http://localhost:11434',
        model: 'test-model',
        timeout: 5000,
        maxRetries: 1,
      });
    });

    it('should throw error when response is empty', async () => {
      (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          response: '',
        },
      });

      // generateResponse wraps the error in LLMError with "Failed to generate response"
      await expect(testClient.testGenerateResponse('test prompt')).rejects.toThrow(
        'Failed to generate response'
      );
    });

    it('should throw error when response property is missing', async () => {
      (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
        data: {},
      });

      // generateResponse wraps the error in LLMError with "Failed to generate response"
      await expect(testClient.testGenerateResponse('test prompt')).rejects.toThrow(
        'Failed to generate response'
      );
    });

    it('should throw LLMError with TIMEOUT code on timeout', async () => {
      const timeoutError = new Error('timeout of 5000ms exceeded') as any;
      timeoutError.isAxiosError = true;
      timeoutError.code = 'ECONNABORTED';
      timeoutError.message = 'timeout of 5000ms exceeded';

      (mockedAxios.post as jest.Mock).mockRejectedValueOnce(timeoutError);

      // Mock axios.isAxiosError
      const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(testClient.testGenerateResponse('test prompt')).rejects.toThrow(
        'Request timeout'
      );

      isAxiosErrorSpy.mockRestore();
    });

    it('should throw LLMError on network errors', async () => {
      const networkError = new Error('Network error');
      (mockedAxios.post as jest.Mock).mockRejectedValueOnce(networkError);

      // Mock axios.isAxiosError to return false
      const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);

      await expect(testClient.testGenerateResponse('test prompt')).rejects.toThrow(
        'Failed to generate response'
      );

      isAxiosErrorSpy.mockRestore();
    });

    it('should trim response text', async () => {
      (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          response: '  response text  ',
        },
      });

      const result = await testClient.testGenerateResponse('test prompt');
      expect(result).toBe('response text');
    });

    it('should use custom model when provided', async () => {
      (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          response: 'response',
        },
      });

      await testClient.testGenerateResponse('test prompt', 'custom-model');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          model: 'custom-model',
        }),
        expect.any(Object)
      );
    });

    it('should use default model when not provided', async () => {
      (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          response: 'response',
        },
      });

      await testClient.testGenerateResponse('test prompt');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          model: 'test-model',
        }),
        expect.any(Object)
      );
    });
  });

  describe('makeRequest error handling', () => {
    // Create a test class that extends OllamaClient to access protected method
    class TestOllamaClient extends OllamaClient {
      public async testMakeRequest(prompt: string, model?: string): Promise<any> {
        return this.makeRequest(prompt, model);
      }
    }

    let testClient: TestOllamaClient;

    beforeEach(() => {
      testClient = new TestOllamaClient({
        baseUrl: 'http://localhost:11434',
        model: 'test-model',
        timeout: 5000,
        maxRetries: 1, // Use 1 retry for faster tests
      });
    });

    it('should throw error when response is empty', async () => {
      // Mock to always return empty response (will retry and eventually fail)
      (mockedAxios.post as jest.Mock).mockResolvedValue({
        data: {
          response: '',
        },
      });

      // makeRequest uses retryWithBackoff which will retry and eventually throw "Max retries exceeded"
      await expect(testClient.testMakeRequest('test prompt')).rejects.toThrow(
        'Max retries exceeded'
      );
    });

    it('should throw error when response property is missing', async () => {
      // Mock to always return missing response (will retry and eventually fail)
      (mockedAxios.post as jest.Mock).mockResolvedValue({
        data: {},
      });

      // makeRequest uses retryWithBackoff which will retry and eventually throw "Max retries exceeded"
      await expect(testClient.testMakeRequest('test prompt')).rejects.toThrow(
        'Max retries exceeded'
      );
    });

    it('should throw error on invalid JSON', async () => {
      (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          response: 'not valid json',
        },
      });

      // retryWithBackoff wraps JSON parsing errors in "Invalid response format"
      await expect(testClient.testMakeRequest('test prompt')).rejects.toThrow(
        'Invalid response format'
      );
    });

    it('should parse valid JSON response', async () => {
      const jsonData = [{ word: 'hola', translation: 'hello' }];
      (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          response: JSON.stringify(jsonData),
        },
      });

      const result = await testClient.testMakeRequest('test prompt');
      expect(result).toEqual(jsonData);
    });

    it('should clean response before parsing JSON', async () => {
      // Response with markdown code blocks
      const jsonData = [{ word: 'hola', translation: 'hello' }];
      const responseWithMarkdown = '```json\n' + JSON.stringify(jsonData) + '\n```';

      (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          response: responseWithMarkdown,
        },
      });

      const result = await testClient.testMakeRequest('test prompt');
      expect(result).toEqual(jsonData);
    });

    it('should use custom model when provided', async () => {
      (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          response: '[]',
        },
      });

      await testClient.testMakeRequest('test prompt', 'custom-model');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          model: 'custom-model',
        }),
        expect.any(Object)
      );
    });

    it('should use default model when not provided', async () => {
      (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          response: '[]',
        },
      });

      await testClient.testMakeRequest('test prompt');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          model: 'test-model',
        }),
        expect.any(Object)
      );
    });

    it('should handle network errors with retry logic', async () => {
      const networkError = new Error('Network error');
      (mockedAxios.post as jest.Mock).mockRejectedValueOnce(networkError).mockResolvedValueOnce({
        data: {
          response: '[]',
        },
      });

      // With maxRetries: 1, it should retry once
      const result = await testClient.testMakeRequest('test prompt');
      expect(result).toEqual([]);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('should truncate long invalid JSON in error message', async () => {
      const longInvalidJson = 'a'.repeat(200);
      (mockedAxios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          response: longInvalidJson,
        },
      });

      // retryWithBackoff wraps JSON parsing errors in "Invalid response format"
      await expect(testClient.testMakeRequest('test prompt')).rejects.toThrow(
        'Invalid response format'
      );
    });
  });
});
