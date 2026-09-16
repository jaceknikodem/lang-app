/**
 * Bundled dictionary data, lookups, hover tracking and zipf frequencies.
 */

import path from 'path';
import { promises as fsPromises } from 'fs';
import { DictionaryEntry } from '../../shared/types/core.js';
import { wrapError } from '../../shared/utils/error.js';
import { parseGlossesField } from './mappers.js';
import { BaseRepository } from './base-repository.js';
import { DatabaseConnection } from './connection.js';
import { Logger } from '../../shared/utils/logger.js';
import { SettingsRepository } from './settings-repository.js';
import { WordRepository } from './word-repository.js';
import { WordGenerationQueueRepository } from './word-generation-queue-repository.js';

export class DictionaryRepository extends BaseRepository {
  constructor(
    connection: DatabaseConnection,
    logger: Logger,
    private readonly settings: SettingsRepository,
    private readonly words: WordRepository,
    private readonly queue: WordGenerationQueueRepository
  ) {
    super(connection, logger);
  }
  async lookupDictionary(word: string, language: string): Promise<DictionaryEntry[]> {
    return this.query(`Failed to lookup dictionary entry`, (db) => {
      const stmt = db.prepare(`
        SELECT word, pos, glosses, lang
        FROM dict
        WHERE LOWER(word) = LOWER(?) AND lang = ?
        ORDER BY pos ASC, word ASC
      `);

      const rows = stmt.all(word, language) as Array<{
        word: string;
        pos: string;
        glosses: string;
        lang: string;
      }>;

      return rows.map((row) => ({
        word: row.word,
        pos: row.pos,
        glosses: parseGlossesField(row.glosses),
        lang: row.lang,
      }));
    });
  }
  async populateDictionaryFromFiles(): Promise<void> {
    const dictDir = path.join(process.cwd(), 'dicts');

    // Check if directory exists before proceeding
    try {
      await fsPromises.access(dictDir);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ error }, 'Failed to access dictionary directory');
      } else {
        this.logger.warn('Dictionary directory not found, skipping dictionary population');
      }
      return;
    }

    let files: string[];
    try {
      files = await fsPromises.readdir(dictDir);
    } catch (error) {
      this.logger.warn({ error }, 'Failed to read dictionary directory');
      return;
    }

    const jsonlFiles = files.filter((file) => file.endsWith('_dict.jsonl'));
    if (jsonlFiles.length === 0) {
      return;
    }

    const db = this.getDb();
    const deleteStmt = db.prepare('DELETE FROM dict WHERE lang = ?');
    const insertStmt = db.prepare(
      'INSERT INTO dict (word, pos, glosses, lang) VALUES (?, ?, ?, ?)'
    );
    const hasEntriesStmt = db.prepare('SELECT 1 FROM dict WHERE lang = ? LIMIT 1');
    const languagesToProcess: string[] = [];
    for (const file of jsonlFiles) {
      const language = file.replace('_dict.jsonl', '');
      const markerKey = `dictionary_populated_${language}`;
      const alreadyMarked = await this.settings.getSetting(markerKey);
      const existingEntry = hasEntriesStmt.get(language);

      // Skip if already marked as populated AND entries exist
      if (alreadyMarked === 'true' && existingEntry) {
        continue; // Skip this language entirely
      }

      // If entries exist but not marked, just mark it and skip
      if (existingEntry && alreadyMarked !== 'true') {
        await this.settings.setSetting(markerKey, 'true');
        this.logger.info(
          { language },
          `Dictionary entries already present for ${language}, marked as populated`
        );
        continue;
      }

      // Only process languages that need importing
      languagesToProcess.push(language);
    }

    // Early return if all dictionaries are already populated
    if (languagesToProcess.length === 0) {
      this.logger.info('All dictionaries already populated, skipping import');
      return;
    }

    // Now process only the languages that need importing
    for (const language of languagesToProcess) {
      const file = `${language}_dict.jsonl`;
      const filePath = path.join(dictDir, file);
      const markerKey = `dictionary_populated_${language}`;

      try {
        const entries = await this.parseDictionaryFile(filePath, language);

        const transaction = db.transaction(
          (
            dictionaryEntries: Array<{ word: string; pos: string; glosses: string; lang: string }>
          ) => {
            deleteStmt.run(language);
            for (const entry of dictionaryEntries) {
              insertStmt.run(entry.word, entry.pos, entry.glosses, entry.lang);
            }
          }
        );

        transaction(entries);
        await this.settings.setSetting(markerKey, 'true');
        this.logger.info(
          { language, entryCount: entries.length },
          `Dictionary populated for ${language} (${entries.length} entries)`
        );
      } catch (error) {
        this.logger.warn({ error, language }, `Failed to import dictionary for ${language}`);
      }
    }
  }
  private async parseDictionaryFile(
    filePath: string,
    language: string
  ): Promise<Array<{ word: string; pos: string; glosses: string; lang: string }>> {
    let rawContents: string;

    try {
      rawContents = await fsPromises.readFile(filePath, 'utf-8');
    } catch (error) {
      throw wrapError(error, `Unable to read dictionary file ${filePath}`);
    }

    const lines = rawContents.split('\n');
    const entries: Array<{ word: string; pos: string; glosses: string; lang: string }> = [];
    const seen = new Set<string>();

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      try {
        const parsed = JSON.parse(trimmed) as {
          word?: unknown;
          pos?: unknown;
          glosses?: unknown;
        };

        const word = typeof parsed.word === 'string' ? parsed.word.trim() : '';
        if (!word) {
          return;
        }

        const pos = typeof parsed.pos === 'string' ? parsed.pos.trim() : '';

        let glossesArray: string[] = [];
        if (Array.isArray(parsed.glosses)) {
          glossesArray = parsed.glosses.map((gloss) => String(gloss).trim()).filter(Boolean);
        } else if (parsed.glosses) {
          glossesArray = [String(parsed.glosses).trim()].filter(Boolean);
        }

        const dedupeKey = `${word.toLowerCase()}|${pos.toLowerCase()}|${glossesArray.join('|').toLowerCase()}|${language}`;
        if (seen.has(dedupeKey)) {
          return;
        }

        seen.add(dedupeKey);
        entries.push({
          word,
          pos,
          glosses: JSON.stringify(glossesArray),
          lang: language,
        });
      } catch (error) {
        this.logger.warn(
          { error, filePath: path.basename(filePath), lineNumber: index + 1 },
          `Failed to parse dictionary entry in ${path.basename(filePath)} at line ${index + 1}`
        );
      }
    });

    return entries;
  }
  async recordDictionaryHover(data: {
    word: string;
    language: string;
    sentenceId?: number;
    sessionId?: number;
    hoverDurationMs: number;
    dictionaryKey?: string;
    foundInDict: boolean;
  }): Promise<number> {
    return this.query(`Failed to record dictionary hover event`, (db) => {
      const stmt = db.prepare(`
        INSERT INTO dictionary_hover_events (word, language, sentence_id, session_id, hover_duration_ms, dictionary_key, found_in_dict)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.word,
        data.language,
        data.sentenceId || null,
        data.sessionId || null,
        data.hoverDurationMs,
        data.dictionaryKey || null,
        data.foundInDict ? 1 : 0
      );

      return result.lastInsertRowid as number;
    });
  }
  async processFrequentlyLookedUpWords(
    language: string,
    minHoverCount: number = 3,
    lookbackDays: number = 30
  ): Promise<number> {
    const db = this.getDb();

    try {
      // Calculate the lookback date
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
      const lookbackDateStr = lookbackDate.toISOString();

      // Find frequently looked-up words from dictionary_hover_events
      // Group by word and language, count occurrences, filter by min count and lookback period
      const frequentlyLookedUpStmt = db.prepare(`
        SELECT 
          word,
          language,
          COUNT(*) as hover_count,
          MAX(created_at) as last_hover
        FROM dictionary_hover_events
        WHERE language = ?
          AND created_at >= ?
          AND found_in_dict = 1
        GROUP BY word, language
        HAVING COUNT(*) >= ?
        ORDER BY hover_count DESC, last_hover DESC
      `);

      const frequentlyLookedUp = frequentlyLookedUpStmt.all(
        language,
        lookbackDateStr,
        minHoverCount
      ) as Array<{
        word: string;
        language: string;
        hover_count: number;
        last_hover: string;
      }>;

      if (frequentlyLookedUp.length === 0) {
        this.logger.debug(
          { language: language },
          `[processFrequentlyLookedUpWords] No frequently looked-up words found for ${language}`
        );
        return 0;
      }

      this.logger.debug(
        { language: language, wordCount: frequentlyLookedUp.length },
        `[processFrequentlyLookedUpWords] Found ${frequentlyLookedUp.length} frequently looked-up words for ${language}`
      );

      // Check which words already exist in the words table
      const checkWordExistsStmt = db.prepare(`
        SELECT id FROM words 
        WHERE LOWER(word) = LOWER(?) AND language = ?
      `);

      // Get dictionary lookup for translation
      const getDictTranslationStmt = db.prepare(`
        SELECT glosses 
        FROM dict 
        WHERE LOWER(word) = LOWER(?) AND lang = ?
        LIMIT 1
      `);

      let wordsAdded = 0;
      const wordsToAdd: Array<{ word: string; language: string; translation: string }> = [];

      for (const item of frequentlyLookedUp) {
        // Check if word already exists
        const existingWord = checkWordExistsStmt.get(item.word, item.language) as
          | { id: number }
          | undefined;

        if (existingWord) {
          // Word already exists, skip
          continue;
        }

        // Try to get translation from dictionary
        const dictEntry = getDictTranslationStmt.get(item.word, item.language) as
          | { glosses: string }
          | undefined;

        let translation: string;
        if (dictEntry && dictEntry.glosses) {
          try {
            const glosses = JSON.parse(dictEntry.glosses);
            if (Array.isArray(glosses) && glosses.length > 0) {
              translation = glosses[0]; // Use first gloss as translation
            } else {
              translation = item.word; // Fallback to word itself
            }
          } catch {
            // If parsing fails, try to extract from string
            const glossesStr = dictEntry.glosses.trim();
            if (glossesStr) {
              translation = glossesStr.split(/[;,]/)[0].trim() || item.word;
            } else {
              translation = item.word;
            }
          }
        } else {
          // No dictionary entry found, use word as placeholder
          translation = item.word;
        }

        wordsToAdd.push({
          word: item.word,
          language: item.language,
          translation,
        });
      }

      if (wordsToAdd.length === 0) {
        this.logger.debug(
          `[processFrequentlyLookedUpWords] All frequently looked-up words already exist`
        );
        return 0;
      }

      this.logger.info(
        { wordCount: wordsToAdd.length },
        `[processFrequentlyLookedUpWords] Adding ${wordsToAdd.length} new words from dictionary hovers`
      );

      // Insert words and enqueue for generation
      for (const wordData of wordsToAdd) {
        try {
          // Insert word
          const wordId = await this.words.insertWord({
            word: wordData.word,
            language: wordData.language,
            translation: wordData.translation,
          });

          // Enqueue for sentence generation
          await this.queue.enqueueWordGeneration(wordId, wordData.language, undefined, 3);

          wordsAdded++;
          this.logger.debug(
            { wordId, word: wordData.word },
            `[processFrequentlyLookedUpWords] Added word: ${wordData.word} (ID: ${wordId})`
          );
        } catch (error) {
          this.logger.warn(
            { error, word: wordData.word },
            `[processFrequentlyLookedUpWords] Failed to add word "${wordData.word}"`
          );
          // Continue with next word
        }
      }

      this.logger.info(
        { wordsAdded },
        `[processFrequentlyLookedUpWords] Successfully added ${wordsAdded} words from dictionary hovers`
      );
      return wordsAdded;
    } catch (error) {
      throw wrapError(error, `Failed to process frequently looked-up words`);
    }
  }
  async getZipfFrequencies(words: string[], language: string): Promise<Record<string, number>> {
    return this.query(`Failed to get zipf frequencies`, (db) => {
      if (words.length === 0) {
        return {};
      }

      // Create placeholders for IN clause
      const placeholders = words.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT word, zipf_frequency 
        FROM words 
        WHERE word IN (${placeholders}) 
        AND language = ? 
        AND zipf_frequency IS NOT NULL
      `);

      const rows = stmt.all(...words, language) as Array<{ word: string; zipf_frequency: number }>;
      const result: Record<string, number> = {};

      for (const row of rows) {
        result[row.word] = row.zipf_frequency;
      }

      return result;
    });
  }
  async updateZipfFrequencies(
    frequencies: Record<string, number>,
    language: string
  ): Promise<void> {
    this.query(`Failed to update zipf frequencies`, (db) => {
      if (Object.keys(frequencies).length === 0) {
        return;
      }

      const updateStmt = db.prepare(`
        UPDATE words 
        SET zipf_frequency = ? 
        WHERE word = ? AND language = ?
      `);

      const transaction = db.transaction((freqs: Record<string, number>) => {
        for (const [word, frequency] of Object.entries(freqs)) {
          updateStmt.run(frequency, word, language);
        }
      });

      transaction(frequencies);

      this.logger.debug(
        { wordCount: Object.keys(frequencies).length, language },
        '[updateZipfFrequencies] Updated zipf frequencies'
      );
    });
  }
}
