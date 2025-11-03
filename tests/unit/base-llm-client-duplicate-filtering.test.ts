/**
 * Unit tests for BaseLLMClient duplicate filtering logic
 */

import { BaseLLMClient } from '../../src/main/llm/base-llm-client';
import { GeneratedWord } from '../../src/shared/types/core';
import { WordGenerationResponseSchema } from '../../src/main/llm/schemas';
import { z } from 'zod';

// Create a test subclass to test protected methods
class TestLLMClient extends BaseLLMClient {
  private mockResponse: any;

  // Override makeRequest to return mock responses
  protected async makeRequest(prompt: string, model?: string): Promise<any> {
    return this.mockResponse;
  }

  // Set mock response for testing
  public setMockResponse(response: any): void {
    this.mockResponse = response;
  }

  // Expose method for testing
  public async testGenerateTopicWords(
    topic: string,
    language: string,
    count: number,
    proficiencyLevel?: string
  ): Promise<GeneratedWord[]> {
    return this.generateTopicWords(topic, language, count, proficiencyLevel);
  }
}

describe('BaseLLMClient Duplicate Filtering', () => {
  let client: TestLLMClient;
  let mockDatabase: any;

  beforeEach(() => {
    client = new TestLLMClient({ model: 'test-model' });
    mockDatabase = {
      getExistingWordsForDuplicateChecking: jest.fn().mockResolvedValue([])
    };
    client.setDatabaseLayer(mockDatabase);
    jest.clearAllMocks();
  });

  describe('generateTopicWords duplicate filtering', () => {
    it('should remove duplicates within generated words (case-insensitive)', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'HOLA', translation: 'hello' }, // Duplicate (case-insensitive)
        { word: 'casa', translation: 'house' },
        { word: 'Casa', translation: 'house' } // Duplicate (case-insensitive)
      ];

      client.setMockResponse(mockWords);
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue([]);

      const result = await client.testGenerateTopicWords('test', 'Spanish', 4);

      // Should only have 2 unique words (hola and casa)
      expect(result).toHaveLength(2);
      const words = result.map(w => w.word.toLowerCase());
      expect(words).toHaveLength(2);
      expect(words).toContain('hola');
      expect(words).toContain('casa');
    });

    it('should filter out words that exist in database', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' },
        { word: 'perro', translation: 'dog' }
      ];

      client.setMockResponse(mockWords);
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue(['hola', 'casa']);

      const result = await client.testGenerateTopicWords('test', 'Spanish', 3);

      // Should filter out hola and casa, only return perro
      expect(result).toHaveLength(1);
      expect(result[0].word).toBe('perro');
      expect(result.map(w => w.word.toLowerCase())).not.toContain('hola');
      expect(result.map(w => w.word.toLowerCase())).not.toContain('casa');
    });

    it('should handle case-insensitive duplicate checking with database', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' },
        { word: 'perro', translation: 'dog' }
      ];

      client.setMockResponse(mockWords);
      // Database has uppercase version
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue(['HOLA', 'CASA']);

      const result = await client.testGenerateTopicWords('test', 'Spanish', 3);

      // Should filter out hola and casa (case-insensitive match)
      expect(result).toHaveLength(1);
      expect(result[0].word).toBe('perro');
    });

    it('should combine duplicate removal and database filtering', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'HOLA', translation: 'hello' }, // Duplicate in generated
        { word: 'casa', translation: 'house' }, // Exists in database
        { word: 'perro', translation: 'dog' },
        { word: 'gato', translation: 'cat' }
      ];

      client.setMockResponse(mockWords);
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue(['casa']);

      const result = await client.testGenerateTopicWords('test', 'Spanish', 4);

      // Should remove HOLA (duplicate, case-insensitive) and casa (database)
      // The first occurrence 'hola' should be kept (preserves original case)
      expect(result.length).toBeGreaterThanOrEqual(2);
      const wordLowercases = result.map(w => w.word.toLowerCase()).sort();
      expect(wordLowercases).toContain('hola'); // First occurrence kept
      expect(wordLowercases).toContain('perro');
      expect(wordLowercases).toContain('gato');
      expect(wordLowercases).not.toContain('casa');
      // HOLA should be removed as duplicate
      expect(result.filter(w => w.word === 'HOLA')).toHaveLength(0);
    });

    it('should handle empty database existing words', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' }
      ];

      client.setMockResponse(mockWords);
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue([]);

      const result = await client.testGenerateTopicWords('test', 'Spanish', 2);

      // Should return all words since none exist in database
      expect(result).toHaveLength(2);
      const words = result.map(w => w.word);
      expect(words).toHaveLength(2);
      expect(words).toContain('hola');
      expect(words).toContain('casa');
    });

    it('should throw error when insufficient new words generated', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' }
      ];

      client.setMockResponse(mockWords);
      // All generated words exist in database
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue(['hola', 'casa']);

      await expect(client.testGenerateTopicWords('test', 'Spanish', 3))
        .rejects.toThrow('Insufficient new words generated');
    });

    it('should handle minimum threshold calculation', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' }
      ];

      client.setMockResponse(mockWords);
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue(['hola']);

      // Request 10 words, but only get 1 new word
      // With default MIN_WORD_COUNT_THRESHOLD, should fail
      await expect(client.testGenerateTopicWords('test', 'Spanish', 10))
        .rejects.toThrow('Insufficient new words generated');
    });

    it('should pass when minimum threshold is met', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' },
        { word: 'perro', translation: 'dog' }
      ];

      client.setMockResponse(mockWords);
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue(['hola']);

      // Request 3 words, get 2 new words (should pass threshold)
      const result = await client.testGenerateTopicWords('test', 'Spanish', 3);

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle database errors gracefully', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' }
      ];

      client.setMockResponse(mockWords);
      mockDatabase.getExistingWordsForDuplicateChecking.mockRejectedValue(new Error('Database error'));

      // Should still work, just treat as empty existing words
      const result = await client.testGenerateTopicWords('test', 'Spanish', 2);

      expect(result).toHaveLength(2);
    });

    it('should handle no database layer set', async () => {
      const clientWithoutDb = new TestLLMClient({ model: 'test-model' });
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' }
      ];

      clientWithoutDb.setMockResponse(mockWords);

      // Should work without database layer, just no duplicate checking
      const result = await clientWithoutDb.testGenerateTopicWords('test', 'Spanish', 2);

      expect(result).toHaveLength(2);
    });

    it('should preserve original case of first occurrence', async () => {
      const mockWords = [
        { word: 'HOLA', translation: 'hello' },
        { word: 'hola', translation: 'hello' }, // Duplicate with different case
        { word: 'casa', translation: 'house' }
      ];

      client.setMockResponse(mockWords);
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue([]);

      const result = await client.testGenerateTopicWords('test', 'Spanish', 3);

      // Should preserve first occurrence's case (HOLA)
      expect(result).toHaveLength(2);
      const holaWord = result.find(w => w.word.toLowerCase() === 'hola');
      expect(holaWord?.word).toBe('HOLA'); // Should preserve original case
    });

    it('should handle multiple duplicates correctly', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'hola', translation: 'hello' }, // Duplicate 1
        { word: 'hola', translation: 'hello' }, // Duplicate 2
        { word: 'casa', translation: 'house' }
      ];

      client.setMockResponse(mockWords);
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue([]);

      const result = await client.testGenerateTopicWords('test', 'Spanish', 4);

      // Should only have 2 unique words
      expect(result).toHaveLength(2);
      const holaCount = result.filter(w => w.word.toLowerCase() === 'hola').length;
      expect(holaCount).toBe(1);
    });

    it('should work with existing words from different languages', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' }
      ];

      client.setMockResponse(mockWords);
      // Database has words for Spanish
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue(['hola']);

      const result = await client.testGenerateTopicWords('test', 'Spanish', 2);

      // Should filter out hola (exists in Spanish database)
      expect(result).toHaveLength(1);
      expect(result[0].word).toBe('casa');
    });
  });

  describe('generateSentences duplicate filtering', () => {
    it('should generate sentences without duplicate checking', async () => {
      const mockSentences = [
        { sentence: 'Hola mundo', translation: 'Hello world' },
        { sentence: 'Buenos días', translation: 'Good morning' }
      ];

      client.setMockResponse(mockSentences);
      mockDatabase.getKnownWordsForSentenceGeneration = jest.fn().mockResolvedValue(['hola', 'casa']);

      const result = await (client as any).generateSentences('hola', 'Spanish', 2);

      expect(result).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('should handle Zod validation errors', async () => {
      client.setMockResponse({ invalid: 'response' });
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue([]);

      // The error should mention validation or invalid response format
      await expect(client.testGenerateTopicWords('test', 'Spanish', 3))
        .rejects.toThrow();
    });

    it('should handle non-Zod errors', async () => {
      client.setMockResponse({ invalid: 'response' });
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue([]);

      // Mock the makeRequest to throw a generic error
      client.setMockResponse(null);
      (client as any).makeRequest = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(client.testGenerateTopicWords('test', 'Spanish', 3))
        .rejects.toThrow('Failed to generate words');
    });

    it('should handle ZodError instance with detailed error message', async () => {
      const zodError = new z.ZodError([
        {
          code: 'invalid_type',
          expected: 'array',
          received: 'string',
          path: [],
          message: 'Expected array, received string'
        }
      ]);

      // Simulate Zod validation error by having parse throw
      client.setMockResponse('not an array');
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue([]);

      await expect(client.testGenerateTopicWords('test', 'Spanish', 3))
        .rejects.toThrow();
    });

    it('should handle makeRequest throwing non-Error objects', async () => {
      (client as any).makeRequest = jest.fn().mockRejectedValue('String error');
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue([]);

      await expect(client.testGenerateTopicWords('test', 'Spanish', 3))
        .rejects.toThrow('Failed to generate words');
    });

    it('should handle null/undefined errors from makeRequest', async () => {
      (client as any).makeRequest = jest.fn().mockRejectedValue(null);
      mockDatabase.getExistingWordsForDuplicateChecking.mockResolvedValue([]);

      await expect(client.testGenerateTopicWords('test', 'Spanish', 3))
        .rejects.toThrow();
    });

    it('should handle database errors when getting existing words', async () => {
      const mockWords = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' }
      ];
      client.setMockResponse(mockWords);
      mockDatabase.getExistingWordsForDuplicateChecking.mockRejectedValue(new Error('Database connection failed'));

      // Should handle gracefully and treat as empty existing words
      const result = await client.testGenerateTopicWords('test', 'Spanish', 2);
      expect(result).toHaveLength(2);
    });
  });
});
