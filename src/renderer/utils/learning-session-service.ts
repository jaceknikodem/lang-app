import { Word, Sentence } from '../../shared/types/core.js';
import { router } from './router.js';
import { sessionManager } from './session-manager.js';
import { logger } from './logger.js';
import { APP_CONFIG } from '../../shared/constants/index.js';

export interface WordWithSentences extends Word {
  sentences: Sentence[];
}

export function prepareSentencesForWord(word: Word, sentences: Sentence[]): Sentence[] {
  if (!sentences.length) return [];

  let orderedSentences = sentences;
  if ((word.strength ?? 0) < 50) {
    orderedSentences = [...sentences].sort((a, b) => {
      const at = a.lastShown ? a.lastShown.getTime() : 0;
      const bt = b.lastShown ? b.lastShown.getTime() : 0;
      return at - bt;
    });
  }

  return orderedSentences.slice(0, 1);
}

export async function loadSelectedWords(currentLanguage: string | null): Promise<Word[]> {
  if (!currentLanguage) {
    throw new Error('No language loaded');
  }

  const routeData = router.getRouteData<{ specificWords?: Word[] }>();
  if (routeData?.specificWords && routeData.specificWords.length > 0) {
    const limitedWords: Word[] = [];
    const seenIds = new Set<number>();

    for (const word of routeData.specificWords) {
      if (word.language !== currentLanguage) continue;
      if (seenIds.has(word.id)) continue;

      const sentences = await window.electronAPI.database.getSentencesByWord(word.id);
      if (!sentences.length) continue;

      limitedWords.push(word);
      seenIds.add(word.id);

      if (limitedWords.length >= APP_CONFIG.MAX_LEARNING_WORDS) break;
    }

    if (limitedWords.length > 0) {
      sessionManager.startNewLearningSession(
        limitedWords.map((w) => w.id),
        Math.min(APP_CONFIG.MAX_LEARNING_WORDS, limitedWords.length)
      );
    }
    return limitedWords;
  }

  const activeSession = sessionManager.getLearningSession();
  if (activeSession?.wordIds?.length) {
    const loadedWords: Word[] = [];
    for (const wordId of activeSession.wordIds) {
      const word = await window.electronAPI.database.getWordById(wordId);
      if (word && word.language === currentLanguage) {
        loadedWords.push(word);
      }
    }
    if (loadedWords.length > 0) return loadedWords;
  }

  const wordsOrdered = await window.electronAPI.database.getWordsWithSentencesOrderedByStrength(
    currentLanguage,
    true,
    false
  );
  const sessionWordIds: number[] = [];
  const selectableWords: Word[] = [];

  for (const word of wordsOrdered) {
    const sentences = await window.electronAPI.database.getSentencesByWord(word.id);
    if (!sentences.length) continue;

    selectableWords.push(word);
    sessionWordIds.push(word.id);

    if (sessionWordIds.length >= APP_CONFIG.MAX_LEARNING_WORDS) break;
  }

  if (sessionWordIds.length) {
    sessionManager.startNewLearningSession(
      sessionWordIds,
      Math.min(APP_CONFIG.MAX_LEARNING_WORDS, sessionWordIds.length)
    );
  }

  if (selectableWords.length === 0) {
    const allWordsForLanguage = await window.electronAPI.database.getAllWords(
      currentLanguage,
      true,
      false
    );
    if (allWordsForLanguage.length > 0) {
      return allWordsForLanguage.slice(0, APP_CONFIG.MAX_LEARNING_WORDS);
    }
  }

  return selectableWords;
}

