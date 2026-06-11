import type { ReactiveController, ReactiveControllerHost } from 'lit';
import {
  buildDictionaryKey,
  formatDictionaryTooltip,
  truncateTooltipText,
  hasParsedWordsChanged,
} from './sentence-viewer-helpers.js';
import { tokenizeSentenceWithDictionary } from '../utils/sentence-tokenizer.js';
import type { TokenizedWord as WordInSentence } from '../utils/sentence-tokenizer.js';
import type { Word, Sentence, DictionaryEntry, PrecomputedToken } from '../../shared/types/core.js';
import { splitSentenceIntoParts } from '../../shared/utils/sentence.js';
import { logger } from '../utils/logger.js';

export interface TokenizationHost extends ReactiveControllerHost {
  sentence: Sentence;
  targetWord: Word;
  allWords: Word[];
  currentSessionId?: number;
}

/**
 * ReactiveController that owns the tokenization + dictionary pipeline for SentenceViewer.
 *
 * State exposed to the host (read-only from outside):
 *   parsedWords      — tokenized words with word-data merged in
 *   zipfFrequencies  — per-word Zipf frequency scores
 *
 * The host reads these fields in render(); the controller calls host.requestUpdate()
 * whenever they change.
 */
export class SentenceTokenizationController implements ReactiveController {
  private readonly host: TokenizationHost;

  parsedWords: WordInSentence[] = [];
  zipfFrequencies: Record<string, number> = {};

  private dictionaryCache: Record<string, DictionaryEntry[] | null> = {};
  private tokenizationRequestId = 0;
  private dictionaryLookupInFlight = new Set<string>();
  private dictionaryLookupPromises: Partial<Record<string, Promise<DictionaryEntry[] | null>>> = {};
  private lastProcessedSentenceId?: number;
  private lastProcessedAllWordsHash?: string;
  private lastAllWordsArrayReference?: Word[];

  private hoverStartTime = new Map<string, number>();
  private hoverTimeout = new Map<string, number>();

