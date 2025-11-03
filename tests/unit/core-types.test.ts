/**
 * Basic tests for core type definitions
 */

import { Word, Sentence, AppState, QuizSession } from '../../src/shared/types/core';

describe('Core Types', () => {
  test('Word interface should have required properties', () => {
    const word: Word = {
      id: 1,
      word: 'hola',
      language: 'spanish',
      translation: 'hello',
      audioPath: 'audio/hola.aiff',
      strength: 50,
      known: false,
      ignored: false,
      createdAt: new Date(),
      intervalDays: 1,
      easeFactor: 2.5,
      nextDue: new Date(),
    };

    expect(word.id).toBe(1);
    expect(word.word).toBe('hola');
    expect(word.strength).toBe(50);
  });

  test('Sentence interface should have required properties', () => {
    const sentence: Sentence = {
      id: 1,
      wordId: 1,
      language: 'spanish',
      sentence: 'Hola, ¿cómo estás?',
      translation: 'Hello, how are you?',
      audioPath: 'audio/sentence_1.aiff',
      createdAt: new Date(),
      playCount: 0,
    };

    expect(sentence.wordId).toBe(1);
    expect(sentence.sentence).toBe('Hola, ¿cómo estás?');
    expect(sentence.language).toBe('spanish');
  });

  test('AppState interface should have required properties', () => {
    const appState: AppState = {
      currentMode: 'learning',
      selectedTopic: 'food',
    };

    expect(appState.currentMode).toBe('learning');
    expect(appState.selectedTopic).toBe('food');
  });

  test('QuizSession interface should have required properties', () => {
    const quizSession: QuizSession = {
      questions: [],
      currentQuestionIndex: 0,
      score: 0,
      totalQuestions: 10,
      isComplete: false,
    };

    expect(quizSession.currentQuestionIndex).toBe(0);
    expect(quizSession.isComplete).toBe(false);
  });
});
