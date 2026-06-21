import {
  DatabaseLayer,
  WordGenerationJob,
  WordProcessingStatus,
} from '../../shared/types/database.js';
import { ContentGenerator } from '../llm/content-generator.js';
import { AudioService } from '../audio/audio-service.js';
import { DialogService } from '../dialog/dialog-service.js';
import { splitSentenceIntoParts } from '../../shared/utils/sentence.js';
import { precomputeSentenceTokens } from '../database/sentence-preprocessor.js';
import type { LemmatizationService } from '../lemmatization/index.js';
import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';
import { serializeErrorForLogging } from '../../shared/utils/error.js';

export interface WordGenerationRunnerOptions {
  database: DatabaseLayer;
  contentGenerator: ContentGenerator;
  audioService: AudioService;
  lemmatizationService?: LemmatizationService;
  pollIntervalMs?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
  onWordUpdated?: (payload: {
    wordId: number;
    processingStatus: WordProcessingStatus;
    sentenceCount: number;
  }) => void;
}

type Word = NonNullable<Awaited<ReturnType<DatabaseLayer['getWordById']>>>;
type GeneratedSentence = Awaited<ReturnType<ContentGenerator['generateWordSentences']>>[number];

interface SentenceAudioMetadata {
  audioPath: string;
  sentenceModel?: string;
  audioService?: string;
  audioModel?: string;
  audioVoiceId?: string;
}

