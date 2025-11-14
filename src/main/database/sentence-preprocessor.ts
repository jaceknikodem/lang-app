/**
 * Service for precomputing sentence tokenization and dictionary lookups.
 * This runs offline when sentences are created, storing results in the database.
 */

import { Word, DictionaryEntry, PrecomputedToken } from '../../shared/types/core.js';
import { tokenizeSentenceWithDictionary } from '../../renderer/utils/sentence-tokenizer.js';
import type { TokenizedWord } from '../../renderer/utils/sentence-tokenizer.js';
import type { LemmatizationService } from '../lemmatization/index.js';
import { getLogger } from '../utils/logger.js';

export interface PrecomputeSentenceTokensParams {
  sentence: string;
  targetWord: Word;
  allWords: Word[];
  lookupDictionary: (word: string, language?: string) => Promise<DictionaryEntry[]>;
  language?: string;
  maxPhraseWords?: number;
  lemmatizationService?: LemmatizationService;
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
      cache: undefined, // Start fresh for precomputation
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
      dictionaryKey: token.dictionaryKey,
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

  // Lemmatize words if service is available (skip for Japanese)
  if (params.lemmatizationService && language) {
    // Skip lemmatization for Japanese
    const normalizedLanguage = language.toLowerCase().trim();
    if (normalizedLanguage === 'japanese' || normalizedLanguage === 'ja') {
      const logger = getLogger();
      logger.debug({ language }, '[Lemmatization] Skipping lemmatization for Japanese');
    } else {
      try {
        // Extract unique words that need lemmatization
        const wordsToLemmatize: string[] = [];
        const wordToTokenMap = new Map<string, number[]>();

        precomputedTokens.forEach((token, index) => {
          if (token.dictionaryForm && !token.lemma) {
            const cleanText = token.dictionaryForm.toLowerCase().trim();
            if (cleanText) {
              if (!wordToTokenMap.has(cleanText)) {
                wordsToLemmatize.push(cleanText);
                wordToTokenMap.set(cleanText, []);
              }
              wordToTokenMap.get(cleanText)!.push(index);
            }
          }
        });

        if (wordsToLemmatize.length > 0) {
          const logger = getLogger();
          logger.debug(
            {
              wordCount: wordsToLemmatize.length,
              language,
            },
            '[Lemmatization] Lemmatizing words during sentence preprocessing'
          );
          const lemmas = await params.lemmatizationService.lemmatizeWords(
            wordsToLemmatize,
            language
          );

          // Apply lemmas to tokens
          wordToTokenMap.forEach((indices, word) => {
            const lemma = lemmas[word];
            if (lemma) {
              indices.forEach((index) => {
                precomputedTokens[index].lemma = lemma;
              });
            }
          });

          const lemmaCount = Object.keys(lemmas).length;
          logger.debug(
            { lemmaCount, language },
            '[Lemmatization] Applied lemmas to precomputed tokens'
          );
        }
      } catch (error) {
        const logger = getLogger();
        logger.warn(
          {
            error,
            language,
          },
          '[Lemmatization] Failed to lemmatize words during preprocessing (non-critical)'
        );
        // Continue without lemmas - sentence will still work
      }
    }
  }

  return precomputedTokens;
}
