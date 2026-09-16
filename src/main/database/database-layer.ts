/**
 * SQLite implementation of {@link DatabaseLayer}.
 *
 * This class owns the connection and schema lifecycle; every query lives in a
 * focused repository under this directory. The methods below are thin
 * delegations that keep the flat `DatabaseLayer` surface its consumers expect.
 */

import {
  DatabaseLayer,
  DatabaseConfig,
  JobWordInfo,
  SentenceAudioBackfillItem,
  WordGenerationJob,
  WordProcessingStatus,
} from '../../shared/types/database.js';
import {
  Word,
  Sentence,
  StudyStats,
  CreateWordRequest,
  DictionaryEntry,
  DialogueVariant,
  PrecomputedToken,
  AnkiExportRow,
} from '../../shared/types/core.js';
import { DatabaseConnection } from './connection.js';
import { initializeSchema } from './schema.js';
import { wrapError } from '../../shared/utils/error.js';
import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';
import { SrsRepository } from './srs-repository.js';
import { WordRepository } from './word-repository.js';
import { SentenceRepository } from './sentence-repository.js';
import { AudioRepository } from './audio-repository.js';
import { DialogueRepository } from './dialogue-repository.js';
import { WordGenerationQueueRepository } from './word-generation-queue-repository.js';
import { SettingsRepository } from './settings-repository.js';
import { DictionaryRepository } from './dictionary-repository.js';
import { StatsRepository } from './stats-repository.js';
import { TrackingRepository } from './tracking-repository.js';
import { MaintenanceRepository } from './maintenance-repository.js';

export class SQLiteDatabaseLayer implements DatabaseLayer {
  private readonly connection: DatabaseConnection;
  private readonly logger: Logger;

  private readonly srs: SrsRepository;
  private readonly word: WordRepository;
  private readonly sentence: SentenceRepository;
  private readonly audio: AudioRepository;
  private readonly dialogue: DialogueRepository;
  private readonly queue: WordGenerationQueueRepository;
  private readonly settings: SettingsRepository;
  private readonly dictionary: DictionaryRepository;
  private readonly stats: StatsRepository;
  private readonly tracking: TrackingRepository;
  private readonly maintenance: MaintenanceRepository;

  constructor(config: DatabaseConfig) {
    this.logger = getLogger();
    this.connection = new DatabaseConnection(config);
    this.srs = new SrsRepository(this.connection, this.logger);
    this.word = new WordRepository(this.connection, this.logger, this.srs);
    this.sentence = new SentenceRepository(this.connection, this.logger, this.word);
    this.audio = new AudioRepository(this.connection, this.logger);
    this.dialogue = new DialogueRepository(this.connection, this.logger);
    this.queue = new WordGenerationQueueRepository(this.connection, this.logger);
    this.settings = new SettingsRepository(this.connection, this.logger);
    this.dictionary = new DictionaryRepository(
      this.connection,
      this.logger,
      this.settings,
      this.word,
      this.queue
    );
    this.stats = new StatsRepository(this.connection, this.logger);
    this.tracking = new TrackingRepository(this.connection, this.logger);
    this.maintenance = new MaintenanceRepository(this.connection, this.logger);
  }

