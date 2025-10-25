/**
 * Basic tests for core type definitions
 */

import { Word, Sentence, StudySession } from '../../src/shared/types/core';

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
    };

    expect(word.id).toBe(1);
    expect(word.word).toBe('hola');
    expect(word.strength).toBe(50);
  });

  test('Sentence interface should have required properties', () => {
    const sentence: Sentence = {
      id: 1,
      wordId: 1,
      sentence: 'Hola, ¿cómo estás?',
      translation: 'Hello, how are you?',
      audioPath: 'audio/sentence_1.aiff',
      createdAt: new Date(),
    };

    expect(sentence.wordId).toBe(1);
    expect(sentence.sentence).toBe('Hola, ¿cómo estás?');
  });

  test('StudySession interface should have required properties', () => {
    const session: StudySession = {
      selectedWords: [],
      currentIndex: 0,
      mode: 'learning',
      quizDirection: 'foreign-to-english',
    };

    expect(session.mode).toBe('learning');
    expect(session.currentIndex).toBe(0);
  });
});