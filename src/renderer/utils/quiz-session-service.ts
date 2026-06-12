import { Word, QuizQuestion } from '../../shared/types/core.js';
import { sessionManager, type QuizSessionState } from '../utils/session-manager.js';
import { shuffleArray } from '../utils/array-utils.js';
import { logger } from '../utils/logger.js';

export type QuizBuildResult =
  | { status: 'built'; questions: QuizQuestion[]; wordIds: number[] }
  | { status: 'no_words' }
  | { status: 'no_sentences' };

export type QuizRestoreResult =
  | {
      status: 'restored';
      questions: QuizQuestion[];
      words: Word[];
      audioOnlyMode: boolean;
      currentQuestionIndex: number;
      score: number;
      totalQuestions: number;
      isComplete: boolean;
    }
  | { status: 'needs_fresh_start' };

export async function buildQuizFromWords(words: Word[]): Promise<QuizBuildResult> {
  const wordsToQuiz = words.filter((word) => !word.known);

  if (wordsToQuiz.length === 0) {
    return { status: 'no_words' };
  }

  const questions: QuizQuestion[] = [];

  for (const word of wordsToQuiz) {
    const sentence = await window.electronAPI.quiz.getRandomSentenceForWord(word.id);
    if (sentence) {
      questions.push({ word, sentence });
    }
  }

  if (questions.length === 0) {
    return { status: 'no_sentences' };
  }

  const shuffledQuestions = shuffleArray(questions);
  const wordIds = shuffledQuestions.map((q) => q.word.id);

  return { status: 'built', questions: shuffledQuestions, wordIds };
}

export async function restoreQuizFromSession(
  savedSession: QuizSessionState
): Promise<QuizRestoreResult> {
  const words = await window.electronAPI.database.getWordsByIds(savedSession.wordIds);

  if (words.length === 0 || words.length !== savedSession.wordIds.length) {
    logger.warn(
      { expected: savedSession.wordIds.length, got: words.length },
      'Quiz session words mismatch — clearing session'
    );
    sessionManager.clearQuizSession();
    return { status: 'needs_fresh_start' };
  }

  const questions: QuizQuestion[] = [];

  for (const wordId of savedSession.wordIds) {
    const word = words.find((w) => w.id === wordId);
    if (!word) continue;

    const sentence = await window.electronAPI.quiz.getRandomSentenceForWord(word.id);
    if (sentence) {
      questions.push({ word, sentence });
    }
  }

  if (questions.length === 0) {
    sessionManager.clearQuizSession();
    return { status: 'needs_fresh_start' };
  }

  return {
    status: 'restored',
    questions,
    words,
    audioOnlyMode: savedSession.audioOnlyMode ?? false,
    currentQuestionIndex: savedSession.currentQuestionIndex,
    score: savedSession.score,
    totalQuestions: savedSession.totalQuestions,
    isComplete: savedSession.isComplete,
  };
}