  constructor(host: TokenizationHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected(): void {
    const { sentence } = this.host;
    if (sentence?.tokenizedTokens && sentence.tokenizedTokens.length > 0) {
      this.parsedWords = this.convertPrecomputedTokensToWords(sentence.tokenizedTokens);
      this.lastProcessedSentenceId = sentence.id;
    } else {
      void this.parseSentence();
    }
  }

  hostDisconnected(): void {
    for (const id of this.hoverTimeout.values()) clearTimeout(id);
    this.hoverTimeout.clear();
    this.hoverStartTime.clear();
  }

  /** Called from host's updated() when sentence or allWords changes. */
  handleSentenceChange(sentenceChanged: boolean, allWordsChanged: boolean): void {
    const { sentence, allWords } = this.host;
    const hasPrecomputedTokens = sentence?.tokenizedTokens && sentence.tokenizedTokens.length > 0;

    if (allWordsChanged && allWords === this.lastAllWordsArrayReference) {
      this.lastAllWordsArrayReference = allWords;
      return;
    }

    const currentSentenceId = sentence?.id;
    const sentenceIdChanged = sentenceChanged && currentSentenceId !== this.lastProcessedSentenceId;
    const needsReparse =
      sentenceIdChanged ||
      (allWordsChanged && !hasPrecomputedTokens && this.needsReparseForAllWords());

    if (hasPrecomputedTokens) {
      if (sentenceIdChanged) {
        this.lastProcessedSentenceId = currentSentenceId;
        const newWords = this.convertPrecomputedTokensToWords(sentence.tokenizedTokens!);
        if (hasParsedWordsChanged(newWords, this.parsedWords)) {
          this.parsedWords = newWords;
          void this.fetchZipfFrequencies();
          this.host.requestUpdate();
        }
      } else if (allWordsChanged) {
        this.lastAllWordsArrayReference = allWords;
        this.updateWordStatusesFromPrecomputedTokens();
      }
    } else if (needsReparse) {
      if (sentenceChanged) this.lastProcessedSentenceId = currentSentenceId;
      if (allWordsChanged) this.lastAllWordsArrayReference = allWords;
      void this.parseSentence();
    } else if (allWordsChanged) {
      this.lastAllWordsArrayReference = allWords;
    }
  }

  /** Push externally pre-processed words (e.g. from async tokenization pipelines). */
  applyTokenizedWords(words: WordInSentence[]): void {
    this.tokenizationRequestId += 1;
    this.parsedWords = words;
    this.host.requestUpdate();
  }

  /**
   * Immediately patch the wordData for a single word across parsedWords.
   * Called after the host mutates a word's status so the UI reacts before the
   * next updated() cycle re-tokenizes.
   */
  updateParsedWordsWordData(updatedWord: Word): void {
    const normalizedTarget = updatedWord.word.toLowerCase().trim();
    const normalizeText = (t: string) =>
      t
        .trim()
        .replace(/[.,!?;:]/g, '')
        .toLowerCase();

    let foundMatch = false;
    this.parsedWords = this.parsedWords.map((w) => {
      if (/^\s+$/.test(w.text) || /^[.,!?;:]+$/.test(w.text)) return w;

      if (w.wordData?.id === updatedWord.id) {
        foundMatch = true;
        return { ...w, wordData: updatedWord };
      }
      if (w.lemma && w.lemma.toLowerCase() === normalizedTarget) {
        foundMatch = true;
        return { ...w, wordData: updatedWord };
      }
      if (w.dictionaryForm && normalizeText(w.dictionaryForm) === normalizedTarget) {
        foundMatch = true;
        return { ...w, wordData: updatedWord };
      }
      if (normalizeText(w.text) === normalizedTarget) {
        foundMatch = true;
        return { ...w, wordData: updatedWord };
      }
      if (!w.wordData && w.text.trim().toLowerCase() === normalizedTarget) {
        foundMatch = true;
        return { ...w, wordData: updatedWord };
      }
      return w;
    });

    if (!foundMatch) {
      logger.warn(
        {
          word: updatedWord.word,
          wordId: updatedWord.id,
          parsedWordsCount: this.parsedWords.length,
          sampleParsedWord: this.parsedWords.find((w) => !w.wordData && w.text.trim()),
        },
        '[SentenceViewer] Could not find matching word in parsedWords'
      );
    }

    this.host.requestUpdate();
  }

  async getDictionaryEntries(
    word: string,
    key?: string,
    languageOverride?: string,
    lemma?: string
  ): Promise<DictionaryEntry[] | null> {
    const dictionaryKey =
      key ?? buildDictionaryKey(word, languageOverride ?? this.host.targetWord?.language);
    if (!dictionaryKey) return null;

    if (Object.prototype.hasOwnProperty.call(this.dictionaryCache, dictionaryKey)) {
      return this.dictionaryCache[dictionaryKey] ?? null;
    }
    if (this.dictionaryLookupPromises[dictionaryKey]) {
      return this.dictionaryLookupPromises[dictionaryKey]!;
    }

    const lookupPromise = (async (): Promise<DictionaryEntry[] | null> => {
      try {
        this.dictionaryLookupInFlight.add(dictionaryKey);
        const language =
          languageOverride ??
          this.host.targetWord?.language ??
          (await window.electronAPI.database.getCurrentLanguage());

        const entries = await Promise.race([
          window.electronAPI.database.lookupDictionary(word, language),
          this.createDictionaryLookupTimeout(),
        ]);

        let normalizedEntries = Array.isArray(entries) && entries.length > 0 ? entries : null;

        if (
          !normalizedEntries &&
          lemma &&
          lemma.toLowerCase().trim() !== word.toLowerCase().trim()
        ) {
          try {
            const lemmaLanguage = languageOverride ?? this.host.targetWord?.language;
            const lemmaEntries = await Promise.race([
              window.electronAPI.database.lookupDictionary(lemma, lemmaLanguage),
              this.createDictionaryLookupTimeout(),
            ]);
            normalizedEntries =
              Array.isArray(lemmaEntries) && lemmaEntries.length > 0 ? lemmaEntries : null;
            if (normalizedEntries) {
              console.log(
                `[Dictionary] Original word "${word}" not found, using lemma "${lemma}" for lookup`
              );
            }
          } catch (lemmaError) {
            logger.warn(
              { error: lemmaError, lemma },
              `[Dictionary] Lemma lookup also failed for "${lemma}"`
            );
          }
        }

        this.dictionaryCache[dictionaryKey] = normalizedEntries;
        return normalizedEntries;
      } catch (error) {
        logger.error({ error, dictionaryKey }, 'Failed to load dictionary entries');
        this.dictionaryCache[dictionaryKey] = null;
        return null;
      } finally {
        this.dictionaryLookupInFlight.delete(dictionaryKey);
        delete this.dictionaryLookupPromises[dictionaryKey];
        this.host.requestUpdate();
      }
    })();

    this.dictionaryLookupPromises[dictionaryKey] = lookupPromise;
    return lookupPromise;
  }

  getWordTooltip(wordInfo: WordInSentence): string {
    if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) return '';

    const parts: string[] = [];

    const wordKey = wordInfo.dictionaryForm || wordInfo.text.trim();
    const zipfFreq = this.zipfFrequencies[wordKey];
    if (zipfFreq && zipfFreq > 0) {
      const rounded = Math.round(zipfFreq);
      let label = '';
      if (rounded >= 6) label = ' (very common, ~1 per 1000 words)';
      else if (rounded >= 5) label = ' (common, ~1 per 10k words)';
      else if (rounded >= 4) label = ' (moderate, ~1 per 100k words)';
      else if (rounded >= 3) label = ' (uncommon, ~1 per million words)';
      else label = ' (rare)';
      parts.push(`Zipf: ${rounded}${label}`);
    }

    if (wordInfo.lemma) {
      const dictForm = (wordInfo.dictionaryForm || wordInfo.text.trim()).toLowerCase();
      if (wordInfo.lemma.toLowerCase() !== dictForm) {
        parts.push(`Lemma: ${wordInfo.lemma}`);
      }
    }

    if (wordInfo.dictionaryKey) {
      if (
        !this.dictionaryLookupInFlight.has(wordInfo.dictionaryKey) &&
        this.dictionaryCache[wordInfo.dictionaryKey] === undefined
      ) {
        void this.ensureDictionaryEntry(
          wordInfo.dictionaryForm ?? '',
          wordInfo.dictionaryKey,
          wordInfo.lemma
        );
      }
      const cached = this.dictionaryCache[wordInfo.dictionaryKey];
      if (cached && cached.length > 0) {
        const formatted = formatDictionaryTooltip(cached);
        const full = parts.length > 0 ? parts.join(' • ') + ' • ' + formatted : formatted;
        return truncateTooltipText(full);
      }
    }

    return parts.length > 0 ? truncateTooltipText(parts.join(' • ')) : '';
  }