export async function loadWordsAndSentences(
  selectedWords: Word[],
  currentLanguage: string | null
): Promise<WordWithSentences[]> {
  if (!selectedWords.length) {
    throw new Error('No words available for learning. Please start a new learning session.');
  }

  const activeSession = sessionManager.getLearningSession();
  const hasCachedIds =
    activeSession?.wordIds?.length &&
    activeSession?.sentenceIds?.length &&
    activeSession?.audioPaths?.length;

  if (
    hasCachedIds &&
    activeSession.wordIds.length === selectedWords.length &&
    activeSession.sentenceIds &&
    activeSession.audioPaths
  ) {
    const [loadedWords, loadedSentences] = await Promise.all([
      window.electronAPI.database.getWordsByIds(activeSession.wordIds),
      window.electronAPI.database.getSentencesByIds(activeSession.sentenceIds),
    ]);

    const sentenceMapByWordId = new Map<number, Sentence[]>();
    for (const sentence of loadedSentences) {
      if (!sentenceMapByWordId.has(sentence.wordId)) {
        sentenceMapByWordId.set(sentence.wordId, []);
      }
      sentenceMapByWordId.get(sentence.wordId)!.push(sentence);
    }

    return loadedWords
      .filter((word: Word) => !currentLanguage || word.language === currentLanguage)
      .map((word: Word) => ({
        ...word,
        sentences: prepareSentencesForWord(word, sentenceMapByWordId.get(word.id) || []),
      }))
      .filter((w: WordWithSentences) => w.sentences.length > 0);
  }

  const wordsWithSentences: WordWithSentences[] = [];

  for (const word of selectedWords) {
    if (currentLanguage && word.language !== currentLanguage) continue;

    const sentences = await window.electronAPI.database.getSentencesByWord(word.id);
    if (!sentences.length) {
      logger.warn({ word: word.word, wordId: word.id }, 'No sentences found for word');
    }

    wordsWithSentences.push({
      ...word,
      sentences: prepareSentencesForWord(word, sentences),
    });
  }

  const wordsWithValidSentences = wordsWithSentences.filter((w) => w.sentences.length > 0);

  const wordIds = wordsWithValidSentences.map((w) => w.id);
  const sentenceIds: number[] = [];
  const audioPaths: string[] = [];

  for (const wordEntry of wordsWithValidSentences) {
    for (const sentence of wordEntry.sentences) {
      sentenceIds.push(sentence.id);
      if (sentence.audioPath) audioPaths.push(sentence.audioPath);
    }
  }

  if (wordIds.length > 0) {
    sessionManager.startNewLearningSession(
      wordIds,
      Math.min(APP_CONFIG.MAX_LEARNING_WORDS, wordIds.length),
      sentenceIds,
      audioPaths
    );
  }

  return wordsWithValidSentences;
}

export async function maybeAppendNewWordsToSession(
  currentLanguage: string | null
): Promise<boolean> {
  const activeSession = sessionManager.getLearningSession();
  if (!activeSession) return false;

  try {
    const language = currentLanguage || (await window.electronAPI.database.getCurrentLanguage());
    const sessionCreatedAt = new Date(activeSession.createdAt);
    const wordsOrdered = await window.electronAPI.database.getWordsWithSentencesOrderedByStrength(
      language,
      true,
      false
    );

    const existingWordIds = new Set(activeSession.wordIds);
    const wordsToAppend: number[] = [];

    for (const word of wordsOrdered) {
      if (existingWordIds.has(word.id)) continue;
      if (word.createdAt <= sessionCreatedAt) continue;

      const sentences = await window.electronAPI.database.getSentencesByWord(word.id);
      if (!sentences.length) continue;

      wordsToAppend.push(word.id);
      if (wordsToAppend.length >= 10) break;
    }

    if (wordsToAppend.length) {
      sessionManager.appendWordsToLearningSession(wordsToAppend);
      return true;
    }
  } catch (error) {
    logger.error({ error }, 'Failed to append new words to learning session');
  }

  return false;
}

export function restoreSessionProgress(
  wordsWithSentences: WordWithSentences[]
): { wordIndex: number; sentenceIndex: number } | null {
  const session = sessionManager.getCurrentSession();
  if (!session.learningProgress) return null;

  const wordIndex = Math.min(
    session.learningProgress.currentWordIndex,
    wordsWithSentences.length - 1
  );

  const currentWord = wordsWithSentences[wordIndex];
  const sentenceIndex = currentWord
    ? Math.min(session.learningProgress.currentSentenceIndex, currentWord.sentences.length - 1)
    : 0;

  return { wordIndex, sentenceIndex };
}

export function saveProgressToSession(wordIndex: number, sentenceIndex: number): void {
  sessionManager.updateLearningProgress(wordIndex, sentenceIndex);
}
