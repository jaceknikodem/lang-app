/**
 * IPC handlers for secure communication between main and renderer processes
 */

import { ipcMain, app, dialog } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/types/ipc.js';
import { SQLiteDatabaseLayer } from '../database/database-layer.js';
import { LLMClient, ContentGenerator, LLMFactory } from '../llm/index.js';
import { AudioService } from '../audio/audio-service.js';
import { LifecycleManager, UpdateManager } from '../lifecycle/index.js';
import { SRSService } from '../srs/srs-service.js';
import { WordGenerationRunner } from '../jobs/word-generation-runner.js';
import { LemmatizationService } from '../lemmatization/index.js';
import { DialogService } from '../dialog/index.js';
import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { createIPCHandler } from './ipc-handler-helper.js';
import { wrapError } from '../../shared/utils/error.js';
import { getLogger } from '../utils/logger.js';

// Validation schemas for input sanitization
const CreateWordSchema = z.object({
  word: z.string().min(1).max(100),
  translation: z.string().min(1).max(200),
  language: z.string().min(2).max(10),
  audioPath: z.string().optional(),
  topic: z.string().optional(),
});

const WordIdSchema = z.number().int().positive();
const WordIdsSchema = z.array(z.number().int().positive());
const SentenceIdSchema = z.number().int().positive();
const SentenceIdsSchema = z.array(z.number().int().positive());
const VariantIdSchema = z
  .number()
  .int()
  .refine((val) => val !== 0, {
    message: 'Variant ID must be non-zero',
  }); // Allows positive and negative integers (for pseudo-variants with negative IDs)
const StrengthSchema = z.number().int().min(0);
const BooleanSchema = z.boolean();
const LimitSchema = z.number().int().positive().max(1000);
const LanguageSchema = z.string().min(2).max(10);
const TextSchema = z.string().min(1).max(1000);
const TopicSchema = z.string().min(1).max(200);
const AudioPathSchema = z.string().min(1).max(500);
const DictionaryWordSchema = z.string().min(1).max(100);
const ConversationHistorySchema = z.array(z.string().min(1).max(1000));

/**
 * Set up all IPC handlers with proper validation and error handling
 */
export function setupIPCHandlers(
  databaseLayer: SQLiteDatabaseLayer,
  llmClient: LLMClient,
  contentGenerator: ContentGenerator,
  audioService: AudioService,
  srsService: SRSService,
  lifecycleManager?: LifecycleManager,
  updateManager?: UpdateManager,
  wordGenerationRunner?: WordGenerationRunner,
  lemmatizationService?: LemmatizationService
): void {
  // Database handlers
  setupDatabaseHandlers(databaseLayer);

  // LLM handlers
  setupLLMHandlers(llmClient, contentGenerator, databaseLayer);

  // Audio handlers
  setupAudioHandlers(audioService, databaseLayer);

  // Quiz handlers
  setupQuizHandlers(databaseLayer);

  // SRS handlers
  setupSRSHandlers(srsService, databaseLayer);

  // Background job handlers
  setupJobHandlers(databaseLayer);

  // Lifecycle handlers
  if (lifecycleManager && updateManager) {
    setupLifecycleHandlers(lifecycleManager, updateManager, audioService, wordGenerationRunner);
  }

  // Lemmatization handlers
  if (lemmatizationService) {
    setupLemmatizationHandlers(lemmatizationService);
  }

  // Dialog handlers
  setupDialogHandlers(databaseLayer, llmClient, audioService);

  // Flow handlers
  setupFlowHandlers(databaseLayer, audioService);

  // Log handlers
  setupLogHandlers();

  // Topics handlers
  setupTopicsHandlers();

  // Tracking handlers
  setupTrackingHandlers(databaseLayer);

  // Scoring handlers (if scoringService is provided, will be added in main.ts)
  // setupScoringHandlers is called separately after scoring service initialization

  const logger = getLogger();
  logger.info('IPC handlers registered successfully');
}

/**
 * Set up database-related IPC handlers
 */
function setupDatabaseHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  ipcMain.handle(
    IPC_CHANNELS.DATABASE.INSERT_WORD,
    createIPCHandler(
      CreateWordSchema,
      (wordData) => {
        console.log('[IPC Handler] INSERT_WORD received wordData:', wordData);
        console.log('[IPC Handler] wordData.topic:', wordData.topic);
        console.log('[IPC Handler] wordData.topic type:', typeof wordData.topic);
        return databaseLayer.insertWord(wordData);
      },
      'insert word'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.UPDATE_WORD_STRENGTH,
    createIPCHandler(
      [WordIdSchema, StrengthSchema],
      async (wordId, strength) => {
        await databaseLayer.updateWordStrength(wordId, strength);
        const logger = getLogger();
        logger.debug(
          { wordId, strength },
          `[Tracking] Word progress: wordId=${wordId}, strength=${strength}`
        );
      },
      'update word strength'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.MARK_WORD_KNOWN,
    createIPCHandler(
      [WordIdSchema, BooleanSchema],
      async (wordId, known) => {
        await databaseLayer.markWordKnown(wordId, known);
        const logger = getLogger();
        logger.debug(
          { wordId, known },
          `[Tracking] Word progress: wordId=${wordId}, known=${known}`
        );
      },
      'mark word known'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.MARK_WORD_IGNORED,
    createIPCHandler(
      [WordIdSchema, BooleanSchema],
      async (wordId, ignored) => {
        await databaseLayer.markWordIgnored(wordId, ignored);
        const logger = getLogger();
        logger.debug(
          { wordId, ignored },
          `[Tracking] Word progress: wordId=${wordId}, ignored=${ignored}`
        );
      },
      'mark word ignored'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_WORDS_TO_STUDY,
    createIPCHandler(
      LimitSchema,
      async (limit) => {
        const language = await databaseLayer.getCurrentLanguage();
        return databaseLayer.getWordsToStudy(limit, language);
      },
      'get words to study'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_WORD_BY_ID,
    createIPCHandler(WordIdSchema, (wordId) => databaseLayer.getWordById(wordId), 'get word by ID')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_WORDS_BY_IDS,
    createIPCHandler(
      WordIdsSchema,
      (wordIds) => databaseLayer.getWordsByIds(wordIds),
      'get words by IDs'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.INSERT_SENTENCE,
    createIPCHandler(
      [
        WordIdSchema,
        TextSchema,
        TextSchema,
        z.string(),
        TextSchema.optional(),
        TextSchema.optional(),
        TextSchema.optional(),
        TextSchema.optional(),
        z.array(z.string()).optional(),
        z.string().optional(),
        z.string().optional(),
        z.string().optional(),
        z.string().optional(),
      ],
      (
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
        audioGenerationVoiceId
      ) =>
        databaseLayer.insertSentence(
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
          audioGenerationVoiceId
        ),
      'insert sentence'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_SENTENCES_BY_WORD,
    createIPCHandler(
      WordIdSchema,
      (wordId) => databaseLayer.getSentencesByWord(wordId),
      'get sentences by word'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_SENTENCES_BY_IDS,
    createIPCHandler(
      SentenceIdsSchema,
      (sentenceIds) => databaseLayer.getSentencesByIds(sentenceIds),
      'get sentences by IDs'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.DELETE_SENTENCE,
    createIPCHandler(
      SentenceIdSchema,
      (sentenceId) => databaseLayer.deleteSentence(sentenceId),
      'delete sentence'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.UPDATE_SENTENCE_LAST_SHOWN,
    createIPCHandler(
      SentenceIdSchema,
      (sentenceId) => databaseLayer.updateSentenceLastShown(sentenceId),
      'update sentence last shown'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.INCREMENT_SENTENCE_PLAY_COUNT,
    createIPCHandler(
      SentenceIdSchema,
      (sentenceId) => databaseLayer.incrementSentencePlayCount(sentenceId),
      'increment sentence play count'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.INCREMENT_GRAMMAR_EXPLANATION_COUNT,
    createIPCHandler(
      z.number().int().positive(),
      (wordId) => databaseLayer.incrementGrammarExplanationCount(wordId),
      'increment grammar explanation count'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.RECORD_PRONUNCIATION_ATTEMPT,
    createIPCHandler(
      [
        SentenceIdSchema,
        z.number().min(0).max(1),
        z.string(),
        z.string(),
        z.string().optional().nullable(),
      ],
      (sentenceId, similarityScore, expectedText, transcribedText, audioPath) => {
        const logger = getLogger();
        logger.debug(
          { sentenceId, similarityScore, audioPath: audioPath || 'none' },
          `[Pronunciation] Recording attempt: sentenceId=${sentenceId}, similarity=${similarityScore.toFixed(2)}, audioPath=${audioPath || 'none'}`
        );
        return databaseLayer.recordPronunciationAttempt(
          sentenceId,
          similarityScore,
          expectedText,
          transcribedText,
          audioPath || null
        );
      },
      'record pronunciation attempt'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_PRONUNCIATION_HISTORY,
    createIPCHandler(
      [SentenceIdSchema, z.number().int().positive().optional()],
      (sentenceId, limit) =>
        databaseLayer.getPronunciationHistory(
          sentenceId,
          limit !== undefined ? Math.max(1, Math.floor(limit)) : undefined
        ),
      'get pronunciation history'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.INSERT_DIALOG_CORRECTION,
    createIPCHandler(
      [
        z.object({
          sentenceId: SentenceIdSchema,
          sessionId: z.number().int().positive().optional(),
          correctionText: z.string().min(1).max(500),
          language: z.string().min(1),
        }),
      ],
      (data) => databaseLayer.insertDialogCorrection(data),
      'insert dialog correction'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_DIALOG_CORRECTIONS,
    createIPCHandler(
      [SentenceIdSchema, z.string().min(1), z.number().int().positive().optional()],
      (sentenceId, language, limit) =>
        databaseLayer.getDialogCorrections(
          sentenceId,
          language,
          limit !== undefined ? Math.max(1, Math.floor(limit)) : 3
        ),
      'get dialog corrections'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.UPDATE_SENTENCE_AUDIO_PATH,
    createIPCHandler(
      [SentenceIdSchema, AudioPathSchema, z.string().optional()],
      (sentenceId, audioPath, audioGenerationVoiceId) =>
        databaseLayer.updateSentenceAudioPath(sentenceId, audioPath, audioGenerationVoiceId),
      'update sentence audio path'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.UPDATE_LAST_STUDIED,
    createIPCHandler(
      WordIdSchema,
      async (wordId) => {
        await databaseLayer.updateLastStudied(wordId);
        const logger = getLogger();
        logger.debug({ wordId }, `[Tracking] Word progress: wordId=${wordId}, lastStudied=now`);
      },
      'update last studied'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_STUDY_STATS,
    createIPCHandler(
      undefined,
      async () => {
        const language = await databaseLayer.getCurrentLanguage();
        return databaseLayer.getStudyStats(language);
      },
      'get study stats'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.RECORD_STUDY_SESSION,
    createIPCHandler(
      z.number().int().min(0),
      (wordsStudied) => databaseLayer.recordStudySession(wordsStudied),
      'record study session'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_ALL_WORDS,
    createIPCHandler(
      [LanguageSchema, z.boolean().optional(), z.boolean().optional()],
      async (language, includeKnown, includeIgnored) => {
        return databaseLayer.getAllWords(
          language,
          includeKnown !== undefined ? includeKnown : true,
          includeIgnored !== undefined ? includeIgnored : false
        );
      },
      'get all words'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_WORDS_WITH_SENTENCES,
    createIPCHandler(
      [LanguageSchema, z.boolean().optional(), z.boolean().optional()],
      async (language, includeKnown, includeIgnored) => {
        return databaseLayer.getWordsWithSentences(
          language,
          includeKnown !== undefined ? includeKnown : true,
          includeIgnored !== undefined ? includeIgnored : false
        );
      },
      'get words with sentences'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_WORDS_WITH_SENTENCES_ORDERED_BY_STRENGTH,
    createIPCHandler(
      [LanguageSchema, z.boolean().optional(), z.boolean().optional()],
      async (language, includeKnown, includeIgnored) => {
        return databaseLayer.getWordsWithSentencesOrderedByStrength(
          language,
          includeKnown !== undefined ? includeKnown : true,
          includeIgnored !== undefined ? includeIgnored : false
        );
      },
      'get words with sentences ordered by strength'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_RECENT_STUDY_SESSIONS,
    createIPCHandler(
      LimitSchema.optional(),
      (limit) => databaseLayer.getRecentStudySessions(limit !== undefined ? limit : 10),
      'get recent study sessions'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_SETTING,
    createIPCHandler(
      z.string().min(1).max(100),
      (key) => databaseLayer.getSetting(key),
      'get setting'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.SET_SETTING,
    createIPCHandler(
      [z.string().min(1).max(100), z.string().max(1000)],
      (key, value) => databaseLayer.setSetting(key, value),
      'set setting'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_CURRENT_LANGUAGE,
    createIPCHandler(undefined, () => databaseLayer.getCurrentLanguage(), 'get current language')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.SET_CURRENT_LANGUAGE,
    createIPCHandler(
      LanguageSchema,
      (language) => databaseLayer.setCurrentLanguage(language),
      'set current language'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_AVAILABLE_LANGUAGES,
    createIPCHandler(
      undefined,
      () => databaseLayer.getAvailableLanguages(),
      'get available languages'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_LANGUAGE_STATS,
    createIPCHandler(undefined, () => databaseLayer.getLanguageStats(), 'get language stats')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.LOOKUP_DICTIONARY,
    createIPCHandler(
      [DictionaryWordSchema, LanguageSchema.optional()],
      async (word, language) => {
        const currentLanguage = language || (await databaseLayer.getCurrentLanguage());
        return databaseLayer.lookupDictionary(word, currentLanguage);
      },
      'lookup dictionary entry'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_NEW_WORD_COUNT,
    createIPCHandler(
      LanguageSchema.optional(),
      async (language) => {
        const currentLanguage = language || (await databaseLayer.getCurrentLanguage());
        return databaseLayer.getNewWordCount(currentLanguage);
      },
      'get new word count'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_AVAILABLE_SENTENCES_COUNT,
    createIPCHandler(
      LanguageSchema.optional(),
      async (language) => {
        const currentLanguage = language || (await databaseLayer.getCurrentLanguage());
        return databaseLayer.getAvailableSentencesCount(currentLanguage);
      },
      'get available sentences count'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.RESET_LANGUAGE_PROGRESS,
    createIPCHandler(
      LanguageSchema,
      (language) => databaseLayer.resetLanguageProgress(language),
      'reset language progress'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_TOPIC_WORD_COUNTS,
    createIPCHandler(
      LanguageSchema,
      (language) => databaseLayer.getTopicWordCounts(language),
      'get topic word counts'
    )
  );
}

/**
 * Set up LLM-related IPC handlers
 */
function setupLLMHandlers(
  llmClient: LLMClient,
  contentGenerator: ContentGenerator,
  databaseLayer?: SQLiteDatabaseLayer
): void {
  ipcMain.handle(
    IPC_CHANNELS.LLM.GENERATE_WORDS,
    createIPCHandler(
      [TopicSchema.optional(), LanguageSchema],
      async (topic, language) => {
        // Use ContentGenerator for better error handling and validation
        return await contentGenerator.generateTopicVocabulary(
          topic && topic.trim() ? topic.trim() : undefined,
          language,
          undefined, // Use default word count from ContentGenerator (5)
          databaseLayer
        );
      },
      'generate words'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.GENERATE_SENTENCES,
    createIPCHandler(
      [TextSchema, LanguageSchema, TopicSchema.optional()],
      async (word, language, topic) => {
        // Use ContentGenerator for better error handling and validation
        return await contentGenerator.generateWordSentences(
          word,
          language,
          3,
          databaseLayer,
          topic && topic.trim() ? topic.trim() : undefined
        );
      },
      'generate sentences'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.IS_AVAILABLE,
    createIPCHandler(
      undefined,
      async () => {
        return await llmClient.isAvailable();
      },
      'check LLM availability'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.GET_AVAILABLE_MODELS,
    createIPCHandler(
      undefined,
      async () => {
        return await llmClient.getAvailableModels();
      },
      'get available models'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.SET_MODEL,
    createIPCHandler(
      z.string().min(1),
      (model) => {
        llmClient.setModel(model);
      },
      'set model'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.GET_CURRENT_MODEL,
    createIPCHandler(undefined, () => llmClient.getCurrentModel(), 'get current model')
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.SET_WORD_GENERATION_MODEL,
    createIPCHandler(
      z.string().min(1),
      (model) => {
        llmClient.setWordGenerationModel(model);
      },
      'set word generation model'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.SET_SENTENCE_GENERATION_MODEL,
    createIPCHandler(
      z.string().min(1),
      (model) => {
        llmClient.setSentenceGenerationModel(model);
      },
      'set sentence generation model'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.GET_WORD_GENERATION_MODEL,
    createIPCHandler(
      undefined,
      () => llmClient.getWordGenerationModel(),
      'get word generation model'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.GET_SENTENCE_GENERATION_MODEL,
    createIPCHandler(
      undefined,
      () => llmClient.getSentenceGenerationModel(),
      'get sentence generation model'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.EXPLAIN_GRAMMAR,
    createIPCHandler(
      [TextSchema, TextSchema, LanguageSchema, z.string().optional()],
      async (word, sentence, language, proficiencyLevel) => {
        return await llmClient.explainGrammar(word, sentence, language, proficiencyLevel);
      },
      'explain grammar'
    )
  );

  // Frequency word management handlers
  ipcMain.handle(
    IPC_CHANNELS.FREQUENCY.GET_PROGRESS,
    createIPCHandler(
      LanguageSchema,
      async (language) => {
        if (!databaseLayer) {
          throw new Error('Database layer not available');
        }
        return await contentGenerator.getFrequencyProgress(language, databaseLayer);
      },
      'get frequency progress'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.FREQUENCY.GET_AVAILABLE_LANGUAGES,
    createIPCHandler(
      undefined,
      () => contentGenerator.getAvailableFrequencyLanguages(),
      'get available frequency languages'
    )
  );

  // Provider management handlers
  ipcMain.handle(
    IPC_CHANNELS.LLM.GET_CURRENT_PROVIDER,
    createIPCHandler(undefined, () => contentGenerator.getCurrentProvider(), 'get current provider')
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.SWITCH_PROVIDER,
    createIPCHandler(
      [z.enum(['ollama', 'gemini']), z.string().min(1).optional()],
      async (provider, geminiApiKey) => {
        let validatedApiKey = geminiApiKey;

        // If switching to Gemini and no API key provided, get it from database
        if (provider === 'gemini' && !validatedApiKey && databaseLayer) {
          const storedApiKey = await databaseLayer.getSetting('gemini_api_key');
          const logger = getLogger();
          logger.debug({ hasApiKey: !!storedApiKey }, 'Retrieved Gemini API key from database');
          validatedApiKey = storedApiKey || undefined;
        }

        // Switch provider in content generator
        contentGenerator.switchProvider(provider, validatedApiKey);

        // Persist selected provider so it survives app restarts
        if (databaseLayer) {
          await databaseLayer.setSetting('llm_provider', provider);
        }

        // Update the main process llmClient reference
        const newClient = contentGenerator.getCurrentClient();
        if (newClient && databaseLayer) {
          newClient.setDatabaseLayer(databaseLayer);
        }

        const logger = getLogger();
        logger.info({ provider }, `Switched to ${provider} provider`);
      },
      'switch provider'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.SET_GEMINI_API_KEY,
    createIPCHandler(
      [z.string().min(1), z.boolean().optional()],
      async (apiKey, switchToGemini) => {
        const validatedSwitch = switchToGemini !== undefined ? switchToGemini : false;

        contentGenerator.setGeminiApiKey(apiKey, validatedSwitch);

        // If switching to Gemini, update the main process llmClient reference
        if (validatedSwitch) {
          const newClient = contentGenerator.getCurrentClient();
          if (newClient && databaseLayer) {
            newClient.setDatabaseLayer(databaseLayer);
          }
        }

        const logger = getLogger();
        logger.info('Gemini API key set successfully');
      },
      'set Gemini API key'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.GET_AVAILABLE_PROVIDERS,
    createIPCHandler(undefined, () => LLMFactory.getAvailableProviders(), 'get available providers')
  );

  ipcMain.handle(
    IPC_CHANNELS.LLM.GET_MODELS_FOR_PROVIDER,
    createIPCHandler(
      z.enum(['ollama', 'gemini']),
      async (provider) => {
        if (provider === 'ollama') {
          // Create a temporary Ollama client to get models
          const ollamaClient = LLMFactory.createOllamaClient();
          return await ollamaClient.getAvailableModels();
        } else if (provider === 'gemini') {
          // Create a temporary Gemini client to get models
          let apiKey = '';
          if (databaseLayer) {
            const storedApiKey = await databaseLayer.getSetting('gemini_api_key');
            apiKey = storedApiKey || '';
          }
          const geminiClient = LLMFactory.createGeminiClient(apiKey);
          return await geminiClient.getAvailableModels();
        }

        return [];
      },
      'get models for provider'
    )
  );
}

/**
 * Set up audio-related IPC handlers
 */
function setupAudioHandlers(audioService: AudioService, databaseLayer?: SQLiteDatabaseLayer): void {
  ipcMain.handle(
    IPC_CHANNELS.AUDIO.GENERATE_AUDIO,
    createIPCHandler(
      [
        TextSchema,
        LanguageSchema.optional(),
        TextSchema.optional(),
        z.number().int().optional(),
        z.number().int().positive().optional(),
        z.number().int().optional(),
      ],
      async (text, language, word, wordId, sentenceId, variantId) => {
        const validatedLanguage =
          language || (databaseLayer ? await databaseLayer.getCurrentLanguage() : 'spanish');
        return await audioService.generateAudio(
          text,
          validatedLanguage,
          word,
          wordId,
          sentenceId,
          variantId
        );
      },
      'generate audio'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.PLAY_AUDIO,
    createIPCHandler(
      AudioPathSchema,
      async (audioPath) => {
        // Catch expected errors immediately with .catch() to prevent Electron logging
        try {
          return await audioService.playAudio(audioPath);
        } catch (error: unknown) {
          // Silently handle PLAYBACK_STOPPED errors - they're expected when audio is stopped
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'PLAYBACK_STOPPED'
          ) {
            // Return undefined instead of throwing to prevent Electron from logging the error
            return undefined;
          }
          // Silently handle FILE_NOT_FOUND errors - missing files are handled gracefully by the UI
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'FILE_NOT_FOUND'
          ) {
            // Return undefined instead of throwing to prevent Electron from logging the error
            return undefined;
          }
          // Re-throw other errors
          throw error;
        }
      },
      'play audio'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.STOP_AUDIO,
    createIPCHandler(
      undefined,
      () => {
        audioService.stopAudio();
      },
      'stop audio'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.AUDIO_EXISTS,
    createIPCHandler(
      AudioPathSchema,
      async (audioPath) => {
        return await audioService.audioExists(audioPath);
      },
      'check audio existence'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.NORMALIZE_AUDIO_VOLUME,
    createIPCHandler(
      [AudioPathSchema, z.number().optional()],
      async (audioPath, targetDb) => {
        const validatedTargetDb = targetDb !== undefined ? targetDb : 5; // Default to 5dB amplification
        return await audioService.normalizeAudioVolume(audioPath, validatedTargetDb);
      },
      'normalize audio volume'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.LOAD_AUDIO_BASE64,
    createIPCHandler(
      AudioPathSchema,
      async (audioPath) => {
        return await audioService.loadAudioBase64(audioPath);
      },
      'load audio as base64'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.REGENERATE_AUDIO,
    createIPCHandler(
      z
        .object({
          text: TextSchema,
          language: LanguageSchema.optional(),
          word: TextSchema.optional(),
          wordId: z.number().int().optional(),
          sentenceId: z.number().int().positive().optional(),
          variantId: z.number().int().optional(),
          existingPath: AudioPathSchema.optional(),
        })
        .optional(),
      async (payload) => {
        const validatedPayload = payload ?? {};
        const language =
          validatedPayload.language ||
          (databaseLayer ? await databaseLayer.getCurrentLanguage() : 'spanish');

        const audioPath = await audioService.regenerateAudio(
          validatedPayload.text,
          language,
          validatedPayload.word,
          validatedPayload.wordId,
          validatedPayload.sentenceId,
          validatedPayload.variantId,
          validatedPayload.existingPath
        );

        // Capture voiceID after generation and update database if sentenceId is provided
        let voiceId: string | undefined;
        if (validatedPayload.sentenceId && databaseLayer) {
          try {
            const audioInfo = audioService.getAudioGenerationInfo();
            voiceId = audioInfo.voiceId;
            if (voiceId) {
              await databaseLayer.updateSentenceAudioPath(
                validatedPayload.sentenceId,
                audioPath,
                voiceId
              );
            }
          } catch (error) {
            const logger = getLogger();
            logger.warn({ error }, 'Failed to update voiceID after regeneration');
          }
        }

        return { audioPath };
      },
      'regenerate audio'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.START_RECORDING,
    createIPCHandler(
      z
        .object({
          sampleRate: z.number().optional(),
          channels: z.number().optional(),
          threshold: z.number().optional(),
          silence: z.string().optional(),
          endOnSilence: z.boolean().optional(),
          device: z.string().optional(),
        })
        .optional(),
      async (options) => {
        return await audioService.startRecording(options || undefined);
      },
      'start recording'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.STOP_RECORDING,
    createIPCHandler(
      undefined,
      async () => {
        return await audioService.stopRecording();
      },
      'stop recording'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.CANCEL_RECORDING,
    createIPCHandler(
      undefined,
      async () => {
        await audioService.cancelRecording();
      },
      'cancel recording'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.GET_CURRENT_RECORDING_SESSION,
    createIPCHandler(
      undefined,
      () => {
        try {
          return audioService.getCurrentRecordingSession();
        } catch {
          // Return null on error instead of throwing
          return null;
        }
      },
      'get current recording session'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.IS_RECORDING,
    createIPCHandler(
      undefined,
      () => {
        try {
          return audioService.isRecording();
        } catch {
          // Return false on error instead of throwing
          return false;
        }
      },
      'check recording status'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.GET_AVAILABLE_RECORDING_DEVICES,
    createIPCHandler(
      undefined,
      async () => {
        try {
          return await audioService.getAvailableRecordingDevices();
        } catch {
          // Return default device on error instead of throwing
          return ['default'];
        }
      },
      'get available recording devices'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.DELETE_RECORDING,
    createIPCHandler(
      AudioPathSchema,
      async (filePath) => {
        await audioService.deleteRecording(filePath);
      },
      'delete recording'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.GET_RECORDING_INFO,
    createIPCHandler(
      AudioPathSchema,
      async (filePath) => {
        try {
          return await audioService.getRecordingInfo(filePath);
        } catch {
          // Return null on error instead of throwing
          return null;
        }
      },
      'get recording info'
    )
  );

  // Speech recognition handlers
  ipcMain.handle(
    IPC_CHANNELS.AUDIO.INITIALIZE_SPEECH_RECOGNITION,
    createIPCHandler(
      undefined,
      async () => {
        // Non-blocking: does not throw errors if server is unavailable
        // Use isSpeechRecognitionReady() to check if initialization was successful
        await audioService.initializeSpeechRecognition();
      },
      'initialize speech recognition'
    )
  );

  // TRANSCRIBE_AUDIO needs event parameter for progress callbacks, so handle it specially
  ipcMain.handle(IPC_CHANNELS.AUDIO.TRANSCRIBE_AUDIO, async (event, filePath, options) => {
    try {
      const validatedFilePath = AudioPathSchema.parse(filePath);
      if (!options || !options.language) {
        throw new Error('Language is required for transcription');
      }

      const validatedOptions = z
        .object({
          language: z.string(),
          temperature: z.number().optional(),
        })
        .parse(options);

      // Create progress callback that sends IPC events
      const transcriptionOptions = {
        ...validatedOptions,
        onProgress: (text: string, isFinal: boolean) => {
          // Send progress updates via IPC event
          event.sender.send(IPC_CHANNELS.AUDIO.TRANSCRIBE_AUDIO_PROGRESS, {
            text,
            isFinal,
          });
        },
      };

      return await audioService.transcribeAudio(validatedFilePath, transcriptionOptions);
    } catch (error) {
      const logger = getLogger();
      logger.error({ error }, 'Error transcribing audio');
      throw wrapError(error, `Failed to transcribe audio`);
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.COMPARE_TRANSCRIPTION,
    createIPCHandler(
      [TextSchema, TextSchema, z.string().nullable().optional()],
      async (transcribed, expected, proficiencyLevel) => {
        return await audioService.compareTranscription(transcribed, expected, proficiencyLevel);
      },
      'compare transcription'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.IS_SPEECH_RECOGNITION_READY,
    createIPCHandler(
      undefined,
      async () => {
        try {
          return await audioService.isSpeechRecognitionReady();
        } catch {
          // Return false on error instead of throwing
          return false;
        }
      },
      'check speech recognition status'
    )
  );

  // ElevenLabs TTS handlers
  ipcMain.handle(
    IPC_CHANNELS.AUDIO.SWITCH_TO_ELEVENLABS,
    createIPCHandler(
      z.string().min(1),
      async (apiKey) => {
        await audioService.switchToElevenLabs(apiKey);
      },
      'switch to ElevenLabs'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.SWITCH_TO_SYSTEM_TTS,
    createIPCHandler(
      undefined,
      async () => {
        await audioService.switchToSystemTTS();
      },
      'switch to system TTS'
    )
  );

  // Voice mapping handlers
  ipcMain.handle(
    IPC_CHANNELS.AUDIO.GET_VOICE_MAPPINGS,
    createIPCHandler(
      undefined,
      async () => {
        return await audioService.getVoiceMappings();
      },
      'get voice mappings'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.SAVE_VOICE_MAPPINGS,
    createIPCHandler(
      z.record(z.string(), z.array(z.string().min(1))),
      async (mappings) => {
        // Validate each language entry is an array of strings
        const validatedMappings: Record<string, string[]> = {};
        for (const [lang, voices] of Object.entries(mappings)) {
          validatedMappings[lang] = (voices as string[]).map((v: string) => v.trim());
        }

        await audioService.saveVoiceMappings(validatedMappings);
      },
      'save voice mappings'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.AUDIO.RESET_VOICE_MAPPINGS_TO_DEFAULTS,
    createIPCHandler(
      undefined,
      async () => {
        await audioService.resetVoiceMappingsToDefaults();
      },
      'reset voice mappings to defaults'
    )
  );
}

/**
 * Set up quiz-related IPC handlers
 */
function setupQuizHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  ipcMain.handle(
    IPC_CHANNELS.QUIZ.GET_WEAKEST_WORDS,
    createIPCHandler(
      LimitSchema,
      async (limit) => {
        const language = await databaseLayer.getCurrentLanguage();
        return await databaseLayer.getWeakestWords(limit, language);
      },
      'get weakest words'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.QUIZ.GET_RANDOM_SENTENCE_FOR_WORD,
    createIPCHandler(
      WordIdSchema,
      (wordId) => {
        return databaseLayer.getRandomSentenceForWord(wordId);
      },
      'get random sentence for word'
    )
  );
}

/**
 * Set up SRS-related IPC handlers
 */
function setupSRSHandlers(srsService: SRSService, databaseLayer: SQLiteDatabaseLayer): void {
  ipcMain.handle(
    IPC_CHANNELS.SRS.PROCESS_REVIEW,
    createIPCHandler(
      [WordIdSchema, z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])],
      async (wordId, recall) => {
        return await srsService.processReview(wordId, { recall });
      },
      'process review'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.SRS.PROCESS_QUIZ_RESULTS,
    createIPCHandler(
      [
        z.array(
          z.object({
            wordId: WordIdSchema,
            correct: BooleanSchema,
            responseTime: z.number().optional(),
            difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
          })
        ),
        z.string().min(1),
        z.number().int().positive().optional(),
      ],
      async (results, language, sessionId) => {
        return await srsService.processQuizResults(results, language, sessionId);
      },
      'process quiz results'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.SRS.GET_TODAYS_STUDY_WORDS,
    createIPCHandler(
      [LimitSchema.optional(), LanguageSchema.optional()],
      async (maxWords, language) => {
        const validatedLanguage = language || (await databaseLayer.getCurrentLanguage());
        return await srsService.getTodaysStudyWords(validatedLanguage, maxWords);
      },
      'get todays study words'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.SRS.GET_DASHBOARD_STATS,
    createIPCHandler(
      LanguageSchema.optional(),
      async (language) => {
        const validatedLanguage = language || (await databaseLayer.getCurrentLanguage());
        return await srsService.getDashboardStats(validatedLanguage);
      },
      'get dashboard stats'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.SRS.MARK_WORD_DIFFICULTY,
    createIPCHandler(
      [WordIdSchema, z.enum(['easy', 'hard'])],
      async (wordId, difficulty) => {
        return await srsService.markWordDifficulty(wordId, difficulty);
      },
      'mark word difficulty'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.SRS.RESET_WORD_PROGRESS,
    createIPCHandler(
      WordIdSchema,
      async (wordId) => {
        return await srsService.resetWordProgress(wordId);
      },
      'reset word progress'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.SRS.GET_OVERDUE_WORDS,
    createIPCHandler(
      LanguageSchema.optional(),
      async (language) => {
        const validatedLanguage = language || (await databaseLayer.getCurrentLanguage());
        return await srsService.getOverdueWords(validatedLanguage);
      },
      'get overdue words'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.SRS.INITIALIZE_EXISTING_WORDS,
    createIPCHandler(
      LanguageSchema.optional(),
      async (language) => {
        const validatedLanguage = language || (await databaseLayer.getCurrentLanguage());
        return await srsService.initializeExistingWords(validatedLanguage);
      },
      'initialize existing words'
    )
  );
}

/**
 * Set up word generation job queue handlers
 */
function setupJobHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  const EnqueueOptionsSchema = z
    .object({
      topic: TopicSchema.optional(),
      language: LanguageSchema.optional(),
      desiredSentenceCount: z.number().int().min(1).max(10).optional(),
    })
    .optional();

  ipcMain.handle(
    IPC_CHANNELS.JOBS.ENQUEUE_WORD_GENERATION,
    createIPCHandler(
      [WordIdSchema, EnqueueOptionsSchema],
      async (wordId, options) => {
        let language = options?.language;
        if (!language) {
          const word = await databaseLayer.getWordById(wordId);
          if (!word) {
            throw new Error(`Word with ID ${wordId} not found`);
          }
          language = word.language;
        }

        await databaseLayer.enqueueWordGeneration(
          wordId,
          language,
          options?.topic,
          options?.desiredSentenceCount ?? 3
        );
      },
      'enqueue word generation'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.JOBS.GET_WORD_STATUS,
    createIPCHandler(
      WordIdSchema,
      (wordId) => {
        return databaseLayer.getWordProcessingInfo(wordId);
      },
      'get word status'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.JOBS.GET_QUEUE_SUMMARY,
    createIPCHandler(
      LanguageSchema.optional(),
      (language) => {
        return databaseLayer.getWordGenerationQueueSummary(language || undefined);
      },
      'get queue summary'
    )
  );
}

/**
 * Set up lifecycle-related IPC handlers
 */
function setupLifecycleHandlers(
  lifecycleManager: LifecycleManager,
  updateManager: UpdateManager,
  audioService?: AudioService,
  wordGenerationRunner?: WordGenerationRunner
): void {
  ipcMain.handle(
    IPC_CHANNELS.LIFECYCLE.CREATE_BACKUP,
    createIPCHandler(
      undefined,
      async () => {
        return await lifecycleManager.createBackup();
      },
      'create backup'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LIFECYCLE.RESTORE_FROM_BACKUP,
    createIPCHandler(
      z.string().min(1),
      async (backupPath) => {
        await lifecycleManager.restoreFromBackup(backupPath);
      },
      'restore from backup'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LIFECYCLE.CHECK_FOR_UPDATES,
    createIPCHandler(
      undefined,
      async () => {
        try {
          const updateInfo = await updateManager.checkForUpdates(true);
          return updateInfo !== null;
        } catch {
          // Return false on error instead of throwing
          return false;
        }
      },
      'check for updates'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LIFECYCLE.GET_APP_VERSION,
    createIPCHandler(
      undefined,
      () => {
        return app.getVersion();
      },
      'get app version'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LIFECYCLE.RESTART_ALL,
    createIPCHandler(
      undefined,
      async () => {
        await lifecycleManager.restartAll();
      },
      'restart all'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LIFECYCLE.OPEN_BACKUP_DIALOG,
    createIPCHandler(
      undefined,
      async () => {
        const result = await dialog.showOpenDialog({
          title: 'Select Backup Directory',
          properties: ['openDirectory'],
          message: 'Select a backup directory to restore from',
        });

        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }

        return result.filePaths[0];
      },
      'open backup dialog'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LIFECYCLE.OPEN_BACKUP_DIRECTORY,
    createIPCHandler(
      undefined,
      async () => {
        await lifecycleManager.openBackupDirectory();
      },
      'open backup directory'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LIFECYCLE.CLOSE_APP,
    createIPCHandler(
      undefined,
      async () => {
        const logger = getLogger();
        logger.info('Close app requested via IPC');

        // Stop word generation runner FIRST (before database is closed)
        if (wordGenerationRunner) {
          await wordGenerationRunner.stop();
        }

        // Stop audio service (stop any playing audio or active recordings)
        if (audioService) {
          audioService.stopAudio();
          try {
            const isRecording = await audioService.isRecording();
            if (isRecording) {
              await audioService.stopRecording();
            }
          } catch (error) {
            const logger = getLogger();
            logger.warn({ error }, 'Error stopping recording during app close');
          }
        }

        // Clean up update manager
        updateManager.cleanup();

        // Clean up IPC handlers
        cleanupIPCHandlers();

        // Handle graceful shutdown (sets isShuttingDown flag and closes database)
        await lifecycleManager.handleShutdown();

        // Quit the app (before-quit handler will see isShuttingDown flag and skip cleanup)
        app.quit();
      },
      'close app'
    )
  );
}

/**
 * Clean up IPC handlers (call this on app shutdown)
 */
export function cleanupIPCHandlers(): void {
  // Remove all IPC handlers
  Object.values(IPC_CHANNELS.DATABASE).forEach((channel) => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.LLM).forEach((channel) => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.AUDIO).forEach((channel) => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.QUIZ).forEach((channel) => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.LIFECYCLE).forEach((channel) => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.FREQUENCY).forEach((channel) => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.SRS).forEach((channel) => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.JOBS).forEach((channel) => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.LEMMATIZATION).forEach((channel) => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.DIALOG).forEach((channel) => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.FLOW).forEach((channel) => {
    ipcMain.removeAllListeners(channel);
  });

  const logger = getLogger();
  logger.info('IPC handlers cleaned up');
}

/**
 * Set up lemmatization-related IPC handlers
 */
function setupLemmatizationHandlers(lemmatizationService: LemmatizationService): void {
  ipcMain.handle(
    IPC_CHANNELS.LEMMATIZATION.GET_STATUS,
    createIPCHandler(
      undefined,
      async () => {
        return await lemmatizationService.getStatus();
      },
      'get lemmatization status'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LEMMATIZATION.LOAD_MODEL,
    createIPCHandler(
      LanguageSchema,
      async (language) => {
        await lemmatizationService.loadModel(language);
      },
      'load lemmatization model'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.LEMMATIZATION.LEMMATIZE_WORDS,
    createIPCHandler(
      [z.array(z.string().min(1).max(200)), LanguageSchema],
      async (words, language) => {
        return await lemmatizationService.lemmatizeWords(words, language);
      },
      'lemmatize words'
    )
  );
}

/**
 * Set up dialog-related IPC handlers
 */
function setupDialogHandlers(
  databaseLayer: SQLiteDatabaseLayer,
  llmClient: LLMClient,
  audioService: AudioService
): void {
  const dialogService = new DialogService(databaseLayer, llmClient);

  ipcMain.handle(
    IPC_CHANNELS.DIALOG.SELECT_SENTENCE,
    createIPCHandler(
      undefined,
      async () => {
        const language = await databaseLayer.getCurrentLanguage();
        return await dialogService.selectSentence(language);
      },
      'select sentence for dialog'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DIALOG.SELECT_SENTENCE_WITH_TOPIC,
    createIPCHandler(
      undefined,
      async () => {
        const language = await databaseLayer.getCurrentLanguage();
        return await dialogService.selectSentenceWithTopic(language);
      },
      'select sentence with topic for dialog'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DIALOG.GENERATE_VARIANTS,
    createIPCHandler(
      SentenceIdSchema,
      async (sentenceId) => {
        // Get the sentence
        const sentence = await databaseLayer.getSentenceById(sentenceId);
        if (!sentence) {
          throw new Error(`Sentence with ID ${sentenceId} not found`);
        }

        // Get existing variants
        const existingVariants = await databaseLayer.getDialogueVariantsBySentenceId(sentenceId);

        // Get known words for variant generation
        const language = await databaseLayer.getCurrentLanguage();
        const allWords = await databaseLayer.getAllWords(language, true, false);
        const dialogServiceConfig = dialogService as any; // Access private config
        const minWordStrength = dialogServiceConfig.config?.minWordStrength ?? 40;
        const maxKnownWords = dialogServiceConfig.config?.maxKnownWordsForVariants ?? 50;
        const knownWords = allWords
          .filter((w) => w.known || (w.strength ?? 0) >= minWordStrength)
          .slice(0, maxKnownWords)
          .map((w) => w.word);

        // Generate variants
        return await dialogService.generateDialogueVariants(
          sentence,
          existingVariants,
          knownWords,
          language
        );
      },
      'generate dialogue variants'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DIALOG.ANALYZE_TRANSCRIPTION,
    createIPCHandler(
      [TextSchema, LanguageSchema, TextSchema, z.string().optional()],
      async (transcription, language, assistantSentence, topic) => {
        return await llmClient.analyzeTranscription(
          transcription,
          language,
          assistantSentence,
          topic
        );
      },
      'analyze transcription for corrections and grammar'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DIALOG.GENERATE_FOLLOW_UP,
    createIPCHandler(
      [VariantIdSchema, ConversationHistorySchema.optional()], // Use VariantIdSchema to allow negative IDs, optional conversation history
      async (variantId, conversationHistory) => {
        const language = await databaseLayer.getCurrentLanguage();

        // Generate follow-up using unified history-based approach
        const followUp = await dialogService.generateFollowUp(
          variantId,
          language,
          conversationHistory
        );

        // Generate audio on-demand if continuation text exists and no audio is cached yet
        // Only cache audio for actual variants (positive IDs), not pseudo-variants (negative IDs)
        let continuationAudio: string | undefined;
        if (followUp.text && followUp.text.trim().length > 0 && variantId > 0) {
          try {
            // Check if audio already exists in database and matches current text
            const variant = await databaseLayer.getDialogueVariantById(variantId);
            const shouldUseCachedAudio =
              variant && variant.continuationAudio && variant.continuationText === followUp.text; // Audio must match current text

            if (shouldUseCachedAudio) {
              // Audio already exists and matches current text, use cached path
              continuationAudio = variant.continuationAudio;
            } else {
              // Generate audio on-demand (either no cached audio, or text changed)
              const currentLanguage = await databaseLayer.getCurrentLanguage();
              const audioPath = await audioService.generateAudio(
                followUp.text,
                currentLanguage,
                undefined,
                undefined,
                undefined,
                variantId
              );

              if (audioPath) {
                continuationAudio = audioPath;

                // Update database with audio path (update continuation with audio path)
                // This also ensures the continuation text/translation are cached
                await databaseLayer.updateDialogueVariantContinuation(
                  variantId,
                  followUp.text,
                  followUp.translation,
                  audioPath
                );
                const logger = getLogger();
                logger.debug({ audioPath }, '[IPC] Generated and cached continuation audio');
              }
            }
          } catch (audioError) {
            const logger = getLogger();
            logger.error({ error: audioError }, '[IPC] Failed to generate continuation audio');
            // Continue without audio - non-critical
          }
        } else if (followUp.text && followUp.text.trim().length > 0 && variantId < 0) {
          // For pseudo-variants (negative IDs), generate audio but don't cache in database
          // The audio file will still be cached on disk via audioService.generateAudio
          try {
            const currentLanguage = await databaseLayer.getCurrentLanguage();
            const audioPath = await audioService.generateAudio(
              followUp.text,
              currentLanguage,
              undefined,
              undefined,
              undefined,
              variantId
            );

            if (audioPath) {
              continuationAudio = audioPath;
              const logger = getLogger();
              logger.debug(
                { audioPath },
                '[IPC] Generated continuation audio for pseudo-variant (not cached in DB)'
              );
            }
          } catch (audioError) {
            const logger = getLogger();
            logger.error(
              { error: audioError },
              '[IPC] Failed to generate continuation audio for pseudo-variant'
            );
            // Continue without audio - non-critical
          }
        }

        return {
          text: followUp.text,
          translation: followUp.translation,
          audio: continuationAudio,
        };
      },
      'generate follow-up'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DIALOG.PREGENERATE_SESSION,
    createIPCHandler(
      undefined,
      async () => {
        try {
          // Pre-generate a single dialog session using batch method
          const language = await databaseLayer.getCurrentLanguage();
          const sessions = await dialogService.pregenerateSessions(1, language);
          if (sessions.length === 0) {
            return null;
          }

          const session = sessions[0];

          // Generate audio if needed (non-blocking - don't fail if audio generation fails)
          let beforeSentenceAudio: string | undefined;
          let afterSentenceAudio: string | undefined;
          if (session.sentenceId) {
            try {
              // Get word ID from sentence
              const sentence = await databaseLayer.getSentenceById(session.sentenceId);
              if (!sentence) {
                throw new Error(`Sentence with ID ${session.sentenceId} not found`);
              }
              const language = await databaseLayer.getCurrentLanguage();

              // Generate beforeSentence audio if contextBefore exists
              if (session.contextBefore) {
                const audioPath = await audioService.generateAudio(
                  session.contextBefore,
                  language,
                  '_before_sentence',
                  sentence.wordId,
                  session.sentenceId
                );

                // Check if audio was generated successfully
                if (audioPath && (await audioService.audioExists(audioPath))) {
                  beforeSentenceAudio = audioPath;
                  // Save the path to database
                  try {
                    await databaseLayer.updateBeforeSentenceAudioPath(
                      session.sentenceId,
                      audioPath
                    );
                  } catch (dbError) {
                    const logger = getLogger();
                    logger.warn(
                      { error: dbError },
                      '[IPC] Failed to save beforeSentence audio path to database'
                    );
                    // Continue - audio exists even if DB update fails
                  }
                }
              }

              // Generate afterSentence audio if contextAfter exists
              if (session.contextAfter) {
                const audioPath = await audioService.generateAudio(
                  session.contextAfter,
                  language,
                  '_after_sentence',
                  sentence.wordId,
                  session.sentenceId
                );

                // Check if audio was generated successfully
                if (audioPath && (await audioService.audioExists(audioPath))) {
                  afterSentenceAudio = audioPath;
                  // Save the path to database
                  try {
                    await databaseLayer.updateAfterSentenceAudioPath(session.sentenceId, audioPath);
                  } catch (dbError) {
                    const logger = getLogger();
                    logger.warn(
                      { error: dbError },
                      '[IPC] Failed to save afterSentence audio path to database'
                    );
                    // Continue - audio exists even if DB update fails
                  }
                }
              }
            } catch (error) {
              const logger = getLogger();
              logger.warn(
                { error },
                '[IPC] Failed to generate context sentences audio during pre-generation'
              );
              // Continue without audio
            }
          }

          // Convert Date objects to ISO strings for IPC transfer
          return {
            ...session,
            beforeSentenceAudio,
            afterSentenceAudio,
            responseOptions: session.responseOptions.map((v) => ({
              ...v,
              createdAt: v.createdAt.toISOString(),
            })),
          };
        } catch (error) {
          const logger = getLogger();
          logger.error({ error }, 'Error pre-generating dialog session');
          return null; // Don't throw - this is a background operation
        }
      },
      'pregenerate dialog session'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DIALOG.PREGENERATE_SESSIONS,
    createIPCHandler(
      z.number().int().min(1).max(100),
      async (count) => {
        try {
          // Pre-generate multiple dialog sessions (non-blocking - can fail silently)
          const language = await databaseLayer.getCurrentLanguage();
          const sessions = await dialogService.pregenerateSessions(count, language);
          if (sessions.length === 0) {
            return [];
          }
          const sessionsWithAudio = await Promise.all(
            sessions.map(async (session) => {
              // Generate audio if needed (non-blocking - don't fail if audio generation fails)
              let beforeSentenceAudio: string | undefined;
              let afterSentenceAudio: string | undefined;
              if (session.sentenceId) {
                try {
                  // Get word ID from sentence
                  const sentence = await databaseLayer.getSentenceById(session.sentenceId);
                  if (!sentence) {
                    throw new Error(`Sentence with ID ${session.sentenceId} not found`);
                  }

                  // Generate beforeSentence audio if contextBefore exists
                  if (session.contextBefore) {
                    const audioPath = await audioService.generateAudio(
                      session.contextBefore,
                      language,
                      '_before_sentence',
                      sentence.wordId,
                      session.sentenceId
                    );

                    // Check if audio was generated successfully
                    if (audioPath && (await audioService.audioExists(audioPath))) {
                      beforeSentenceAudio = audioPath;
                      // Save the path to database
                      try {
                        await databaseLayer.updateBeforeSentenceAudioPath(
                          session.sentenceId,
                          audioPath
                        );
                      } catch (dbError) {
                        const logger = getLogger();
                        logger.warn(
                          { error: dbError, sentenceId: session.sentenceId },
                          `[IPC] Failed to save beforeSentence audio path to database for session ${session.sentenceId}`
                        );
                        // Continue - audio exists even if DB update fails
                      }
                    }
                  }

                  // Generate afterSentence audio if contextAfter exists
                  if (session.contextAfter) {
                    const audioPath = await audioService.generateAudio(
                      session.contextAfter,
                      language,
                      '_after_sentence',
                      sentence.wordId,
                      session.sentenceId
                    );

                    // Check if audio was generated successfully
                    if (audioPath && (await audioService.audioExists(audioPath))) {
                      afterSentenceAudio = audioPath;
                      // Save the path to database
                      try {
                        await databaseLayer.updateAfterSentenceAudioPath(
                          session.sentenceId,
                          audioPath
                        );
                      } catch (dbError) {
                        const logger = getLogger();
                        logger.warn(
                          { error: dbError, sentenceId: session.sentenceId },
                          `[IPC] Failed to save afterSentence audio path to database for session ${session.sentenceId}`
                        );
                        // Continue - audio exists even if DB update fails
                      }
                    }
                  }
                } catch (error) {
                  const logger = getLogger();
                  logger.warn(
                    { error, sentenceId: session.sentenceId },
                    `[IPC] Failed to generate context sentences audio for session ${session.sentenceId}`
                  );
                  // Continue without audio
                }
              }

              // Convert Date objects to ISO strings for IPC transfer
              return {
                ...session,
                beforeSentenceAudio,
                afterSentenceAudio,
                responseOptions: session.responseOptions.map((v) => ({
                  ...v,
                  createdAt: v.createdAt.toISOString(),
                })),
              };
            })
          );

          return sessionsWithAudio;
        } catch (error) {
          const logger = getLogger();
          logger.error({ error }, 'Error pre-generating dialog sessions');
          return []; // Don't throw - this is a background operation
        }
      },
      'pregenerate dialog sessions'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DIALOG.ENSURE_BEFORE_SENTENCE_AUDIO,
    createIPCHandler(
      SentenceIdSchema,
      async (sentenceId) => {
        // Get the sentence
        const sentence = await databaseLayer.getSentenceById(sentenceId);
        if (!sentence) {
          throw new Error(`Sentence with ID ${sentenceId} not found`);
        }

        // Check if beforeSentence exists
        if (!sentence.contextBefore) {
          return null;
        }

        // If audio path already exists in database, return it
        if (sentence.beforeSentenceAudioPath) {
          return sentence.beforeSentenceAudioPath;
        }

        // Get word ID from sentence
        const language = await databaseLayer.getCurrentLanguage();

        // Generate audio with wordId and sentenceId
        const audioPath = await audioService.generateAudio(
          sentence.contextBefore,
          language,
          '_before_sentence',
          sentence.wordId,
          sentenceId
        );

        // Save the path to database
        if (audioPath) {
          await databaseLayer.updateBeforeSentenceAudioPath(sentenceId, audioPath);
        }

        return audioPath;
      },
      'ensure before sentence audio'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DIALOG.ENSURE_CONTEXT_SENTENCES,
    createIPCHandler(
      SentenceIdSchema,
      async (sentenceId) => {
        // Get the sentence
        const sentence = await databaseLayer.getSentenceById(sentenceId);
        if (!sentence) {
          throw new Error(`Sentence with ID ${sentenceId} not found`);
        }

        const language = await databaseLayer.getCurrentLanguage();
        let beforeSentenceAudio: string | null = null;
        let afterSentenceAudio: string | null = null;

        // Select a voice ID once for context sentences to ensure consistency
        // Only needed if we're using ElevenLabs and at least one context sentence needs generation
        let contextVoiceId: string | undefined = undefined;
        const needsBeforeGeneration = sentence.contextBefore && !sentence.beforeSentenceAudioPath;
        const needsAfterGeneration = sentence.contextAfter && !sentence.afterSentenceAudioPath;

        if (needsBeforeGeneration || needsAfterGeneration) {
          // Check if audioService is using ElevenLabs
          const audioInfo = audioService.getAudioGenerationInfo();
          if (audioInfo.service === 'elevenlabs') {
            // Get the ElevenLabs generator and select a voice ID for the language
            const generator = (audioService as any).audioGenerator;
            if (generator && typeof generator.getVoiceForLanguage === 'function') {
              contextVoiceId = await generator.getVoiceForLanguage(language);
            }
          }
        }

        // Generate beforeSentence audio if contextBefore exists
        if (sentence.contextBefore) {
          // If audio path already exists in database, use it
          if (sentence.beforeSentenceAudioPath) {
            beforeSentenceAudio = sentence.beforeSentenceAudioPath;
          } else {
            // Generate audio with wordId and sentenceId, using the selected voice ID
            const audioPath = await audioService.generateAudio(
              sentence.contextBefore,
              language,
              '_before_sentence',
              sentence.wordId,
              sentenceId,
              undefined,
              contextVoiceId
            );

            // Save the path to database
            if (audioPath) {
              await databaseLayer.updateBeforeSentenceAudioPath(sentenceId, audioPath);
              beforeSentenceAudio = audioPath;
            }
          }
        }

        // Generate afterSentence audio if contextAfter exists
        if (sentence.contextAfter) {
          // If audio path already exists in database, use it
          if (sentence.afterSentenceAudioPath) {
            afterSentenceAudio = sentence.afterSentenceAudioPath;
          } else {
            // Generate audio with wordId and sentenceId, using the same voice ID as before_sentence
            const audioPath = await audioService.generateAudio(
              sentence.contextAfter,
              language,
              '_after_sentence',
              sentence.wordId,
              sentenceId,
              undefined,
              contextVoiceId
            );

            // Save the path to database
            if (audioPath) {
              await databaseLayer.updateAfterSentenceAudioPath(sentenceId, audioPath);
              afterSentenceAudio = audioPath;
            }
          }
        }

        return {
          beforeSentenceAudio,
          afterSentenceAudio,
        };
      },
      'ensure context sentences audio'
    )
  );
}

/**
 * Set up Flow-related IPC handlers
 */
function setupFlowHandlers(databaseLayer: SQLiteDatabaseLayer, audioService: AudioService): void {
  ipcMain.handle(
    IPC_CHANNELS.FLOW.GET_FLOW_SENTENCES,
    createIPCHandler(
      LanguageSchema.optional(),
      async (language) => {
        // Validate and use provided language, or get current language if not provided
        const validatedLanguage = language || (await databaseLayer.getCurrentLanguage());
        const flowSentences = await databaseLayer.getFlowSentences(validatedLanguage);

        // Check which audio files actually exist and filter accordingly
        const result = await Promise.all(
          flowSentences.map(async (item) => {
            // Check if before sentence audio exists
            let beforeSentenceAudio: string | undefined;
            if (item.beforeSentenceAudio) {
              const exists = await audioService.audioExists(item.beforeSentenceAudio);
              if (exists) {
                beforeSentenceAudio = item.beforeSentenceAudio;
              }
            }

            // Check which continuation audio files exist
            const existingContinuationAudios: string[] = [];
            for (const audioPath of item.continuationAudios) {
              const exists = await audioService.audioExists(audioPath);
              if (exists) {
                existingContinuationAudios.push(audioPath);
              }
            }

            return {
              sentence: item.sentence,
              words: item.words,
              beforeSentenceAudio,
              continuationAudios: existingContinuationAudios,
            };
          })
        );

        return result;
      },
      'get flow sentences'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.FLOW.STITCH_AUDIO,
    createIPCHandler(
      [z.array(z.string().min(1).max(500)), LanguageSchema],
      async (audioPaths, language) => {
        // Don't log here - audioService.stitchAudio() will check cache first and log appropriately
        const stitchedPath = await audioService.stitchAudio(audioPaths, language);

        if (!stitchedPath) {
          throw new Error('Failed to stitch audio files');
        }

        return stitchedPath;
      },
      'stitch audio'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.FLOW.STITCH_AUDIO_WITH_ENGLISH,
    createIPCHandler(
      [z.array(z.tuple([z.string().min(1).max(500), z.string().min(1).max(500)])), LanguageSchema],
      async (audioPathPairs, language) => {
        // Don't log here - audioService.stitchAudioWithEnglish() will check cache first and log appropriately
        const stitchedPath = await audioService.stitchAudioWithEnglish(audioPathPairs, language);

        // Return null instead of throwing - the renderer handles null gracefully
        // This can happen legitimately when no audio files are available
        return stitchedPath;
      },
      'stitch audio with English pattern'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.FLOW.GET_FILE_STATS,
    createIPCHandler(
      z.string().min(1).max(500),
      async (filePath) => {
        try {
          // Resolve relative paths to absolute paths
          const absolutePath = AudioService.resolveAudioPath(filePath);

          const { stat } = require('fs').promises;
          const stats = await stat(absolutePath);

          return {
            mtime: stats.mtime,
          };
        } catch {
          // File doesn't exist or other error
          return null;
        }
      },
      'get file stats'
    )
  );
}

/**
 * Set up tracking-related IPC handlers
 */
function setupTrackingHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  ipcMain.handle(
    IPC_CHANNELS.TRACKING.CREATE_SESSION,
    createIPCHandler(
      [z.enum(['learning', 'quiz', 'dialog', 'flow']), LanguageSchema],
      async (mode, language) => {
        const sessionId = await databaseLayer.createLearningSession({ mode, language });
        const logger = getLogger();
        logger.debug(
          { sessionId, mode, language },
          `[Tracking] Learning session created: id=${sessionId}, mode=${mode}, language=${language}`
        );
        return sessionId;
      },
      'create learning session'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.TRACKING.UPDATE_SESSION,
    createIPCHandler(
      [
        z.number().int().positive(),
        z.object({
          wordCount: z.number().int().nonnegative().optional(),
          sentenceCount: z.number().int().nonnegative().optional(),
          audioPlayedCount: z.number().int().nonnegative().optional(),
        }),
      ],
      async (sessionId, data) => {
        await databaseLayer.updateLearningSession(sessionId, data);
        const counts = [
          data.wordCount !== undefined ? `words=${data.wordCount}` : null,
          data.sentenceCount !== undefined ? `sentences=${data.sentenceCount}` : null,
          data.audioPlayedCount !== undefined ? `audio=${data.audioPlayedCount}` : null,
        ]
          .filter(Boolean)
          .join(', ');
        const logger = getLogger();
        logger.debug(
          { sessionId, counts },
          `[Tracking] Learning session updated: id=${sessionId}${counts ? ', ' + counts : ''}`
        );
      },
      'update learning session'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.TRACKING.RECORD_AUDIO_PLAYBACK,
    createIPCHandler(
      z.object({
        sessionId: z.number().int().positive().optional(),
        sentenceId: z.number().int().positive().optional(),
        audioPath: AudioPathSchema,
        language: LanguageSchema,
        mode: z.enum(['learning', 'quiz', 'dialog', 'flow']),
        playbackSpeed: z.number().min(0.1).max(3.0).optional(),
      }),
      async (data) => {
        const id = await databaseLayer.recordAudioPlayback(data);
        const logger = getLogger();
        logger.debug(
          {
            id,
            mode: data.mode,
            language: data.language,
            speed: data.playbackSpeed?.toFixed(1) || '1.0',
            sentenceId: data.sentenceId || 'none',
            sessionId: data.sessionId || 'none',
          },
          `[Tracking] Audio playback: mode=${data.mode}, language=${data.language}, speed=${data.playbackSpeed?.toFixed(1) || '1.0'}x, sentenceId=${data.sentenceId || 'none'}, sessionId=${data.sessionId || 'none'}`
        );
        return id;
      },
      'record audio playback'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.TRACKING.RECORD_NEGLECTED_WORDS,
    createIPCHandler(
      z.array(
        z.object({
          word: z.string().min(1),
          language: LanguageSchema,
          topic: z.string().optional(),
          translation: z.string().optional(),
          sessionId: z.number().int().positive().optional(),
          frequencyPosition: z.number().int().nonnegative().optional(),
        })
      ),
      async (data) => {
        const count = await databaseLayer.recordNeglectedWords(data);
        if (count > 0) {
          const logger = getLogger();
          logger.debug(
            {
              count,
              language: data[0]?.language || 'unknown',
              topic: data[0]?.topic || 'none',
            },
            `[Tracking] Neglected words (batch): count=${count}, language=${data[0]?.language || 'unknown'}, topic=${data[0]?.topic || 'none'}`
          );
        }
        return count;
      },
      'record neglected words'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.TRACKING.RECORD_DICTIONARY_HOVER,
    createIPCHandler(
      z.object({
        word: z.string().min(1),
        language: LanguageSchema,
        sentenceId: z.number().int().positive().optional(),
        sessionId: z.number().int().positive().optional(),
        hoverDurationMs: z.number().int().positive().min(1000), // Must be >= 1000ms
        dictionaryKey: z.string().optional(),
        foundInDict: z.boolean(),
      }),
      async (data) => {
        const id = await databaseLayer.recordDictionaryHover(data);
        const logger = getLogger();
        logger.debug(
          {
            id,
            word: data.word,
            language: data.language,
            duration: data.hoverDurationMs,
            foundInDict: data.foundInDict,
            sentenceId: data.sentenceId || 'none',
            sessionId: data.sessionId || 'none',
          },
          `[Tracking] Dictionary hover: word="${data.word}", language=${data.language}, duration=${data.hoverDurationMs}ms, foundInDict=${data.foundInDict}, sentenceId=${data.sentenceId || 'none'}, sessionId=${data.sessionId || 'none'}`
        );
        return id;
      },
      'record dictionary hover'
    )
  );
}

function setupLogHandlers(): void {
  const { getLogger } = require('../utils/logger.js');
  const logger = getLogger();

  ipcMain.handle(
    IPC_CHANNELS.LOG.LOG,
    createIPCHandler(
      [
        z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
        z.string(),
        z.any().optional(),
      ],
      (level, message, data) => {
        try {
          // Log with appropriate level
          if (data) {
            logger[level]({ ...data, process: 'renderer' }, message);
          } else {
            logger[level]({ process: 'renderer' }, message);
          }
        } catch (error) {
          // Fallback to console if logger is not available
          const logger = getLogger();
          logger.error({ error }, 'Error logging from renderer');
        }
      },
      'log from renderer'
    )
  );
}

function setupTopicsHandlers(): void {
  // Cache topics after first load
  let cachedTopics: string[] | null = null;

  /**
   * Load topics from topics.txt file (cached after first load)
   */
  async function loadTopicsFromFile(): Promise<string[]> {
    // Return cached topics if already loaded
    if (cachedTopics !== null) {
      return cachedTopics;
    }

    try {
      const topicsPath = join(process.cwd(), 'topics.txt');
      const content = await fsPromises.readFile(topicsPath, 'utf-8');
      const topics = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      // Cache the topics
      cachedTopics = topics;
      return topics;
    } catch (error) {
      const logger = getLogger();
      logger.error({ error }, '[Topics] Error loading topics from file');
      // Return empty array as fallback
      cachedTopics = [];
      return [];
    }
  }

  ipcMain.handle(
    IPC_CHANNELS.TOPICS.GET_TOPICS,
    createIPCHandler(
      [],
      async () => {
        const topics = await loadTopicsFromFile();
        return topics;
      },
      'get topics'
    )
  );
}

/**
 * Set up Scoring-related IPC handlers
 */
export function setupScoringHandlers(
  scoringService: import('../scoring/scoring-service.js').ScoringService
): void {
  ipcMain.handle(
    IPC_CHANNELS.SCORING.GET_NEXT_MODE,
    createIPCHandler(
      z.object({
        currentMode: z.enum(['topic-selection', 'learning', 'quiz', 'dialog', 'flow']).nullable(),
        language: z.string().min(1).max(50).nullable(),
        initialTakeover: z.boolean(),
      }),
      async (options) => {
        const result = await scoringService.getNextMode({
          currentMode: options.currentMode as
            | 'topic-selection'
            | 'learning'
            | 'quiz'
            | 'dialog'
            | 'flow'
            | null,
          language: options.language,
          initialTakeover: options.initialTakeover,
        });

        return result;
      },
      'get next mode'
    )
  );

  const { getLogger } = require('../utils/logger.js');
  const logger = getLogger();
  logger.info({ channel: IPC_CHANNELS.SCORING.GET_NEXT_MODE }, 'Scoring IPC handler registered');
}

/**
 * Set up Proficiency-related IPC handlers
 */
export function setupProficiencyHandlers(
  proficiencyService: import('../scoring/proficiency-service.js').ProficiencyService
): void {
  ipcMain.handle(
    IPC_CHANNELS.SCORING.GET_LANGUAGE_PROFICIENCY,
    createIPCHandler(
      [z.string().min(1).max(50).nullable(), z.number().int().min(1).max(365).optional()],
      async (language, timeWindowDays) => {
        const proficiency = await proficiencyService.calculateLanguageProficiency(
          language || '',
          timeWindowDays
        );

        return proficiency;
      },
      'get language proficiency'
    )
  );

  const { getLogger } = require('../utils/logger.js');
  const logger = getLogger();
  logger.info(
    { channel: IPC_CHANNELS.SCORING.GET_LANGUAGE_PROFICIENCY },
    'Proficiency IPC handler registered'
  );
}
