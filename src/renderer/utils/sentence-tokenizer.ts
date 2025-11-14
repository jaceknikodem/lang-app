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

/**
 * Tokenize Japanese text
 * In renderer: uses IPC to call the main process
 * In main process: calls the tokenizer directly
 */
async function tokenizeJapanese(sentence: string): Promise<InternalToken[]> {
  // Check if we're in the renderer process (browser) or main process (Node.js)
  // In renderer process, always use IPC (this code path is what gets bundled)
  if (typeof window !== 'undefined') {
    try {
      // Call the main process via IPC to tokenize Japanese text
      // Type assertion needed because japaneseTokenization is added dynamically
      const electronAPI = (window as any).electronAPI;
      const tokens = await electronAPI.japaneseTokenization.tokenize(sentence);

      // Convert the IPC response to InternalToken format
      return tokens.map((token: { text: string; type: string }) => ({
        text: token.text,
        type: token.type as 'word' | 'whitespace' | 'punctuation',
      }));
    } catch (error) {
      console.error('Failed to tokenize Japanese via IPC:', error);
      // Fallback: simple character-based splitting for Japanese
      return tokenizeJapaneseSimple(sentence);
    }
  }

  // Main process code path (should never execute in renderer bundle)
  // Use Function constructor to prevent esbuild from analyzing the require() call
  try {
    // Dynamically require to prevent bundler from analyzing this
    // From dist/main/renderer/utils/ to dist/main/main/lemmatization/
    // Path: ../../main/lemmatization/japanese-tokenizer.js
    const nodeRequire =
      typeof require !== 'undefined'
        ? require
        : (() => {
            throw new Error('require is not available');
          })();
    // Use Function constructor to make path completely dynamic
    // This prevents esbuild from trying to resolve the module
    const requireFunc = new Function('require', 'path', 'return require(path)');
    const modulePath = '../../main/lemmatization/japanese-tokenizer.js';
    const module = requireFunc(nodeRequire, modulePath);
    const tokenizeJapaneseMain: (text: string) => Promise<Array<{ text: string; type: string }>> =
      module.tokenizeJapanese;

    const tokens = await tokenizeJapaneseMain(sentence);
    return tokens.map((token: { text: string; type: string }) => ({
      text: token.text,
      type: token.type as 'word' | 'whitespace' | 'punctuation',
    }));
  } catch (error) {
    console.error('Failed to tokenize Japanese in main process:', error);
    return tokenizeJapaneseSimple(sentence);
  }
}

/**
 * Simple fallback tokenization for Japanese (less accurate)
 * Splits on Japanese punctuation and treats character sequences as words
 */
function tokenizeJapaneseSimple(sentence: string): InternalToken[] {
  const tokens: InternalToken[] = [];

  // Match Japanese characters (hiragana, katakana, kanji), punctuation, and whitespace
  // Unicode ranges:
  // Hiragana: \u3040-\u309F
  // Katakana: \u30A0-\u30FF
  // Kanji: \u4E00-\u9FAF
  // Japanese punctuation: 。、！？：；
  const regex =
    /([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+|[。、！？：；]+|[\s]+|[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF。、！？：；\s]+)/g;
  let match;

  while ((match = regex.exec(sentence)) !== null) {
    const text = match[0];
    if (/^\s+$/.test(text)) {
      tokens.push({ text, type: 'whitespace' });
    } else if (/^[。、！？：；]+$/.test(text)) {
      tokens.push({ text, type: 'punctuation' });
    } else if (/^[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+$/.test(text)) {
      // Japanese characters - treat as word
      tokens.push({ text, type: 'word' });
    } else {
      // Other characters (numbers, Latin, etc.)
      tokens.push({ text, type: 'punctuation' });
    }
  }

  return tokens.length > 0 ? tokens : [{ text: sentence, type: 'word' }];
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

  // Check if this is Japanese and use appropriate tokenization
  let tokens: InternalToken[];
  const isJapanese = fallbackLanguage === 'japanese' || fallbackLanguage === 'ja';

  if (isJapanese) {
    // Use kuromoji for Japanese tokenization
    tokens = await tokenizeJapanese(sentence);
  } else {
    // Original logic for space-separated languages
    const parts = sentence.split(/(\s+|[.,!?;:])/);
    tokens = parts
      .filter((part) => part !== '')
      .map((part) => {
        if (/^\s+$/.test(part)) {
          return { text: part, type: 'whitespace' as const };
        }

        if (/^[.,!?;:]+$/.test(part)) {
          return { text: part, type: 'punctuation' as const };
        }

        return { text: part, type: 'word' as const };
      });
  }

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
        language: fallbackLanguage,
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

    const dictionaryKey =
      selected.dictionaryKey ?? buildDictionaryKey(dictionaryForm, fallbackLanguage);
    const wordData = wordLookup.get(cleanText);
    const isTargetWord = Boolean(targetWord?.word && cleanText === targetWord.word.toLowerCase());

    words.push({
      text: selected.text,
      isTargetWord,
      wordData,
      dictionaryForm,
      dictionaryKey,
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

    const dictionaryForm = dictionaryWords.join(' ').trim() || currentText.trim();
    const dictionaryKey = buildDictionaryKey(dictionaryForm, targetWord?.language?.toLowerCase());

    candidates.push({
      text: currentText,
      dictionaryForm,
      dictionaryKey,
      endIndex: index,
      wordCount: wordsCollected,
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
