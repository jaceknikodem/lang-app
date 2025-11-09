/**
 * Utility functions for topic selection and filtering
 */

import { logger } from './logger.js';
import { UI_CONFIG } from '../../shared/constants/index.js';

/**
 * Get available topics by filtering out frequently used topics.
 * Excludes the top N most used topics to encourage variety.
 * Falls back to all topics if too many are filtered out.
 *
 * @param allTopics - All available topics
 * @param language - The target language for filtering
 * @param minAvailable - Minimum number of topics to keep after filtering (default: from config)
 * @param excludeTopN - Number of top-used topics to exclude (default: from config)
 * @returns Array of available topics (filtered or all if too few remain)
 */
export async function getAvailableTopics(
  allTopics: string[],
  language: string | null,
  minAvailable: number = UI_CONFIG.TOPIC_FILTERING_MIN_AVAILABLE,
  excludeTopN: number = UI_CONFIG.TOPIC_FILTERING_EXCLUDE_TOP_N
): Promise<string[]> {
  if (allTopics.length === 0) {
    return [];
  }

  // If no language provided, return all topics
  if (!language) {
    return allTopics;
  }

  // Get word counts by topic for the language to filter out frequently used topics
  let frequentlyUsedTopics: Set<string> = new Set();
  try {
    const topicCounts = await window.electronAPI.database.getTopicWordCounts(language);
    // Get the top N most used topics (or fewer if there aren't that many)
    const topUsedTopics = topicCounts.slice(0, excludeTopN).map((tc) => tc.topic);
    frequentlyUsedTopics = new Set(topUsedTopics);
  } catch (error) {
    logger.error({ error }, '[TopicUtils] Error getting topic word counts');
    // Continue without filtering if there's an error
  }

  // Filter out frequently used topics
  const availableTopics = allTopics.filter((topic) => !frequentlyUsedTopics.has(topic));

  // If we filtered out too many, fall back to all topics
  return availableTopics.length >= minAvailable ? availableTopics : allTopics;
}

/**
 * Select a random topic from available topics, excluding frequently used ones.
 *
 * @param language - The target language for filtering
 * @returns A randomly selected topic, or null if no topics are available
 */
export async function selectRandomTopic(language: string | null): Promise<string | null> {
  const topics = await window.electronAPI.topics.getTopics();
  if (topics.length === 0) {
    return null;
  }

  const availableTopics = await getAvailableTopics(topics, language);
  if (availableTopics.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * availableTopics.length);
  return availableTopics[randomIndex];
}
