/**
 * Backfill script to precompute tokens for all existing sentences in the database.
 * This can be run as a standalone script or integrated into a migration.
 */

import { DatabaseLayer } from '../../shared/types/database.js';
import { precomputeSentenceTokens } from './sentence-preprocessor.js';

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

  console.log('[BackfillSentenceTokens] Starting backfill process...');

  // Get all sentences from database
  const allSentences = await (database as any).getAllSentences();
  const totalSentences = allSentences.length;

  if (totalSentences === 0) {
    console.log('[BackfillSentenceTokens] No sentences found to process');
    return;
  }

  console.log(`[BackfillSentenceTokens] Processing ${totalSentences} sentences...`);

  let processed = 0;
  let successCount = 0;
  let errorCount = 0;

  // Process sentences in batches
  for (let i = 0; i < allSentences.length; i += batchSize) {
    const batch = allSentences.slice(i, i + batchSize);

    for (const sentence of batch) {
      try {
        // Get the primary word for this sentence
        const primaryWord = await database.getWordById(sentence.wordId);
        if (!primaryWord) {
          console.warn(`[BackfillSentenceTokens] Primary word not found for sentence ${sentence.id}, skipping`);
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
        const allWords = await database.getAllWords(true, true, primaryWord.language);

        // Precompute tokens with dictionary lookups
        const tokenizedTokens = await precomputeSentenceTokens({
          sentence: sentence.sentence,
          targetWord: primaryWord,
          allWords,
          lookupDictionary: (word: string, lang?: string) => 
            database.lookupDictionary(word, lang || primaryWord.language),
          language: primaryWord.language,
          maxPhraseWords: 3
        });

        // Update sentence with precomputed tokens
        await database.updateSentenceTokens(sentence.id, tokenizedTokens);

        successCount++;
        processed++;

        if (processed % 10 === 0) {
          console.log(`[BackfillSentenceTokens] Progress: ${processed}/${totalSentences} sentences processed`);
        }
      } catch (error) {
        console.error(`[BackfillSentenceTokens] Failed to process sentence ${sentence.id}:`, error);
        errorCount++;
        processed++;
      }
    }

    // Report progress
    if (onProgress) {
      onProgress(processed, totalSentences);
    }
  }

  console.log(`[BackfillSentenceTokens] Backfill complete:`, {
    total: totalSentences,
    processed,
    success: successCount,
    errors: errorCount
  });
}

