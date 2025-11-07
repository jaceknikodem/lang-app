/**
 * Similarity threshold utilities based on proficiency level
 */

export type ProficiencyLevel = 'newbie' | 'a1' | 'a2' | 'b1';

/**
 * Configuration for similarity thresholds based on proficiency level
 * Lower proficiency = more lenient thresholds (easier to pass)
 * Higher proficiency = stricter thresholds (more accurate pronunciation required)
 */
interface SimilarityThresholds {
  successThreshold: number; // Single threshold for passing (0-1) - used for both word matching and overall success
  excellentThreshold: number; // Threshold for "excellent" rating (0-1)
  goodThreshold: number; // Threshold for "good" rating (0-1)
  fairThreshold: number; // Threshold for "fair" rating (0-1)
}

/**
 * Get similarity thresholds based on proficiency level
 *
 * Thresholds are adjusted to be more lenient for beginners and stricter for advanced learners.
 */
export function getSimilarityThresholds(
  proficiencyLevel: ProficiencyLevel | null | undefined
): SimilarityThresholds {
  // Default to newbie (very lenient) if no proficiency level is set
  const level = proficiencyLevel || 'newbie';

  switch (level) {
    case 'a1':
      return {
        successThreshold: 0.7,
        excellentThreshold: 0.82,
        goodThreshold: 0.72,
        fairThreshold: 0.6,
      };
    case 'a2':
      return {
        successThreshold: 0.8,
        excellentThreshold: 0.85,
        goodThreshold: 0.75,
        fairThreshold: 0.65,
      };
    case 'b1':
      return {
        successThreshold: 0.9,
        excellentThreshold: 0.86,
        goodThreshold: 0.78,
        fairThreshold: 0.7,
      };
    default:
      // Fallback to newbie
      return {
        successThreshold: 0.7,
        excellentThreshold: 0.8,
        goodThreshold: 0.7,
        fairThreshold: 0.55,
      };
  }
}

/**
 * Get similarity class based on similarity score and proficiency level
 */
export function getSimilarityClass(
  similarity: number,
  proficiencyLevel: ProficiencyLevel | null | undefined
): 'excellent' | 'good' | 'fair' | 'poor' {
  const thresholds = getSimilarityThresholds(proficiencyLevel);

  if (similarity >= thresholds.excellentThreshold) return 'excellent';
  if (similarity >= thresholds.goodThreshold) return 'good';
  if (similarity >= thresholds.fairThreshold) return 'fair';
  return 'poor';
}
