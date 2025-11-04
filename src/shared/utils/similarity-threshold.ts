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
  wordMatchThreshold: number;      // Threshold for individual word matching (0-1)
  overallSuccessThreshold: number;  // Threshold for overall sentence success (0-1)
  excellentThreshold: number;       // Threshold for "excellent" rating (0-1)
  goodThreshold: number;             // Threshold for "good" rating (0-1)
  fairThreshold: number;             // Threshold for "fair" rating (0-1)
}

/**
 * Get similarity thresholds based on proficiency level
 * 
 * Thresholds are adjusted to be more lenient for beginners and stricter for advanced learners:
 * - newbie: Very lenient (0.60 word match, 0.65 overall success)
 * - a1: Lenient (0.65 word match, 0.70 overall success)
 * - a2: Moderate (0.70 word match, 0.75 overall success) - default
 * - b1: Stricter (0.75 word match, 0.80 overall success)
 */
export function getSimilarityThresholds(proficiencyLevel: ProficiencyLevel | null | undefined): SimilarityThresholds {
  // Default to a2 (moderate) if no proficiency level is set
  const level = proficiencyLevel || 'a2';

  switch (level) {
    case 'newbie':
      return {
        wordMatchThreshold: 0.60,
        overallSuccessThreshold: 0.65,
        excellentThreshold: 0.90,
        goodThreshold: 0.80,
        fairThreshold: 0.65,
      };
    case 'a1':
      return {
        wordMatchThreshold: 0.65,
        overallSuccessThreshold: 0.70,
        excellentThreshold: 0.92,
        goodThreshold: 0.82,
        fairThreshold: 0.70,
      };
    case 'a2':
      return {
        wordMatchThreshold: 0.70,
        overallSuccessThreshold: 0.75,
        excellentThreshold: 0.95,
        goodThreshold: 0.85,
        fairThreshold: 0.75,
      };
    case 'b1':
      return {
        wordMatchThreshold: 0.75,
        overallSuccessThreshold: 0.80,
        excellentThreshold: 0.96,
        goodThreshold: 0.88,
        fairThreshold: 0.80,
      };
    default:
      // Fallback to a2
      return {
        wordMatchThreshold: 0.70,
        overallSuccessThreshold: 0.75,
        excellentThreshold: 0.95,
        goodThreshold: 0.85,
        fairThreshold: 0.75,
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

