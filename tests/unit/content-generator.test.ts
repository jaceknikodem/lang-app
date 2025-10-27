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
                translation: topic ? `${topic} word ${i}` : `general word ${i}`
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
                5
            );

            expect(words).toHaveLength(5);

            // Check that all expected words are present (order may vary due to shuffling)
            const wordTexts = words.map(w => w.word);
            for (let i = 1; i <= 5; i++) {
                expect(wordTexts).toContain(`general_word_${i}`);
            }

            // Check that first word has expected structure (regardless of which one it is)
            expect(words[0].word).toMatch(/^general_word_\d+$/);
            expect(words[0].translation).toMatch(/^general word \d+$/);
        });

        test('should generate multiple words for specific topic', async () => {
            const words = await contentGenerator.generateTopicVocabulary(
                'food',
                'Spanish',
                5
            );

            expect(words).toHaveLength(5);

            // Check that all expected words are present (order may vary due to shuffling)
            const wordTexts = words.map(w => w.word);
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
            const wordTexts = words.map(w => w.word);
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
            const wordTexts = words.map(w => w.word);
            for (let i = 1; i <= 3; i++) {
                expect(wordTexts).toContain(`general_word_${i}`);
            }
        });

        test('should shuffle words to provide variety in order', async () => {
            // Generate words multiple times and check that order varies
            const results = [];
            for (let i = 0; i < 5; i++) {
                const words = await contentGenerator.generateTopicVocabulary(
                    'test',
                    'Spanish',
                    5
                );
                results.push(words.map(w => w.word));
            }

            // Check that not all results are identical (shuffling should provide variety)
            const firstResult = results[0];
            const allIdentical = results.every(result =>
                result.every((word, index) => word === firstResult[index])
            );

            // With shuffling, it's extremely unlikely all 5 results would be identical
            // (probability is 1/5! = 1/120 for each comparison, much lower for all)
            expect(allIdentical).toBe(false);
        });
    });
});