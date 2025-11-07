/**
 * Unit tests for Gemini client
 */

import { GeminiClient } from '../../src/main/llm/gemini-client.js';
import axios from 'axios';

// Mock axios for testing
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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
      expect(client.getCurrentModel()).toBe('gemini-2.5-flash');
    });

    it('should create client with empty API key', () => {
      const emptyClient = new GeminiClient('');
      expect(emptyClient).toBeInstanceOf(GeminiClient);
      expect(emptyClient.getCurrentModel()).toBe('gemini-2.5-flash');
    });

    it('should use custom configuration', () => {
      const customClient = new GeminiClient(mockApiKey, {
        model: 'gemini-1.5-pro',
        timeout: 60000,
      });
      expect(customClient.getCurrentModel()).toBe('gemini-1.5-pro');
    });
  });

  describe('isAvailable', () => {
    it('should return true when API is accessible', async () => {
      (mockedAxios.get as jest.Mock).mockResolvedValueOnce({
        status: 200,
        data: {},
      });

      const result = await client.isAvailable();
      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          timeout: 5000,
          validateStatus: expect.any(Function),
        })
      );
    });

    it('should return false when API key is empty', async () => {
      const emptyClient = new GeminiClient('');
      const result = await emptyClient.isAvailable();
      expect(result).toBe(false);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should return false when API is not accessible', async () => {
      (mockedAxios.get as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await client.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('getAvailableModels', () => {
    it('should return predefined model list', async () => {
      const models = await client.getAvailableModels();
      expect(models).toEqual([
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
      ]);
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

    it('should use defaults for specialized models when not provided', () => {
      const testClient = new GeminiClient(mockApiKey, { model: 'gemini-1.5-pro' });
      expect(testClient.getWordGenerationModel()).toBe('gemini-2.5-flash-lite'); // Uses default word model
      expect(testClient.getSentenceGenerationModel()).toBe('gemini-2.5-flash'); // Uses default sentence model
    });
  });

  describe('generateResponse', () => {
    it('should generate response successfully', async () => {
      const mockResponse = {
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Test response',
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        },
      };

      (mockedAxios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      const result = await client.generateResponse('Test prompt');
      expect(result).toBe('Test response');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('generateContent'),
        expect.objectContaining({
          contents: expect.arrayContaining([
            expect.objectContaining({
              parts: expect.arrayContaining([
                expect.objectContaining({
                  text: 'Test prompt',
                }),
              ]),
            }),
          ]),
        }),
        expect.objectContaining({
          timeout: expect.any(Number),
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should throw error when API key is missing', async () => {
      const emptyClient = new GeminiClient('');
      await expect(emptyClient.generateResponse('Test prompt')).rejects.toThrow(
        'Gemini API key not configured'
      );
    });

    it('should handle API errors', async () => {
      const axiosError = new Error('Request failed') as any;
      axiosError.isAxiosError = true;
      axiosError.response = {
        status: 400,
        statusText: 'Bad Request',
        data: 'Invalid API key',
      };
      (mockedAxios.post as jest.Mock).mockRejectedValueOnce(axiosError);

      await expect(client.generateResponse('Test prompt')).rejects.toThrow(
        'Failed to generate response'
      );
    });

    it('should handle timeout', async () => {
      const timeoutClient = new GeminiClient(mockApiKey, { timeout: 100 });

      const timeoutError = new Error('timeout of 100ms exceeded') as any;
      timeoutError.isAxiosError = true;
      timeoutError.code = 'ECONNABORTED';
      timeoutError.message = 'timeout of 100ms exceeded';
      (mockedAxios.post as jest.Mock).mockRejectedValueOnce(timeoutError);

      // Mock axios.isAxiosError to return true for this error
      const isAxiosErrorSpy = jest.spyOn(axios, 'isAxiosError').mockImplementation((error) => {
        if (error === timeoutError) {
          return true;
        }
        return false;
      });

      await expect(timeoutClient.generateResponse('Test prompt')).rejects.toThrow(
        'Request timeout'
      );

      // Restore original
      isAxiosErrorSpy.mockRestore();
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
