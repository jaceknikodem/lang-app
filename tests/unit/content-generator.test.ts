/**
 * Unit tests for ContentGenerator
 */

import { ContentGenerator } from '../../src/main/llm/content-generator';
import { GeneratedWord, GeneratedSentence } from '../../src/shared/types/core';
import type { DatabaseLayer } from '../../src/shared/types/database';

// Mock the OllamaClient
class MockOllamaClient {
  isAvailable = jest.fn().mockResolvedValue(true);
  generateTopicWords = jest
    .fn()
    .mockImplementation(
      (
        topic: string,
        _language: string,
        count: number,
        _proficiencyLevel?: string
      ): Promise<GeneratedWord[]> => {
        // Simulate generating the requested number of words
        const words: GeneratedWord[] = [];
        for (let i = 1; i <= count; i++) {
          words.push({
            word: topic ? `${topic}_word_${i}` : `general_word_${i}`,
            translation: topic ? `${topic} word ${i}` : `general word ${i}`,
          });
        }
        return Promise.resolve(words);
      }
    );
  generateSentences = jest
    .fn()
    .mockImplementation(
      (
        word: string,
        _language: string,
        count: number,
        _topic?: string,
        _proficiencyLevel?: string
      ): Promise<GeneratedSentence[]> => {
        const sentences: GeneratedSentence[] = [];
        for (let i = 1; i <= count; i++) {
          sentences.push({
            sentence: `${word} sentence ${i}`,
            translation: `Translation ${i}`,
          });
        }
        return Promise.resolve(sentences);
      }
    );
  generateContextSentences = jest.fn().mockResolvedValue({
    contextBefore: 'Before context',
    contextAfter: 'After context',
    contextBeforeTranslation: 'Before translation',
    contextAfterTranslation: 'After translation',
  });
  generateResponse = jest.fn().mockResolvedValue('translation');
  getAvailableModels = jest.fn().mockResolvedValue(['test-model']);
  setModel = jest.fn();
  getCurrentModel = jest.fn().mockReturnValue('test-model');
  setWordGenerationModel = jest.fn();
  getWordGenerationModel = jest.fn().mockReturnValue('test-model');
  setSentenceGenerationModel = jest.fn();
  getSentenceGenerationModel = jest.fn().mockReturnValue('test-model');
  setDatabaseLayer = jest.fn();
}

// Mock FrequencyWordManager
jest.mock('../../src/main/llm/frequency-word-manager', () => {
  return {
    FrequencyWordManager: jest.fn().mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
      getLanguageProgress: jest.fn(),
      getAvailableLanguages: jest.fn().mockReturnValue(['spanish', 'italian', 'portuguese']),
      hasMoreWords: jest.fn().mockResolvedValue(true),
      getNextWordsToProcess: jest.fn(),
      getWordFrequencyPosition: jest.fn(),
      getFrequencyTier: jest.fn(),
    })),
  };
});

