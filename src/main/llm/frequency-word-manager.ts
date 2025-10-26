/**
 * Manages frequency-based word selection from pre-sorted word lists
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { DatabaseLayer } from '../../shared/types/database.js';

export interface FrequencyWordManagerConfig {
    wordsDirectory: string;
    batchSize: number;
}

export interface WordEntry {
    word: string;
    translation: string | null;
}

export class FrequencyWordManager {
    private config: FrequencyWordManagerConfig;
    private wordLists: Map<string, WordEntry[]> = new Map();
    private wordPositions: Map<string, number> = new Map();

    constructor(config?: Partial<FrequencyWordManagerConfig>) {
        this.config = {
            wordsDirectory: config?.wordsDirectory || join(process.cwd(), 'words'),
            batchSize: config?.batchSize || 10
        };
    }

    /**
     * Initialize word lists for all available languages
     */
    async initialize(): Promise<void> {
        try {
            const availableLanguages = this.getAvailableLanguages();

            for (const language of availableLanguages) {
                await this.loadWordList(language);
            }

            console.log(`Initialized frequency word manager for languages: ${availableLanguages.join(', ')}`);
        } catch (error) {
            throw new Error(`Failed to initialize frequency word manager: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get available languages based on word list files
     */
    getAvailableLanguages(): string[] {
        const languages: string[] = [];

        try {
            const files = ['spanish_words.txt', 'portuguese_words.txt', 'polish_words.txt'];

            for (const file of files) {
                const filePath = join(this.config.wordsDirectory, file);
                if (existsSync(filePath)) {
                    // Extract language name from filename (e.g., 'spanish_words.txt' -> 'spanish')
                    const language = file.replace('_words.txt', '');
                    languages.push(language);
                }
            }
        } catch (error) {
            console.warn('Error scanning for language files:', error);
        }

        return languages;
    }

    /**
     * Load word list for a specific language
     */
    private async loadWordList(language: string): Promise<void> {
        const filePath = join(this.config.wordsDirectory, `${language}_words.txt`);

        if (!existsSync(filePath)) {
            throw new Error(`Word list file not found for language: ${language}`);
        }

        try {
            const content = readFileSync(filePath, 'utf-8');
            const lines = content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            // Parse lines - support both formats: "word" and "word;translation"
            const wordEntries: WordEntry[] = lines.map(line => {
                if (line.includes(';')) {
                    const [word, translation] = line.split(';').map(part => part.trim());
                    return { word, translation };
                } else {
                    // Legacy format - word only (translation will need to be generated)
                    return { word: line, translation: null };
                }
            });

            this.wordLists.set(language, wordEntries);

            // Initialize position tracking for this language
            if (!this.wordPositions.has(language)) {
                this.wordPositions.set(language, 0);
            }

            const withTranslations = wordEntries.filter(entry => entry.translation !== null).length;
            console.log(`Loaded ${wordEntries.length} words for ${language} (${withTranslations} with translations)`);
        } catch (error) {
            throw new Error(`Failed to load word list for ${language}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get the next batch of words to process for a language
     */
    async getNextWordsToProcess(
        language: string,
        database: DatabaseLayer,
        count?: number
    ): Promise<WordEntry[]> {
        const batchSize = count || this.config.batchSize;

        // Ensure word list is loaded
        if (!this.wordLists.has(language)) {
            await this.loadWordList(language);
        }

        const wordList = this.wordLists.get(language);
        if (!wordList) {
            throw new Error(`No word list available for language: ${language}`);
        }

        // Update position based on what's already in the database
        await this.updatePositionFromDatabase(language, database);

        const currentPosition = this.wordPositions.get(language) || 0;
        const nextWords: WordEntry[] = [];

        // Get the next batch of words that aren't already in the database
        let position = currentPosition;
        while (nextWords.length < batchSize && position < wordList.length) {
            const wordEntry = wordList[position];

            // Check if word already exists in database
            const existingWords = await database.getAllWords(true, true, language);
            const wordExists = existingWords.some(w => w.word.toLowerCase() === wordEntry.word.toLowerCase());

            if (!wordExists) {
                nextWords.push(wordEntry);
            }

            position++;
        }

        // Update position
        this.wordPositions.set(language, position);

        return nextWords;
    }

    /**
     * Update the current position based on what words are already in the database
     */
    private async updatePositionFromDatabase(language: string, database: DatabaseLayer): Promise<void> {
        const wordList = this.wordLists.get(language);
        if (!wordList) return;

        try {
            // Get all words for this language from database
            const existingWords = await database.getAllWords(true, true, language);
            const existingWordSet = new Set(existingWords.map(w => w.word.toLowerCase()));

            // Find the highest position of words that exist in database
            let maxPosition = 0;
            for (let i = 0; i < wordList.length; i++) {
                if (existingWordSet.has(wordList[i].word.toLowerCase())) {
                    maxPosition = i + 1; // Position is 1-based for next word
                } else {
                    // If we hit a word that doesn't exist, we can stop here
                    // since words are processed in frequency order
                    break;
                }
            }

            // Update position to continue from where we left off
            const currentPosition = this.wordPositions.get(language) || 0;
            this.wordPositions.set(language, Math.max(currentPosition, maxPosition));

            console.log(`Updated position for ${language}: ${this.wordPositions.get(language)}/${wordList.length}`);
        } catch (error) {
            console.warn(`Failed to update position from database for ${language}:`, error);
        }
    }

    /**
     * Get progress information for a language
     */
    async getLanguageProgress(language: string, database: DatabaseLayer): Promise<{
        totalWords: number;
        processedWords: number;
        currentPosition: number;
        percentComplete: number;
    }> {
        // Ensure word list is loaded
        if (!this.wordLists.has(language)) {
            await this.loadWordList(language);
        }

        const wordList = this.wordLists.get(language);
        if (!wordList) {
            throw new Error(`No word list available for language: ${language}`);
        }

        await this.updatePositionFromDatabase(language, database);

        const totalWords = wordList.length;
        const currentPosition = this.wordPositions.get(language) || 0;
        const processedWords = Math.min(currentPosition, totalWords);
        const percentComplete = totalWords > 0 ? (processedWords / totalWords) * 100 : 0;

        return {
            totalWords,
            processedWords,
            currentPosition,
            percentComplete
        };
    }

    /**
     * Check if there are more words to process for a language
     */
    async hasMoreWords(language: string, database: DatabaseLayer): Promise<boolean> {
        const progress = await this.getLanguageProgress(language, database);
        return progress.currentPosition < progress.totalWords;
    }

    /**
     * Reset position for a language (useful for testing or restarting)
     */
    resetLanguagePosition(language: string): void {
        this.wordPositions.set(language, 0);
    }

    /**
     * Get all available words for a language (for debugging/testing)
     */
    getWordList(language: string): WordEntry[] {
        return this.wordLists.get(language) || [];
    }
}