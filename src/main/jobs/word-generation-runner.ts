import { DatabaseLayer, WordGenerationJob, WordProcessingStatus } from '../../shared/types/database.js';
import { ContentGenerator } from '../llm/content-generator.js';
import { AudioService } from '../audio/audio-service.js';
import { splitSentenceIntoParts } from '../../shared/utils/sentence.js';
import { precomputeSentenceTokens } from '../database/sentence-preprocessor.js';
import type { LemmatizationService } from '../lemmatization/index.js';

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

  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(options: WordGenerationRunnerOptions) {
    this.database = options.database;
    this.contentGenerator = options.contentGenerator;
    this.audioService = options.audioService;
    this.lemmatizationService = options.lemmatizationService;
    this.pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? 2000;
    this.defaultSentenceCount = options.desiredSentenceCount ?? 3;
    this.onWordUpdated = options.onWordUpdated;
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
            const summary = await this.database.getWordGenerationQueueSummary();
          } catch (summaryError) {
            console.warn('[WordGenerationRunner] Unable to retrieve queue summary:', summaryError);
          }
          await this.delay(this.pollIntervalMs);
          continue;
        }

        console.log('[WordGenerationRunner] Found job', {
          jobId: job.id,
          wordId: job.wordId,
          attempts: job.attempts,
          desiredSentenceCount: job.desiredSentenceCount
        });

        await this.handleJob(job);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // If database is closed/not connected, exit gracefully
        if (errorMessage.includes('Database not connected') || errorMessage.includes('not connected')) {
          console.log('[WordGenerationRunner] Database closed, stopping runner');
          this.running = false;
          break;
        }
        
        console.error('WordGenerationRunner loop error:', error);
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
        console.warn('[WordGenerationRunner] Word not found for job', { jobId: job.id, wordId: job.wordId });
        await this.database.completeWordGenerationJob(job.id);
        await this.database.updateWordProcessingStatus(job.wordId, 'ready');
        await this.emitWordUpdate(job.wordId);
        return;
      }

      const language = job.language || word.language;
      console.log('[WordGenerationRunner] Processing job', {
        jobId: job.id,
        wordId: word.id,
        word: word.word,
        language,
        attemptNumber
      });

      await this.ensureSentenceAudio(word.id, language, word.word);

      const desiredCount = job.desiredSentenceCount ?? this.defaultSentenceCount;
      const existingSentences = await this.database.getSentencesByWord(word.id);
      const normalizedExisting = new Set(existingSentences.map(sentence => this.normalizeSentence(sentence.sentence)));
      let totalSentences = existingSentences.length;

      console.log('[WordGenerationRunner] Sentence status', {
        wordId: word.id,
        existingSentences: totalSentences,
        desiredCount
      });

      if (totalSentences < desiredCount) {
        const needed = desiredCount - totalSentences;
        console.log('[WordGenerationRunner] Requesting additional sentences', {
          word: word.word,
          language,
          needed
        });
        const generatedSentences = await this.contentGenerator.generateWordSentences(
          word.word,
          language,
          needed,
          this.database,
          job.topic
        );

        for (const sentence of generatedSentences) {
          const normalizedSentence = this.normalizeSentence(sentence.sentence);
          if (!normalizedSentence || normalizedExisting.has(normalizedSentence)) {
            continue;
          }

          let audioPath: string = '';
          const isTatoebaSentence = Boolean(sentence.audioUrl);
          let sentenceModel: string | undefined;
          let audioService: string | undefined;
          let audioModel: string | undefined;
          
          if (sentence.audioUrl) {
            // Tatoeba sentence - download audio from external source
            // Note: We don't generate audio for Tatoeba sentences
            const isTatoebaAudio = sentence.audioUrl.includes('tatoeba.org');
            console.log('Attempting to download external audio for sentence', {
              word: word.word,
              language,
              audioUrl: sentence.audioUrl,
              isTatoeba: isTatoebaAudio
            });
            try {
              audioPath = await this.audioService.downloadSentenceAudioFromUrl(
                sentence.audioUrl,
                sentence.sentence,
                language,
                word.word
              );
              // Mark as Tatoeba if URL is from Tatoeba
              if (isTatoebaAudio) {
                sentenceModel = 'tatoeba';
                audioService = 'tatoeba';
                audioModel = undefined; // Tatoeba doesn't have a specific model
              } else {
                // Other external source - use LLM model for sentence, but mark audio source
                sentenceModel = this.contentGenerator.getCurrentClient().getSentenceGenerationModel();
                audioService = 'external';
                audioModel = undefined;
              }
            } catch (downloadError) {
              console.warn('Failed to download external audio:', downloadError);
              // Don't generate fallback audio - leave audioPath empty
              // User can regenerate audio manually if needed via the regenerate button
              audioPath = '';
              if (isTatoebaAudio) {
                sentenceModel = 'tatoeba';
                audioService = 'tatoeba';
                audioModel = undefined;
              } else {
                sentenceModel = this.contentGenerator.getCurrentClient().getSentenceGenerationModel();
                audioService = 'external';
                audioModel = undefined;
              }
            }
          } else {
            // LLM-generated sentence (Tatoeba is not used)
            // Generate audio only for newly added words (this is the normal word addition flow)
            // The regenerate button uses a separate flow (regenerateAudio), so this won't be called during regeneration
            audioPath = await this.audioService.generateSentenceAudio(sentence.sentence, language, word.word);
            sentenceModel = this.contentGenerator.getCurrentClient().getSentenceGenerationModel();
            const audioInfo = this.audioService.getAudioGenerationInfo();
            audioService = audioInfo.service;
            audioModel = audioInfo.model;
          }
          
          const sentenceParts = splitSentenceIntoParts(sentence.sentence);
          const sentenceId = await this.database.insertSentence(
            word.id,
            sentence.sentence,
            sentence.translation,
            audioPath,
            sentence.contextBefore,
            sentence.contextAfter,
            sentence.contextBeforeTranslation,
            sentence.contextAfterTranslation,
            sentenceParts,
            sentenceModel,
            audioService,
            audioModel
          );

          // Precompute sentence tokens with dictionary lookups and lemmatization
          try {
            const allWords = await this.database.getAllWords(false, false, language);
            const tokenizedTokens = await precomputeSentenceTokens({
              sentence: sentence.sentence,
              targetWord: word,
              allWords,
              lookupDictionary: (word: string, lang?: string) => this.database.lookupDictionary(word, lang || language),
              language,
              maxPhraseWords: 3,
              lemmatizationService: this.lemmatizationService
            });
            
            await this.database.updateSentenceTokens(sentenceId, tokenizedTokens);
            console.log('[WordGenerationRunner] Precomputed tokens for sentence', {
              sentenceId,
              tokenCount: tokenizedTokens.length
            });
          } catch (tokenError) {
            console.warn('[WordGenerationRunner] Failed to precompute tokens for sentence', {
              sentenceId,
              error: tokenError
            });
            // Non-fatal - sentence will work without precomputed tokens
          }

          normalizedExisting.add(normalizedSentence);
          totalSentences += 1;
          console.log('[WordGenerationRunner] Stored sentence for word', {
            wordId: word.id,
            sentencePreview: sentence.sentence.slice(0, 80),
            totalSentences
          });

          if (totalSentences >= desiredCount) {
            break;
          }
        }
      }

      const processingInfo = await this.database.getWordProcessingInfo(word.id);
      if (!processingInfo || processingInfo.sentenceCount < desiredCount) {
        const sentenceTotal = processingInfo?.sentenceCount ?? 0;
        throw new Error(`Sentence generation incomplete. Have ${sentenceTotal}, wanted ${desiredCount}.`);
      }

      console.log('[WordGenerationRunner] Sentence generation complete', {
        wordId: word.id,
        sentenceCount: processingInfo.sentenceCount
      });

      await this.database.updateWordProcessingStatus(word.id, 'ready');
      await this.database.completeWordGenerationJob(job.id);
      await this.emitWordUpdate(word.id);
      console.log('[WordGenerationRunner] Job completed', { jobId: job.id, wordId: word.id });
    } catch (error) {
      console.error(`WordGenerationRunner failed for job ${job.id} (attempt ${attemptNumber}):`, error);
      await this.handleJobFailure(job, attemptNumber, error as Error);
    }
  }

  private async handleJobFailure(job: WordGenerationJob, attemptNumber: number, error: Error): Promise<void> {
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

  private async ensureSentenceAudio(wordId: number, language: string, wordText: string): Promise<void> {
    const sentences = await this.database.getSentencesByWord(wordId);

    for (const sentence of sentences) {
      if (sentence.audioPath) {
        continue;
      }

      console.log('[WordGenerationRunner] Backfilling audio for existing sentence', {
        sentenceId: sentence.id,
        wordId,
        language
      });

      try {
        const audioPath = await this.audioService.generateSentenceAudio(sentence.sentence, language, wordText);
        await this.database.updateSentenceAudioPath(sentence.id, audioPath);
      } catch (error) {
        console.warn(`Failed to generate audio for existing sentence ${sentence.id}:`, error);
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
          sentenceCount: info.sentenceCount
        });
      }
    } catch (error) {
      console.warn(`Failed to emit word update for word ${wordId}:`, error);
    }
  }

  private normalizeSentence(sentence: string): string {
    return sentence
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
