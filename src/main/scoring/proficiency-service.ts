/**
 * Proficiency service for calculating comprehensive proficiency scores
 * Combines pronunciation, audio speed, engagement, word position, and strength
 */

import { DatabaseLayer } from '../../shared/types/database.js';

export interface ProficiencyMetrics {
  pronunciationScore: number;
  audioSpeedScore: number;
  engagementScore: number;
  wordPositionScore: number;
  strengthScore: number;
  overallProficiency: number;
}

interface PronunciationData {
  similarity: number;
  timestamp: number;
}

interface PlaybackData {
  playbackSpeed: number;
  timestamp: number;
}

export class ProficiencyService {
  private database: DatabaseLayer;

  // Weights for combining different metrics
  private readonly weights = {
    pronunciation: 0.3, // 30% - pronunciation is key indicator
    audioSpeed: 0.2, // 20% - speed indicates comprehension
    engagement: 0.15, // 15% - practice frequency matters
    wordPosition: 0.15, // 15% - vocabulary difficulty
    strength: 0.2, // 20% - SRS strength is important
  };

  constructor(database: DatabaseLayer) {
    this.database = database;
  }

  /**
   * Calculate proficiency score for a language
   * Returns overall proficiency (0-100) based on all tracked metrics
   */
  async calculateLanguageProficiency(language: string, timeWindowDays?: number): Promise<number> {
    try {
      // Get all words for the language
      const words = await this.database.getAllWords(language, false, false);

      if (words.length === 0) {
        return 0;
      }

      // Calculate proficiency for each word
      const proficiencies = await Promise.all(
        words.map((word) => this.calculateWordProficiency(word.id, language, timeWindowDays))
      );

      // Weight by word frequency (common words matter more)
      // Get frequency positions for all words
      const frequencyPositions = await Promise.all(
        words.map((word) => this.getWordFrequencyPosition(word.id, language))
      );

      const weightedSum = proficiencies.reduce((sum, p, i) => {
        const frequencyPosition = frequencyPositions[i];
        // Use frequency position if available, otherwise use strength as proxy
        const frequencyWeight = frequencyPosition ? 1 / Math.log(frequencyPosition + 1) : 1;
        return sum + p.overallProficiency * frequencyWeight;
      }, 0);

      const totalWeight = proficiencies.reduce((sum, p, i) => {
        const frequencyPosition = frequencyPositions[i];
        return sum + (frequencyPosition ? 1 / Math.log(frequencyPosition + 1) : 1);
      }, 0);

      return totalWeight > 0 ? weightedSum / totalWeight : 0;
    } catch (error) {
      console.error('Error calculating language proficiency:', error);
      return 0;
    }
  }

  /**
   * Calculate proficiency metrics for a specific word
   */
  async calculateWordProficiency(
    wordId: number,
    language: string,
    timeWindowDays?: number
  ): Promise<ProficiencyMetrics> {
    try {
      // 1. Get pronunciation data
      const pronunciationData = await this.getWordPronunciationData(wordId, timeWindowDays);
      const pronunciationScore = this.calculatePronunciationScore(pronunciationData);

      // 2. Get audio playback data
      const playbackData = await this.getWordPlaybackData(wordId, timeWindowDays);
      const audioSpeedScore = this.calculateAudioSpeedScore(playbackData);

      // 3. Get engagement (play counts)
      const engagementData = await this.getWordEngagementData(wordId);
      const engagementScore = this.calculateEngagementScore(engagementData);

      // 4. Get word position (frequency-based)
      const wordPosition = await this.getWordFrequencyPosition(wordId, language);
      const wordPositionScore = this.calculateWordPositionScore(wordPosition);

      // 5. Get strength
      const word = await this.database.getWordById(wordId);
      const strengthScore = Math.min(100, word?.strength ?? 0);

      // 6. Combine with weights
      const overallProficiency = this.combineScores({
        pronunciation: pronunciationScore,
        audioSpeed: audioSpeedScore,
        engagement: engagementScore,
        wordPosition: wordPositionScore,
        strength: strengthScore,
      });

      return {
        pronunciationScore,
        audioSpeedScore,
        engagementScore,
        wordPositionScore,
        strengthScore,
        overallProficiency,
      };
    } catch (error) {
      console.error(`Error calculating proficiency for word ${wordId}:`, error);
      return {
        pronunciationScore: 0,
        audioSpeedScore: 50,
        engagementScore: 0,
        wordPositionScore: 50,
        strengthScore: 0,
        overallProficiency: 0,
      };
    }
  }

  /**
   * Get pronunciation data for a word (via its sentences)
   */
  private async getWordPronunciationData(
    wordId: number,
    timeWindowDays?: number
  ): Promise<PronunciationData[]> {
    try {
      const sentences = await this.database.getSentencesByWord(wordId);
      const allAttempts: PronunciationData[] = [];

      for (const sentence of sentences) {
        const history = await this.database.getPronunciationHistory(sentence.id);
        const cutoffTime = timeWindowDays ? Date.now() - timeWindowDays * 24 * 60 * 60 * 1000 : 0;

        for (const attempt of history) {
          const timestamp = attempt.createdAt.getTime();
          if (timestamp >= cutoffTime) {
            allAttempts.push({
              similarity: attempt.similarityScore,
              timestamp,
            });
          }
        }
      }

      return allAttempts;
    } catch (error) {
      console.error('Error getting word pronunciation data:', error);
      return [];
    }
  }

