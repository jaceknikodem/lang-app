/**
 * Simple integration test for duplicate checking functionality
 */

import { OllamaClient } from '../../dist/main/main/llm/ollama-client.js';

describe('Duplicate Checking Simple Integration', () => {
  let ollamaClient: OllamaClient;

  beforeEach(() => {
    ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      timeout: 5000,
      maxRetries: 1
    });
  });

  describe('Database Layer Integration', () => {
    it('should handle database layer injection correctly', () => {
      const mockDatabase = {
        getAllWords: jest.fn().mockResolvedValue([])
      };

      expect(() => {
        ollamaClient.setDatabaseLayer(mockDatabase);
      }).not.toThrow();
    });

    it('should work without database layer (graceful fallback)', async () => {
      // Mock fetch to simulate Ollama response
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          response: JSON.stringify([
            { word: 'test', translation: 'test', frequency: 'high' }
          ])
        })
      } as Response);

      global.fetch = mockFetch;

      // Should work without database layer
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      const result = await ollamaClient.generateTopicWords('test', 'Spanish', 1);
      
      expect(result).toHaveLength(1);
      expect(result[0].word).toBe('test');
      expect(consoleSpy).toHaveBeenCalledWith('Database layer not set, cannot check for duplicates');
      
      consoleSpy.mockRestore();
    });

    it('should use database layer when available', async () => {
      const mockDatabase = {
        getAllWords: jest.fn().mockResolvedValue([
          { word: 'existing', language: 'Spanish', translation: 'existing' }
        ])
      };

      ollamaClient.setDatabaseLayer(mockDatabase);

      // Mock fetch to simulate Ollama response with duplicate
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          response: JSON.stringify([
            { word: 'existing', translation: 'existing', frequency: 'high' }, // Should be filtered
            { word: 'new', translation: 'new', frequency: 'high' }
          ])
        })
      } as Response);

      global.fetch = mockFetch;

      const result = await ollamaClient.generateTopicWords('test', 'Spanish', 2);
      
      // Should filter out 'existing' and only return 'new'
      expect(result).toHaveLength(1);
      expect(result[0].word).toBe('new');
      expect(mockDatabase.getAllWords).toHaveBeenCalledWith(true, true);
    });

    it('should handle database errors gracefully', async () => {
      const mockDatabase = {
        getAllWords: jest.fn().mockRejectedValue(new Error('Database error'))
      };

      ollamaClient.setDatabaseLayer(mockDatabase);

      // Mock fetch
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          response: JSON.stringify([
            { word: 'test', translation: 'test', frequency: 'high' }
          ])
        })
      } as Response);

      global.fetch = mockFetch;

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      // Should still work despite database error
      const result = await ollamaClient.generateTopicWords('test', 'Spanish', 1);
      
      expect(result).toHaveLength(1);
      expect(result[0].word).toBe('test');
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to get existing words for duplicate checking:',
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('Prompt Enhancement', () => {
    it('should include existing words in exclusion list', async () => {
      const mockDatabase = {
        getAllWords: jest.fn().mockResolvedValue([
          { word: 'exclude1', language: 'Spanish', translation: 'test' },
          { word: 'exclude2', language: 'Spanish', translation: 'test' }
        ])
      };

      ollamaClient.setDatabaseLayer(mockDatabase);

      // Mock fetch to capture the prompt
      let capturedPrompt = '';
      const mockFetch = jest.fn().mockImplementation((url, options) => {
        const body = JSON.parse(options.body);
        capturedPrompt = body.prompt;
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: JSON.stringify([
              { word: 'new', translation: 'new', frequency: 'high' }
            ])
          })
        } as Response);
      });

      global.fetch = mockFetch;

      await ollamaClient.generateTopicWords('test', 'Spanish', 1);
      
      // Verify prompt includes exclusion instructions
      expect(capturedPrompt).toContain('Do NOT include any of these existing words');
      expect(capturedPrompt).toContain('exclude1');
      expect(capturedPrompt).toContain('exclude2');
    });

    it('should handle large exclusion lists by truncating', async () => {
      const existingWords = Array.from({ length: 60 }, (_, i) => ({
        word: `word${i}`,
        language: 'Spanish',
        translation: 'test'
      }));

      const mockDatabase = {
        getAllWords: jest.fn().mockResolvedValue(existingWords)
      };

      ollamaClient.setDatabaseLayer(mockDatabase);

      let capturedPrompt = '';
      const mockFetch = jest.fn().mockImplementation((url, options) => {
        const body = JSON.parse(options.body);
        capturedPrompt = body.prompt;
        
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            response: JSON.stringify([
              { word: 'new', translation: 'new', frequency: 'high' }
            ])
          })
        } as Response);
      });

      global.fetch = mockFetch;

      await ollamaClient.generateTopicWords('test', 'Spanish', 1);
      
      // Should truncate at 50 words and include "..."
      expect(capturedPrompt).toContain('...');
      expect(capturedPrompt).toContain('word49');
      expect(capturedPrompt).not.toContain('word50');
    });
  });
});