  handleWordHoverStart(wordInfo: WordInSentence): void {
    if (!wordInfo.dictionaryKey) return;
    const key = wordInfo.dictionaryKey;
    const existing = this.hoverTimeout.get(key);
    if (existing) {
      clearTimeout(existing);
      this.hoverTimeout.delete(key);
    }
    this.hoverStartTime.set(key, Date.now());
  }

  handleWordHoverEnd(wordInfo: WordInSentence): void {
    if (!wordInfo.dictionaryKey) return;
    const key = wordInfo.dictionaryKey;
    const timeoutId = this.hoverTimeout.get(key);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.hoverTimeout.delete(key);
    }
    const startTime = this.hoverStartTime.get(key);
    if (startTime) {
      const duration = Date.now() - startTime;
      if (duration >= 1000) void this.recordDictionaryHover(wordInfo, key, duration);
      this.hoverStartTime.delete(key);
    }
  }

  // ─── private ────────────────────────────────────────────────────────────────

  private async parseSentence(): Promise<void> {
    const requestId = ++this.tokenizationRequestId;
    const { sentence, targetWord, allWords } = this.host;

    if (!sentence?.sentence) {
      this.parsedWords = [];
      this.lastProcessedSentenceId = undefined;
      return;
    }

    if (sentence.tokenizedTokens && sentence.tokenizedTokens.length > 0) {
      const newWords = this.convertPrecomputedTokensToWords(sentence.tokenizedTokens);
      if (requestId === this.tokenizationRequestId) {
        if (hasParsedWordsChanged(newWords, this.parsedWords)) {
          this.parsedWords = newWords;
          this.host.requestUpdate();
        }
      }
      return;
    }

    const parts = sentence.sentenceParts ?? splitSentenceIntoParts(sentence.sentence);
    const baseWords: WordInSentence[] = parts.map((text) => {
      if (/^\s+$/.test(text) || /^[.,!?;:]+$/.test(text)) {
        return { text, isTargetWord: false };
      }
      const dictionaryForm = text.trim().replace(/[.,!?;:]/g, '');
      const cleanText = dictionaryForm.toLowerCase();
      if (!cleanText) return { text, isTargetWord: false };

      const targetWordLower = targetWord.word.toLowerCase();
      const isTargetWord = cleanText === targetWordLower;
      const wordData = allWords.find((w) => w.word.toLowerCase() === cleanText);
      const dictionaryKey = buildDictionaryKey(dictionaryForm, targetWord?.language);

      if (!wordData && !isTargetWord && dictionaryKey) {
        void this.ensureDictionaryEntry(dictionaryForm, dictionaryKey);
      }

      return { text, isTargetWord, wordData, dictionaryForm, dictionaryKey };
    });

    this.parsedWords = baseWords;
    this.host.requestUpdate();
    await this.enhanceSentenceWithDictionary(requestId);
    void this.fetchZipfFrequencies();
  }

  private updateWordStatusesFromPrecomputedTokens(): void {
    const { sentence, allWords } = this.host;
    if (!sentence?.tokenizedTokens || !this.parsedWords.length) return;

    let hasChanged = false;
    const updated = this.parsedWords.map((word, i) => {
      const token = sentence.tokenizedTokens?.[i];
      if (!token) return word;

      let wordData: Word | undefined;
      if (token.wordId) wordData = allWords.find((w) => w.id === token.wordId);
      if (!wordData) {
        if (token.lemma) {
          wordData = allWords.find((w) => w.word.toLowerCase() === token.lemma!.toLowerCase());
        } else if (token.dictionaryForm) {
          wordData = allWords.find(
            (w) => w.word.toLowerCase() === token.dictionaryForm!.toLowerCase()
          );
        }
      }

      if (
        word.wordData?.id !== wordData?.id ||
        word.wordData?.strength !== wordData?.strength ||
        word.wordData?.known !== wordData?.known ||
        word.wordData?.ignored !== wordData?.ignored
      ) {
        hasChanged = true;
        return { ...word, wordData };
      }
      return word;
    });

    if (hasChanged) {
      this.parsedWords = updated;
      this.host.requestUpdate();
    }
  }

  private convertPrecomputedTokensToWords(tokens: PrecomputedToken[]): WordInSentence[] {
    const { targetWord, allWords } = this.host;
    return tokens.map((token) => {
      let wordData: Word | undefined;
      if (token.wordId) wordData = allWords.find((w) => w.id === token.wordId);
      if (!wordData) {
        if (token.lemma) {
          wordData = allWords.find((w) => w.word.toLowerCase() === token.lemma!.toLowerCase());
        } else if (token.dictionaryForm) {
          wordData = allWords.find(
            (w) => w.word.toLowerCase() === token.dictionaryForm!.toLowerCase()
          );
        }
      }

      const targetWordLower = targetWord.word.toLowerCase();
      let isTargetWord = token.isTargetWord;
      if (token.lemma) {
        isTargetWord = token.lemma.toLowerCase() === targetWordLower || isTargetWord;
      } else if (token.dictionaryForm) {
        isTargetWord =
          (token.dictionaryForm.toLowerCase() ?? '') === targetWordLower || isTargetWord;
      }

      if (token.dictionaryKey && token.dictionaryEntries) {
        this.dictionaryCache[token.dictionaryKey] = token.dictionaryEntries;
      }

      return {
        text: token.text,
        isTargetWord,
        wordData,
        dictionaryForm: token.dictionaryForm,
        dictionaryKey: token.dictionaryKey,
        lemma: token.lemma,
      };
    });
  }

  private async enhanceSentenceWithDictionary(requestId: number): Promise<void> {
    const { sentence, targetWord, allWords } = this.host;
    if (!sentence?.sentence || !targetWord) return;

    try {
      const cacheMap = new Map<string, DictionaryEntry[] | null>(
        Object.entries(this.dictionaryCache)
      );
      const { words, cache } = await tokenizeSentenceWithDictionary(
        {
          sentence: sentence.sentence,
          targetWord,
          allWords,
          lookupDictionary: async (word, language) => {
            const key = buildDictionaryKey(word, language ?? targetWord?.language);
            const entries = await this.getDictionaryEntries(word, key, language);
            return entries ?? [];
          },
          language: targetWord?.language,
          cache: cacheMap,
        },
        { maxPhraseWords: 3 }
      );

      if (requestId !== this.tokenizationRequestId) return;

      this.dictionaryCache = Object.fromEntries(cache.entries()) as Record<
        string,
        DictionaryEntry[] | null
      >;
      if (hasParsedWordsChanged(words, this.parsedWords)) {
        this.parsedWords = words;
        this.host.requestUpdate();
      }
    } catch (error) {
      if (requestId === this.tokenizationRequestId) {
        logger.error({ error }, 'Failed to apply dictionary-based tokenization');
      }
    }
  }

  private async ensureDictionaryEntry(word: string, key: string, lemma?: string): Promise<void> {
    await this.getDictionaryEntries(word, key, undefined, lemma);
  }

  private createDictionaryLookupTimeout(ms = 10000): Promise<never> {
    return new Promise<never>((_, reject) => {
      setTimeout(() => {
        const error = new Error('Timeout');
        error.name = 'TimeoutError';
        reject(error);
      }, ms);
    });
  }

  private async fetchZipfFrequencies(): Promise<void> {
    const { sentence, targetWord } = this.host;
    if (!sentence || !targetWord) return;

    try {
      const words = this.parsedWords
        .map((w) => w.dictionaryForm || w.text.trim())
        .filter((w) => w && !/^\s+$/.test(w) && !/^[.,!?;:]+$/.test(w))
        .filter((w, i, arr) => arr.indexOf(w) === i);

      if (words.length === 0) return;

      const frequencies = await window.electronAPI.lemmatization.getWordFrequencies(
        words,
        targetWord.language
      );
      this.zipfFrequencies = frequencies;
      this.host.requestUpdate();
    } catch (error) {
      console.warn('[SentenceViewer] Failed to fetch zipf frequencies:', error);
    }
  }

  private needsReparseForAllWords(): boolean {
    const { allWords, targetWord } = this.host;
    if (!allWords || allWords.length === 0) return false;

    const hash = allWords
      .filter(
        (w) => w.id === targetWord?.id || this.parsedWords.some((p) => p.wordData?.id === w.id)
      )
      .map((w) => `${w.id}:${w.strength}:${w.known}:${w.ignored}`)
      .join(',');

    if (hash !== this.lastProcessedAllWordsHash) {
      this.lastProcessedAllWordsHash = hash;
      return true;
    }
    return false;
  }

  private async recordDictionaryHover(
    wordInfo: WordInSentence,
    dictionaryKey: string,
    duration: number
  ): Promise<void> {
    const cached = this.dictionaryCache[dictionaryKey];
    const foundInDict = cached !== undefined && cached !== null && cached.length > 0;

    try {
      const wordToRecord = wordInfo.lemma || wordInfo.dictionaryForm || wordInfo.text.trim();
      await window.electronAPI.tracking.recordDictionaryHover({
        word: wordToRecord,
        language: this.host.targetWord?.language || 'spanish',
        sentenceId: this.host.sentence?.id,
        sessionId: this.host.currentSessionId,
        hoverDurationMs: duration,
        dictionaryKey,
        foundInDict,
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to record dictionary hover');
    }
  }
}
