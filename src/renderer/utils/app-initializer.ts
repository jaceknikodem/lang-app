/**
 * App initialization utilities
 * Helper functions for app initialization that can be reused across components
 */

import { logger } from './logger.js';

/**
 * Check if electronAPI is available
 */
export function checkElectronAPI(): boolean {
  if (!window.electronAPI) {
    logger.error('electronAPI not available - preload script may have failed');
    return false;
  }
  return true;
}

/**
 * Check if LLM is available (non-blocking)
 */
export async function checkLLMAvailability(): Promise<void> {
  try {
    await window.electronAPI.llm.isAvailable();
  } catch (error) {
    logger.warn({ error }, 'LLM check failed (this is OK)');
  }
}

/**
 * Load autoplay audio setting from database
 */
export async function loadAutoplayAudioSetting(): Promise<boolean> {
  try {
    const autoplaySetting = await window.electronAPI.database.getSetting('autoplay_audio');
    return autoplaySetting === 'true';
  } catch (error) {
    logger.error({ error }, 'Failed to load autoplay audio setting');
    return false;
  }
}

/**
 * Check if existing words exist in database for a language
 */
export async function checkExistingWords(language: string): Promise<boolean> {
  try {
    // Use getStudyStats which is much faster than loading all words
    // It only returns a count, not the full word data
    const stats = await window.electronAPI.database.getStudyStats(language);
    return stats.totalWords > 0;
  } catch (error) {
    logger.error({ error }, 'Failed to check existing words');
    return false;
  }
}

/**
 * Check if flow sentences with audio exist
 * Returns true only if there are at least 10 sentences with audio available
 */
export async function checkFlowSentences(): Promise<boolean> {
  try {
    const language = await window.electronAPI.database.getCurrentLanguage();
    const availableSentencesCount =
      await window.electronAPI.database.getAvailableSentencesCount(language);

    // Only enable Flow button if we have at least 10 sentences with audio
    return availableSentencesCount >= 10;
  } catch (error) {
    logger.error({ error }, 'Failed to check flow sentences');
    return false;
  }
}

/**
 * Check proficiency level for a language
 */
export async function checkProficiencyLevel(language: string): Promise<string | null> {
  if (!language) {
    return null;
  }

  try {
    const proficiencyKey = `language_proficiency_${language}`;
    const proficiency = await window.electronAPI.database.getSetting(proficiencyKey);
    return proficiency as string | null;
  } catch (error) {
    logger.error({ error, language }, 'Failed to check proficiency level');
    return null;
  }
}

/**
 * Schedule a deferred initialization task
 */
export function scheduleDeferred(task: () => Promise<void>, delay: number = 0): void {
  setTimeout(async () => {
    try {
      await task();
    } catch (error) {
      logger.error({ error }, 'Deferred initialization task failed');
    }
  }, delay);
}
