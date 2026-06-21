/**
 * Pure, stateless helpers extracted from SentenceViewer.
 * These have no dependency on component state and are unit-testable in isolation.
 */
import { formatDistanceToNow } from 'date-fns';
import type { Word, DictionaryEntry } from '../../shared/types/core.js';
import type { TokenizedWord as WordInSentence } from '../utils/sentence-tokenizer.js';

/** Truncate a string to `max` characters (grapheme-safe), appending an ellipsis. */
export function truncate(text: string, max: number): string {
  if (!text) return '';
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, max).join('') + '…';
}

/** Human-readable "x minutes ago", or "never" when no date is given. */
export function formatTimeAgo(date?: Date): string {
  if (!date) {
    return 'never';
  }
  return formatDistanceToNow(date, { addSuffix: true });
}

/** Build the dictionary cache key for a word: `language|word`, both lowercased. */
export function buildDictionaryKey(word: string, language?: string): string | undefined {
  const trimmed = word.trim();
  if (!trimmed) {
    return undefined;
  }
  const lang = language?.toLowerCase() || 'unknown';
  return `${lang}|${trimmed.toLowerCase()}`;
}

/** Render dictionary entries into a single-line "pos: glosses • pos: glosses" tooltip string. */
export function formatDictionaryTooltip(entries: DictionaryEntry[]): string {
  if (!entries.length) {
    return '';
  }

  const content = entries
    .map((entry) => {
      const glossText = entry.glosses.join(', ');
      if (entry.pos && glossText) {
        return `${entry.pos}: ${glossText}`;
      }
      return glossText || entry.pos || '';
    })
    .filter(Boolean)
    .join(' • ');

  return content ? content : '';
}

/** Truncate tooltip body text to `maxLength`, appending "..." when clipped. */
export function truncateTooltipText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/** Map a tokenized word to its CSS class (target / known / ignored / strength level). */
export function getWordClass(wordInfo: WordInSentence): string {
  // Don't style whitespace or punctuation
  if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) {
    return '';
  }

  if (!wordInfo.wordData && !wordInfo.isTargetWord) {
    return 'word-neutral';
  }

  if (wordInfo.isTargetWord) {
    return 'word-target';
  }

  const word = wordInfo.wordData!;

  if (word.ignored) {
    return 'word-ignored';
  }

  if (word.known) {
    return 'word-known';
  }

  // Color based on strength (0-100 scale, map to 0-4 levels)
  const strengthLevel = Math.min(4, Math.floor(word.strength / 20));
  return `word-strength-${strengthLevel}`;
}

/** Returns true if the string contains any CJK kanji characters. */
export function containsKanji(text: string): boolean {
  return /[一-龯㐀-䶿]/.test(text);
}

/**
 * Determine whether a freshly-parsed word list differs meaningfully from the
 * previous one (text, target flag, word id, or status). Used to avoid needless re-renders.
 */
export function hasParsedWordsChanged(
  newWords: WordInSentence[],
  oldWords: WordInSentence[]
): boolean {
  if (newWords.length !== oldWords.length) {
    return true;
  }

  return newWords.some((word, i) => {
    const oldWord = oldWords[i];
    if (!oldWord) return true;

    // Check text and isTargetWord (these should rarely change)
    if (word.text !== oldWord.text || word.isTargetWord !== oldWord.isTargetWord) {
      return true;
    }

    // Check wordData by ID and relevant properties, not by reference
    const oldWordId = oldWord.wordData?.id;
    const newWordId = word.wordData?.id;

    if (oldWordId !== newWordId) {
      return true;
    }

    // If same word ID, check if status changed
    if (oldWordId && oldWordId === newWordId) {
      const oldWordData = oldWord.wordData as Word;
      const newWordData = word.wordData as Word;
      return (
        oldWordData.strength !== newWordData.strength ||
        oldWordData.known !== newWordData.known ||
        oldWordData.ignored !== newWordData.ignored
      );
    }

    return false;
  });
}
