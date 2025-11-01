/**
 * Service for precomputing sentence tokenization and dictionary lookups.
 * This runs offline when sentences are created, storing results in the database.
 */

import { Word, DictionaryEntry, PrecomputedToken } from '../../shared/types/core.js';
import { tokenizeSentenceWithDictionary } from '../../renderer/utils/sentence-tokenizer.js';
import type { TokenizedWord } from '../../renderer/utils/sentence-tokenizer.js';
import type { LemmatizationService } from '../lemmatization/index.js';

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
      cache: undefined // Start fresh for precomputation
    },
    { maxPhraseWords }
  );

  // Convert TokenizedWord[] to PrecomputedToken[]
  // Extract dictionary entries from cache and attach to tokens
  let precomputedTokens: PrecomputedToken[] = words.map((token: TokenizedWord) => {
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

  // Lemmatize words if service is available
  if (params.lemmatizationService && language) {
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
        console.log(`[Lemmatization] Lemmatizing ${wordsToLemmatize.length} words during sentence preprocessing for language: ${language}`);
        const lemmas = await params.lemmatizationService.lemmatizeWords(wordsToLemmatize, language);
        
        // Apply lemmas to tokens
        wordToTokenMap.forEach((indices, word) => {
          const lemma = lemmas[word];
          if (lemma) {
            indices.forEach(index => {
              precomputedTokens[index].lemma = lemma;
            });
          }
        });
        
        const lemmaCount = Object.keys(lemmas).length;
        console.log(`[Lemmatization] Applied ${lemmaCount} lemmas to precomputed tokens`);
      }
    } catch (error) {
      console.warn('[Lemmatization] Failed to lemmatize words during preprocessing (non-critical):', error);
      // Continue without lemmas - sentence will still work
    }
  }

  return precomputedTokens;
}