describe('ContentGenerator', () => {
  let contentGenerator: ContentGenerator;
  let mockClient: MockOllamaClient;

  beforeEach(() => {
    mockClient = new MockOllamaClient();
    contentGenerator = new ContentGenerator(mockClient as any);
  });

  describe('generateTopicVocabulary', () => {
    test('should generate multiple words for general vocabulary', async () => {
      const words = await contentGenerator.generateTopicVocabulary(
        undefined, // No topic - should generate general vocabulary
        'Spanish',
        5
      );

      expect(words).toHaveLength(5);

      // Check that all expected words are present (order may vary due to shuffling)
      const wordTexts = words.map((w) => w.word);
      for (let i = 1; i <= 5; i++) {
        expect(wordTexts).toContain(`general_word_${i}`);
      }

      // Check that first word has expected structure (regardless of which one it is)
      expect(words[0].word).toMatch(/^general_word_\d+$/);
      expect(words[0].translation).toMatch(/^general word \d+$/);
    });

    test('should generate multiple words for specific topic', async () => {
      const words = await contentGenerator.generateTopicVocabulary('food', 'Spanish', 5);

      expect(words).toHaveLength(5);

      // Check that all expected words are present (order may vary due to shuffling)
      const wordTexts = words.map((w) => w.word);
      for (let i = 1; i <= 5; i++) {
        expect(wordTexts).toContain(`food_word_${i}`);
      }

      // Check that first word has expected structure (regardless of which one it is)
      expect(words[0].word).toMatch(/^food_word_\d+$/);
      expect(words[0].translation).toMatch(/^food word \d+$/);
    });

    test('should handle empty topic string as general vocabulary', async () => {
      const words = await contentGenerator.generateTopicVocabulary(
        '', // Empty topic - should generate general vocabulary
        'Spanish',
        3
      );

      expect(words).toHaveLength(3);

      // Check that all expected words are present (order may vary due to shuffling)
      const wordTexts = words.map((w) => w.word);
      for (let i = 1; i <= 3; i++) {
        expect(wordTexts).toContain(`general_word_${i}`);
      }
    });

    test('should handle whitespace-only topic as general vocabulary', async () => {
      const words = await contentGenerator.generateTopicVocabulary(
        '   ', // Whitespace-only topic - should generate general vocabulary
        'Spanish',
        3
      );

      expect(words).toHaveLength(3);

      // Check that all expected words are present (order may vary due to shuffling)
      const wordTexts = words.map((w) => w.word);
      for (let i = 1; i <= 3; i++) {
        expect(wordTexts).toContain(`general_word_${i}`);
      }
    });

    test('should shuffle words to provide variety in order', async () => {
      // Generate words multiple times and check that order varies
      const results: string[][] = [];
      for (let i = 0; i < 5; i++) {
        const words = await contentGenerator.generateTopicVocabulary('test', 'Spanish', 5);
        results.push(words.map((w) => w.word));
      }

      // Check that not all results are identical (shuffling should provide variety)
      const firstResult = results[0];
      const allIdentical = results.every((result) =>
        result.every((word, index) => word === firstResult[index])
      );

      // With shuffling, it's extremely unlikely all 5 results would be identical
      // (probability is 1/5! = 1/120 for each comparison, much lower for all)
      expect(allIdentical).toBe(false);
    });
  });

  describe('generateWordSentences', () => {
    let mockClient: MockOllamaClient;
    let mockDatabase: Partial<DatabaseLayer>;

    beforeEach(() => {
      mockClient = new MockOllamaClient();
      // Reset mocks
      mockClient.isAvailable.mockResolvedValue(true);
      mockClient.generateSentences.mockImplementation(
        (word: string, _language: string, count: number) => {
          const sentences: GeneratedSentence[] = [];
          for (let i = 1; i <= count; i++) {
            sentences.push({
              sentence: `${word} sentence ${i}`,
              translation: `Translation ${i}`,
            });
          }
          return Promise.resolve(sentences);
        }
      );
      mockDatabase = {
        getSetting: jest.fn().mockResolvedValue(null),
      };
      contentGenerator = new ContentGenerator(mockClient as any);
    });

    it('should generate sentences using LLM when Tatoeba is unavailable', async () => {
      // Mock fetchTatoebaExamples to return empty (Tatoeba unavailable)
      (contentGenerator as any).fetchTatoebaExamples = jest.fn().mockResolvedValue([]);

      const sentences = await contentGenerator.generateWordSentences(
        'hola',
        'Spanish',
        3,
        mockDatabase as DatabaseLayer
      );

      expect(sentences.length).toBeGreaterThan(0);
      expect(mockClient.generateSentences).toHaveBeenCalled();
    });

    it('should handle empty word parameter', async () => {
      await expect(contentGenerator.generateWordSentences('', 'Spanish', 3)).rejects.toThrow(
        'Word parameter is required'
      );
    });

    it('should handle whitespace-only word', async () => {
      await expect(contentGenerator.generateWordSentences('   ', 'Spanish', 3)).rejects.toThrow(
        'Word parameter is required'
      );
    });

    it('should use default language when not provided', async () => {
      // Mock fetchTatoebaExamples to return empty
      (contentGenerator as any).fetchTatoebaExamples = jest.fn().mockResolvedValue([]);

      await contentGenerator.generateWordSentences('hola', undefined, 3);

      expect(mockClient.generateSentences).toHaveBeenCalled();
    });

    it('should use default count when not provided', async () => {
      // Mock fetchTatoebaExamples to return empty
      (contentGenerator as any).fetchTatoebaExamples = jest.fn().mockResolvedValue([]);

      await contentGenerator.generateWordSentences('hola', 'Spanish');

      expect(mockClient.generateSentences).toHaveBeenCalled();
    });

    it('should handle topic parameter', async () => {
      // Mock fetchTatoebaExamples to return empty
      (contentGenerator as any).fetchTatoebaExamples = jest.fn().mockResolvedValue([]);
      // Mock Math.random to always return 0.6 (above 0.5 threshold) so topic is not dropped
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.6);

      await contentGenerator.generateWordSentences('hola', 'Spanish', 3, undefined, 'greetings');

      expect(mockClient.generateSentences).toHaveBeenCalledWith(
        'hola',
        'Spanish',
        expect.any(Number),
        'greetings',
        undefined
      );

      // Restore Math.random
      Math.random = originalRandom;
    });

    it('should handle proficiency level from database', async () => {
      mockDatabase.getSetting = jest.fn().mockResolvedValue('A1');
      await contentGenerator.generateWordSentences(
        'hola',
        'Spanish',
        3,
        mockDatabase as DatabaseLayer
      );

      expect(mockDatabase.getSetting).toHaveBeenCalledWith('language_proficiency_spanish');
    });

    it('should throw error when LLM is unavailable', async () => {
      // Mock fetchTatoebaExamples to return empty (so it tries LLM)
      (contentGenerator as any).fetchTatoebaExamples = jest.fn().mockResolvedValue([]);
      mockClient.isAvailable.mockResolvedValue(false);

      await expect(contentGenerator.generateWordSentences('hola', 'Spanish', 3)).rejects.toThrow();
      try {
        await contentGenerator.generateWordSentences('hola', 'Spanish', 3);
      } catch (error: any) {
        // Error is wrapped, check cause
        expect(error.cause?.message || error.message).toContain('LLM service is not available');
      }
    });

    it('should throw error when no valid sentences generated', async () => {
      mockClient.generateSentences.mockResolvedValue([]);
      // Mock fetchTatoebaExamples to also return empty
      (contentGenerator as any).fetchTatoebaExamples = jest.fn().mockResolvedValue([]);

      await expect(contentGenerator.generateWordSentences('hola', 'Spanish', 3)).rejects.toThrow();
      try {
        await contentGenerator.generateWordSentences('hola', 'Spanish', 3);
      } catch (error: any) {
        // Error is wrapped, check cause
        expect(error.cause?.message || error.message).toContain(
          'No valid sentences were generated'
        );
      }
    });
  });

  describe('provider management', () => {
    let mockClient: MockOllamaClient;

    beforeEach(() => {
      mockClient = new MockOllamaClient();
      contentGenerator = new ContentGenerator(mockClient as any, {
        llmProvider: 'ollama',
      });
    });

    describe('switchProvider', () => {
      it('should switch from ollama to gemini', () => {
        contentGenerator.switchProvider('gemini', 'test-api-key');

        expect(contentGenerator.getCurrentProvider()).toBe('gemini');
      });

      it('should switch from gemini to ollama', () => {
        contentGenerator.switchProvider('gemini', 'test-api-key');
        contentGenerator.switchProvider('ollama');

        expect(contentGenerator.getCurrentProvider()).toBe('ollama');
      });

      it('should update API key when switching to gemini', () => {
        contentGenerator.switchProvider('gemini', 'new-api-key');

        expect(contentGenerator.getCurrentProvider()).toBe('gemini');
      });

      it('should keep existing API key when not provided', () => {
        contentGenerator.switchProvider('gemini', 'existing-key');
        contentGenerator.switchProvider('gemini'); // Switch again without key

        expect(contentGenerator.getCurrentProvider()).toBe('gemini');
      });
    });

    describe('setGeminiApiKey', () => {
      it('should set API key without switching', () => {
        contentGenerator.setGeminiApiKey('test-key', false);

        expect(contentGenerator.getCurrentProvider()).toBe('ollama');
      });

      it('should set API key and switch to gemini', () => {
        contentGenerator.setGeminiApiKey('test-key', true);

        expect(contentGenerator.getCurrentProvider()).toBe('gemini');
      });
    });

    describe('getCurrentProvider', () => {
      it('should return ollama by default', () => {
        expect(contentGenerator.getCurrentProvider()).toBe('ollama');
      });

      it('should return current provider after switch', () => {
        contentGenerator.switchProvider('gemini', 'key');
        expect(contentGenerator.getCurrentProvider()).toBe('gemini');
      });
    });

    describe('getCurrentClient', () => {
      it('should return current LLM client', () => {
        const client = contentGenerator.getCurrentClient();

        expect(client).toBeDefined();
      });
    });
  });

  describe('frequency word management', () => {
    let mockClient: MockOllamaClient;
    let mockDatabase: Partial<DatabaseLayer>;
    let mockFrequencyWordManager: any;

    beforeEach(() => {
      mockClient = new MockOllamaClient();
      mockDatabase = {
        getSetting: jest.fn().mockResolvedValue(null),
        getAllWords: jest.fn().mockResolvedValue([]),
      };
      const { FrequencyWordManager } = require('../../src/main/llm/frequency-word-manager');
      mockFrequencyWordManager = new FrequencyWordManager();
      contentGenerator = new ContentGenerator(mockClient as any, {
        llmProvider: 'ollama',
      });
      // Access private frequencyWordManager
      (contentGenerator as any).frequencyWordManager = mockFrequencyWordManager;
    });

    describe('getFrequencyProgress', () => {
      it('should return frequency progress', async () => {
        const mockProgress = {
          totalWords: 1000,
          processedWords: 100,
          currentPosition: 100,
          percentComplete: 10,
        };
        mockFrequencyWordManager.getLanguageProgress = jest.fn().mockResolvedValue(mockProgress);

        const progress = await contentGenerator.getFrequencyProgress(
          'spanish',
          mockDatabase as DatabaseLayer
        );

        expect(progress).toEqual(mockProgress);
        expect(mockFrequencyWordManager.getLanguageProgress).toHaveBeenCalledWith(
          'spanish',
          mockDatabase
        );
      });
    });

    describe('getAvailableFrequencyLanguages', () => {
      it('should return available languages', () => {
        const languages = contentGenerator.getAvailableFrequencyLanguages();

        expect(languages).toContain('spanish');
        expect(languages).toContain('italian');
        expect(mockFrequencyWordManager.getAvailableLanguages).toHaveBeenCalled();
      });
    });

    describe('generateFrequencyVocabulary', () => {
      it('should generate frequency-based vocabulary', async () => {
        const mockWordEntries = [
          { word: 'hola', translation: 'hello', position: 1 },
          { word: 'casa', translation: 'house', position: 2 },
        ];
        mockFrequencyWordManager.hasMoreWords = jest.fn().mockResolvedValue(true);
        mockFrequencyWordManager.getNextWordsToProcess = jest
          .fn()
          .mockResolvedValue(mockWordEntries);
        mockClient.generateResponse.mockResolvedValue('translation');

        const words = await (contentGenerator as any).generateFrequencyBasedVocabulary(
          'spanish',
          2,
          mockDatabase as DatabaseLayer
        );

        expect(words.length).toBeGreaterThan(0);
        expect(mockFrequencyWordManager.getNextWordsToProcess).toHaveBeenCalled();
      });

      it('should throw error when no more words available', async () => {
        mockFrequencyWordManager.hasMoreWords = jest.fn().mockResolvedValue(false);

        await expect(
          (contentGenerator as any).generateFrequencyBasedVocabulary(
            'spanish',
            2,
            mockDatabase as DatabaseLayer
          )
        ).rejects.toThrow('All words from the frequency list have been processed');
      });

      it('should filter words by proficiency level A1', async () => {
        const mockWordEntries = [
          { word: 'hola', translation: 'hello', position: 50 }, // Top 200 - should be filtered
          { word: 'casa', translation: 'house', position: 250 }, // Outside top 200 - should be kept
        ];
        mockDatabase.getSetting = jest.fn().mockResolvedValue('A1');
        mockFrequencyWordManager.hasMoreWords = jest.fn().mockResolvedValue(true);
        mockFrequencyWordManager.getNextWordsToProcess = jest
          .fn()
          .mockResolvedValue(mockWordEntries);
        mockClient.generateResponse.mockResolvedValue('translation');

        const words = await (contentGenerator as any).generateFrequencyBasedVocabulary(
          'spanish',
          2,
          mockDatabase as DatabaseLayer
        );

        // Should filter out words in top 200
        expect(
          words.every((w: GeneratedWord) => !w.frequencyPosition || w.frequencyPosition > 200)
        ).toBe(true);
      });

      it('should filter words by proficiency level A2', async () => {
        const mockWordEntries = [
          { word: 'hola', translation: 'hello', position: 300 }, // Top 500 - should be filtered
          { word: 'casa', translation: 'house', position: 600 }, // Outside top 500 - should be kept
        ];
        mockDatabase.getSetting = jest.fn().mockResolvedValue('A2');
        mockFrequencyWordManager.hasMoreWords = jest.fn().mockResolvedValue(true);
        mockFrequencyWordManager.getNextWordsToProcess = jest
          .fn()
          .mockResolvedValue(mockWordEntries);
        mockClient.generateResponse.mockResolvedValue('translation');

        const words = await (contentGenerator as any).generateFrequencyBasedVocabulary(
          'spanish',
          2,
          mockDatabase as DatabaseLayer
        );

        // Should filter out words in top 500
        expect(
          words.every((w: GeneratedWord) => !w.frequencyPosition || w.frequencyPosition > 500)
        ).toBe(true);
      });

      it('should filter words by proficiency level B1', async () => {
        const mockWordEntries = [
          { word: 'hola', translation: 'hello', position: 800 }, // Top 1000 - should be filtered
          { word: 'casa', translation: 'house', position: 1200 }, // Outside top 1000 - should be kept
        ];
        mockDatabase.getSetting = jest.fn().mockResolvedValue('B1');
        mockFrequencyWordManager.hasMoreWords = jest.fn().mockResolvedValue(true);
        mockFrequencyWordManager.getNextWordsToProcess = jest
          .fn()
          .mockResolvedValue(mockWordEntries);
        mockClient.generateResponse.mockResolvedValue('translation');

        const words = await (contentGenerator as any).generateFrequencyBasedVocabulary(
          'spanish',
          2,
          mockDatabase as DatabaseLayer
        );

        // Should filter out words in top 1000
        expect(
          words.every((w: GeneratedWord) => !w.frequencyPosition || w.frequencyPosition > 1000)
        ).toBe(true);
      });

      it('should not filter for other proficiency levels', async () => {
        const mockWordEntries = [
          { word: 'hola', translation: 'hello', position: 50 },
          { word: 'casa', translation: 'house', position: 250 },
        ];
        mockDatabase.getSetting = jest.fn().mockResolvedValue('B2');
        mockFrequencyWordManager.hasMoreWords = jest.fn().mockResolvedValue(true);
        mockFrequencyWordManager.getNextWordsToProcess = jest
          .fn()
          .mockResolvedValue(mockWordEntries);
        mockClient.generateResponse.mockResolvedValue('translation');

        const words = await (contentGenerator as any).generateFrequencyBasedVocabulary(
          'spanish',
          2,
          mockDatabase as DatabaseLayer
        );

        // Should not filter - all words should be present
        expect(words.length).toBeGreaterThan(0);
      });
    });
  });

  describe('helper methods', () => {
    let mockClient: MockOllamaClient;

    beforeEach(() => {
      mockClient = new MockOllamaClient();
      contentGenerator = new ContentGenerator(mockClient as any);
    });

    describe('filterWordsByProficiencyLevel', () => {
      it('should filter A1 words (top 200)', () => {
        const words: GeneratedWord[] = [
          { word: 'hola', translation: 'hello', frequencyPosition: 50 },
          { word: 'casa', translation: 'house', frequencyPosition: 250 },
        ];

        const filtered = (contentGenerator as any).filterWordsByProficiencyLevel(
          words,
          'A1',
          'spanish'
        );

        expect(filtered.length).toBe(1);
        expect(filtered[0].word).toBe('casa');
      });

      it('should filter A2 words (top 500)', () => {
        const words: GeneratedWord[] = [
          { word: 'hola', translation: 'hello', frequencyPosition: 300 },
          { word: 'casa', translation: 'house', frequencyPosition: 600 },
        ];

        const filtered = (contentGenerator as any).filterWordsByProficiencyLevel(
          words,
          'A2',
          'spanish'
        );

        expect(filtered.length).toBe(1);
        expect(filtered[0].word).toBe('casa');
      });

      it('should filter B1 words (top 1000)', () => {
        const words: GeneratedWord[] = [
          { word: 'hola', translation: 'hello', frequencyPosition: 800 },
          { word: 'casa', translation: 'house', frequencyPosition: 1200 },
        ];

        const filtered = (contentGenerator as any).filterWordsByProficiencyLevel(
          words,
          'B1',
          'spanish'
        );

        expect(filtered.length).toBe(1);
        expect(filtered[0].word).toBe('casa');
      });

      it('should not filter for other levels', () => {
        const words: GeneratedWord[] = [
          { word: 'hola', translation: 'hello', frequencyPosition: 50 },
          { word: 'casa', translation: 'house', frequencyPosition: 250 },
        ];

        const filtered = (contentGenerator as any).filterWordsByProficiencyLevel(
          words,
          'B2',
          'spanish'
        );

        expect(filtered.length).toBe(2);
      });

      it('should keep words without frequency position', () => {
        const words: GeneratedWord[] = [
          { word: 'hola', translation: 'hello' },
          { word: 'casa', translation: 'house', frequencyPosition: 50 },
        ];

        const filtered = (contentGenerator as any).filterWordsByProficiencyLevel(
          words,
          'A1',
          'spanish'
        );

        expect(filtered.length).toBe(1);
        expect(filtered[0].word).toBe('hola');
      });
    });

    // Note: getWordTranslation method was removed from ContentGenerator
    // These tests are skipped as the method no longer exists
    describe.skip('getWordTranslation', () => {
      it('should get translation from LLM', async () => {
        mockClient.generateResponse.mockResolvedValue('hello');

        const translation = await (contentGenerator as any).getWordTranslation('hola', 'Spanish');

        expect(translation).toBe('hello');
        expect(mockClient.generateResponse).toHaveBeenCalled();
      });

      it('should throw error when LLM is unavailable', async () => {
        mockClient.isAvailable.mockResolvedValue(false);

        await expect(
          (contentGenerator as any).getWordTranslation('hola', 'Spanish')
        ).rejects.toThrow('LLM service is not available');
      });
    });

    describe('fetchTatoebaExamples', () => {
      it('should return empty array for unsupported language', async () => {
        const result = await (contentGenerator as any).fetchTatoebaExamples(
          'word',
          'unsupported',
          3
        );

        expect(result).toEqual([]);
      });

      it('should return empty array when offline', async () => {
        // Mock isOnline to return false
        (contentGenerator as any).isOnline = jest.fn().mockResolvedValue(false);

        const result = await (contentGenerator as any).fetchTatoebaExamples('hola', 'spanish', 3);

        expect(result).toEqual([]);
      });
    });
  });
});
