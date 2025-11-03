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

  async generateTopicWords(topic: string, language: string, count: number, proficiencyLevel?: string): Promise<GeneratedWord[]> {
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
      translation: `translation ${i + 1}`
    }));
  }

  async generateSentences(word: string, language: string, count: number, topic?: string, proficiencyLevel?: string): Promise<GeneratedSentence[]> {
    this.calls++;
    
    if (this.shouldFail && this.failCount < this.maxFailures) {
      this.failCount++;
      throw new Error(`Test error ${this.failCount}`);
    }

    if (Array.isArray(this.responses) && this.responses.length > 0 && 'sentence' in this.responses[0]) {
      return this.responses as GeneratedSentence[];
    }

    return Array.from({ length: count }, (_, i) => ({
      sentence: `${word} sentence ${i + 1}`,
      translation: `translation ${i + 1}`
    }));
  }

  async generateContextSentences(sentence: string, translation: string, language: string): Promise<any> {
    return {};
  }

  async generateDialogueVariants(triggerSentence: string, triggerTranslation: string, language: string, knownWords: string[], count: number): Promise<any[]> {
    return [];
  }

  async generateFollowUp(sentence: string, translation: string, language: string): Promise<any> {
    return { text: '', translation: '' };
  }

  async generateResponse(prompt: string, model?: string): Promise<string> {
    return '';
  }

  async getAvailableModels(): Promise<string[]> {
    return ['test-model'];
  }

  setModel(model: string): void {}
  getCurrentModel(): string {
    return 'test-model';
  }

  setWordGenerationModel(model: string): void {}
  getWordGenerationModel(): string {
    return 'test-model';
  }

  setSentenceGenerationModel(model: string): void {}
  getSentenceGenerationModel(): string {
    return 'test-model';
  }

  setDatabaseLayer(database: any): void {}
}

