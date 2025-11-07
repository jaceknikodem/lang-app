/**
 * App initialization utilities
 * Helper functions for app initialization that can be reused across components
 */

/**
 * Check if electronAPI is available
 */
export function checkElectronAPI(): boolean {
  if (!window.electronAPI) {
    console.error('electronAPI not available - preload script may have failed');
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
    console.warn('LLM check failed (this is OK):', error);
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
    console.error('Failed to load autoplay audio setting:', error);
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
    console.error('Failed to check existing words:', error);
    return false;
  }
}

/**
 * Check if flow sentences with audio exist
 */
export async function checkFlowSentences(): Promise<boolean> {
  try {
    const language = await window.electronAPI.database.getCurrentLanguage();
    const flowSentences = await window.electronAPI.flow.getFlowSentences(language);

    // Collect all audio paths using the same logic as handleFlowPlay()
    const audioPaths: string[] = [];
    for (const item of flowSentences) {
      if (item.beforeSentenceAudio) {
        audioPaths.push(item.beforeSentenceAudio);
      }
      if (item.sentence.audioPath) {
        audioPaths.push(item.sentence.audioPath);
      }
      if (item.afterSentenceAudio) {
        audioPaths.push(item.afterSentenceAudio);
      }
      audioPaths.push(...item.continuationAudios);
    }

    // Only enable Flow button if we have at least one audio file
    return audioPaths.length > 0;
  } catch (error) {
    console.error('Failed to check flow sentences:', error);
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
    console.error('Failed to check proficiency level:', error);
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
      console.error('Deferred initialization task failed:', error);
    }
  }, delay);
}