export class WordGenerationRunner {
  private readonly database: DatabaseLayer;
  private readonly contentGenerator: ContentGenerator;
  private readonly audioService: AudioService;
  private readonly lemmatizationService?: LemmatizationService;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly onWordUpdated?: WordGenerationRunnerOptions['onWordUpdated'];
  private readonly dialogService: DialogService;
  private readonly logger: Logger;

  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(options: WordGenerationRunnerOptions) {
    this.logger = getLogger();
    this.database = options.database;
    this.contentGenerator = options.contentGenerator;
    this.audioService = options.audioService;
    this.lemmatizationService = options.lemmatizationService;
    this.pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? 2000;
    this.onWordUpdated = options.onWordUpdated;
    this.dialogService = new DialogService(
      options.database,
      options.contentGenerator.getCurrentClient()
    );
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const job = await this.database.getNextWordGenerationJob();

        if (!job) {
          try {
            await this.database.getWordGenerationQueueSummary();
          } catch (summaryError) {
            this.logger.warn(
              { error: summaryError },
              '[WordGenerationRunner] Unable to retrieve queue summary'
            );
          }
          await this.delay(this.pollIntervalMs);
          continue;
        }

        this.logger.info(
          {
            jobId: job.id,
            wordId: job.wordId,
            attempts: job.attempts,
          },
          '[WordGenerationRunner] Found job'
        );

        await this.handleJob(job);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // If database is closed/not connected, exit gracefully
        if (
          errorMessage.includes('Database not connected') ||
          errorMessage.includes('not connected')
        ) {
          this.logger.info('[WordGenerationRunner] Database closed, stopping runner');
          this.running = false;
          break;
        }

        this.logger.error({ error }, 'WordGenerationRunner loop error');
        await this.delay(this.pollIntervalMs);
      }
    }
  }

  private async handleJob(job: WordGenerationJob): Promise<void> {
    const attemptNumber = job.attempts + 1;
    try {
      const word = await this.startJobProcessing(job);
      if (!word) return;

      const language = job.language || word.language;
      this.logger.info({
        jobId: job.id,
        wordId: word.id,
        word: word.word,
        language,
        attemptNumber,
      });

      await this.ensureSentenceAudio(word.id, language, word.word);
      await this.generateSentences(word, job, language);
      await this.verifyAndCompleteJob(job, word.id, job.desiredSentenceCount ?? 4);
    } catch (error) {
      this.logger.debug(
        {
          jobId: job.id,
          errorType: typeof error,
          errorConstructor: (error as any)?.constructor?.name,
          isError: error instanceof Error,
          hasMessage: error && typeof error === 'object' && 'message' in error,
          errorKeys: error && typeof error === 'object' ? Object.keys(error) : [],
        },
        '[WordGenerationRunner] Raw error info before serialization'
      );

      const errorDetails = serializeErrorForLogging(error);
      const detailKeys = Object.keys(errorDetails);
      if (detailKeys.length === 0 || (detailKeys.length === 1 && detailKeys[0] === 'type')) {
        this.logger.warn(
          {
            jobId: job.id,
            serializedError: errorDetails,
            detailKeys,
            errorString: String(error),
            errorJson: JSON.stringify(error),
          },
          '[WordGenerationRunner] Error serialization resulted in empty/minimal object'
        );
      }

      this.logger.error(
        {
          jobId: job.id,
          attemptNumber,
          err: error instanceof Error ? error : undefined,
          ...errorDetails,
        },
        `WordGenerationRunner failed for job`
      );
      await this.handleJobFailure(job, attemptNumber, error as Error);
    }
  }

  private async startJobProcessing(job: WordGenerationJob): Promise<Word | null> {
    await this.database.markWordGenerationJobProcessing(job.id);
    await this.database.updateWordProcessingStatus(job.wordId, 'processing');
    await this.emitWordUpdate(job.wordId);

    const word = await this.database.getWordById(job.wordId);
    if (!word) {
      this.logger.warn(
        { jobId: job.id, wordId: job.wordId },
        '[WordGenerationRunner] Word not found for job'
      );
      await this.database.completeWordGenerationJob(job.id);
      await this.database.updateWordProcessingStatus(job.wordId, 'ready');
      await this.emitWordUpdate(job.wordId);
      return null;
    }
    return word;
  }

  private async generateSentences(
    word: Word,
    job: WordGenerationJob,
    language: string
  ): Promise<void> {
    const desiredCount = job.desiredSentenceCount ?? 4;
    const existingSentences = await this.database.getSentencesByWord(word.id);
    const normalizedExisting = new Set(
      existingSentences.map((s) => this.normalizeSentence(s.sentence))
    );
    let totalSentences = existingSentences.length;

    this.logger.debug(
      { wordId: word.id, existingSentences: totalSentences, desiredCount },
      '[WordGenerationRunner] Sentence status'
    );

    if (totalSentences >= desiredCount) return;

    const needed = desiredCount - totalSentences;
    this.logger.info(
      { word: word.word, language, needed },
      '[WordGenerationRunner] Requesting additional sentences'
    );

    const proficiencyKey = `language_proficiency_${language.toLowerCase()}`;
    const proficiencyLevel = (await this.database.getSetting(proficiencyKey)) || undefined;

    const allWords = await this.database.getAllWords(language, false, false);
    const knownWords = allWords
      .filter((w) => w.known || (w.strength ?? 0) >= 40)
      .slice(0, 50)
      .map((w) => w.word);

    const generatedSentences = await this.contentGenerator.generateWordSentences(
      word.word,
      language,
      needed,
      this.database,
      job.topic,
      word.translation
    );

    for (const sentence of generatedSentences) {
      const added = await this.processSentence(
        sentence,
        word,
        language,
        proficiencyLevel,
        knownWords,
        normalizedExisting
      );
      if (added) {
        totalSentences += 1;
        this.logger.debug(
          { wordId: word.id, sentencePreview: sentence.sentence.slice(0, 80), totalSentences },
          '[WordGenerationRunner] Stored sentence for word'
        );
        if (totalSentences >= desiredCount) break;
      }
    }
  }

  private async processSentence(
    sentence: GeneratedSentence,
    word: Word,
    language: string,
    proficiencyLevel: string | undefined,
    knownWords: string[],
    normalizedExisting: Set<string>
  ): Promise<boolean> {
    const normalizedSentence = this.normalizeSentence(sentence.sentence);
    if (!normalizedSentence || normalizedExisting.has(normalizedSentence)) return false;

    const sentenceParts = splitSentenceIntoParts(sentence.sentence);
    const sentenceId = await this.database.insertSentence(
      word.id,
      sentence.sentence,
      sentence.translation,
      '', // Audio path will be set after generation with proper IDs
      sentence.contextBefore,
      sentence.contextAfter,
      sentence.contextBeforeTranslation,
      sentence.contextAfterTranslation,
      sentenceParts,
      undefined, // Will be set after audio generation
      undefined, // Will be set after audio generation
      undefined, // Will be set after audio generation
      undefined, // Will be set after audio generation
      undefined, // tokenizedTokens
      sentence.pronunciation,
      sentence.contextBeforePronunciation,
      sentence.contextAfterPronunciation,
      proficiencyLevel
    );

    let audioMeta: SentenceAudioMetadata;
    if (sentence.audioUrl) {
      audioMeta = await this.downloadExternalAudio(sentence, word, language, sentenceId);
      await this.generateTranslationAudio(
        sentence,
        word,
        language,
        sentenceId,
        audioMeta.audioPath
      );
      await this.generateContextAudio(sentence, word, language, sentenceId);
    } else {
      audioMeta = await this.generateTTSAudioBatch(sentence, word, language, sentenceId);
    }

    if (audioMeta.audioPath) {
      await this.database.updateSentenceAudioPath(
        sentenceId,
        audioMeta.audioPath,
        audioMeta.audioVoiceId
      );
    }
    this.updateSentenceMetadata(sentenceId, audioMeta);

    await this.precomputeTokens(sentence, word, language, sentenceId);
    this.pregenerateDialogVariants(
      sentence,
      word,
      language,
      sentenceId,
      audioMeta.audioPath,
      knownWords
    );

    normalizedExisting.add(normalizedSentence);
    return true;
  }

  private async downloadExternalAudio(
    sentence: GeneratedSentence,
    word: Word,
    language: string,
    sentenceId: number
  ): Promise<SentenceAudioMetadata> {
    const isTatoeba = sentence.audioUrl!.includes('tatoeba.org');
    this.logger.debug(
      { word: word.word, language, audioUrl: sentence.audioUrl, isTatoeba, sentenceId },
      'Attempting to download external audio for sentence'
    );
    const sentenceModel = isTatoeba
      ? 'tatoeba'
      : this.contentGenerator.getCurrentClient().getSentenceGenerationModel();
    const audioService = isTatoeba ? 'tatoeba' : 'external';
    try {
      const audioPath = await this.audioService.downloadSentenceAudioFromUrl(
        sentence.audioUrl!,
        sentence.sentence,
        language,
        word.word,
        word.id,
        sentenceId
      );
      return { audioPath, sentenceModel, audioService };
    } catch (downloadError) {
      this.logger.warn(
        { error: downloadError, audioUrl: sentence.audioUrl, sentenceId },
        'Failed to download external audio'
      );
      return { audioPath: '', sentenceModel, audioService };
    }
  }

  private async generateTTSAudioBatch(
    sentence: GeneratedSentence,
    word: Word,
    language: string,
    sentenceId: number
  ): Promise<SentenceAudioMetadata> {
    const isJapanese = language === 'japanese' || language === 'ja';
    const sentenceModel = this.contentGenerator.getCurrentClient().getSentenceGenerationModel();
    const audioInfo = this.audioService.getAudioGenerationInfo();
    const meta: SentenceAudioMetadata = {
      audioPath: '',
      sentenceModel,
      audioService: audioInfo.service,
      audioModel: audioInfo.model,
      audioVoiceId: audioInfo.voiceId,
    };

    const batchParts: Array<{
      text: string;
      language: string;
      wordLabel: string;
      wordId: number;
      sentenceId: number;
    }> = [
      {
        text: isJapanese && sentence.pronunciation ? sentence.pronunciation : sentence.sentence,
        language,
        wordLabel: word.word,
        wordId: word.id,
        sentenceId,
      },
    ];
    if (sentence.translation) {
      batchParts.push({
        text: sentence.translation,
        language,
        wordLabel: 'english_sentence',
        wordId: word.id,
        sentenceId,
      });
    }
    if (sentence.contextBefore) {
      batchParts.push({
        text:
          isJapanese && sentence.contextBeforePronunciation
            ? sentence.contextBeforePronunciation
            : sentence.contextBefore,
        language,
        wordLabel: '_before_sentence',
        wordId: word.id,
        sentenceId,
      });
    }
    if (sentence.contextAfter) {
      batchParts.push({
        text:
          isJapanese && sentence.contextAfterPronunciation
            ? sentence.contextAfterPronunciation
            : sentence.contextAfter,
        language,
        wordLabel: '_after_sentence',
        wordId: word.id,
        sentenceId,
      });
    }

    let partIdx = 0;
    const sentencePartIdx = partIdx++;
    const englishPartIdx = sentence.translation ? partIdx++ : -1;
    const beforePartIdx = sentence.contextBefore ? partIdx++ : -1;
    const afterPartIdx = sentence.contextAfter ? partIdx++ : -1;

    try {
      const results = await this.audioService.generateSentencePartsBatch(batchParts);

      meta.audioPath = results[sentencePartIdx]?.audioPath ?? '';
      if (!meta.audioPath) {
        this.logger.warn(
          { err: results[sentencePartIdx]?.error, sentenceId, wordId: word.id },
          '[WordGenerationRunner] Failed to generate audio'
        );
      }
      if (englishPartIdx >= 0 && results[englishPartIdx]?.error) {
        this.logger.warn(
          { error: results[englishPartIdx].error, sentenceId },
          '[WordGenerationRunner] Failed to generate English audio'
        );
      }
      if (beforePartIdx >= 0) {
        const beforePath = results[beforePartIdx]?.audioPath;
        if (beforePath) {
          await this.database.updateBeforeSentenceAudioPath(sentenceId, beforePath);
        } else {
          this.logger.warn(
            { err: results[beforePartIdx]?.error, sentenceId },
            '[WordGenerationRunner] Failed to generate context before audio'
          );
        }
      }
      if (afterPartIdx >= 0) {
        const afterPath = results[afterPartIdx]?.audioPath;
        if (afterPath) {
          await this.database.updateAfterSentenceAudioPath(sentenceId, afterPath);
        } else {
          this.logger.warn(
            { err: results[afterPartIdx]?.error, sentenceId },
            '[WordGenerationRunner] Failed to generate context after audio'
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        { err: error, sentenceId, wordId: word.id },
        '[WordGenerationRunner] Failed to generate audio batch'
      );
    }

    return meta;
  }

  private async generateTranslationAudio(
    sentence: GeneratedSentence,
    word: Word,
    language: string,
    sentenceId: number,
    mainAudioPath: string
  ): Promise<void> {
    if (!mainAudioPath || !sentence.translation) return;
    try {
      await this.audioService.generateAudio(
        sentence.translation,
        language, // Use the same language directory as the selected language
        'english_sentence',
        word.id,
        sentenceId
      );
    } catch (error) {
      this.logger.warn(
        { error, sentenceId },
        '[WordGenerationRunner] Failed to generate English audio'
      );
    }
  }

  private async generateContextAudio(
    sentence: GeneratedSentence,
    word: Word,
    language: string,
    sentenceId: number
  ): Promise<void> {
    const isJapanese = language === 'japanese' || language === 'ja';

    if (sentence.contextBefore) {
      try {
        const text =
          isJapanese && sentence.contextBeforePronunciation
            ? sentence.contextBeforePronunciation
            : sentence.contextBefore;
        const beforePath = await this.audioService.generateAudio(
          text,
          language,
          '_before_sentence',
          word.id,
          sentenceId
        );
        await this.database.updateBeforeSentenceAudioPath(sentenceId, beforePath);
      } catch (error) {
        this.logger.warn(
          { err: error, sentenceId },
          '[WordGenerationRunner] Failed to generate context before audio'
        );
      }
    }

    if (sentence.contextAfter) {
      try {
        const text =
          isJapanese && sentence.contextAfterPronunciation
            ? sentence.contextAfterPronunciation
            : sentence.contextAfter;
        const afterPath = await this.audioService.generateAudio(
          text,
          language,
          '_after_sentence',
          word.id,
          sentenceId
        );
        await this.database.updateAfterSentenceAudioPath(sentenceId, afterPath);
      } catch (error) {
        this.logger.warn(
          { err: error, sentenceId },
          '[WordGenerationRunner] Failed to generate context after audio'
        );
      }
    }
  }

  private updateSentenceMetadata(sentenceId: number, meta: SentenceAudioMetadata): void {
    const { sentenceModel, audioService, audioModel, audioVoiceId } = meta;
    if (sentenceModel === undefined && audioService === undefined && audioModel === undefined)
      return;
    const db = (this.database as any).getDb();
    if (!db) return;
    db.prepare(
      `
      UPDATE sentences
      SET sentence_generation_model = COALESCE(?, sentence_generation_model),
          audio_generation_service = COALESCE(?, audio_generation_service),
          audio_generation_model = COALESCE(?, audio_generation_model),
          audio_generation_voice_id = COALESCE(?, audio_generation_voice_id)
      WHERE id = ?
    `
    ).run(
      sentenceModel || null,
      audioService || null,
      audioModel || null,
      audioVoiceId || null,
      sentenceId
    );
  }

  private async precomputeTokens(
    sentence: GeneratedSentence,
    word: Word,
    language: string,
    sentenceId: number
  ): Promise<void> {
    try {
      const allWords = await this.database.getAllWords(language, false, false);
      const tokenizedTokens = await precomputeSentenceTokens({
        sentence: sentence.sentence,
        targetWord: word,
        allWords,
        lookupDictionary: (w: string, lang?: string) =>
          this.database.lookupDictionary(w, lang || language),
        language,
        maxPhraseWords: 3,
        lemmatizationService: this.lemmatizationService,
      });
      await this.database.updateSentenceTokens(sentenceId, tokenizedTokens);
      this.logger.debug(
        { sentenceId, tokenCount: tokenizedTokens.length },
        '[WordGenerationRunner] Precomputed tokens for sentence'
      );
    } catch (tokenError) {
      this.logger.warn(
        { sentenceId, error: tokenError },
        '[WordGenerationRunner] Failed to precompute tokens for sentence'
      );
    }
  }

  private pregenerateDialogVariants(
    sentence: GeneratedSentence,
    word: Word,
    language: string,
    sentenceId: number,
    audioPath: string,
    knownWords: string[]
  ): void {
    if (!sentence.contextBefore) return;
    this.dialogService
      .generateDialogueVariants(
        {
          id: sentenceId,
          wordId: word.id,
          sentence: sentence.sentence,
          translation: sentence.translation,
          audioPath,
          createdAt: new Date(),
          playCount: 0,
          contextBefore: sentence.contextBefore,
          contextBeforeTranslation: sentence.contextBeforeTranslation,
          contextAfter: sentence.contextAfter,
          contextAfterTranslation: sentence.contextAfterTranslation,
          language,
          pronunciation: sentence.pronunciation,
        },
        [],
        knownWords,
        language
      )
      .catch((err) => {
        this.logger.warn(
          { error: err, sentenceId },
          '[WordGenerationRunner] Failed to pre-generate dialogue variants'
        );
      });
  }

  private async verifyAndCompleteJob(
    job: WordGenerationJob,
    wordId: number,
    desiredCount: number
  ): Promise<void> {
    const processingInfo = await this.database.getWordProcessingInfo(wordId);
    if (!processingInfo || processingInfo.sentenceCount < desiredCount) {
      const sentenceTotal = processingInfo?.sentenceCount ?? 0;
      throw new Error(
        `Sentence generation incomplete. Have ${sentenceTotal}, wanted ${desiredCount}.`
      );
    }
    this.logger.info(
      { wordId, sentenceCount: processingInfo.sentenceCount },
      '[WordGenerationRunner] Sentence generation complete'
    );
    await this.database.updateWordProcessingStatus(wordId, 'ready');
    await this.database.completeWordGenerationJob(job.id);
    await this.emitWordUpdate(wordId);
    this.logger.info({ jobId: job.id, wordId }, '[WordGenerationRunner] Job completed');
  }

  private async handleJobFailure(
    job: WordGenerationJob,
    attemptNumber: number,
    error: Error
  ): Promise<void> {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (attemptNumber < this.maxAttempts) {
      const delayMs = this.retryBackoffMs * attemptNumber;
      await this.database.rescheduleWordGenerationJob(job.id, delayMs, message);
      await this.database.updateWordProcessingStatus(job.wordId, 'queued');
    } else {
      await this.database.failWordGenerationJob(job.id, message);
      await this.database.updateWordProcessingStatus(job.wordId, 'failed');
    }

    await this.emitWordUpdate(job.wordId);
  }

  private async ensureSentenceAudio(
    wordId: number,
    language: string,
    wordText: string
  ): Promise<void> {
    const sentences = await this.database.getSentencesByWord(wordId);

    for (const sentence of sentences) {
      if (sentence.audioPath) {
        continue;
      }

      this.logger.debug(
        {
          sentenceId: sentence.id,
          wordId,
          language,
        },
        '[WordGenerationRunner] Backfilling audio for existing sentence'
      );

      try {
        const isJapanese = language === 'japanese' || language === 'ja';
        const ttsText =
          isJapanese && sentence.pronunciation ? sentence.pronunciation : sentence.sentence;
        const audioPath = await this.audioService.generateSentenceAudio(
          ttsText,
          language,
          wordText,
          wordId,
          sentence.id
        );
        await this.database.updateSentenceAudioPath(sentence.id, audioPath);
      } catch (error) {
        this.logger.warn(
          { error, sentenceId: sentence.id, wordId },
          'Failed to generate audio for existing sentence'
        );
      }
    }
  }

  private async emitWordUpdate(wordId: number): Promise<void> {
    if (!this.onWordUpdated) {
      return;
    }

    try {
      const info = await this.database.getWordProcessingInfo(wordId);
      if (info) {
        this.onWordUpdated({
          wordId,
          processingStatus: info.processingStatus,
          sentenceCount: info.sentenceCount,
        });
      }
    } catch (error) {
      this.logger.warn({ error, wordId }, 'Failed to emit word update for word');
    }
  }

  private normalizeSentence(sentence: string): string {
    return sentence.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
