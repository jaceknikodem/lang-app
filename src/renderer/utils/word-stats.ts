/**
 * Word statistics utilities
 */

import { UI_CONFIG } from '../../shared/constants/index.js';

export interface WordCategoryStats {
  known: number;
  strong: number;
  weak: number;
  new: number;
}

export interface WordStatsThresholds {
  weak: number;
  strong: number;
}

/**
 * Get default word stats thresholds from config
 */
function getDefaultThresholds(): WordStatsThresholds {
  return {
    weak: UI_CONFIG.WORD_STATS_THRESHOLDS.WEAK,
    strong: UI_CONFIG.WORD_STATS_THRESHOLDS.STRONG,
  };
}

/**
 * Calculate word category statistics from a list of words
 * @param words Array of words with strength and lastStudied properties
 * @param thresholds Optional thresholds for categorizing words (default: from config)
 * @returns Statistics object with counts for each category
 */
export function calculateWordCategoryStats(
  words: Array<{ strength?: number | null; lastStudied?: Date | null }>,
  thresholds: WordStatsThresholds = getDefaultThresholds()
): WordCategoryStats {
  const stats: WordCategoryStats = {
    known: 0,
    strong: 0,
    weak: 0,
    new: 0,
  };

  words.forEach((word) => {
    if (!word.lastStudied) {
      // Not yet reviewed
      stats.new++;
    } else if ((word.strength ?? 0) > thresholds.strong) {
      // Confidently remembered (strength > threshold)
      stats.known++;
    } else if ((word.strength ?? 0) >= thresholds.weak) {
      // Mostly remembered (between thresholds)
      stats.strong++;
    } else {
      // Shaky or forgotten (< weak threshold)
      stats.weak++;
    }
  });

  return stats;
}
