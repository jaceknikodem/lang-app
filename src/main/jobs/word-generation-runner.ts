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
  desiredSentenceCount?: number;
  onWordUpdated?: (payload: {
    wordId: number;
    processingStatus: WordProcessingStatus;
    sentenceCount: number;
  }) => void;
}

export class WordGenerationRunner {
  private readonly database: DatabaseLayer;
  private readonly contentGenerator: ContentGenerator;
  private readonly audioService: AudioService;
  private readonly lemmatizationService?: LemmatizationService;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly defaultSentenceCount: number;
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
    this.defaultSentenceCount = options.desiredSentenceCount ?? 3;
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
            desiredSentenceCount: job.desiredSentenceCount,
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
      await this.database.markWordGenerationJobProcessing(job.id);
      await this.database.updateWordProcessingStatus(job.wordId, 'processing');
      await this.emitWordUpdate(job.wordId);

      const word = await this.database.getWordById(job.wordId);
      if (!word) {
        this.logger.warn(
          {
            jobId: job.id,
            wordId: job.wordId,
          },
          '[WordGenerationRunner] Word not found for job'
        );
        await this.database.completeWordGenerationJob(job.id);
        await this.database.updateWordProcessingStatus(job.wordId, 'ready');
        await this.emitWordUpdate(job.wordId);
        return;
      }

      const language = job.language || word.language;
      this.logger.info({
        jobId: job.id,
        wordId: word.id,
        word: word.word,
        language,
        attemptNumber,
      });

      await this.ensureSentenceAudio(word.id, language, word.word);

      const desiredCount = job.desiredSentenceCount ?? this.defaultSentenceCount;
      const existingSentences = await this.database.getSentencesByWord(word.id);
      const normalizedExisting = new Set(
        existingSentences.map((sentence) => this.normalizeSentence(sentence.sentence))
      );
      let totalSentences = existingSentences.length;

      this.logger.debug(
        {
          wordId: word.id,
          existingSentences: totalSentences,
          desiredCount,
        },
        '[WordGenerationRunner] Sentence status'
      );

      if (totalSentences < desiredCount) {
        const needed = desiredCount - totalSentences;
        this.logger.info(
          {
            word: word.word,
            language,
            needed,
          },
          '[WordGenerationRunner] Requesting additional sentences'
        );

        // Fetch known words once per job for variant generation
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
          const normalizedSentence = this.normalizeSentence(sentence.sentence);
          if (!normalizedSentence || normalizedExisting.has(normalizedSentence)) {
            continue;
          }

          let audioPath: string = '';
          let sentenceModel: string | undefined;
          let audioService: string | undefined;
          let audioModel: string | undefined;
          let audioVoiceId: string | undefined;

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
            sentence.contextAfterPronunciation
          );

