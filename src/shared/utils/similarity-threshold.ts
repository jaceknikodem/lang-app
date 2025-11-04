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
  successThreshold: number;        // Single threshold for passing (0-1) - used for both word matching and overall success
  excellentThreshold: number;       // Threshold for "excellent" rating (0-1)
  goodThreshold: number;             // Threshold for "good" rating (0-1)
  fairThreshold: number;             // Threshold for "fair" rating (0-1)
}

/**
 * Get similarity thresholds based on proficiency level
 * 
 * Thresholds are adjusted to be more lenient for beginners and stricter for advanced learners:
 * - newbie: Very lenient (0.55 success threshold)
 * - a1: Lenient (0.60 success threshold)
 * - a2: Moderate (0.65 success threshold) - default
 * - b1: Stricter (0.70 success threshold)
 */
export function getSimilarityThresholds(proficiencyLevel: ProficiencyLevel | null | undefined): SimilarityThresholds {
  // Default to newbie (very lenient) if no proficiency level is set
  const level = proficiencyLevel || 'newbie';

  switch (level) {
    case 'a1':
      return {
        successThreshold: 0.60,
        excellentThreshold: 0.82,
        goodThreshold: 0.72,
        fairThreshold: 0.60,
      };
    case 'a2':
      return {
        successThreshold: 0.65,
        excellentThreshold: 0.85,
        goodThreshold: 0.75,
        fairThreshold: 0.65,
      };
    case 'b1':
      return {
        successThreshold: 0.70,
        excellentThreshold: 0.86,
        goodThreshold: 0.78,
        fairThreshold: 0.70,
      };
    default:
      // Fallback to newbie
      return {
        successThreshold: 0.45,
        excellentThreshold: 0.80,
        goodThreshold: 0.70,
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

