/**
 * Backfill script to precompute tokens for all existing sentences in the database.
 * This can be run as a standalone script or integrated into a migration.
 */

import { DatabaseLayer } from '../../shared/types/database.js';
import { Sentence } from '../../shared/types/core.js';
import { precomputeSentenceTokens } from './sentence-preprocessor.js';
import { getLogger } from '../utils/logger.js';

export interface BackfillOptions {
  database: DatabaseLayer;
  batchSize?: number;
  onProgress?: (processed: number, total: number) => void;
}

/**
 * Backfill sentence tokens for all existing sentences in the database.
 */
export async function backfillSentenceTokens(options: BackfillOptions): Promise<void> {
  const { database, batchSize = 10, onProgress } = options;
  const logger = getLogger();

  // Get all sentences from database
  const allSentences = await (database as any).getAllSentences();
  const totalSentences = allSentences.length;

  if (totalSentences === 0) {
    logger.info('[BackfillSentenceTokens] No sentences found to process');
    return;
  }

  // Check if any sentences need tokenization before starting
  const sentencesNeedingTokens = allSentences.filter(
    (sentence: Sentence) => !sentence.tokenizedTokens || sentence.tokenizedTokens.length === 0
  );

  if (sentencesNeedingTokens.length === 0) {
    // All sentences already have tokens, skip silently
    return;
  }

  logger.info(
    {
      sentencesNeedingTokens: sentencesNeedingTokens.length,
      totalSentences,
    },
    '[BackfillSentenceTokens] Starting backfill process'
  );

  let processed = 0;
  let successCount = 0;
  let errorCount = 0;

  // Process sentences in batches
  for (let i = 0; i < sentencesNeedingTokens.length; i += batchSize) {
    const batch = sentencesNeedingTokens.slice(i, i + batchSize);

    for (const sentence of batch) {
      try {
        // Get the primary word for this sentence
        const primaryWord = await database.getWordById(sentence.wordId);
        if (!primaryWord) {
          logger.warn(
            { sentenceId: sentence.id },
            '[BackfillSentenceTokens] Primary word not found for sentence, skipping'
          );
          errorCount++;
          processed++;
          continue;
        }

        // Skip if tokens already exist
        if (sentence.tokenizedTokens && sentence.tokenizedTokens.length > 0) {
          processed++;
          continue;
        }

        // Get all words in the same language
        const allWords = await database.getAllWords(primaryWord.language, true, true);

        // Precompute tokens with dictionary lookups
        const tokenizedTokens = await precomputeSentenceTokens({
          sentence: sentence.sentence,
          targetWord: primaryWord,
          allWords,
          lookupDictionary: (word: string, lang?: string) =>
            database.lookupDictionary(word, lang || primaryWord.language),
          language: primaryWord.language,
          maxPhraseWords: 3,
        });

        // Update sentence with precomputed tokens
        await database.updateSentenceTokens(sentence.id, tokenizedTokens);

        successCount++;
        processed++;

        if (processed % 10 === 0) {
          logger.debug(
            {
              processed,
              total: sentencesNeedingTokens.length,
            },
            '[BackfillSentenceTokens] Progress'
          );
        }
      } catch (error) {
        logger.error(
          { error, sentenceId: sentence.id },
          '[BackfillSentenceTokens] Failed to process sentence'
        );
        errorCount++;
        processed++;
      }
    }

    // Report progress
    if (onProgress) {
      onProgress(processed, sentencesNeedingTokens.length);
    }
  }

  logger.info(
    {
      total: sentencesNeedingTokens.length,
      processed,
      success: successCount,
      errors: errorCount,
    },
    '[BackfillSentenceTokens] Backfill complete'
  );
}
