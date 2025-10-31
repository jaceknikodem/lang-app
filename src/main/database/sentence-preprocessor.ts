/**
 * Service for precomputing sentence tokenization and dictionary lookups.
 * This runs offline when sentences are created, storing results in the database.
 */

import { Word, DictionaryEntry, PrecomputedToken } from '../../shared/types/core.js';
import { tokenizeSentenceWithDictionary } from '../../renderer/utils/sentence-tokenizer.js';
import type { TokenizedWord } from '../../renderer/utils/sentence-tokenizer.js';

export interface PrecomputeSentenceTokensParams {
  sentence: string;
  targetWord: Word;
  allWords: Word[];
  lookupDictionary: (word: string, language?: string) => Promise<DictionaryEntry[]>;
  language?: string;
  maxPhraseWords?: number;
}

/**
 * Precompute sentence tokens with full phrase detection and dictionary lookups.
 * This performs all the expensive processing upfront and stores the results.
 */
export async function precomputeSentenceTokens(
  params: PrecomputeSentenceTokensParams
): Promise<PrecomputedToken[]> {
  const { sentence, targetWord, allWords, lookupDictionary, language, maxPhraseWords = 3 } = params;

  if (!sentence) {
    return [];
  }

  // Use the existing tokenization logic which handles phrase detection
  const { words, cache } = await tokenizeSentenceWithDictionary(
    {
      sentence,
      targetWord,
      allWords,
      lookupDictionary,
      language,
      cache: undefined // Start fresh for precomputation
    },
    { maxPhraseWords }
  );

  // Convert TokenizedWord[] to PrecomputedToken[]
  // Extract dictionary entries from cache and attach to tokens
  const precomputedTokens: PrecomputedToken[] = words.map((token: TokenizedWord) => {
    const precomputed: PrecomputedToken = {
      text: token.text,
      isTargetWord: token.isTargetWord,
      dictionaryForm: token.dictionaryForm,
      dictionaryKey: token.dictionaryKey
    };

    // Store word ID if there's matching word data
    if (token.wordData) {
      precomputed.wordId = token.wordData.id;
    }

    // Attach dictionary entries from cache if available
    if (token.dictionaryKey) {
      const dictionaryEntries = cache.get(token.dictionaryKey);
      if (dictionaryEntries) {
        precomputed.dictionaryEntries = dictionaryEntries;
      }
    }

    return precomputed;
  });

  return precomputedTokens;
}

