/**
 * Utility functions for processing words (inserting, enqueueing, marking as known)
 * Reusable across word-selector and auto-add flows
 */

import { GeneratedWord } from '../../shared/types/core.js';
import { sessionManager } from './session-manager.js';

export interface ProcessWordsOptions {
  language: string;
  topic?: string;
  desiredSentenceCount?: number;
}

export interface ProcessWordsResult {
  queuedCount: number;
  processedKnown: number;
  failedWords: string[];
  queuedWordIds: number[];
}

/**
 * Process selected words by inserting them into the database and enqueueing for generation
 */
export async function processSelectedWords(
  words: GeneratedWord[],
  options: ProcessWordsOptions
): Promise<ProcessWordsResult> {
  const { language, topic, desiredSentenceCount = 3 } = options;
  let queuedCount = 0;
  const failedWords: string[] = [];
  const queuedWordIds: number[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    console.log(`Processing word ${i + 1}/${words.length}: ${word.word}`);

    try {
      // Insert word into database
      console.log('Inserting word into database:', word.word);
      const wordId = await window.electronAPI.database.insertWord({
        word: word.word,
        language: language,
        translation: word.translation,
        topic: topic,
      });
      console.log('Word inserted with ID:', wordId);

      // Enqueue for sentence generation
      await window.electronAPI.jobs.enqueueWordGeneration(wordId, {
        language: language,
        topic: topic,
        desiredSentenceCount: desiredSentenceCount,
      });
      queuedCount++;
      queuedWordIds.push(wordId);
      console.log('Enqueued word for asynchronous processing:', word.word);
    } catch (wordError) {
      console.error(`Failed to process word ${word.word}:`, wordError);
      failedWords.push(word.word);
    }
  }

  return { queuedCount, processedKnown: 0, failedWords, queuedWordIds };
}

/**
 * Process known words by inserting them into the database and marking as known
 */
export async function processKnownWords(
  words: GeneratedWord[],
  options: ProcessWordsOptions
): Promise<ProcessWordsResult> {
  const { language } = options;
  let processedKnown = 0;
  const failedWords: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    console.log(`Processing known word ${i + 1}/${words.length}: ${word.word}`);

    try {
      // Insert word into database
      const wordId = await window.electronAPI.database.insertWord({
        word: word.word,
        language: language,
        translation: word.translation,
      });

      // Mark as known immediately
      await window.electronAPI.database.markWordKnown(wordId, true);
      console.log('Known word processed:', word.word);
      processedKnown++;
    } catch (wordError) {
      console.error(`Failed to process known word ${word.word}:`, wordError);
      failedWords.push(word.word);
    }
  }

  return { queuedCount: 0, processedKnown, failedWords, queuedWordIds: [] };
}

/**
 * Set up language and topic for word processing session
 */
export async function setupWordProcessingSession(language: string, topic?: string): Promise<void> {
  // Set the current language in database to match the words being inserted
  await window.electronAPI.database.setCurrentLanguage(language);
  console.log('Set current language to:', language);
  sessionManager.setActiveLanguage(language);

  // Update session with topic
  if (topic) {
    sessionManager.updateSelectedTopic(topic);
  }
}
