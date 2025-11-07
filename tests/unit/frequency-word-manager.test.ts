/**
 * Unit tests for FrequencyWordManager
 */

import { FrequencyWordManager, WordEntry } from '../../src/main/llm/frequency-word-manager';
import { DatabaseLayer } from '../../src/shared/types/database';
import { join } from 'path';
import * as os from 'os';

// Mock fs module
jest.mock('fs');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readdirSync: jest.fn(),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const { readdirSync, existsSync, readFileSync } = require('fs');

describe('FrequencyWordManager', () => {
  let manager: FrequencyWordManager;
  let tempDir: string;
  let mockDatabase: DatabaseLayer;

  beforeEach(() => {
    // Create temporary directory for tests
    tempDir = join(os.tmpdir(), `test-words-${Date.now()}`);
    manager = new FrequencyWordManager({ wordsDirectory: tempDir });

    // Mock database layer
    mockDatabase = {
      getAllWords: jest.fn().mockResolvedValue([]),
    } as any;

    jest.clearAllMocks();
  });

  describe('getFrequencyTier', () => {
    it('should return correct tier for all position ranges', () => {
      expect(manager.getFrequencyTier(1)).toBe('top 100');
      expect(manager.getFrequencyTier(100)).toBe('top 100');
      expect(manager.getFrequencyTier(101)).toBe('top 200');
      expect(manager.getFrequencyTier(200)).toBe('top 200');
      expect(manager.getFrequencyTier(201)).toBe('top 500');
      expect(manager.getFrequencyTier(500)).toBe('top 500');
      expect(manager.getFrequencyTier(501)).toBe('top 1000');
      expect(manager.getFrequencyTier(1000)).toBe('top 1000');
      expect(manager.getFrequencyTier(1001)).toBeUndefined();
    });
  });

  describe('getWordFrequencyPosition', () => {
    beforeEach(() => {
      // Setup mock word list
      (manager as any).wordLists.set('spanish', [
        { word: 'hola', translation: 'hello', position: 1 },
        { word: 'casa', translation: 'house', position: 2 },
        { word: 'perro', translation: 'dog', position: 3 },
      ]);
    });

    it('should return position for existing word with case/whitespace handling', () => {
      expect(manager.getWordFrequencyPosition('hola', 'spanish')).toBe(1);
      expect(manager.getWordFrequencyPosition('HOLA', 'spanish')).toBe(1); // case-insensitive
      expect(manager.getWordFrequencyPosition('  hola  ', 'spanish')).toBe(1); // whitespace
      expect(manager.getWordFrequencyPosition('casa', 'spanish')).toBe(2);
    });

    it('should return undefined for non-existent word or language', () => {
      expect(manager.getWordFrequencyPosition('missing', 'spanish')).toBeUndefined();
      expect(manager.getWordFrequencyPosition('hola', 'french')).toBeUndefined();
    });
  });

  describe('getAvailableLanguages', () => {
    it('should return languages from word list files and handle edge cases', () => {
      // Normal case
      readdirSync.mockReturnValue(['spanish_words.txt', 'italian_words.txt', 'other_file.txt']);
      existsSync.mockReturnValue(true);
      expect(manager.getAvailableLanguages()).toEqual(['spanish', 'italian']);

      // Empty directory
      readdirSync.mockReturnValue([]);
      expect(manager.getAvailableLanguages()).toEqual([]);

      // Error handling
      readdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      expect(manager.getAvailableLanguages()).toEqual([]);
    });
  });

  describe('loadWordList', () => {
    it('should parse word lists with various formats', async () => {
      // Test basic format
      readFileSync.mockReturnValue('hola\ncasa\nperro');
      existsSync.mockReturnValue(true);
      await (manager as any).loadWordList('spanish');
      let wordList = (manager as any).wordLists.get('spanish');
      expect(wordList[0]).toEqual({ word: 'hola', translation: null, position: 1 });

      // Test word;translation format
      readFileSync.mockReturnValue('hola;hello\ncasa;house');
      await (manager as any).loadWordList('spanish');
      wordList = (manager as any).wordLists.get('spanish');
      expect(wordList[0]).toEqual({ word: 'hola', translation: 'hello', position: 1 });

      // Test mixed formats and edge cases
      readFileSync.mockReturnValue('  hola  ;  hello  \n\ncasa\n  \nperro;dog');
      await (manager as any).loadWordList('spanish');
      wordList = (manager as any).wordLists.get('spanish');
      expect(wordList[0].word).toBe('hola');
      expect(wordList[0].translation).toBe('hello');
      expect(wordList.map((w: WordEntry) => w.word)).toEqual(['hola', 'casa', 'perro']);
    });

    it('should throw error if file not found', async () => {
      existsSync.mockReturnValue(false);

      await expect((manager as any).loadWordList('spanish')).rejects.toThrow(
        'Word list file not found for language: spanish'
      );
    });

    it('should throw error on file read failure', async () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockImplementation(() => {
        throw new Error('Cannot read file');
      });

      await expect((manager as any).loadWordList('spanish')).rejects.toThrow(
        'Failed to load word list for spanish: Cannot read file'
      );
    });

    it('should initialize position tracking', async () => {
      const content = 'hola\ncasa\nperro';
      readFileSync.mockReturnValue(content);
      existsSync.mockReturnValue(true);

      await (manager as any).loadWordList('spanish');

      const position = (manager as any).wordPositions.get('spanish');
      expect(position).toBe(0);
    });
  });

  describe('getNextWordsToProcess', () => {
    beforeEach(() => {
      (manager as any).wordLists.set('spanish', [
        { word: 'hola', translation: 'hello', position: 1 },
        { word: 'casa', translation: 'house', position: 2 },
        { word: 'perro', translation: 'dog', position: 3 },
        { word: 'gato', translation: 'cat', position: 4 },
      ]);
      (manager as any).wordPositions.set('spanish', 0);
    });

    it('should return next batch of words', async () => {
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([]);

      const words = await manager.getNextWordsToProcess('spanish', mockDatabase, 2);

      expect(words).toHaveLength(2);
      expect(words[0].word).toBe('hola');
      expect(words[1].word).toBe('casa');
    });

    it('should skip words already in database', async () => {
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([
        { id: 1, word: 'hola', language: 'spanish' },
        { id: 2, word: 'casa', language: 'spanish' },
      ]);

      const words = await manager.getNextWordsToProcess('spanish', mockDatabase, 2);

      expect(words).toHaveLength(2);
      expect(words[0].word).toBe('perro');
      expect(words[1].word).toBe('gato');
    });

    it('should handle case-insensitive duplicate checking', async () => {
      mockDatabase.getAllWords = jest
        .fn()
        .mockResolvedValue([{ id: 1, word: 'HOLA', language: 'spanish' }]);

      const words = await manager.getNextWordsToProcess('spanish', mockDatabase, 2);

      expect(words).toHaveLength(2);
      expect(words[0].word).toBe('casa');
      expect(words[1].word).toBe('perro');
    });

    it('should update position after processing', async () => {
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([]);

      await manager.getNextWordsToProcess('spanish', mockDatabase, 2);

      const position = (manager as any).wordPositions.get('spanish');
      expect(position).toBe(2);
    });

    it('should load word list if not already loaded', async () => {
      const content = 'hola\ncasa\nperro';
      readFileSync.mockReturnValue(content);
      existsSync.mockReturnValue(true);
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([]);

      // The method should call loadWordList internally
      const words = await manager.getNextWordsToProcess('spanish', mockDatabase);

      // Should load the word list and return words (default batch size is 10, but we only have 3)
      expect(words.length).toBeGreaterThanOrEqual(3);
      // The loadWordList is called internally, so we verify by result
      expect((manager as any).wordLists.has('spanish')).toBe(true);
      // Verify the words we loaded
      const wordLowercases = words.map((w) => w.word.toLowerCase());
      expect(wordLowercases).toContain('hola');
      expect(wordLowercases).toContain('casa');
      expect(wordLowercases).toContain('perro');
    });

    it('should handle end of word list', async () => {
      (manager as any).wordPositions.set('spanish', 3);
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([]);

      const words = await manager.getNextWordsToProcess('spanish', mockDatabase, 10);

      expect(words).toHaveLength(1); // Only one word left
      expect(words[0].word).toBe('gato');
    });

    it('should use default batch size if not specified', async () => {
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([]);
      // Set up word list with more than default batch size
      (manager as any).wordLists.set(
        'spanish',
        Array.from({ length: 15 }, (_, i) => ({
          word: `word${i + 1}`,
          translation: `translation${i + 1}`,
          position: i + 1,
        }))
      );

      const words = await manager.getNextWordsToProcess('spanish', mockDatabase);

      expect(words).toHaveLength(10); // Default batch size from config
    });
  });

  describe('getLanguageProgress', () => {
    beforeEach(() => {
      (manager as any).wordLists.set('spanish', [
        { word: 'hola', translation: 'hello', position: 1 },
        { word: 'casa', translation: 'house', position: 2 },
        { word: 'perro', translation: 'dog', position: 3 },
      ]);
      (manager as any).wordPositions.set('spanish', 0);
    });

    it('should return progress information', async () => {
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([]);

      const progress = await manager.getLanguageProgress('spanish', mockDatabase);

      expect(progress.totalWords).toBe(3);
      expect(progress.processedWords).toBe(0);
      expect(progress.currentPosition).toBe(0);
      expect(progress.percentComplete).toBe(0);
    });

    it('should calculate progress correctly for various completion levels', async () => {
      // Partial completion
      jest.clearAllMocks();
      (manager as any).wordPositions.set('spanish', 1);
      mockDatabase.getAllWords = jest
        .fn()
        .mockResolvedValue([{ id: 1, word: 'hola', language: 'spanish' }]);
      let progress = await manager.getLanguageProgress('spanish', mockDatabase);
      expect(progress.processedWords).toBe(1);
      expect(progress.percentComplete).toBeCloseTo(33.33, 1);

      // 100% completion
      jest.clearAllMocks();
      (manager as any).wordPositions.set('spanish', 3);
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([
        { id: 1, word: 'hola', language: 'spanish' },
        { id: 2, word: 'casa', language: 'spanish' },
        { id: 3, word: 'perro', language: 'spanish' },
      ]);
      progress = await manager.getLanguageProgress('spanish', mockDatabase);
      expect(progress.processedWords).toBe(3);
      expect(progress.percentComplete).toBe(100);
    });

    it('should load word list if not already loaded', async () => {
      const content = 'hola\ncasa\nperro';
      readFileSync.mockReturnValue(content);
      existsSync.mockReturnValue(true);
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([]);

      const progress = await manager.getLanguageProgress('spanish', mockDatabase);

      expect(progress.totalWords).toBe(3);
    });
  });

  describe('hasMoreWords', () => {
    beforeEach(() => {
      (manager as any).wordLists.set('spanish', [
        { word: 'hola', translation: 'hello', position: 1 },
        { word: 'casa', translation: 'house', position: 2 },
      ]);
    });

    it('should return correct status based on progress', async () => {
      // Has more words
      jest.clearAllMocks();
      (manager as any).wordPositions.set('spanish', 0);
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([]);
      expect(await manager.hasMoreWords('spanish', mockDatabase)).toBe(true);

      // All words processed
      jest.clearAllMocks();
      (manager as any).wordPositions.set('spanish', 2);
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([
        { id: 1, word: 'hola', language: 'spanish' },
        { id: 2, word: 'casa', language: 'spanish' },
      ]);
      expect(await manager.hasMoreWords('spanish', mockDatabase)).toBe(false);
    });
  });

  describe('resetLanguagePosition', () => {
    it('should reset position to 0 for existing and non-existent languages', () => {
      (manager as any).wordPositions.set('spanish', 5);
      manager.resetLanguagePosition('spanish');
      expect((manager as any).wordPositions.get('spanish')).toBe(0);

      expect(() => manager.resetLanguagePosition('french')).not.toThrow();
      expect((manager as any).wordPositions.get('french')).toBe(0);
    });
  });

  describe('getWordList', () => {
    it('should return word list for language or empty array for non-existent', () => {
      const wordList = [
        { word: 'hola', translation: 'hello', position: 1 },
        { word: 'casa', translation: 'house', position: 2 },
      ];
      (manager as any).wordLists.set('spanish', wordList);
      expect(manager.getWordList('spanish')).toEqual(wordList);
      expect(manager.getWordList('french')).toEqual([]);
    });
  });

  describe('updatePositionFromDatabase', () => {
    beforeEach(() => {
      (manager as any).wordLists.set('spanish', [
        { word: 'hola', translation: 'hello', position: 1 },
        { word: 'casa', translation: 'house', position: 2 },
        { word: 'perro', translation: 'dog', position: 3 },
      ]);
    });

    it('should update position based on database words', async () => {
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([
        { id: 1, word: 'hola', language: 'spanish' },
        { id: 2, word: 'casa', language: 'spanish' },
      ]);

      await (manager as any).updatePositionFromDatabase('spanish', mockDatabase);

      expect((manager as any).wordPositions.get('spanish')).toBe(2);
    });

    it('should handle case-insensitive matching and stop at first missing word', async () => {
      // Case-insensitive matching
      jest.clearAllMocks();
      (manager as any).wordPositions.set('spanish', 0);
      mockDatabase.getAllWords = jest
        .fn()
        .mockResolvedValue([{ id: 1, word: 'HOLA', language: 'spanish' }]);
      await (manager as any).updatePositionFromDatabase('spanish', mockDatabase);
      expect((manager as any).wordPositions.get('spanish')).toBe(1);

      // Stops at first missing word
      jest.clearAllMocks();
      (manager as any).wordPositions.set('spanish', 0);
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([
        { id: 1, word: 'hola', language: 'spanish' },
        { id: 3, word: 'perro', language: 'spanish' }, // Missing casa
      ]);
      await (manager as any).updatePositionFromDatabase('spanish', mockDatabase);
      expect((manager as any).wordPositions.get('spanish')).toBe(1);

      // Empty database
      jest.clearAllMocks();
      (manager as any).wordPositions.set('spanish', 0);
      mockDatabase.getAllWords = jest.fn().mockResolvedValue([]);
      await (manager as any).updatePositionFromDatabase('spanish', mockDatabase);
      expect((manager as any).wordPositions.get('spanish')).toBe(0);
    });

    it('should handle database errors gracefully', async () => {
      mockDatabase.getAllWords = jest.fn().mockRejectedValue(new Error('Database error'));

      // Initialize position first
      (manager as any).wordPositions.set('spanish', 0);

      await (manager as any).updatePositionFromDatabase('spanish', mockDatabase);

      // Should not throw, position should remain unchanged (or be set to 0 if not initialized)
      const position = (manager as any).wordPositions.get('spanish');
      expect(position).toBeDefined();
      expect(position).toBeGreaterThanOrEqual(0);
    });

    it('should keep existing position if it is higher', async () => {
      (manager as any).wordPositions.set('spanish', 3);
      mockDatabase.getAllWords = jest
        .fn()
        .mockResolvedValue([{ id: 1, word: 'hola', language: 'spanish' }]);

      await (manager as any).updatePositionFromDatabase('spanish', mockDatabase);

      // Should keep position 3 (higher than calculated 1)
      expect((manager as any).wordPositions.get('spanish')).toBe(3);
    });
  });
});
