/**
 * Manages frequency-based word selection from pre-sorted word lists
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { DatabaseLayer } from '../../shared/types/database.js';
import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';

export interface FrequencyWordManagerConfig {
  wordsDirectory: string;
  batchSize: number;
}

export interface WordEntry {
  word: string;
  translation: string;
  position?: number; // 1-based position in frequency list
}

export class FrequencyWordManager {
  private config: FrequencyWordManagerConfig;
  private wordLists: Map<string, WordEntry[]> = new Map();
  private wordPositions: Map<string, number> = new Map();
  private readonly logger: Logger;

  constructor(config?: Partial<FrequencyWordManagerConfig>) {
    this.logger = getLogger();
    this.config = {
      wordsDirectory: config?.wordsDirectory || join(process.cwd(), 'words'),
      batchSize: config?.batchSize || 10,
    };
  }

  /**
   * Initialize word lists for all available languages
   * Optimized: Don't load all word lists at startup - load lazily when needed
   */
  async initialize(): Promise<void> {
    // Lazy initialization - don't load word lists until they're actually needed
    // This significantly speeds up application startup
    this.logger.info('Frequency word manager initialized (lazy loading enabled)');
  }

  /**
   * Get available languages based on word list files
   */
  getAvailableLanguages(): string[] {
    const languages: string[] = [];

    try {
      const files = readdirSync(this.config.wordsDirectory);

      for (const file of files) {
        if (file.endsWith('_words.txt')) {
          const filePath = join(this.config.wordsDirectory, file);
          if (existsSync(filePath)) {
            // Extract language name from filename (e.g., 'spanish_words.txt' -> 'spanish')
            const language = file.replace('_words.txt', '');
            languages.push(language);
          }
        }
      }
    } catch (error) {
      this.logger.warn({ error }, 'Error scanning for language files');
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
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      // Parse lines - require "word;translation" format
      const wordEntries: WordEntry[] = lines.map((line, index) => {
        if (!line.includes(';')) {
          throw new Error(
            `Invalid format at line ${index + 1}: missing semicolon. Expected format: "word;translation"`
          );
        }
        const [word, translation] = line.split(';').map((part) => part.trim());
        if (!word || !translation) {
          throw new Error(
            `Invalid format at line ${index + 1}: word or translation is empty. Expected format: "word;translation"`
          );
        }
        return { word, translation, position: index + 1 };
      });

      this.wordLists.set(language, wordEntries);

      // Initialize position tracking for this language
      if (!this.wordPositions.has(language)) {
        this.wordPositions.set(language, 0);
      }

      this.logger.info(
        { language, totalWords: wordEntries.length },
        `Loaded ${wordEntries.length} words for ${language}`
      );
    } catch (error) {
      throw new Error(
        `Failed to load word list for ${language}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get the minimum starting position based on proficiency level
   */
  private getMinPositionForProficiency(proficiencyLevel?: string): number {
    if (!proficiencyLevel) return 0;

    const level = proficiencyLevel.toLowerCase();
    switch (level) {
      case 'a1':
        return 200; // Skip top 200 words for A1
      case 'a2':
        return 500; // Skip top 500 words for A2
      case 'b1':
        return 1000; // Skip top 1000 words for B1 (skips current word lists entirely)
      default:
        return 0; // No minimum for other levels
    }
  }

  /**
   * Get the next batch of words to process for a language
   */
  async getNextWordsToProcess(
    language: string,
    database: DatabaseLayer,
    count?: number,
    proficiencyLevel?: string
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

    // Calculate minimum starting position based on proficiency level
    const minPositionForProficiency = this.getMinPositionForProficiency(proficiencyLevel);
    const currentPosition = this.wordPositions.get(language) || 0;

    // Use the maximum of current position and minimum position for proficiency
    // This ensures we skip words that are too frequent for the proficiency level
    const startPosition = Math.max(currentPosition, minPositionForProficiency);

    if (minPositionForProficiency > 0 && startPosition === minPositionForProficiency) {
      this.logger.info(
        { startPosition, proficiencyLevel, minPositionForProficiency },
        `Starting at position ${startPosition} for proficiency level ${proficiencyLevel} (skipping top ${minPositionForProficiency} words)`
      );
    }

    const nextWords: WordEntry[] = [];

    // Get the next batch of words that aren't already in the database
    let position = startPosition;
    while (nextWords.length < batchSize && position < wordList.length) {
      const wordEntry = wordList[position];

      // Check if word already exists in database
      const existingWords = await database.getAllWords(language, true, true);
      const wordExists = existingWords.some(
        (w) => w.word.toLowerCase() === wordEntry.word.toLowerCase()
      );

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
  private async updatePositionFromDatabase(
    language: string,
    database: DatabaseLayer
  ): Promise<void> {
    const wordList = this.wordLists.get(language);
    if (!wordList) return;

    try {
      // Get all words for this language from database
      const existingWords = await database.getAllWords(language, true, true);
      const existingWordSet = new Set(existingWords.map((w) => w.word.toLowerCase()));

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

      this.logger.info(
        { language, position: this.wordPositions.get(language), totalWords: wordList.length },
        `Updated position for ${language}: ${this.wordPositions.get(language)}/${wordList.length}`
      );
    } catch (error) {
      this.logger.warn(
        { error, language },
        `Failed to update position from database for ${language}`
      );
    }
  }

  /**
   * Get progress information for a language
   */
  async getLanguageProgress(
    language: string,
    database: DatabaseLayer
  ): Promise<{
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
      percentComplete,
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

  /**
   * Get the frequency position of a specific word
   * Returns the 1-based position in the frequency list, or undefined if not found
   */
  getWordFrequencyPosition(word: string, language: string): number | undefined {
    const wordList = this.wordLists.get(language);
    if (!wordList) {
      return undefined;
    }

    const normalizedWord = word.toLowerCase().trim();
    const entry = wordList.find((entry) => entry.word.toLowerCase().trim() === normalizedWord);
    return entry?.position;
  }

  /**
   * Get frequency tier description based on position
   */
  getFrequencyTier(position: number): string | undefined {
    if (position <= 100) {
      return 'top 100';
    } else if (position <= 200) {
      return 'top 200';
    } else if (position <= 500) {
      return 'top 500';
    } else if (position <= 1000) {
      return 'top 1000';
    }
    return undefined; // Don't show anything for words beyond top 1000
  }
}
