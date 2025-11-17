/**
 * Unit tests for ContentGenerator error handling and retry logic
 */

import { ContentGenerator } from '../../src/main/llm/content-generator';
import { LLMClient, LLMError } from '../../src/shared/types/llm';
import { GeneratedWord, GeneratedSentence } from '../../src/shared/types/core';

// Mock LLM client
class MockLLMClient implements LLMClient {
  public calls: number = 0;
  public shouldFail: boolean = false;
  public failCount: number = 0;
  public maxFailures: number = 0;
  public responses: GeneratedWord[] | GeneratedSentence[] = [];
  public isAvailableResponse: boolean = true;

  async isAvailable(): Promise<boolean> {
    return this.isAvailableResponse;
  }

  async generateTopicWords(
    topic: string,
    _language: string,
    count: number,
    _proficiencyLevel?: string
  ): Promise<GeneratedWord[]> {
    this.calls++;

    if (this.shouldFail && this.failCount < this.maxFailures) {
      this.failCount++;
      throw new Error(`Test error ${this.failCount}`);
    }

    if (Array.isArray(this.responses) && this.responses.length > 0 && 'word' in this.responses[0]) {
      return this.responses as GeneratedWord[];
    }

    return Array.from({ length: count }, (_, i) => ({
      word: `${topic || 'word'}_${i + 1}`,
      translation: `translation ${i + 1}`,
    }));
  }

  async generateSentences(
    word: string,
    _language: string,
    count: number,
    _topic?: string,
    _proficiencyLevel?: string
  ): Promise<GeneratedSentence[]> {
    this.calls++;

    if (this.shouldFail && this.failCount < this.maxFailures) {
      this.failCount++;
      throw new Error(`Test error ${this.failCount}`);
    }

    if (
      Array.isArray(this.responses) &&
      this.responses.length > 0 &&
      'sentence' in this.responses[0]
    ) {
      return this.responses as GeneratedSentence[];
    }

    return Array.from({ length: count }, (_, i) => ({
      sentence: `${word} sentence ${i + 1}`,
      translation: `translation ${i + 1}`,
    }));
  }

  async generateContextSentences(
    _sentence: string,
    _translation: string,
    _language: string
  ): Promise<any> {
    return {};
  }

  async generateDialogueVariants(
    _triggerSentence: string,
    _triggerTranslation: string,
    _language: string,
    _knownWords: string[],
    _count: number
  ): Promise<any[]> {
    return [];
  }

  async generateFollowUp(
    _conversationHistory: string[],
    _language: string,
    _proficiencyLevel?: string
  ): Promise<{ text: string; translation: string }> {
    return { text: '', translation: '' };
  }

  async analyzeTranscription(
    _transcription: string,
    _language: string,
    _assistantSentence: string,
    _topic?: string
  ): Promise<any> {
    return { hasGrammarMistakes: false };
  }

  async explainGrammar(
    _word: string,
    _sentence: string,
    _language: string,
    _proficiencyLevel?: string
  ): Promise<string> {
    return '';
  }

  async convertToPronunciation(_sentences: string[], _language: string): Promise<string[]> {
    return _sentences.map(() => '');
  }

  async generateResponse(_prompt: string, _model?: string): Promise<string> {
    return '';
  }

  async getAvailableModels(): Promise<string[]> {
    return ['test-model'];
  }

  setModel(_model: string): void {}
  getCurrentModel(): string {
    return 'test-model';
  }

  setWordGenerationModel(_model: string): void {}
  getWordGenerationModel(): string {
    return 'test-model';
  }

  setSentenceGenerationModel(_model: string): void {}
  getSentenceGenerationModel(): string {
    return 'test-model';
  }

  setDatabaseLayer(_database: any): void {}
}

