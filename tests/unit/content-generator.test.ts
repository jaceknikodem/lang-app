/**
 * Unit tests for ContentGenerator
 */

import { ContentGenerator } from '../../src/main/llm/content-generator';
import { OllamaClient } from '../../src/main/llm/ollama-client';
import { GeneratedWord } from '../../src/shared/types/core';

// Mock the OllamaClient
class MockOllamaClient {
    async isAvailable(): Promise<boolean> {
        return true;
    }

    async generateTopicWords(topic: string, language: string, count: number): Promise<GeneratedWord[]> {
        // Simulate generating the requested number of words
        const words: GeneratedWord[] = [];
        for (let i = 1; i <= count; i++) {
            words.push({
                word: topic ? `${topic}_word_${i}` : `general_word_${i}`,
                translation: topic ? `${topic} word ${i}` : `general word ${i}`,
                frequency: i <= 3 ? 'high' : i <= 7 ? 'medium' : 'low'
            });
        }
        return words;
    }

    async generateSentences(): Promise<any[]> {
        return [];
    }

    async getAvailableModels(): Promise<string[]> {
        return ['test-model'];
    }

    setModel(): void { }

    getCurrentModel(): string {
        return 'test-model';
    }
}

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
                10
            );

            expect(words).toHaveLength(10);
            expect(words[0].word).toBe('general_word_1');
            expect(words[0].translation).toBe('general word 1');
            expect(words[0].frequency).toBe('high');
        });

        test('should generate multiple words for specific topic', async () => {
            const words = await contentGenerator.generateTopicVocabulary(
                'food',
                'Spanish',
                5
            );

            expect(words).toHaveLength(5);
            expect(words[0].word).toBe('food_word_1');
            expect(words[0].translation).toBe('food word 1');
            expect(words[0].frequency).toBe('high');
        });

        test('should handle empty topic string as general vocabulary', async () => {
            const words = await contentGenerator.generateTopicVocabulary(
                '', // Empty topic - should generate general vocabulary
                'Spanish',
                3
            );

            expect(words).toHaveLength(3);
            expect(words[0].word).toBe('general_word_1');
        });

        test('should handle whitespace-only topic as general vocabulary', async () => {
            const words = await contentGenerator.generateTopicVocabulary(
                '   ', // Whitespace-only topic - should generate general vocabulary
                'Spanish',
                3
            );

            expect(words).toHaveLength(3);
            expect(words[0].word).toBe('general_word_1');
        });
    });
});