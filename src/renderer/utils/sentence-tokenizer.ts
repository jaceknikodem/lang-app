import type { DictionaryEntry, Word } from '../../shared/types/core.js';

export interface TokenizedWord {
  text: string;
  isTargetWord: boolean;
  wordData?: Word;
  dictionaryForm?: string;
  dictionaryKey?: string;
  lemma?: string; // Lemmatized version of the word
}

export interface TokenizeSentenceOptions {
  maxPhraseWords?: number;
}

export interface TokenizeSentenceParams {
  sentence: string;
  targetWord: Word;
  allWords: Word[];
  lookupDictionary: (word: string, language?: string) => Promise<DictionaryEntry[]>;
  language?: string;
  cache?: Map<string, DictionaryEntry[] | null>;
}

interface InternalToken {
  text: string;
  type: 'word' | 'whitespace' | 'punctuation';
}

interface PhraseCandidate {
  text: string;
  dictionaryForm: string;
  dictionaryKey?: string;
  endIndex: number;
  wordCount: number;
}

export async function tokenizeSentenceWithDictionary(
  params: TokenizeSentenceParams,
  options: TokenizeSentenceOptions = {}
): Promise<{
  words: TokenizedWord[];
  cache: Map<string, DictionaryEntry[] | null>;
}> {
  const { sentence, targetWord, allWords, lookupDictionary, language, cache } = params;
  const maxPhraseWords = options.maxPhraseWords ?? 4;

  const dictionaryCache = cache ?? new Map<string, DictionaryEntry[] | null>();
  const fallbackLanguage = language || targetWord?.language?.toLowerCase();

  if (!sentence) {
    return { words: [], cache: dictionaryCache };
  }

  const parts = sentence.split(/(\s+|[.,!?;:])/);
  const tokens: InternalToken[] = parts
    .filter(part => part !== '')
    .map(part => {
      if (/^\s+$/.test(part)) {
        return { text: part, type: 'whitespace' as const };
      }

      if (/^[.,!?;:]+$/.test(part)) {
        return { text: part, type: 'punctuation' as const };
      }

      return { text: part, type: 'word' as const };
    });

  const wordLookup = new Map<string, Word>();
  for (const word of allWords) {
    wordLookup.set(word.word.toLowerCase(), word);
  }

  const words: TokenizedWord[] = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];

    if (token.type !== 'word') {
      words.push({ text: token.text, isTargetWord: false });
      index += 1;
      continue;
    }

    const candidates = collectPhraseCandidates(tokens, index, maxPhraseWords, targetWord);

    if (!candidates.length) {
      words.push({ text: token.text, isTargetWord: false });
      index += 1;
      continue;
    }

    let selected = candidates[0];

    for (let c = candidates.length - 1; c >= 0; c--) {
      const candidate = candidates[c];

      if (candidate.wordCount <= 1) {
        break;
      }

      const entries = await getDictionaryEntries({
        lookupDictionary,
        dictionaryForm: candidate.dictionaryForm,
        dictionaryKey: candidate.dictionaryKey,
        cache: dictionaryCache,
        language: fallbackLanguage
      });

      if (entries && entries.length > 0) {
        selected = candidate;
        break;
      }
    }

    const dictionaryForm = selected.dictionaryForm;
    const cleanText = dictionaryForm.toLowerCase();

    if (!cleanText) {
      words.push({ text: selected.text, isTargetWord: false });
      index = selected.endIndex;
      continue;
    }

    const dictionaryKey = selected.dictionaryKey ?? buildDictionaryKey(dictionaryForm, fallbackLanguage);
    const wordData = wordLookup.get(cleanText);
    const isTargetWord = Boolean(targetWord?.word && cleanText === targetWord.word.toLowerCase());

    words.push({
      text: selected.text,
      isTargetWord,
      wordData,
      dictionaryForm,
      dictionaryKey
    });

    index = selected.endIndex;
  }

  return { words, cache: dictionaryCache };
}

function collectPhraseCandidates(
  tokens: InternalToken[],
  startIndex: number,
  maxPhraseWords: number,
  targetWord: Word
): PhraseCandidate[] {
  const candidates: PhraseCandidate[] = [];

  let index = startIndex;
  let currentText = '';
  const dictionaryWords: string[] = [];
  let wordsCollected = 0;

  while (index < tokens.length && wordsCollected < maxPhraseWords) {
    const token = tokens[index];

    if (token.type !== 'word') {
      break;
    }

    currentText += token.text;
    dictionaryWords.push(normalizeForDictionary(token.text));
    wordsCollected += 1;
    index += 1;

    const dictionaryForm = (dictionaryWords.join(' ').trim() || currentText.trim());
    const dictionaryKey = buildDictionaryKey(dictionaryForm, targetWord?.language?.toLowerCase());

    candidates.push({
      text: currentText,
      dictionaryForm,
      dictionaryKey,
      endIndex: index,
      wordCount: wordsCollected
    });

    if (wordsCollected >= maxPhraseWords) {
      break;
    }

    if (
      index + 1 < tokens.length &&
      tokens[index].type === 'whitespace' &&
      tokens[index + 1].type === 'word'
    ) {
      currentText += tokens[index].text;
      index += 1;
      continue;
    }

    break;
  }

  return candidates;
}

function normalizeForDictionary(text: string): string {
  const trimmed = text.trim();
  const cleaned = trimmed.replace(/[.,!?;:]/g, '');
  return cleaned || trimmed;
}

function buildDictionaryKey(word: string, language?: string): string | undefined {
  const trimmed = word.trim();
  if (!trimmed) {
    return undefined;
  }

  const lang = (language || 'unknown').toLowerCase();
  return `${lang}|${trimmed.toLowerCase()}`;
}

async function getDictionaryEntries(params: {
  lookupDictionary: (word: string, language?: string) => Promise<DictionaryEntry[]>;
  dictionaryForm: string;
  dictionaryKey?: string;
  cache: Map<string, DictionaryEntry[] | null>;
  language?: string;
}): Promise<DictionaryEntry[] | null> {
  const { lookupDictionary, dictionaryForm, dictionaryKey, cache, language } = params;
  const key = dictionaryKey ?? buildDictionaryKey(dictionaryForm, language);

  if (!key) {
    return null;
  }

  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  try {
    const entries = await lookupDictionary(dictionaryForm, language);
    const normalizedEntries = Array.isArray(entries) && entries.length > 0 ? entries : null;
    cache.set(key, normalizedEntries);
    return normalizedEntries;
  } catch (error) {
    console.error('Failed to load dictionary entries in tokenizer:', error);
    cache.set(key, null);
    return null;
  }
}
