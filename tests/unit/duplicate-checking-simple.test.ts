/**
 * Simple integration test for duplicate checking functionality
 */

import { OllamaClient } from '../../dist/main/main/llm/ollama-client.js';
import axios from 'axios';

// Mock axios for testing
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Duplicate Checking Simple Integration', () => {
  let ollamaClient: OllamaClient;
  let loggerSpy: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Spy on the logger
    try {
      const { getLogger } = require('../../dist/main/main/utils/logger');
      const logger = getLogger();
      loggerSpy = {
        warn: jest.spyOn(logger, 'warn').mockImplementation(() => {}),
        error: jest.spyOn(logger, 'error').mockImplementation(() => {}),
      };
    } catch {
      loggerSpy = {
        warn: jest.fn(),
        error: jest.fn(),
      };
    }

    ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      timeout: 5000,
      maxRetries: 1,
    });
  });

  describe('Database Layer Integration', () => {
    it('should handle database layer injection correctly', () => {
      const mockDatabase = {
        getAllWords: jest.fn().mockResolvedValue([]),
      };

      expect(() => {
        ollamaClient.setDatabaseLayer(mockDatabase);
      }).not.toThrow();
    });

    it('should work without database layer (graceful fallback)', async () => {
      // Mock axios to simulate Ollama response
      (mockedAxios.post as jest.Mock).mockResolvedValue({
        data: {
          response: JSON.stringify([{ word: 'test', translation: 'test' }]),
        },
      });

      // Should work without database layer
      loggerSpy.warn.mockClear();

      const result = await ollamaClient.generateTopicWords('test', 'Spanish', 1);

      expect(result).toHaveLength(1);
      expect(result[0].word).toBe('test');
      expect(loggerSpy.warn).toHaveBeenCalledWith(
        'Database layer not set, cannot check for duplicates'
      );
    });

    it('should use database layer when available', async () => {
      const mockDatabase = {
        getAllWords: jest
          .fn()
          .mockResolvedValue([{ word: 'existing', language: 'Spanish', translation: 'existing' }]),
        getExistingWordsForDuplicateChecking: jest.fn().mockResolvedValue(['existing']),
        checkWordsExist: jest.fn().mockResolvedValue(new Set(['existing'])),
      };

      ollamaClient.setDatabaseLayer(mockDatabase);

      // Mock axios to simulate Ollama response with duplicate
      (mockedAxios.post as jest.Mock).mockResolvedValue({
        data: {
          response: JSON.stringify([
            { word: 'existing', translation: 'existing' }, // Should be filtered
            { word: 'new', translation: 'new' },
          ]),
        },
      });

      const result = await ollamaClient.generateTopicWords('test', 'Spanish', 2);

      // Should filter out 'existing' and only return 'new'
      expect(result).toHaveLength(1);
      expect(result[0].word).toBe('new');
      expect(mockDatabase.getExistingWordsForDuplicateChecking).toHaveBeenCalledWith(
        'Spanish',
        'test',
        50
      );
      expect(mockDatabase.checkWordsExist).toHaveBeenCalledWith(
        'Spanish',
        ['existing', 'new'],
        'test'
      );
    });

    it('should handle database errors gracefully', async () => {
      const mockDatabase = {
        getAllWords: jest.fn().mockRejectedValue(new Error('Database error')),
        getExistingWordsForDuplicateChecking: jest
          .fn()
          .mockRejectedValue(new Error('Database error')),
        checkWordsExist: jest.fn().mockRejectedValue(new Error('Database error')),
      };

      ollamaClient.setDatabaseLayer(mockDatabase);

      // Mock axios
      (mockedAxios.post as jest.Mock).mockResolvedValue({
        data: {
          response: JSON.stringify([{ word: 'test', translation: 'test' }]),
        },
      });

      loggerSpy.error.mockClear();

      // Should still work despite database error
      const result = await ollamaClient.generateTopicWords('test', 'Spanish', 1);

      expect(result).toHaveLength(1);
      expect(result[0].word).toBe('test');
      expect(loggerSpy.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Failed to get existing words for duplicate checking'
      );
    });
  });

  describe('Prompt Enhancement', () => {
    it('should include existing words in exclusion list', async () => {
      const mockDatabase = {
        getAllWords: jest.fn().mockResolvedValue([
          { word: 'exclude1', language: 'Spanish', translation: 'test' },
          { word: 'exclude2', language: 'Spanish', translation: 'test' },
        ]),
        getExistingWordsForDuplicateChecking: jest.fn().mockResolvedValue(['exclude1', 'exclude2']),
        checkWordsExist: jest.fn().mockResolvedValue(new Set()),
      };

      ollamaClient.setDatabaseLayer(mockDatabase);

      // Mock axios to capture the prompt
      let capturedPrompt = '';
      (mockedAxios.post as jest.Mock).mockImplementation((_url, data) => {
        capturedPrompt = (data as any).prompt;

        return Promise.resolve({
          data: {
            response: JSON.stringify([{ word: 'new', translation: 'new' }]),
          },
        });
      });

      await ollamaClient.generateTopicWords('test', 'Spanish', 1);

      // Verify prompt includes exclusion instructions
      expect(capturedPrompt).toContain('Do NOT include any of these existing words');
      expect(capturedPrompt).toContain('exclude1');
      expect(capturedPrompt).toContain('exclude2');
    });

    it('should handle large exclusion lists by truncating', async () => {
      const existingWords = Array.from({ length: 60 }, (_, i) => `word${i}`);
      // Mock should respect the limit and only return 50 words, but test the safeguard by returning all 60
      // This tests that the prompt creation has a safeguard even if somehow more words are passed
      const mockDatabase = {
        getAllWords: jest
          .fn()
          .mockResolvedValue(
            existingWords.map((w) => ({ word: w, language: 'Spanish', translation: 'test' }))
          ),
        getExistingWordsForDuplicateChecking: jest
          .fn()
          .mockImplementation((_language: string, _topic?: string, limit?: number) => {
            // Respect the limit parameter in the mock
            if (limit) {
              return Promise.resolve(existingWords.slice(0, limit));
            }
            return Promise.resolve(existingWords);
          }),
        checkWordsExist: jest.fn().mockResolvedValue(new Set()),
      };

      ollamaClient.setDatabaseLayer(mockDatabase);

      let capturedPrompt = '';
      (mockedAxios.post as jest.Mock).mockImplementation((_url, data) => {
        capturedPrompt = (data as any).prompt;

        return Promise.resolve({
          data: {
            response: JSON.stringify([{ word: 'new', translation: 'new' }]),
          },
        });
      });

      await ollamaClient.generateTopicWords('test', 'Spanish', 1);

      // Should truncate at 50 words and include "..."
      expect(capturedPrompt).toContain('...');
      expect(capturedPrompt).toContain('word49');
      expect(capturedPrompt).not.toContain('word50');
      // Verify the mock was called with the limit
      expect(mockDatabase.getExistingWordsForDuplicateChecking).toHaveBeenCalledWith(
        'Spanish',
        'test',
        50
      );
    });
  });
});
