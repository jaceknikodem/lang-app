/**
 * Japanese tokenization service using kuromoji
 * Runs in the main process where Node.js modules are available
 */

import * as kuromoji from 'kuromoji';
import * as path from 'path';
import { getLogger } from '../utils/logger.js';

export interface TokenizedToken {
  text: string;
  type: 'word' | 'whitespace' | 'punctuation';
}

let japaneseTokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;
let japaneseTokenizerInitializing: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | null =
  null;

/**
 * Get the dictionary path for kuromoji
 */
function getKuromojiDictPath(): string {
  // In the main process, we can use Node.js path resolution
  // Try to find the dictionary in node_modules
  const possiblePaths = [
    path.join(process.cwd(), 'node_modules', 'kuromoji', 'dict'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'kuromoji', 'dict'),
    path.join(__dirname, '..', '..', 'node_modules', 'kuromoji', 'dict'),
  ];

  // Return the first path that exists, or the first one as fallback
  const fs = require('fs');
  for (const dictPath of possiblePaths) {
    if (fs.existsSync(dictPath)) {
      return dictPath;
    }
  }

  // Return the first path as fallback (kuromoji will handle the error)
  return possiblePaths[0];
}

/**
 * Initialize Japanese tokenizer (lazy loading)
 */
async function getJapaneseTokenizer(): Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> {
  if (japaneseTokenizer) {
    return japaneseTokenizer;
  }

  // If already initializing, wait for that promise
  if (japaneseTokenizerInitializing) {
    return japaneseTokenizerInitializing;
  }

  const logger = getLogger();
  logger.info('Initializing kuromoji tokenizer...');

  // Start initialization
  japaneseTokenizerInitializing = new Promise((resolve, reject) => {
    try {
      const dictPath = getKuromojiDictPath();
      logger.debug({ dictPath }, 'Loading kuromoji dictionary from path');

      kuromoji.builder({ dicPath: dictPath }).build((err, tokenizer) => {
        if (err) {
          logger.error({ error: err, dictPath }, 'Failed to initialize kuromoji tokenizer');
          japaneseTokenizerInitializing = null;
          reject(err);
        } else {
          logger.info('Kuromoji tokenizer initialized successfully');
          japaneseTokenizer = tokenizer;
          japaneseTokenizerInitializing = null;
          resolve(tokenizer);
        }
      });
    } catch (error) {
      logger.error({ error }, 'Error initializing kuromoji tokenizer');
      japaneseTokenizerInitializing = null;
      reject(error);
    }
  });

  return japaneseTokenizerInitializing;
}

/**
 * Convert katakana string to hiragana
 */
function katakanaToHiragana(str: string): string {
  return str.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * Get hiragana reading(s) for a batch of Japanese words using kuromoji.
 * Returns a map of word → hiragana reading.
 * Falls back to the word itself if kuromoji fails or has no reading.
 */
export async function getWordReadings(words: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  try {
    const tokenizer = await getJapaneseTokenizer();
    for (const word of words) {
      try {
        const tokens = tokenizer.tokenize(word);
        const reading = tokens
          .map((t) => {
            const r = t.reading;
            return r && r !== '*' ? katakanaToHiragana(r) : t.surface_form;
          })
          .join('');
        result[word] = reading;
      } catch {
        result[word] = word;
      }
    }
  } catch {
    for (const word of words) result[word] = word;
  }
  return result;
}

export interface AnnotatedToken {
  surface: string;
  basicForm: string;
}

/**
 * Returns kuromoji tokens for a sentence with gap text filled in.
 * Each token carries the surface form (as it appears in the sentence) and
 * the dictionary base form so callers can match conjugated words.
 */
export async function getTokensWithBasicForm(sentence: string): Promise<AnnotatedToken[]> {
  const tokenizer = await getJapaneseTokenizer();
  const tokens = tokenizer.tokenize(sentence);
  const result: AnnotatedToken[] = [];
  let lastIndex = 0;

  for (const token of tokens) {
    const tokenStart = token.word_position - 1; // word_position is 1-based
    if (tokenStart > lastIndex) {
      result.push({ surface: sentence.substring(lastIndex, tokenStart), basicForm: '' });
    }
    const basic =
      token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form;
    result.push({ surface: token.surface_form, basicForm: basic });
    lastIndex = tokenStart + token.surface_form.length;
  }

  if (lastIndex < sentence.length) {
    result.push({ surface: sentence.substring(lastIndex), basicForm: '' });
  }

  return result;
}

/**
 * Tokenize Japanese text using kuromoji
 */
export async function tokenizeJapanese(sentence: string): Promise<TokenizedToken[]> {
  try {
    const tokenizer = await getJapaneseTokenizer();
    const tokens = tokenizer.tokenize(sentence);

    const result: TokenizedToken[] = [];
    let lastIndex = 0; // 0-based char index

    for (const token of tokens) {
      const tokenStart = token.word_position - 1; // word_position is 1-based

      // Add any gap text before this token (rare for well-formed Japanese)
      if (tokenStart > lastIndex) {
        const before = sentence.substring(lastIndex, tokenStart);
        if (/^\s+$/.test(before)) {
          result.push({ text: before, type: 'whitespace' });
        } else if (before.trim()) {
          result.push({ text: before, type: 'punctuation' });
        }
      }

      const text = token.surface_form;
      if (/^\s+$/.test(text)) {
        result.push({ text, type: 'whitespace' });
      } else if (/^[。、！？：；・…]+$/.test(text) || token.pos === '記号') {
        result.push({ text, type: 'punctuation' });
      } else {
        result.push({ text, type: 'word' });
      }

      lastIndex = tokenStart + text.length;
    }

    // Add any remaining text
    if (lastIndex < sentence.length) {
      const remaining = sentence.substring(lastIndex);
      if (/^\s+$/.test(remaining)) {
        result.push({ text: remaining, type: 'whitespace' });
      } else if (remaining.trim()) {
        result.push({ text: remaining, type: 'punctuation' });
      }
    }

    return result;
  } catch (error) {
    const logger = getLogger();
    logger.error({ error }, 'Failed to tokenize Japanese with kuromoji');
    return tokenizeJapaneseSimple(sentence);
  }
}

/**
 * Simple fallback tokenization for Japanese (less accurate)
 * Splits on Japanese punctuation and treats character sequences as words
 */
function tokenizeJapaneseSimple(sentence: string): TokenizedToken[] {
  const tokens: TokenizedToken[] = [];

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
