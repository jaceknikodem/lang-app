/**
 * Utility function to automatically add new words:
 * 1. Randomly selects a topic from predefined topics
 * 2. Generates words for that topic
 * 3. Selects 5 words preferring top/frequent words
 * 4. Processes words using shared word processing utilities
 */

import { ALL_TOPIC_SUGGESTIONS } from '../../shared/constants/topics.js';
import { GeneratedWord } from '../../shared/types/core.js';
import { processSelectedWords, setupWordProcessingSession, ProcessWordsOptions } from './word-processor.js';

export interface AutoAddWordsResult {
  success: boolean;
  topic: string;
  wordsAdded: number;
  error?: string;
}

/**
 * Select top words from generated words, preferring those with lower frequencyPosition.
 * If fewer than requested words are available, returns all available words.
 * 
 * @param words - Array of generated words
 * @param count - Number of words to select (default: 5)
 * @returns Array of selected words
 */
function selectTopWords(words: GeneratedWord[], count: number = 5): GeneratedWord[] {
  // Sort words: prefer those with frequencyPosition (lower = better)
  // Words with undefined frequencyPosition go last
  const sortedWords = [...words].sort((a, b) => {
    // If both have frequencyPosition, sort by position (lower = better)
    if (a.frequencyPosition !== undefined && b.frequencyPosition !== undefined) {
      return a.frequencyPosition - b.frequencyPosition;
    }
    // If only one has frequencyPosition, prefer that one
    if (a.frequencyPosition !== undefined) {
      return -1; // a comes first
    }
    if (b.frequencyPosition !== undefined) {
      return 1; // b comes first
    }
    // Neither has frequencyPosition, keep original order
    return 0;
  });

  // Take top words (preferring frequent ones)
  // Then randomly select from the top portion to add some variety
  const topPortion = Math.min(count * 2, sortedWords.length); // Consider top 2x requested
  const candidates = sortedWords.slice(0, topPortion);
  
  // Randomly select count words from candidates
  const selected: GeneratedWord[] = [];
  const remaining = [...candidates];
  
  for (let i = 0; i < Math.min(count, remaining.length); i++) {
    const randomIndex = Math.floor(Math.random() * remaining.length);
    selected.push(remaining[randomIndex]);
    remaining.splice(randomIndex, 1);
  }

  return selected;
}

/**
 * Automatically add new words by selecting a random topic, generating words,
 * and processing 5 top words automatically.
 * 
 * @param language - The target language (defaults to current language if not provided)
 * @returns Result object with success status and details
 */
export async function autoAddNewWords(language?: string): Promise<AutoAddWordsResult> {
  try {
    // Get current language if not provided
    let targetLanguage = language;
    if (!targetLanguage) {
      targetLanguage = await window.electronAPI.database.getCurrentLanguage();
    }

    // Check if there are too many unreviewed/new words before adding more
    const unreviewedCount = await window.electronAPI.database.getNewWordCount(targetLanguage);
    
    if (unreviewedCount > 10) {
      return {
        success: false,
        topic: '',
        wordsAdded: 0,
        error: `Too many unreviewed words (${unreviewedCount}). Not adding more.`
      };
    }

    // Step 1: Randomly select a topic
    const randomIndex = Math.floor(Math.random() * ALL_TOPIC_SUGGESTIONS.length);
    const selectedTopic = ALL_TOPIC_SUGGESTIONS[randomIndex];

    console.log(`[Auto Add] Selected topic: "${selectedTopic}"`);

    // Step 2: Generate words for the topic
    console.log(`[Auto Add] Generating words for topic: "${selectedTopic}"`);
    const generatedWords = await window.electronAPI.llm.generateWords(
      selectedTopic,
      targetLanguage
    );

    if (!generatedWords || generatedWords.length === 0) {
      return {
        success: false,
        topic: selectedTopic,
        wordsAdded: 0,
        error: 'No words were generated. Please try again.'
      };
    }

    console.log(`[Auto Add] Generated ${generatedWords.length} words`);

    // Step 3: Select 5 words preferring top/frequent ones
    const selectedWords = selectTopWords(generatedWords, 5);
    console.log(`[Auto Add] Selected ${selectedWords.length} words to add`);

    if (selectedWords.length === 0) {
      return {
        success: false,
        topic: selectedTopic,
        wordsAdded: 0,
        error: 'No words were selected for processing.'
      };
    }

    // Step 4: Set up processing session (language and topic)
    await setupWordProcessingSession(targetLanguage, selectedTopic);

    // Step 5: Process selected words (insert and enqueue)
    const options: ProcessWordsOptions = {
      language: targetLanguage,
      topic: selectedTopic,
      desiredSentenceCount: 3
    };

    const result = await processSelectedWords(selectedWords, options);

    // Trigger autopilot check to potentially navigate
    window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));

    if (result.queuedCount === 0) {
      return {
        success: false,
        topic: selectedTopic,
        wordsAdded: 0,
        error: result.failedWords.length > 0 
          ? `Failed to add words: ${result.failedWords.join(', ')}`
          : 'No words were added. Please try again.'
      };
    }

    return {
      success: true,
      topic: selectedTopic,
      wordsAdded: result.queuedCount,
      error: result.failedWords.length > 0 
        ? `Some words failed: ${result.failedWords.join(', ')}`
        : undefined
    };
  } catch (error) {
    console.error('[Auto Add] Error in autoAddNewWords:', error);
    return {
      success: false,
      topic: '',
      wordsAdded: 0,
      error: error instanceof Error ? error.message : 'Failed to auto-add words. Please try again.'
    };
  }
}

