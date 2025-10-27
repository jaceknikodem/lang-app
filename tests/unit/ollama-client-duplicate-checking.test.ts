/**
 * Unit tests for OllamaClient duplicate checking functionality
 */

import { OllamaClient } from '../../dist/main/main/llm/ollama-client.js';
import { GeneratedWord } from '../../dist/main/shared/types/core.js';

// Mock database layer interface
interface MockDatabaseLayer {
  getAllWords(includeKnown?: boolean, includeIgnored?: boolean): Promise<any[]>;
}

describe('OllamaClient Duplicate Checking', () => {
  let ollamaClient: OllamaClient;
  let mockDatabaseLayer: MockDatabaseLayer;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock fetch globally
    mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = mockFetch;

    // Create client
    ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      timeout: 5000,
      maxRetries: 1
    });

    // Create mock database layer
    mockDatabaseLayer = {
      getAllWords: jest.fn()
    };
  });

  describe('setDatabaseLayer', () => {
    it('should set the database layer successfully', () => {
      expect(() => {
        ollamaClient.setDatabaseLayer(mockDatabaseLayer);
      }).not.toThrow();
    });
  });

  describe('getExistingWords', () => {
    it('should return empty array when no database layer is set', async () => {
      // Don't set database layer
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Access private method through any cast for testing
      const existingWords = await (ollamaClient as any).getExistingWords('Spanish');
      
      expect(existingWords).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith('Database layer not set, cannot check for duplicates');
      
      consoleSpy.mockRestore();
    });

    it('should return words for the specified language', async () => {
      const mockWords = [
        { id: 1, word: 'hola', language: 'Spanish', translation: 'hello' },
        { id: 2, word: 'casa', language: 'Spanish', translation: 'house' },
        { id: 3, word: 'bonjour', language: 'French', translation: 'hello' }
      ];

      mockDatabaseLayer.getAllWords = jest.fn().mockResolvedValue(mockWords);
      ollamaClient.setDatabaseLayer(mockDatabaseLayer);

      const existingWords = await (ollamaClient as any).getExistingWords('Spanish');

      expect(mockDatabaseLayer.getAllWords).toHaveBeenCalledWith(true, true);
      expect(existingWords).toEqual(['hola', 'casa']);
    });

    it('should handle database errors gracefully', async () => {
      mockDatabaseLayer.getAllWords = jest.fn().mockRejectedValue(new Error('Database error'));
      ollamaClient.setDatabaseLayer(mockDatabaseLayer);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const existingWords = await (ollamaClient as any).getExistingWords('Spanish');
      
      expect(existingWords).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith('Failed to get existing words for duplicate checking:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });
  });

  describe('createTopicWordsPrompt', () => {
    it('should include exclusion list when existing words are provided', () => {
      const existingWords = ['hola', 'casa', 'perro'];
      
      const prompt = (ollamaClient as any).createTopicWordsPrompt('food', 'Spanish', 3, existingWords);
      
      expect(prompt).toContain('Do NOT include any of these existing words: hola, casa, perro');
      expect(prompt).toContain('Do NOT use any words from the exclusion list above');
    });

    it('should not include exclusion text when no existing words', () => {
      const prompt = (ollamaClient as any).createTopicWordsPrompt('food', 'Spanish', 3, []);
      
      expect(prompt).not.toContain('Do NOT include any of these existing words');
      expect(prompt).toContain('Do NOT use any words from the exclusion list above');
    });

    it('should truncate long exclusion lists', () => {
      const existingWords = Array.from({ length: 60 }, (_, i) => `word${i}`);
      
      const prompt = (ollamaClient as any).createTopicWordsPrompt('food', 'Spanish', 3, existingWords);
      
      expect(prompt).toContain('...');
      // Should only include first 50 words
      expect(prompt).toContain('word49');
      expect(prompt).not.toContain('word50');
    });

    it('should handle topic-specific prompts', () => {
      const existingWords = ['hola', 'casa'];
      
      const prompt = (ollamaClient as any).createTopicWordsPrompt('animals', 'Spanish', 3, existingWords);
      
      expect(prompt).toContain('related to "animals"');
      expect(prompt).toContain('Do NOT include any of these existing words: hola, casa');
    });

    it('should handle general vocabulary prompts', () => {
      const existingWords = ['hola', 'casa'];
      
      const prompt = (ollamaClient as any).createTopicWordsPrompt('', 'Spanish', 3, existingWords);
      
      expect(prompt).toContain('basic conversation');
      expect(prompt).toContain('Do NOT include any of these existing words: hola, casa');
    });
  });

  describe('generateTopicWords with duplicate filtering', () => {
    beforeEach(() => {
      // Mock successful Ollama response
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          response: JSON.stringify([
            { word: 'comida', translation: 'food' },
            { word: 'hola', translation: 'hello' }, // This should be filtered as duplicate
            { word: 'delicioso', translation: 'delicious' }
          ])
        })
      } as Response;
      
      mockFetch.mockResolvedValue(mockResponse);
    });

    it('should filter out duplicate words from generated results', async () => {
      const mockWords = [
        { id: 1, word: 'hola', language: 'Spanish', translation: 'hello' },
        { id: 2, word: 'casa', language: 'Spanish', translation: 'house' }
      ];

      mockDatabaseLayer.getAllWords = jest.fn().mockResolvedValue(mockWords);
      ollamaClient.setDatabaseLayer(mockDatabaseLayer);

      const result = await ollamaClient.generateTopicWords('food', 'Spanish', 3);

      // Should filter out 'hola' as it exists in database
      expect(result).toHaveLength(2);
      expect(result.map(w => w.word)).toEqual(['comida', 'delicioso']);
      expect(result.map(w => w.word)).not.toContain('hola');
    });

    it('should work when no duplicates are found', async () => {
      const mockWords = [
        { id: 1, word: 'casa', language: 'Spanish', translation: 'house' },
        { id: 2, word: 'perro', language: 'Spanish', translation: 'dog' }
      ];

      mockDatabaseLayer.getAllWords = jest.fn().mockResolvedValue(mockWords);
      ollamaClient.setDatabaseLayer(mockDatabaseLayer);

      const result = await ollamaClient.generateTopicWords('food', 'Spanish', 3);

      // No duplicates, should return all generated words
      expect(result).toHaveLength(3);
      expect(result.map(w => w.word)).toEqual(['comida', 'hola', 'delicioso']);
    });

    it('should handle case-insensitive duplicate checking', async () => {
      const mockWords = [
        { id: 1, word: 'HOLA', language: 'Spanish', translation: 'hello' }
      ];

      mockDatabaseLayer.getAllWords = jest.fn().mockResolvedValue(mockWords);
      ollamaClient.setDatabaseLayer(mockDatabaseLayer);

      const result = await ollamaClient.generateTopicWords('food', 'Spanish', 3);

      // Should filter out 'hola' even though database has 'HOLA'
      expect(result).toHaveLength(2);
      expect(result.map(w => w.word)).not.toContain('hola');
    });

    it('should throw error when insufficient new words are generated', async () => {
      // Mock response where most words are duplicates
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          response: JSON.stringify([
            { word: 'hola', translation: 'hello' },
            { word: 'casa', translation: 'house' },
            { word: 'perro', translation: 'dog' }
          ])
        })
      } as Response;
      
      mockFetch.mockResolvedValue(mockResponse);

      const mockWords = [
        { id: 1, word: 'hola', language: 'Spanish', translation: 'hello' },
        { id: 2, word: 'casa', language: 'Spanish', translation: 'house' },
        { id: 3, word: 'perro', language: 'Spanish', translation: 'dog' }
      ];

      mockDatabaseLayer.getAllWords = jest.fn().mockResolvedValue(mockWords);
      ollamaClient.setDatabaseLayer(mockDatabaseLayer);

      await expect(ollamaClient.generateTopicWords('food', 'Spanish', 3))
        .rejects.toThrow('Insufficient new words generated');
    });

    it('should work without database layer (fallback behavior)', async () => {
      // Don't set database layer
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await ollamaClient.generateTopicWords('food', 'Spanish', 3);

      // Should return all generated words since no duplicate checking
      expect(result).toHaveLength(3);
      expect(consoleSpy).toHaveBeenCalledWith('Database layer not set, cannot check for duplicates');
      
      consoleSpy.mockRestore();
    });
  });

  describe('duplicate filtering edge cases', () => {
    beforeEach(() => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          response: JSON.stringify([
            { word: 'test1', translation: 'test1' },
            { word: 'test2', translation: 'test2' },
            { word: 'test3', translation: 'test3' }
          ])
        })
      } as Response;
      
      mockFetch.mockResolvedValue(mockResponse);
    });

    it('should handle empty existing words list', async () => {
      mockDatabaseLayer.getAllWords = jest.fn().mockResolvedValue([]);
      ollamaClient.setDatabaseLayer(mockDatabaseLayer);

      const result = await ollamaClient.generateTopicWords('food', 'Spanish', 3);

      expect(result).toHaveLength(3);
      expect(mockDatabaseLayer.getAllWords).toHaveBeenCalledWith(true, true);
    });

    it('should filter words from different states (known, ignored, learning)', async () => {
      const mockWords = [
        { id: 1, word: 'test1', language: 'Spanish', known: true, ignored: false },
        { id: 2, word: 'test2', language: 'Spanish', known: false, ignored: true },
        { id: 3, word: 'test3', language: 'Spanish', known: false, ignored: false }
      ];

      mockDatabaseLayer.getAllWords = jest.fn().mockResolvedValue(mockWords);
      ollamaClient.setDatabaseLayer(mockDatabaseLayer);

      // This should throw an error because all words are duplicates
      await expect(ollamaClient.generateTopicWords('food', 'Spanish', 3))
        .rejects.toThrow('Insufficient new words generated');
    });
  });
});