          // Generate audio now that we have sentenceId
          if (sentence.audioUrl) {
            // Tatoeba sentence - download audio from external source
            const isTatoebaAudio = sentence.audioUrl.includes('tatoeba.org');
            this.logger.debug(
              {
                word: word.word,
                language,
                audioUrl: sentence.audioUrl,
                isTatoeba: isTatoebaAudio,
                sentenceId,
              },
              'Attempting to download external audio for sentence'
            );
            try {
              audioPath = await this.audioService.downloadSentenceAudioFromUrl(
                sentence.audioUrl,
                sentence.sentence,
                language,
                word.word,
                word.id,
                sentenceId
              );
              // Mark as Tatoeba if URL is from Tatoeba
              if (isTatoebaAudio) {
                sentenceModel = 'tatoeba';
                audioService = 'tatoeba';
                audioModel = undefined;
              } else {
                sentenceModel = this.contentGenerator
                  .getCurrentClient()
                  .getSentenceGenerationModel();
                audioService = 'external';
                audioModel = undefined;
              }
            } catch (downloadError) {
              this.logger.warn(
                { error: downloadError, audioUrl: sentence.audioUrl, sentenceId },
                'Failed to download external audio'
              );
              audioPath = '';
              if (isTatoebaAudio) {
                sentenceModel = 'tatoeba';
                audioService = 'tatoeba';
                audioModel = undefined;
              } else {
                sentenceModel = this.contentGenerator
                  .getCurrentClient()
                  .getSentenceGenerationModel();
                audioService = 'external';
                audioModel = undefined;
              }
            }
          } else {
            // LLM-generated sentence - generate audio with proper IDs
            try {
              const isJapanese = language === 'japanese' || language === 'ja';
              const ttsText =
                isJapanese && sentence.pronunciation ? sentence.pronunciation : sentence.sentence;
              audioPath = await this.audioService.generateSentenceAudio(
                ttsText,
                language,
                word.word,
                word.id,
                sentenceId
              );
              sentenceModel = this.contentGenerator.getCurrentClient().getSentenceGenerationModel();
              const audioInfo = this.audioService.getAudioGenerationInfo();
              audioService = audioInfo.service;
              audioModel = audioInfo.model;
              audioVoiceId = audioInfo.voiceId;
            } catch (error) {
              this.logger.warn(
                { err: error, sentenceId, wordId: word.id },
                '[WordGenerationRunner] Failed to generate audio'
              );
              audioPath = '';
              sentenceModel = this.contentGenerator.getCurrentClient().getSentenceGenerationModel();
              const audioInfo = this.audioService.getAudioGenerationInfo();
              audioService = audioInfo.service;
              audioModel = audioInfo.model;
              audioVoiceId = audioInfo.voiceId;
            }
          }