  /**
   * Get playback data for a word's sentences
   */
  private async getWordPlaybackData(
    wordId: number,
    timeWindowDays?: number
  ): Promise<PlaybackData[]> {
    try {
      const sentences = await this.database.getSentencesByWord(wordId);
      if (sentences.length === 0) return [];

      // Access database through type assertion (getDb is private but we need it)
      const db = (this.database as any).getDb?.();
      if (!db) return [];

      const sentenceIds = sentences.map((s) => s.id);
      if (sentenceIds.length === 0) return [];

      const placeholders = sentenceIds.map(() => '?').join(',');

      const cutoffTime = timeWindowDays
        ? new Date(Date.now() - timeWindowDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const query = cutoffTime
        ? `SELECT playback_speed, created_at 
           FROM audio_playback_events 
           WHERE sentence_id IN (${placeholders}) 
           AND created_at >= ?`
        : `SELECT playback_speed, created_at 
           FROM audio_playback_events 
           WHERE sentence_id IN (${placeholders})`;

      const stmt = db.prepare(query);
      const rows = cutoffTime ? stmt.all(...sentenceIds, cutoffTime) : stmt.all(...sentenceIds);

      return rows.map((row: any) => ({
        playbackSpeed: row.playback_speed ?? 1.0,
        timestamp: new Date(row.created_at).getTime(),
      }));
    } catch (error) {
      console.error('Error getting word playback data:', error);
      return [];
    }
  }

  /**
   * Get engagement data (total play count) for a word's sentences
   */
  private async getWordEngagementData(wordId: number): Promise<number> {
    try {
      const sentences = await this.database.getSentencesByWord(wordId);
      return sentences.reduce((sum, s) => sum + (s.playCount ?? 0), 0);
    } catch (error) {
      console.error('Error getting word engagement data:', error);
      return 0;
    }
  }

  /**
   * Get word frequency position
   */
  private async getWordFrequencyPosition(wordId: number, language: string): Promise<number | null> {
    try {
      const word = await this.database.getWordById(wordId);
      if (!word) return null;

      // Access database through type assertion (getDb is private but we need it)
      const db = (this.database as any).getDb?.();
      if (!db) return null;

      const stmt = db.prepare(`
        SELECT frequency_position 
        FROM neglected_words 
        WHERE word = ? AND language = ?
        ORDER BY ignored_at DESC
        LIMIT 1
      `);

      const row = stmt.get(word.word, language) as any;
      return row?.frequency_position ?? null;
    } catch (error) {
      // If word doesn't have frequency position, that's okay
      return null;
    }
  }

  /**
   * Calculate pronunciation score (0-100)
   * Weighted average with exponential decay for recency
   */
  private calculatePronunciationScore(data: PronunciationData[]): number {
    if (data.length === 0) return 0;

    const now = Date.now();
    let weightedSum = 0;
    let totalWeight = 0;

    for (const attempt of data) {
      const daysAgo = (now - attempt.timestamp) / (1000 * 60 * 60 * 24);
      const weight = Math.exp(-daysAgo / 7); // Exponential decay, 7-day half-life
      weightedSum += attempt.similarity * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
  }

  /**
   * Calculate audio speed score (0-100)
   * Higher playback speed = higher proficiency
   */
  private calculateAudioSpeedScore(data: PlaybackData[]): number {
    if (data.length === 0) return 50; // Default to 1.0x speed

    const avgSpeed = data.reduce((sum, p) => sum + p.playbackSpeed, 0) / data.length;
    // 1.0x = 50, 1.5x = 75, 2.0x = 100
    return Math.min(100, Math.max(0, 50 + (avgSpeed - 1.0) * 50));
  }

  /**
   * Calculate engagement score (0-100)
   * Logarithmic scale based on play count
   */
  private calculateEngagementScore(playCount: number): number {
    // Logarithmic scale: log(play_count + 1) / log(10) * 50
    // This means: 1 play = ~15, 10 plays = ~50, 100 plays = ~100
    return Math.min(100, (Math.log(playCount + 1) / Math.log(10)) * 50);
  }

  /**
   * Calculate word position score (0-100)
   * Lower frequency position = higher score
   */
  private calculateWordPositionScore(position: number | null): number {
    if (!position) return 50; // Unknown position = neutral
    // Invert: lower position = higher score
    // position 1 = 100, position 1000 = 0
    return Math.max(0, Math.min(100, 100 - position / 10));
  }

  /**
   * Combine individual scores with weights
   */
  private combineScores(scores: {
    pronunciation: number;
    audioSpeed: number;
    engagement: number;
    wordPosition: number;
    strength: number;
  }): number {
    return (
      this.weights.pronunciation * scores.pronunciation +
      this.weights.audioSpeed * scores.audioSpeed +
      this.weights.engagement * scores.engagement +
      this.weights.wordPosition * scores.wordPosition +
      this.weights.strength * scores.strength
    );
  }
}