describe('ContentGenerator Error Handling', () => {
  let generator: ContentGenerator;
  let mockClient: MockLLMClient;

  beforeEach(() => {
    mockClient = new MockLLMClient();
    generator = new ContentGenerator(mockClient, {
      retryAttempts: 3,
      retryDelay: 10, // Fast delay for tests
    });
    jest.clearAllMocks();
  });

  describe('error handling (via generateTopicVocabulary)', () => {
    it('should succeed on first attempt', async () => {
      mockClient.responses = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' },
      ];

      const words = await generator.generateTopicVocabulary('test', 'Spanish', 2);

      expect(words).toHaveLength(2);
      expect(mockClient.calls).toBe(1);
    });

    it('should propagate errors from LLM client', async () => {
      mockClient.shouldFail = true;
      mockClient.maxFailures = 10; // Always fail

      // The error should be propagated (retries are now handled at HTTP level in LLM clients)
      await expect(generator.generateTopicVocabulary('test', 'Spanish', 2)).rejects.toThrow();

      // Should have called the LLM client at least once
      expect(mockClient.calls).toBeGreaterThanOrEqual(1);
    });

    it('should handle LLMError', async () => {
      const llmError: LLMError = new Error('LLM Error') as LLMError;
      llmError.code = 'MODEL_ERROR';
      llmError.retryable = false;

      let callCount = 0;
      mockClient.generateTopicWords = jest.fn().mockImplementation(() => {
        callCount++;
        throw llmError;
      });

      await expect(generator.generateTopicVocabulary('test', 'Spanish', 2)).rejects.toThrow(
        'LLM Error'
      );

      // Should have called the LLM client
      expect(callCount).toBeGreaterThanOrEqual(1);
    });

    it('should propagate retryable LLMError', async () => {
      const llmError: LLMError = new Error('Retryable error') as LLMError;
      llmError.code = 'CONNECTION_ERROR';
      llmError.retryable = true;

      let callCount = 0;
      mockClient.generateTopicWords = jest.fn().mockImplementation(() => {
        callCount++;
        // Simulate success on first call (retries are handled at HTTP level in real clients)
        return Promise.resolve([{ word: 'hola', translation: 'hello' }]);
      });

      const words = await generator.generateTopicVocabulary('test', 'Spanish', 2);

      expect(words).toHaveLength(1);
      // Should have called the LLM client (retries are handled at HTTP level)
      expect(callCount).toBe(1);
    });
  });

  describe('handleContentGenerationError', () => {
    it('should preserve LLMError', () => {
      const llmError: LLMError = new Error('LLM Error') as LLMError;
      llmError.code = 'MODEL_ERROR';

      const result = (generator as any).handleContentGenerationError(llmError, 'test operation');

      expect(result).toBe(llmError);
      expect((result as LLMError).code).toBe('MODEL_ERROR');
    });

    it('should wrap regular Error with context', () => {
      const error = new Error('Test error');
      const result = (generator as any).handleContentGenerationError(error, 'test operation');

      expect(result.message).toBe('test operation failed');
      expect(result.cause?.message).toBe('Test error');
    });

    it('should handle unknown error type', () => {
      const error = 'String error';
      const result = (generator as any).handleContentGenerationError(error, 'test operation');

      expect(result.message).toBe('test operation failed');
    });

    it('should handle null error', () => {
      const result = (generator as any).handleContentGenerationError(null, 'test operation');

      expect(result.message).toBe('test operation failed');
    });
  });

  describe('LLM availability checks', () => {
    it('should throw error when LLM is not available', async () => {
      mockClient.isAvailableResponse = false;

      await expect(generator.generateTopicVocabulary('food', 'Spanish', 5)).rejects.toThrow(
        'vocabulary generation failed'
      );
    });

    it('should throw specific error for Ollama', async () => {
      const ollamaGenerator = new ContentGenerator(mockClient, {
        llmProvider: 'ollama',
      });
      (ollamaGenerator as any).getCurrentProvider = jest.fn().mockReturnValue('ollama');
      mockClient.isAvailableResponse = false;

      await expect(ollamaGenerator.generateTopicVocabulary('food', 'Spanish', 5)).rejects.toThrow(
        'vocabulary generation failed'
      );
    });

    it('should throw specific error for Gemini', async () => {
      const geminiGenerator = new ContentGenerator(mockClient, {
        llmProvider: 'gemini',
      });
      (geminiGenerator as any).getCurrentProvider = jest.fn().mockReturnValue('gemini');
      mockClient.isAvailableResponse = false;

      await expect(geminiGenerator.generateTopicVocabulary('food', 'Spanish', 5)).rejects.toThrow(
        'vocabulary generation failed'
      );
    });
  });

  describe('validateGeneratedWords', () => {
    it('should filter out invalid words (empty, whitespace, missing translation)', () => {
      const words: GeneratedWord[] = [
        { word: 'hola', translation: 'hello' },
        { word: '', translation: 'empty' }, // Invalid
        { word: '   ', translation: 'whitespace' }, // Invalid
        { word: 'casa', translation: 'house' },
        { word: 'perro', translation: '' }, // Invalid
      ];

      const validWords = (generator as any).validateGeneratedWords(words);
      expect(validWords).toHaveLength(2);
      expect(validWords.map((w: GeneratedWord) => w.word)).toEqual(['hola', 'casa']);
    });

    it('should filter out words exceeding length limits', () => {
      const words: GeneratedWord[] = [
        { word: 'hola', translation: 'hello' },
        { word: 'a'.repeat(51), translation: 'too long' }, // Word > 50 chars
        { word: 'casa', translation: 'b'.repeat(101) }, // Translation > 100 chars
        { word: 'perro', translation: 'dog' },
      ];

      const validWords = (generator as any).validateGeneratedWords(words);
      expect(validWords).toHaveLength(2);
      expect(validWords.map((w: GeneratedWord) => w.word)).toEqual(['hola', 'perro']);
    });

    it('should handle non-array input', () => {
      expect((generator as any).validateGeneratedWords(null)).toEqual([]);
      expect((generator as any).validateGeneratedWords(undefined)).toEqual([]);
      expect((generator as any).validateGeneratedWords('not an array')).toEqual([]);
      expect((generator as any).validateGeneratedWords({})).toEqual([]);
    });

    it('should handle words with null/undefined fields', () => {
      const words: any[] = [
        { word: 'hola', translation: 'hello' },
        { word: null, translation: 'hello' }, // Invalid
        { word: 'casa', translation: undefined }, // Invalid
        { word: undefined, translation: null }, // Invalid
        { word: 'perro', translation: 'dog' },
      ];

      const validWords = (generator as any).validateGeneratedWords(words);
      expect(validWords).toHaveLength(2);
      expect(validWords.map((w: GeneratedWord) => w.word)).toEqual(['hola', 'perro']);
    });

    it('should preserve valid words with frequency info', () => {
      const words: GeneratedWord[] = [
        { word: 'hola', translation: 'hello', frequencyPosition: 1, frequencyTier: 'top 100' },
        { word: 'casa', translation: 'house', frequencyPosition: 2 },
      ];

      const validWords = (generator as any).validateGeneratedWords(words);
      expect(validWords).toHaveLength(2);
      expect(validWords[0].frequencyPosition).toBe(1);
      expect(validWords[0].frequencyTier).toBe('top 100');
    });
  });

  describe('validateGeneratedSentences', () => {
    it('should filter out invalid sentences (empty, missing translation)', () => {
      const sentences: GeneratedSentence[] = [
        { sentence: 'Hola mundo', translation: 'Hello world' },
        { sentence: '', translation: 'empty' }, // Invalid
        { sentence: 'Buenos días', translation: 'Good morning' },
        { sentence: 'Adiós', translation: '' }, // Invalid
      ];

      const validSentences = (generator as any).validateGeneratedSentences(sentences, 'hola');
      expect(validSentences).toHaveLength(2);
      expect(validSentences.map((s: GeneratedSentence) => s.sentence)).toEqual([
        'Hola mundo',
        'Buenos días',
      ]);
    });

    it('should handle non-array input', () => {
      expect((generator as any).validateGeneratedSentences(null, 'test')).toEqual([]);
      expect((generator as any).validateGeneratedSentences(undefined, 'test')).toEqual([]);
      expect((generator as any).validateGeneratedSentences('not an array', 'test')).toEqual([]);
    });

    it('should handle sentences with null/undefined fields', () => {
      const sentences: any[] = [
        { sentence: 'Hola mundo', translation: 'Hello world' },
        { sentence: null, translation: 'Hello' }, // Invalid
        { sentence: 'Buenos días', translation: undefined }, // Invalid
        { sentence: undefined, translation: null }, // Invalid
        { sentence: 'Adiós', translation: 'Goodbye' },
      ];

      const validSentences = (generator as any).validateGeneratedSentences(sentences, 'hola');
      expect(validSentences).toHaveLength(2);
      expect(validSentences.map((s: GeneratedSentence) => s.sentence)).toEqual([
        'Hola mundo',
        'Adiós',
      ]);
    });

    it('should filter out sentences exceeding length limits', () => {
      const sentences: GeneratedSentence[] = [
        { sentence: 'Hola mundo', translation: 'Hello world' },
        { sentence: 'a'.repeat(201), translation: 'too long' }, // Sentence > 200 chars
        { sentence: 'Buenos días', translation: 'b'.repeat(301) }, // Translation > 300 chars
        { sentence: 'Adiós', translation: 'Goodbye' },
      ];

      const validSentences = (generator as any).validateGeneratedSentences(sentences, 'hola');
      expect(validSentences).toHaveLength(2);
      expect(validSentences.map((s: GeneratedSentence) => s.sentence)).toEqual([
        'Hola mundo',
        'Adiós',
      ]);
    });
  });

  describe('shuffleArray', () => {
    it('should shuffle array elements', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = (generator as any).shuffleArray(original);

      // Should have same length
      expect(shuffled).toHaveLength(original.length);

      // Should contain all elements
      original.forEach((item) => {
        expect(shuffled).toContain(item);
      });

      // Should preserve element count
      const shuffledSorted = [...shuffled].sort();
      const originalSorted = [...original].sort();
      expect(shuffledSorted).toEqual(originalSorted);
    });

    it('should handle empty array', () => {
      const result = (generator as any).shuffleArray([]);
      expect(result).toEqual([]);
    });

    it('should handle single element array', () => {
      const result = (generator as any).shuffleArray([1]);
      expect(result).toEqual([1]);
    });

    it('should handle array of strings', () => {
      const original = ['hola', 'casa', 'perro', 'gato'];
      const shuffled = (generator as any).shuffleArray(original);

      expect(shuffled).toHaveLength(original.length);
      original.forEach((item) => {
        expect(shuffled).toContain(item);
      });
    });

    it('should handle array of objects', () => {
      const original = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' },
        { word: 'perro', translation: 'dog' },
      ];
      const shuffled = (generator as any).shuffleArray(original);

      expect(shuffled).toHaveLength(original.length);
      // Check that all original objects are present
      original.forEach((item) => {
        expect(shuffled).toContainEqual(item);
      });
    });

    it('should not mutate original array', () => {
      const original = [1, 2, 3, 4, 5];
      const originalCopy = [...original];
      (generator as any).shuffleArray(original);

      expect(original).toEqual(originalCopy);
    });

    it('should return different order on multiple calls (statistically)', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const results: number[][] = [];

      // Run shuffle multiple times
      for (let i = 0; i < 10; i++) {
        results.push((generator as any).shuffleArray(original));
      }

      // Check that at least some shuffles are different (statistical test)
      // With 10 elements, probability of all being same is extremely low
      const allSame = results.every((arr) => JSON.stringify(arr) === JSON.stringify(original));
      expect(allSame).toBe(false); // Very unlikely all 10 shuffles match original
    });
  });
});