          // Generate English audio for main sentence translation
          // Store in the same directory as the selected language audio
          if (audioPath && sentence.translation) {
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
              // Non-fatal - continue even if English audio generation fails
            }
          }

          // Generate context before/after audio
          const isJapanese = language === 'japanese' || language === 'ja';
          if (sentence.contextBefore) {
            try {
              const contextBeforeText =
                isJapanese && sentence.contextBeforePronunciation
                  ? sentence.contextBeforePronunciation
                  : sentence.contextBefore;
              const beforeAudioPath = await this.audioService.generateAudio(
                contextBeforeText,
                language,
                '_before_sentence',
                word.id,
                sentenceId
              );
              await this.database.updateBeforeSentenceAudioPath(sentenceId, beforeAudioPath);
            } catch (error) {
              this.logger.warn(
                { err: error, sentenceId },
                '[WordGenerationRunner] Failed to generate context before audio'
              );
            }
          }

          if (sentence.contextAfter) {
            try {
              const contextAfterText =
                isJapanese && sentence.contextAfterPronunciation
                  ? sentence.contextAfterPronunciation
                  : sentence.contextAfter;
              const afterAudioPath = await this.audioService.generateAudio(
                contextAfterText,
                language,
                '_after_sentence',
                word.id,
                sentenceId
              );
              await this.database.updateAfterSentenceAudioPath(sentenceId, afterAudioPath);
            } catch (error) {
              this.logger.warn(
                { err: error, sentenceId },
                '[WordGenerationRunner] Failed to generate context after audio'
              );
            }
          }

          // Update sentence with audio path and metadata
          if (audioPath) {
            await this.database.updateSentenceAudioPath(sentenceId, audioPath, audioVoiceId);
          }
          // Update sentence metadata (model info) if available
          if (
            sentenceModel !== undefined ||
            audioService !== undefined ||
            audioModel !== undefined
          ) {
            const db = (this.database as any).getDb();
            if (db) {
              const updateStmt = db.prepare(`
                UPDATE sentences 
                SET sentence_generation_model = COALESCE(?, sentence_generation_model),
                    audio_generation_service = COALESCE(?, audio_generation_service),
                    audio_generation_model = COALESCE(?, audio_generation_model),
                    audio_generation_voice_id = COALESCE(?, audio_generation_voice_id)
                WHERE id = ?
              `);
              updateStmt.run(
                sentenceModel || null,
                audioService || null,
                audioModel || null,
                audioVoiceId || null,
                sentenceId
              );
            }
          }

          // Precompute sentence tokens with dictionary lookups and lemmatization
          try {
            const allWords = await this.database.getAllWords(language, false, false);
            const tokenizedTokens = await precomputeSentenceTokens({
              sentence: sentence.sentence,
              targetWord: word,
              allWords,
              lookupDictionary: (word: string, lang?: string) =>
                this.database.lookupDictionary(word, lang || language),
              language,
              maxPhraseWords: 3,
              lemmatizationService: this.lemmatizationService,
            });

            await this.database.updateSentenceTokens(sentenceId, tokenizedTokens);
            this.logger.debug(
              {
                sentenceId,
                tokenCount: tokenizedTokens.length,
              },
              '[WordGenerationRunner] Precomputed tokens for sentence'
            );
          } catch (tokenError) {
            this.logger.warn(
              {
                sentenceId,
                error: tokenError,
              },
              '[WordGenerationRunner] Failed to precompute tokens for sentence'
            );
            // Non-fatal - sentence will work without precomputed tokens
          }

          // Pre-generate dialogue variants for sentences eligible for dialog mode
          // (contextBefore is required for dialog sentence selection)
          if (sentence.contextBefore) {
            this.dialogService
              .generateDialogueVariants(
                {
                  id: sentenceId,
                  wordId: word.id,
                  sentence: sentence.sentence,
                  translation: sentence.translation,
                  audioPath: audioPath,
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

          normalizedExisting.add(normalizedSentence);
          totalSentences += 1;
          this.logger.debug(
            {
              wordId: word.id,
              sentencePreview: sentence.sentence.slice(0, 80),
              totalSentences,
            },
            '[WordGenerationRunner] Stored sentence for word'
          );

          if (totalSentences >= desiredCount) {
            break;
          }
        }
      }

      const processingInfo = await this.database.getWordProcessingInfo(word.id);
      if (!processingInfo || processingInfo.sentenceCount < desiredCount) {
        const sentenceTotal = processingInfo?.sentenceCount ?? 0;
        throw new Error(
          `Sentence generation incomplete. Have ${sentenceTotal}, wanted ${desiredCount}.`
        );
      }

      this.logger.info(
        {
          wordId: word.id,
          sentenceCount: processingInfo.sentenceCount,
        },
        '[WordGenerationRunner] Sentence generation complete'
      );

      await this.database.updateWordProcessingStatus(word.id, 'ready');
      await this.database.completeWordGenerationJob(job.id);
      await this.emitWordUpdate(word.id);
      this.logger.info({ jobId: job.id, wordId: word.id }, '[WordGenerationRunner] Job completed');
    } catch (error) {
      // Log raw error info for debugging
      this.logger.debug(
        {
          jobId: job.id,
          errorType: typeof error,
          errorConstructor: error?.constructor?.name,
          isError: error instanceof Error,
          hasMessage: error && typeof error === 'object' && 'message' in error,
          errorKeys: error && typeof error === 'object' ? Object.keys(error) : [],
        },
        '[WordGenerationRunner] Raw error info before serialization'
      );

      const errorDetails = serializeErrorForLogging(error);

      // Safety check: if serialization resulted in an empty or nearly empty object, log a warning
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

      // Use both 'err' (pino's standard error key) and 'error' (our custom key) for maximum compatibility
      // Spread errorDetails directly into the log object so pino can serialize it properly
      this.logger.error(
        {
          jobId: job.id,
          attemptNumber,
          err: error instanceof Error ? error : undefined, // Pino's standard error key
          ...errorDetails, // Spread error details directly
        },
        `WordGenerationRunner failed for job`
      );
      await this.handleJobFailure(job, attemptNumber, error as Error);
    }
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