  async initialize(): Promise<void> {
    try {
      const db = await this.connection.connect();

      // Initialize schema
      initializeSchema(db);

      // Populate dictionary data from bundled files in background (non-blocking)
      // This is a very expensive operation that can take several seconds
      setImmediate(async () => {
        try {
          await this.dictionary.populateDictionaryFromFiles();
        } catch (dictError) {
          this.logger.warn({ error: dictError }, 'Dictionary population skipped due to error');
        }
      });

      this.logger.info('Database initialized successfully');
    } catch (error) {
      throw wrapError(error, `Failed to initialize database`);
    }
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  async insertWord(wordData: CreateWordRequest): Promise<number> {
    return this.word.insertWord(wordData);
  }

  async updateWordStrength(wordId: number, strength: number): Promise<void> {
    return this.word.updateWordStrength(wordId, strength);
  }

  async markWordKnown(wordId: number, known: boolean): Promise<void> {
    return this.word.markWordKnown(wordId, known);
  }

  async markWordIgnored(wordId: number, ignored: boolean): Promise<void> {
    return this.word.markWordIgnored(wordId, ignored);
  }

  async getWordsToStudy(limit: number, language: string): Promise<Word[]> {
    return this.word.getWordsToStudy(limit, language);
  }

  async getWordsByStrength(
    minStrength: number,
    maxStrength: number,
    language: string,
    limit?: number
  ): Promise<Word[]> {
    return this.word.getWordsByStrength(minStrength, maxStrength, language, limit);
  }

  async getWordsWithSentences(
    language: string,
    includeKnown: boolean = true,
    includeIgnored: boolean = false
  ): Promise<Word[]> {
    return this.word.getWordsWithSentences(language, includeKnown, includeIgnored);
  }

  async getWordsWithSentencesOrderedByStrength(
    language: string,
    includeKnown: boolean = true,
    includeIgnored: boolean = false
  ): Promise<Word[]> {
    return this.word.getWordsWithSentencesOrderedByStrength(language, includeKnown, includeIgnored);
  }

  async getAllWords(
    language: string,
    includeKnown: boolean = true,
    includeIgnored: boolean = false
  ): Promise<Word[]> {
    return this.word.getAllWords(language, includeKnown, includeIgnored);
  }

  async getAllWordsWithSentences(language: string): Promise<Word[]> {
    return this.word.getAllWordsWithSentences(language);
  }

  async getWordById(wordId: number): Promise<Word | null> {
    return this.word.getWordById(wordId);
  }

  async getKnownWordsForSentenceGeneration(
    language: string,
    limit: number = 50
  ): Promise<string[]> {
    return this.word.getKnownWordsForSentenceGeneration(language, limit);
  }

  async getKnownWords(
    language: string,
    minWordStrength: number,
    maxWords: number
  ): Promise<string[]> {
    return this.word.getKnownWords(language, minWordStrength, maxWords);
  }

  async getExistingWordsForDuplicateChecking(
    language: string,
    topic?: string,
    limit?: number
  ): Promise<string[]> {
    return this.word.getExistingWordsForDuplicateChecking(language, topic, limit);
  }

  async getIgnoredWords(language: string, topic?: string): Promise<string[]> {
    return this.word.getIgnoredWords(language, topic);
  }

  async checkWordsExist(language: string, words: string[], topic?: string): Promise<Set<string>> {
    return this.word.checkWordsExist(language, words, topic);
  }

  async getWordsByIds(wordIds: number[]): Promise<Word[]> {
    return this.word.getWordsByIds(wordIds);
  }

  async insertSentence(
    wordId: number,
    sentence: string,
    translation: string,
    audioPath: string,
    contextBefore?: string,
    contextAfter?: string,
    contextBeforeTranslation?: string,
    contextAfterTranslation?: string,
    sentenceParts?: string[],
    sentenceGenerationModel?: string,
    audioGenerationService?: string,
    audioGenerationModel?: string,
    audioGenerationVoiceId?: string,
    tokenizedTokens?: PrecomputedToken[],
    pronunciation?: string,
    contextBeforePronunciation?: string,
    contextAfterPronunciation?: string,
    proficiencyLevel?: string
  ): Promise<number> {
    return this.sentence.insertSentence(
      wordId,
      sentence,
      translation,
      audioPath,
      contextBefore,
      contextAfter,
      contextBeforeTranslation,
      contextAfterTranslation,
      sentenceParts,
      sentenceGenerationModel,
      audioGenerationService,
      audioGenerationModel,
      audioGenerationVoiceId,
      tokenizedTokens,
      pronunciation,
      contextBeforePronunciation,
      contextAfterPronunciation,
      proficiencyLevel
    );
  }

  async getSentencesByWord(wordId: number): Promise<Sentence[]> {
    return this.sentence.getSentencesByWord(wordId);
  }

  async getSentencesWithoutAudio(): Promise<SentenceAudioBackfillItem[]> {
    return this.audio.getSentencesWithoutAudio();
  }

  async getSentencesForExport(language: string): Promise<AnkiExportRow[]> {
    return this.sentence.getSentencesForExport(language);
  }

  async getSentencesByIds(sentenceIds: number[]): Promise<Sentence[]> {
    return this.sentence.getSentencesByIds(sentenceIds);
  }

  async updateSentenceLastShown(sentenceId: number): Promise<void> {
    return this.sentence.updateSentenceLastShown(sentenceId);
  }

  async updateSentenceAudioPath(
    sentenceId: number,
    audioPath: string,
    audioGenerationVoiceId?: string
  ): Promise<void> {
    return this.audio.updateSentenceAudioPath(sentenceId, audioPath, audioGenerationVoiceId);
  }

  async updateBeforeSentenceAudioPath(sentenceId: number, audioPath: string): Promise<void> {
    return this.audio.updateBeforeSentenceAudioPath(sentenceId, audioPath);
  }

  async updateAfterSentenceAudioPath(sentenceId: number, audioPath: string): Promise<void> {
    return this.audio.updateAfterSentenceAudioPath(sentenceId, audioPath);
  }

  async updateSentenceTokens(sentenceId: number, tokens: PrecomputedToken[]): Promise<void> {
    return this.sentence.updateSentenceTokens(sentenceId, tokens);
  }

  async incrementSentencePlayCount(sentenceId: number): Promise<void> {
    return this.sentence.incrementSentencePlayCount(sentenceId);
  }

  async incrementGrammarExplanationCount(wordId: number): Promise<void> {
    return this.tracking.incrementGrammarExplanationCount(wordId);
  }

  async insertGrammarExplanation(
    wordId: number,
    sentenceId: number,
    explanation: string
  ): Promise<number> {
    return this.tracking.insertGrammarExplanation(wordId, sentenceId, explanation);
  }

  async getGrammarExplanation(wordId: number, sentenceId: number): Promise<string | null> {
    return this.tracking.getGrammarExplanation(wordId, sentenceId);
  }

  async recordPronunciationAttempt(
    sentenceId: number,
    similarityScore: number,
    expectedText: string,
    transcribedText: string,
    audioPath?: string | null
  ): Promise<void> {
    return this.tracking.recordPronunciationAttempt(
      sentenceId,
      similarityScore,
      expectedText,
      transcribedText,
      audioPath
    );
  }

  async getPronunciationHistory(
    sentenceId: number,
    limit?: number
  ): Promise<
    Array<{
      id: number;
      sentenceId: number;
      similarityScore: number;
      expectedText: string;
      transcribedText: string;
      audioPath: string | null;
      createdAt: Date;
    }>
  > {
    return this.tracking.getPronunciationHistory(sentenceId, limit);
  }

  async insertDialogueVariant(
    sentenceId: number,
    variantSentence: string,
    variantTranslation: string,
    variantPronunciation?: string
  ): Promise<number> {
    return this.dialogue.insertDialogueVariant(
      sentenceId,
      variantSentence,
      variantTranslation,
      variantPronunciation
    );
  }

  async updateDialogueVariantPronunciation(
    variantId: number,
    pronunciation: string
  ): Promise<void> {
    return this.dialogue.updateDialogueVariantPronunciation(variantId, pronunciation);
  }

  async getDialogueVariantsBySentenceId(
    sentenceId: number,
    limit?: number
  ): Promise<DialogueVariant[]> {
    return this.dialogue.getDialogueVariantsBySentenceId(sentenceId, limit);
  }

  async getDialogueVariantCount(sentenceId: number): Promise<number> {
    return this.dialogue.getDialogueVariantCount(sentenceId);
  }

  async getDialogueVariantById(variantId: number): Promise<DialogueVariant | null> {
    return this.dialogue.getDialogueVariantById(variantId);
  }

  async updateDialogueVariantContinuation(
    variantId: number,
    continuationText: string,
    continuationTranslation: string,
    continuationAudio?: string
  ): Promise<void> {
    return this.dialogue.updateDialogueVariantContinuation(
      variantId,
      continuationText,
      continuationTranslation,
      continuationAudio
    );
  }

  async updateDialogueVariantSentenceAudio(variantId: number, audioPath: string): Promise<void> {
    return this.dialogue.updateDialogueVariantSentenceAudio(variantId, audioPath);
  }

  async getSentenceById(sentenceId: number): Promise<Sentence | null> {
    return this.sentence.getSentenceById(sentenceId);
  }

  async deleteSentence(sentenceId: number): Promise<void> {
    return this.sentence.deleteSentence(sentenceId);
  }

  async updateLastStudied(wordId: number): Promise<void> {
    return this.srs.updateLastStudied(wordId);
  }

  async getStudyStats(language: string): Promise<StudyStats> {
    return this.stats.getStudyStats(language);
  }

  async recordStudySession(wordsStudied: number): Promise<void> {
    return this.stats.recordStudySession(wordsStudied);
  }

  async getRecentStudySessions(
    limit: number = 10
  ): Promise<Array<{ id: number; wordsStudied: number; whenStudied: Date }>> {
    return this.stats.getRecentStudySessions(limit);
  }

  async getWeakestWords(limit: number, language: string): Promise<Word[]> {
    return this.srs.getWeakestWords(limit, language);
  }

  async getRandomSentenceForWord(wordId: number): Promise<Sentence | null> {
    return this.sentence.getRandomSentenceForWord(wordId);
  }

  async getFlowSentences(language: string): Promise<
    Array<{
      audioPath: string;
      englishAudioPath?: string;
      beforeSentenceAudio?: string;
      afterSentenceAudio?: string;
      continuationAudios: string[];
      variantSentenceAudios: string[];
    }>
  > {
    return this.sentence.getFlowSentences(language);
  }

  async getRandomDialogSentence(language: string, excludeIds?: number[]): Promise<Sentence | null> {
    return this.dialogue.getRandomDialogSentence(language, excludeIds);
  }

  async getRandomDialogSentences(
    count: number,
    language: string,
    excludeIds?: number[]
  ): Promise<Sentence[]> {
    return this.dialogue.getRandomDialogSentences(count, language, excludeIds);
  }

  async insertDialogCorrection(data: {
    sentenceId: number;
    sessionId?: number;
    correctionText: string;
    language: string;
  }): Promise<number> {
    return this.dialogue.insertDialogCorrection(data);
  }

  async getDialogCorrections(
    sentenceId: number,
    language: string,
    limit: number = 3
  ): Promise<Array<{ id: number; correctionText: string; createdAt: Date }>> {
    return this.dialogue.getDialogCorrections(sentenceId, language, limit);
  }

  async getRandomSentenceWithTopic(
    language: string,
    excludeIds?: number[]
  ): Promise<Sentence | null> {
    return this.sentence.getRandomSentenceWithTopic(language, excludeIds);
  }

  async updateSentenceRelatedWords(sentenceId: number, relatedWords: string[]): Promise<void> {
    return this.sentence.updateSentenceRelatedWords(sentenceId, relatedWords);
  }

  async getSetting(key: string): Promise<string | null> {
    return this.settings.getSetting(key);
  }

  async setSetting(key: string, value: string): Promise<void> {
    return this.settings.setSetting(key, value);
  }

  async getCurrentLanguage(): Promise<string> {
    return this.settings.getCurrentLanguage();
  }

  async setCurrentLanguage(language: string): Promise<void> {
    return this.settings.setCurrentLanguage(language);
  }

  async getCurrentTheme(): Promise<string> {
    return this.settings.getCurrentTheme();
  }

  async setCurrentTheme(theme: string): Promise<void> {
    return this.settings.setCurrentTheme(theme);
  }

  async getLanguageStats(): Promise<
    Array<{
      language: string;
      totalWords: number;
      studiedWords: number;
      averagePronunciationScore: number | null;
      pronunciationAttemptCount: number;
    }>
  > {
    return this.stats.getLanguageStats();
  }

  async getStartupStats(language: string): Promise<{
    timesPlayed: number;
    reviewCount: number;
  }> {
    return this.stats.getStartupStats(language);
  }

  async getTopicWordCounts(language: string): Promise<Array<{ topic: string; count: number }>> {
    return this.stats.getTopicWordCounts(language);
  }

  async lookupDictionary(word: string, language: string): Promise<DictionaryEntry[]> {
    return this.dictionary.lookupDictionary(word, language);
  }

  async updateWordProcessingStatus(wordId: number, status: WordProcessingStatus): Promise<void> {
    return this.queue.updateWordProcessingStatus(wordId, status);
  }

  async getWordProcessingInfo(
    wordId: number
  ): Promise<{ processingStatus: WordProcessingStatus; sentenceCount: number } | null> {
    return this.queue.getWordProcessingInfo(wordId);
  }

  async getWordGenerationQueueSummary(language?: string): Promise<{
    queued: number;
    processing: number;
    failed: number;
    queuedWords: JobWordInfo[];
    processingWords: JobWordInfo[];
  }> {
    return this.queue.getWordGenerationQueueSummary(language);
  }

  async enqueueWordGeneration(
    wordId: number,
    language: string,
    topic?: string,
    desiredSentenceCount: number = 3
  ): Promise<void> {
    return this.queue.enqueueWordGeneration(wordId, language, topic, desiredSentenceCount);
  }

  async getNextWordGenerationJob(): Promise<WordGenerationJob | null> {
    return this.queue.getNextWordGenerationJob();
  }

  async markWordGenerationJobProcessing(jobId: number): Promise<void> {
    return this.queue.markWordGenerationJobProcessing(jobId);
  }

  async rescheduleWordGenerationJob(
    jobId: number,
    delayMs: number,
    lastError?: string
  ): Promise<void> {
    return this.queue.rescheduleWordGenerationJob(jobId, delayMs, lastError);
  }

  async completeWordGenerationJob(jobId: number): Promise<void> {
    return this.queue.completeWordGenerationJob(jobId);
  }

  async failWordGenerationJob(jobId: number, errorMessage: string): Promise<void> {
    return this.queue.failWordGenerationJob(jobId, errorMessage);
  }

  async updateWordSRS(
    wordId: number,
    strength: number,
    intervalDays: number,
    easeFactor: number,
    nextDue: Date,
    options?: {
      fsrsDifficulty?: number;
      fsrsStability?: number;
      fsrsLapses?: number;
      fsrsLastRating?: number | null;
    }
  ): Promise<void> {
    return this.srs.updateWordSRS(wordId, strength, intervalDays, easeFactor, nextDue, options);
  }

  async getWordsDueForReview(language: string, limit?: number): Promise<Word[]> {
    return this.srs.getWordsDueForReview(language, limit);
  }

  async getWordsDueCount(language: string): Promise<number> {
    return this.srs.getWordsDueCount(language);
  }

  async getWordsDueWithPriority(language: string, limit?: number): Promise<Word[]> {
    return this.srs.getWordsDueWithPriority(language, limit);
  }

  async getSRSStats(language: string): Promise<{
    totalWords: number;
    dueToday: number;
    overdue: number;
    averageInterval: number;
    averageEaseFactor: number;
  }> {
    return this.srs.getSRSStats(language);
  }

  async getNewWordCount(language: string): Promise<number> {
    return this.stats.getNewWordCount(language);
  }

  async getWeakWordCount(language: string): Promise<number> {
    return this.stats.getWeakWordCount(language);
  }

  async getDialogueReadinessRatio(language: string, minStrength: number = 40): Promise<number> {
    return this.stats.getDialogueReadinessRatio(language, minStrength);
  }

  async getAveragePronunciationScore(language: string): Promise<number> {
    return this.stats.getAveragePronunciationScore(language);
  }

  async getAvailableSentencesCount(language: string): Promise<number> {
    return this.stats.getAvailableSentencesCount(language);
  }

  async getTimeSinceLastActivePractice(language: string): Promise<number> {
    return this.stats.getTimeSinceLastActivePractice(language);
  }

  async resetLanguageProgress(language: string): Promise<void> {
    return this.maintenance.resetLanguageProgress(language);
  }

  async recordSRSAdjustment(data: {
    wordId: number;
    sessionId?: number;
    recallRating?: number;
    strengthDelta: number;
    language: string;
  }): Promise<number> {
    return this.srs.recordSRSAdjustment(data);
  }

  async createLearningSession(data: {
    mode: 'learning' | 'quiz' | 'dialog' | 'flow';
    language: string;
  }): Promise<number> {
    return this.tracking.createLearningSession(data);
  }

  async updateLearningSession(
    sessionId: number,
    data: {
      wordCount?: number;
      sentenceCount?: number;
      audioPlayedCount?: number;
    }
  ): Promise<void> {
    return this.tracking.updateLearningSession(sessionId, data);
  }

  async getLearningSession(sessionId: number): Promise<{
    id: number;
    mode: string;
    language: string;
    startedAt: Date;
  } | null> {
    return this.tracking.getLearningSession(sessionId);
  }

  async recordAudioPlayback(data: {
    sessionId?: number;
    sentenceId?: number;
    audioPath: string;
    language: string;
    mode: 'learning' | 'quiz' | 'dialog' | 'flow';
    playbackSpeed?: number;
  }): Promise<number> {
    return this.audio.recordAudioPlayback(data);
  }

  async recordNeglectedWords(
    data: Array<{
      word: string;
      language: string;
      topic?: string;
      translation?: string;
      sessionId?: number;
      frequencyPosition?: number;
    }>
  ): Promise<number> {
    return this.tracking.recordNeglectedWords(data);
  }

  async recordDictionaryHover(data: {
    word: string;
    language: string;
    sentenceId?: number;
    sessionId?: number;
    hoverDurationMs: number;
    dictionaryKey?: string;
    foundInDict: boolean;
  }): Promise<number> {
    return this.dictionary.recordDictionaryHover(data);
  }

  async processFrequentlyLookedUpWords(
    language: string,
    minHoverCount: number = 3,
    lookbackDays: number = 30
  ): Promise<number> {
    return this.dictionary.processFrequentlyLookedUpWords(language, minHoverCount, lookbackDays);
  }

  async getZipfFrequencies(words: string[], language: string): Promise<Record<string, number>> {
    return this.dictionary.getZipfFrequencies(words, language);
  }

  async updateZipfFrequencies(
    frequencies: Record<string, number>,
    language: string
  ): Promise<void> {
    return this.dictionary.updateZipfFrequencies(frequencies, language);
  }

  async getReadAloudCache(
    text: string,
    language: string
  ): Promise<{ id: number; rawText: string; audioPath: string } | null> {
    return this.audio.getReadAloudCache(text, language);
  }

  async insertReadAloudCache(text: string, language: string, audioPath: string): Promise<number> {
    return this.audio.insertReadAloudCache(text, language, audioPath);
  }
}