describe('ContentGenerator Error Handling', () => {
  let generator: ContentGenerator;
  let mockClient: MockLLMClient;

  beforeEach(() => {
    mockClient = new MockLLMClient();
    generator = new ContentGenerator(mockClient, {
      retryAttempts: 3,
      retryDelay: 10 // Fast delay for tests
    });
    jest.clearAllMocks();
  });

  describe('executeWithRetry', () => {
    it('should succeed on first attempt', async () => {
      mockClient.responses = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' }
      ];

      const words = await (generator as any).executeWithRetry(
        () => mockClient.generateTopicWords('test', 'Spanish', 2),
        'test operation'
      );

      expect(words).toHaveLength(2);
      expect(mockClient.calls).toBe(1);
    });

    it('should retry on failure and succeed', async () => {
      mockClient.shouldFail = true;
      mockClient.maxFailures = 2; // Fail twice, succeed on third

      const words = await (generator as any).executeWithRetry(
        () => mockClient.generateTopicWords('test', 'Spanish', 2),
        'test operation'
      );

      expect(words).toHaveLength(2);
      expect(mockClient.calls).toBeGreaterThanOrEqual(2); // At least 2 retries
      expect(mockClient.calls).toBeLessThanOrEqual(4); // But not more than max attempts
    });

    it('should throw error after max retries', async () => {
      mockClient.shouldFail = true;
      mockClient.maxFailures = 10; // More than retry attempts

      // The error thrown will be the last error from the operation, not the formatted error
      await expect(
        (generator as any).executeWithRetry(
          () => mockClient.generateTopicWords('test', 'Spanish', 2),
          'test operation'
        )
      ).rejects.toThrow();

      // Should retry maxAttempts times (3) + initial attempt = 4 total
      expect(mockClient.calls).toBeGreaterThanOrEqual(3);
      expect(mockClient.calls).toBeLessThanOrEqual(4);
    });

    it('should handle LLMError without retrying', async () => {
      const llmError: LLMError = new Error('LLM Error') as LLMError;
      llmError.code = 'MODEL_ERROR';
      llmError.retryable = false;

      mockClient.generateTopicWords = jest.fn().mockRejectedValue(llmError);

      await expect(
        (generator as any).executeWithRetry(
          () => mockClient.generateTopicWords('test', 'Spanish', 2),
          'test operation'
        )
      ).rejects.toThrow('LLM Error');

      expect(mockClient.generateTopicWords).toHaveBeenCalledTimes(1); // No retries
    });

    it('should retry on retryable LLMError', async () => {
      const llmError: LLMError = new Error('Retryable error') as LLMError;
      llmError.code = 'CONNECTION_ERROR';
      llmError.retryable = true;

      let callCount = 0;
      mockClient.generateTopicWords = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          throw llmError;
        }
        return Promise.resolve([{ word: 'hola', translation: 'hello' }]);
      });

      const words = await (generator as any).executeWithRetry(
        () => mockClient.generateTopicWords('test', 'Spanish', 2),
        'test operation'
      );

      expect(words).toHaveLength(1);
      // Should have retried at least once
      expect(callCount).toBeGreaterThanOrEqual(2);
      expect(callCount).toBeLessThanOrEqual(4);
    });

    it('should respect retry delay', async () => {
      const generatorWithDelay = new ContentGenerator(mockClient, {
        retryAttempts: 2,
        retryDelay: 100
      });

      mockClient.shouldFail = true;
      mockClient.maxFailures = 1; // Fail once, succeed on retry

      const startTime = Date.now();
      await (generatorWithDelay as any).executeWithRetry(
        () => mockClient.generateTopicWords('test', 'Spanish', 2),
        'test operation'
      );
      const duration = Date.now() - startTime;

      // Should have waited at least the retry delay
      expect(duration).toBeGreaterThanOrEqual(90); // Allow some margin
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

      expect(result.message).toBe('test operation failed: Test error');
    });

    it('should handle unknown error type', () => {
      const error = 'String error';
      const result = (generator as any).handleContentGenerationError(error, 'test operation');

      expect(result.message).toBe('test operation failed: Unknown error occurred');
    });

    it('should handle null error', () => {
      const result = (generator as any).handleContentGenerationError(null, 'test operation');

      expect(result.message).toBe('test operation failed: Unknown error occurred');
    });
  });

  describe('LLM availability checks', () => {
    it('should throw error when LLM is not available', async () => {
      mockClient.isAvailableResponse = false;

      await expect(
        generator.generateTopicVocabulary('food', 'Spanish', 5)
      ).rejects.toThrow('LLM service is not available');
    });

    it('should throw specific error for Ollama', async () => {
      const ollamaGenerator = new ContentGenerator(mockClient, {
        llmProvider: 'ollama'
      });
      (ollamaGenerator as any).getCurrentProvider = jest.fn().mockReturnValue('ollama');
      mockClient.isAvailableResponse = false;

      await expect(
        ollamaGenerator.generateTopicVocabulary('food', 'Spanish', 5)
      ).rejects.toThrow('Ollama is running');
    });

    it('should throw specific error for Gemini', async () => {
      const geminiGenerator = new ContentGenerator(mockClient, {
        llmProvider: 'gemini'
      });
      (geminiGenerator as any).getCurrentProvider = jest.fn().mockReturnValue('gemini');
      mockClient.isAvailableResponse = false;

      await expect(
        geminiGenerator.generateTopicVocabulary('food', 'Spanish', 5)
      ).rejects.toThrow('Gemini API');
    });
  });

  describe('validateGeneratedWords', () => {
    it('should filter out invalid words', () => {
      const words: GeneratedWord[] = [
        { word: 'hola', translation: 'hello' },
        { word: '', translation: 'empty' }, // Invalid
        { word: 'casa', translation: 'house' },
        { word: 'perro', translation: '' } // Invalid
      ];

      const validWords = (generator as any).validateGeneratedWords(words);

      expect(validWords).toHaveLength(2);
      expect(validWords.map((w: GeneratedWord) => w.word)).toEqual(['hola', 'casa']);
    });

    it('should filter out words with only whitespace', () => {
      const words: GeneratedWord[] = [
        { word: 'hola', translation: 'hello' },
        { word: '   ', translation: 'whitespace' }, // Invalid
        { word: 'casa', translation: 'house' }
      ];

      const validWords = (generator as any).validateGeneratedWords(words);

      expect(validWords).toHaveLength(2);
      expect(validWords.map((w: GeneratedWord) => w.word)).toEqual(['hola', 'casa']);
    });

    it('should return all valid words', () => {
      const words: GeneratedWord[] = [
        { word: 'hola', translation: 'hello' },
        { word: 'casa', translation: 'house' },
        { word: 'perro', translation: 'dog' }
      ];

      const validWords = (generator as any).validateGeneratedWords(words);

      expect(validWords).toHaveLength(3);
      expect(validWords).toEqual(words);
    });

    it('should handle empty array', () => {
      const words: GeneratedWord[] = [];
      const validWords = (generator as any).validateGeneratedWords(words);

      expect(validWords).toHaveLength(0);
    });
  });

  describe('validateGeneratedSentences', () => {
    it('should filter out invalid sentences', () => {
      const sentences: GeneratedSentence[] = [
        { sentence: 'Hola mundo', translation: 'Hello world' },
        { sentence: '', translation: 'empty' }, // Invalid
        { sentence: 'Buenos días', translation: 'Good morning' },
        { sentence: 'Adiós', translation: '' } // Invalid
      ];

      const validSentences = (generator as any).validateGeneratedSentences(sentences);

      expect(validSentences).toHaveLength(2);
      expect(validSentences.map((s: GeneratedSentence) => s.sentence)).toEqual(['Hola mundo', 'Buenos días']);
    });

    it('should return all valid sentences', () => {
      const sentences: GeneratedSentence[] = [
        { sentence: 'Hola mundo', translation: 'Hello world' },
        { sentence: 'Buenos días', translation: 'Good morning' }
      ];

      const validSentences = (generator as any).validateGeneratedSentences(sentences);

      expect(validSentences).toHaveLength(2);
      expect(validSentences).toEqual(sentences);
    });
  });
});
