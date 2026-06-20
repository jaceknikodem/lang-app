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
import { tokenizeJapanese, getWordReadings } from '../lemmatization/japanese-tokenizer.js';
import { DialogService } from '../dialog/index.js';
import { exportLanguageToApkg } from '../services/anki/anki-export-service.js';
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

type IPCHandlerDef = {
  channel: string;
  schema: z.ZodTypeAny | z.ZodTypeAny[] | undefined | null;
  handler: (...args: any[]) => any;
  description: string;
};

function registerHandlers(defs: IPCHandlerDef[]): void {
  for (const { channel, schema, handler, description } of defs) {
    ipcMain.handle(channel, createIPCHandler(schema, handler, description));
  }
}

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
  setupDatabaseHandlers(databaseLayer);
  setupLLMHandlers(llmClient, contentGenerator, databaseLayer);
  setupAudioHandlers(audioService, databaseLayer);
  setupQuizHandlers(databaseLayer);
  setupSRSHandlers(srsService, databaseLayer);
  setupJobHandlers(databaseLayer);

  if (lifecycleManager && updateManager) {
    setupLifecycleHandlers(lifecycleManager, updateManager, audioService, wordGenerationRunner);
  }

  if (lemmatizationService) {
    setupLemmatizationHandlers(lemmatizationService);
    setupJapaneseTokenizationHandlers();
  }

  setupDialogHandlers(databaseLayer, llmClient, audioService);
  setupFlowHandlers(databaseLayer, audioService);
  setupLogHandlers();
  setupTopicsHandlers();
  setupTrackingHandlers(databaseLayer);
  setupExportHandlers(databaseLayer);

  const logger = getLogger();
  logger.info('IPC handlers registered successfully');
}

function setupDatabaseHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.DATABASE.INSERT_WORD,
      schema: CreateWordSchema,
      description: 'insert word',
      handler: (wordData) => {
        console.log('[IPC Handler] INSERT_WORD received wordData:', wordData);
        console.log('[IPC Handler] wordData.topic:', wordData.topic);
        console.log('[IPC Handler] wordData.topic type:', typeof wordData.topic);
        return databaseLayer.insertWord(wordData);
      },
    },
    {
      channel: IPC_CHANNELS.DATABASE.UPDATE_WORD_STRENGTH,
      schema: [WordIdSchema, StrengthSchema],
      description: 'update word strength',
      handler: async (wordId, strength) => {
        await databaseLayer.updateWordStrength(wordId, strength);
        getLogger().debug(
          { wordId, strength },
          `[Tracking] Word progress: wordId=${wordId}, strength=${strength}`
        );
      },
    },
    {
      channel: IPC_CHANNELS.DATABASE.MARK_WORD_KNOWN,
      schema: [WordIdSchema, BooleanSchema],
      description: 'mark word known',
      handler: async (wordId, known) => {
        await databaseLayer.markWordKnown(wordId, known);
        getLogger().debug(
          { wordId, known },
          `[Tracking] Word progress: wordId=${wordId}, known=${known}`
        );
      },
    },
    {
      channel: IPC_CHANNELS.DATABASE.MARK_WORD_IGNORED,
      schema: [WordIdSchema, BooleanSchema],
      description: 'mark word ignored',
      handler: async (wordId, ignored) => {
        await databaseLayer.markWordIgnored(wordId, ignored);
        getLogger().debug(
          { wordId, ignored },
          `[Tracking] Word progress: wordId=${wordId}, ignored=${ignored}`
        );
      },
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_WORDS_TO_STUDY,
      schema: LimitSchema,
      description: 'get words to study',
      handler: async (limit) => {
        const language = await databaseLayer.getCurrentLanguage();
        return databaseLayer.getWordsToStudy(limit, language);
      },
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_WORD_BY_ID,
      schema: WordIdSchema,
      description: 'get word by ID',
      handler: (wordId) => databaseLayer.getWordById(wordId),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_WORDS_BY_IDS,
      schema: WordIdsSchema,
      description: 'get words by IDs',
      handler: (wordIds) => databaseLayer.getWordsByIds(wordIds),
    },
    {
      channel: IPC_CHANNELS.DATABASE.INSERT_SENTENCE,
      schema: [
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
        TextSchema.optional(),
        TextSchema.optional(),
        TextSchema.optional(),
        z.string().optional(),
      ],
      description: 'insert sentence',
      handler: (
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
        pronunciation,
        contextBeforePronunciation,
        contextAfterPronunciation,
        proficiencyLevel
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
          audioGenerationVoiceId,
          undefined, // tokenizedTokens
          pronunciation,
          contextBeforePronunciation,
          contextAfterPronunciation,
          proficiencyLevel
        ),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_SENTENCES_BY_WORD,
      schema: WordIdSchema,
      description: 'get sentences by word',
      handler: (wordId) => databaseLayer.getSentencesByWord(wordId),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_SENTENCES_BY_IDS,
      schema: SentenceIdsSchema,
      description: 'get sentences by IDs',
      handler: (sentenceIds) => databaseLayer.getSentencesByIds(sentenceIds),
    },
    {
      channel: IPC_CHANNELS.DATABASE.DELETE_SENTENCE,
      schema: SentenceIdSchema,
      description: 'delete sentence',
      handler: (sentenceId) => databaseLayer.deleteSentence(sentenceId),
    },
    {
      channel: IPC_CHANNELS.DATABASE.UPDATE_SENTENCE_LAST_SHOWN,
      schema: SentenceIdSchema,
      description: 'update sentence last shown',
      handler: (sentenceId) => databaseLayer.updateSentenceLastShown(sentenceId),
    },
    {
      channel: IPC_CHANNELS.DATABASE.INCREMENT_SENTENCE_PLAY_COUNT,
      schema: SentenceIdSchema,
      description: 'increment sentence play count',
      handler: (sentenceId) => databaseLayer.incrementSentencePlayCount(sentenceId),
    },
    {
      channel: IPC_CHANNELS.DATABASE.INCREMENT_GRAMMAR_EXPLANATION_COUNT,
      schema: z.number().int().positive(),
      description: 'increment grammar explanation count',
      handler: (wordId) => databaseLayer.incrementGrammarExplanationCount(wordId),
    },
    {
      channel: IPC_CHANNELS.DATABASE.RECORD_PRONUNCIATION_ATTEMPT,
      schema: [
        SentenceIdSchema,
        z.number().min(0).max(1),
        z.string(),
        z.string(),
        z.string().optional().nullable(),
      ],
      description: 'record pronunciation attempt',
      handler: (sentenceId, similarityScore, expectedText, transcribedText, audioPath) => {
        getLogger().debug(
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
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_PRONUNCIATION_HISTORY,
      schema: [SentenceIdSchema, z.number().int().positive().optional()],
      description: 'get pronunciation history',
      handler: (sentenceId, limit) =>
        databaseLayer.getPronunciationHistory(
          sentenceId,
          limit !== undefined ? Math.max(1, Math.floor(limit)) : undefined
        ),
    },
    {
      channel: IPC_CHANNELS.DATABASE.INSERT_DIALOG_CORRECTION,
      schema: [
        z.object({
          sentenceId: SentenceIdSchema,
          sessionId: z.number().int().positive().optional(),
          correctionText: z.string().min(1).max(500),
          language: z.string().min(1),
        }),
      ],
      description: 'insert dialog correction',
      handler: (data) => databaseLayer.insertDialogCorrection(data),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_DIALOG_CORRECTIONS,
      schema: [SentenceIdSchema, z.string().min(1), z.number().int().positive().optional()],
      description: 'get dialog corrections',
      handler: (sentenceId, language, limit) =>
        databaseLayer.getDialogCorrections(
          sentenceId,
          language,
          limit !== undefined ? Math.max(1, Math.floor(limit)) : 3
        ),
    },
    {
      channel: IPC_CHANNELS.DATABASE.UPDATE_SENTENCE_AUDIO_PATH,
      schema: [SentenceIdSchema, AudioPathSchema, z.string().optional()],
      description: 'update sentence audio path',
      handler: (sentenceId, audioPath, audioGenerationVoiceId) =>
        databaseLayer.updateSentenceAudioPath(sentenceId, audioPath, audioGenerationVoiceId),
    },
    {
      channel: IPC_CHANNELS.DATABASE.UPDATE_LAST_STUDIED,
      schema: WordIdSchema,
      description: 'update last studied',
      handler: async (wordId) => {
        await databaseLayer.updateLastStudied(wordId);
        getLogger().debug(
          { wordId },
          `[Tracking] Word progress: wordId=${wordId}, lastStudied=now`
        );
      },
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_STUDY_STATS,
      schema: undefined,
      description: 'get study stats',
      handler: async () => {
        const language = await databaseLayer.getCurrentLanguage();
        return databaseLayer.getStudyStats(language);
      },
    },
    {
      channel: IPC_CHANNELS.DATABASE.RECORD_STUDY_SESSION,
      schema: z.number().int().min(0),
      description: 'record study session',
      handler: (wordsStudied) => databaseLayer.recordStudySession(wordsStudied),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_ALL_WORDS,
      schema: [LanguageSchema, z.boolean().optional(), z.boolean().optional()],
      description: 'get all words',
      handler: async (language, includeKnown, includeIgnored) =>
        databaseLayer.getAllWords(
          language,
          includeKnown !== undefined ? includeKnown : true,
          includeIgnored !== undefined ? includeIgnored : false
        ),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_ALL_WORDS_WITH_SENTENCES,
      schema: LanguageSchema,
      description: 'get all words with sentences',
      handler: (language) => databaseLayer.getAllWordsWithSentences(language),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_WORDS_WITH_SENTENCES,
      schema: [LanguageSchema, z.boolean().optional(), z.boolean().optional()],
      description: 'get words with sentences',
      handler: async (language, includeKnown, includeIgnored) =>
        databaseLayer.getWordsWithSentences(
          language,
          includeKnown !== undefined ? includeKnown : true,
          includeIgnored !== undefined ? includeIgnored : false
        ),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_WORDS_WITH_SENTENCES_ORDERED_BY_STRENGTH,
      schema: [LanguageSchema, z.boolean().optional(), z.boolean().optional()],
      description: 'get words with sentences ordered by strength',
      handler: async (language, includeKnown, includeIgnored) =>
        databaseLayer.getWordsWithSentencesOrderedByStrength(
          language,
          includeKnown !== undefined ? includeKnown : true,
          includeIgnored !== undefined ? includeIgnored : false
        ),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_RECENT_STUDY_SESSIONS,
      schema: LimitSchema.optional(),
      description: 'get recent study sessions',
      handler: (limit) => databaseLayer.getRecentStudySessions(limit !== undefined ? limit : 10),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_SETTING,
      schema: z.string().min(1).max(100),
      description: 'get setting',
      handler: (key) => databaseLayer.getSetting(key),
    },
    {
      channel: IPC_CHANNELS.DATABASE.SET_SETTING,
      schema: [z.string().min(1).max(100), z.string().max(1000)],
      description: 'set setting',
      handler: (key, value) => databaseLayer.setSetting(key, value),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_CURRENT_LANGUAGE,
      schema: undefined,
      description: 'get current language',
      handler: () => databaseLayer.getCurrentLanguage(),
    },
    {
      channel: IPC_CHANNELS.DATABASE.SET_CURRENT_LANGUAGE,
      schema: LanguageSchema,
      description: 'set current language',
      handler: (language) => databaseLayer.setCurrentLanguage(language),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_LANGUAGE_STATS,
      schema: undefined,
      description: 'get language stats',
      handler: () => databaseLayer.getLanguageStats(),
    },
    {
      channel: IPC_CHANNELS.DATABASE.LOOKUP_DICTIONARY,
      schema: [DictionaryWordSchema, LanguageSchema.optional()],
      description: 'lookup dictionary entry',
      handler: async (word, language) => {
        const currentLanguage = language || (await databaseLayer.getCurrentLanguage());
        return databaseLayer.lookupDictionary(word, currentLanguage);
      },
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_NEW_WORD_COUNT,
      schema: LanguageSchema.optional(),
      description: 'get new word count',
      handler: async (language) => {
        const currentLanguage = language || (await databaseLayer.getCurrentLanguage());
        return databaseLayer.getNewWordCount(currentLanguage);
      },
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_AVAILABLE_SENTENCES_COUNT,
      schema: LanguageSchema.optional(),
      description: 'get available sentences count',
      handler: async (language) => {
        const currentLanguage = language || (await databaseLayer.getCurrentLanguage());
        return databaseLayer.getAvailableSentencesCount(currentLanguage);
      },
    },
    {
      channel: IPC_CHANNELS.DATABASE.RESET_LANGUAGE_PROGRESS,
      schema: LanguageSchema,
      description: 'reset language progress',
      handler: (language) => databaseLayer.resetLanguageProgress(language),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_TOPIC_WORD_COUNTS,
      schema: LanguageSchema,
      description: 'get topic word counts',
      handler: (language) => databaseLayer.getTopicWordCounts(language),
    },
    {
      channel: IPC_CHANNELS.DATABASE.GET_READ_ALOUD_CACHE,
      schema: [TextSchema, LanguageSchema],
      description: 'get read aloud cache',
      handler: (text, language) => databaseLayer.getReadAloudCache(text, language),
    },
    {
      channel: IPC_CHANNELS.DATABASE.INSERT_READ_ALOUD_CACHE,
      schema: [TextSchema, LanguageSchema, TextSchema],
      description: 'insert read aloud cache',
      handler: (text, language, audioPath) =>
        databaseLayer.insertReadAloudCache(text, language, audioPath),
    },
  ]);

  getLogger().debug('Read aloud cache handlers registered');
}

function setupLLMHandlers(
  llmClient: LLMClient,
  contentGenerator: ContentGenerator,
  databaseLayer?: SQLiteDatabaseLayer
): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.LLM.GENERATE_WORDS,
      schema: [TopicSchema.optional(), LanguageSchema],
      description: 'generate words',
      handler: async (topic, language) =>
        contentGenerator.generateTopicVocabulary(
          topic && topic.trim() ? topic.trim() : undefined,
          language,
          undefined,
          databaseLayer
        ),
    },
    {
      channel: IPC_CHANNELS.LLM.EXTRACT_ARTICLE_WORDS,
      schema: [z.string().url(), LanguageSchema],
      description: 'extract words from article',
      handler: async (url, language) => {
        const { extractArticleText } = await import('../services/article/article-service.js');
        const { text } = await extractArticleText(url);
        return contentGenerator.extractArticleVocabulary(text, language, undefined, databaseLayer);
      },
    },
    {
      channel: IPC_CHANNELS.LLM.GENERATE_SENTENCES,
      schema: [TextSchema, LanguageSchema, TopicSchema.optional()],
      description: 'generate sentences',
      handler: async (word, language, topic) =>
        contentGenerator.generateWordSentences(
          word,
          language,
          3,
          databaseLayer,
          topic && topic.trim() ? topic.trim() : undefined
        ),
    },
    {
      channel: IPC_CHANNELS.LLM.IS_AVAILABLE,
      schema: undefined,
      description: 'check LLM availability',
      handler: () => llmClient.isAvailable(),
    },
    {
      channel: IPC_CHANNELS.LLM.GET_AVAILABLE_MODELS,
      schema: undefined,
      description: 'get available models',
      handler: () => llmClient.getAvailableModels(),
    },
    {
      channel: IPC_CHANNELS.LLM.SET_MODEL,
      schema: z.string().min(1),
      description: 'set model',
      handler: (model) => {
        llmClient.setModel(model);
      },
    },
    {
      channel: IPC_CHANNELS.LLM.GET_CURRENT_MODEL,
      schema: undefined,
      description: 'get current model',
      handler: () => llmClient.getCurrentModel(),
    },
    {
      channel: IPC_CHANNELS.LLM.SET_WORD_GENERATION_MODEL,
      schema: z.string().min(1),
      description: 'set word generation model',
      handler: (model) => {
        llmClient.setWordGenerationModel(model);
      },
    },
    {
      channel: IPC_CHANNELS.LLM.SET_SENTENCE_GENERATION_MODEL,
      schema: z.string().min(1),
      description: 'set sentence generation model',
      handler: (model) => {
        llmClient.setSentenceGenerationModel(model);
      },
    },
    {
      channel: IPC_CHANNELS.LLM.GET_WORD_GENERATION_MODEL,
      schema: undefined,
      description: 'get word generation model',
      handler: () => llmClient.getWordGenerationModel(),
    },
    {
      channel: IPC_CHANNELS.LLM.GET_SENTENCE_GENERATION_MODEL,
      schema: undefined,
      description: 'get sentence generation model',
      handler: () => llmClient.getSentenceGenerationModel(),
    },
    {
      channel: IPC_CHANNELS.LLM.EXPLAIN_GRAMMAR,
      schema: [
        TextSchema,
        TextSchema,
        LanguageSchema,
        z.string().optional(),
        z.number(),
        z.number(),
      ],
      description: 'explain grammar',
      handler: async (word, sentence, language, proficiencyLevel, wordId, sentenceId) => {
        if (databaseLayer) {
          const cachedExplanation = await databaseLayer.getGrammarExplanation(wordId, sentenceId);
          if (cachedExplanation !== null) {
            return cachedExplanation;
          }
        }
        const explanation = await llmClient.explainGrammar(
          word,
          sentence,
          language,
          proficiencyLevel
        );
        if (databaseLayer) {
          await databaseLayer.insertGrammarExplanation(wordId, sentenceId, explanation);
          await databaseLayer.incrementGrammarExplanationCount(wordId);
        }
        return explanation;
      },
    },
    {
      channel: IPC_CHANNELS.FREQUENCY.GET_PROGRESS,
      schema: LanguageSchema,
      description: 'get frequency progress',
      handler: async (language) => {
        if (!databaseLayer) throw new Error('Database layer not available');
        return contentGenerator.getFrequencyProgress(language, databaseLayer);
      },
    },
    {
      channel: IPC_CHANNELS.FREQUENCY.GET_AVAILABLE_LANGUAGES,
      schema: undefined,
      description: 'get available frequency languages',
      handler: () => contentGenerator.getAvailableFrequencyLanguages(),
    },
    {
      channel: IPC_CHANNELS.FREQUENCY.GET_ASSESSMENT_WORDS,
      schema: [LanguageSchema, z.number().int().positive(), z.number().int().positive()],
      description: 'get sample words for proficiency assessment',
      handler: (language, minPos, maxPos) =>
        contentGenerator.getAssessmentWords(language, minPos, maxPos),
    },
    {
      channel: IPC_CHANNELS.LLM.GET_CURRENT_PROVIDER,
      schema: undefined,
      description: 'get current provider',
      handler: () => contentGenerator.getCurrentProvider(),
    },
    {
      channel: IPC_CHANNELS.LLM.SWITCH_PROVIDER,
      schema: [
        z.enum(['ollama', 'gemini', 'mlx-lm']),
        z.string().min(1).optional(),
        z.string().optional(),
      ],
      description: 'switch provider',
      handler: async (provider, geminiApiKey, mlxLmBaseUrl) => {
        let validatedApiKey = geminiApiKey;
        let validatedBaseUrl = mlxLmBaseUrl;

        if (provider === 'gemini' && !validatedApiKey && databaseLayer) {
          const storedApiKey = await databaseLayer.getSetting('gemini_api_key');
          getLogger().debug(
            { hasApiKey: !!storedApiKey },
            'Retrieved Gemini API key from database'
          );
          validatedApiKey = storedApiKey || undefined;
        }

        if (provider === 'mlx-lm' && !validatedBaseUrl && databaseLayer) {
          const storedBaseUrl = await databaseLayer.getSetting('mlx_lm_base_url');
          validatedBaseUrl = storedBaseUrl || undefined;
        }

        contentGenerator.switchProvider(provider, validatedApiKey, validatedBaseUrl);

        if (databaseLayer) {
          await databaseLayer.setSetting('llm_provider', provider);
        }

        const newClient = contentGenerator.getCurrentClient();
        if (newClient && databaseLayer) {
          newClient.setDatabaseLayer(databaseLayer);
        }

        getLogger().info({ provider }, `Switched to ${provider} provider`);
      },
    },
    {
      channel: IPC_CHANNELS.LLM.SET_GEMINI_API_KEY,
      schema: [z.string().min(1), z.boolean().optional()],
      description: 'set Gemini API key',
      handler: async (apiKey, switchToGemini) => {
        const validatedSwitch = switchToGemini !== undefined ? switchToGemini : false;
        contentGenerator.setGeminiApiKey(apiKey, validatedSwitch);
        if (validatedSwitch) {
          const newClient = contentGenerator.getCurrentClient();
          if (newClient && databaseLayer) {
            newClient.setDatabaseLayer(databaseLayer);
          }
        }
        getLogger().info('Gemini API key set successfully');
      },
    },
    {
      channel: IPC_CHANNELS.LLM.GET_AVAILABLE_PROVIDERS,
      schema: undefined,
      description: 'get available providers',
      handler: () => LLMFactory.getAvailableProviders(),
    },
    {
      channel: IPC_CHANNELS.LLM.GET_MODELS_FOR_PROVIDER,
      schema: z.enum(['ollama', 'gemini', 'mlx-lm']),
      description: 'get models for provider',
      handler: async (provider) => {
        if (provider === 'ollama') {
          return LLMFactory.createOllamaClient().getAvailableModels();
        } else if (provider === 'gemini') {
          let apiKey = '';
          if (databaseLayer) {
            const storedApiKey = await databaseLayer.getSetting('gemini_api_key');
            apiKey = storedApiKey || '';
          }
          return LLMFactory.createGeminiClient(apiKey).getAvailableModels();
        } else if (provider === 'mlx-lm') {
          let baseUrl: string | undefined;
          if (databaseLayer) {
            const stored = await databaseLayer.getSetting('mlx_lm_base_url');
            baseUrl = stored || undefined;
          }
          return LLMFactory.createMlxLmClient(
            baseUrl ? { baseUrl } : undefined
          ).getAvailableModels();
        }
        return [];
      },
    },
  ]);
}

function setupAudioHandlers(audioService: AudioService, databaseLayer?: SQLiteDatabaseLayer): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.AUDIO.GENERATE_AUDIO,
      schema: [
        TextSchema,
        LanguageSchema.optional(),
        TextSchema.optional(),
        z.number().int().optional(),
        z.number().int().positive().optional(),
        z.number().int().optional(),
      ],
      description: 'generate audio',
      handler: async (text, language, word, wordId, sentenceId, variantId) => {
        const validatedLanguage =
          language || (databaseLayer ? await databaseLayer.getCurrentLanguage() : 'spanish');
        return audioService.generateAudio(
          text,
          validatedLanguage,
          word,
          wordId,
          sentenceId,
          variantId
        );
      },
    },
    {
      channel: IPC_CHANNELS.AUDIO.GENERATE_AUDIO_BATCH,
      schema: [
        z.array(
          z.object({
            word: z.string().min(1),
            wordId: z.number().int().positive(),
            language: z.string().min(1),
            voiceId: z.string().optional(),
          })
        ),
      ],
      description: 'generate audio batch',
      handler: (items) => audioService.generateWordAudioBatch(items),
    },
    {
      channel: IPC_CHANNELS.AUDIO.GENERATE_TEXT_AUDIO_RAW,
      schema: [z.array(z.object({ text: z.string().min(1), language: z.string().min(1) }))],
      description: 'generate text audio raw',
      handler: (items) => audioService.generateTextAudioRaw(items),
    },
    {
      channel: IPC_CHANNELS.AUDIO.PLAY_AUDIO,
      schema: AudioPathSchema,
      description: 'play audio',
      handler: async (audioPath) => {
        try {
          return await audioService.playAudio(audioPath);
        } catch (error: unknown) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            (error.code === 'PLAYBACK_STOPPED' || error.code === 'FILE_NOT_FOUND')
          ) {
            return undefined;
          }
          throw error;
        }
      },
    },
    {
      channel: IPC_CHANNELS.AUDIO.STOP_AUDIO,
      schema: undefined,
      description: 'stop audio',
      handler: () => {
        audioService.stopAudio();
      },
    },
    {
      channel: IPC_CHANNELS.AUDIO.AUDIO_EXISTS,
      schema: AudioPathSchema,
      description: 'check audio existence',
      handler: (audioPath) => audioService.audioExists(audioPath),
    },
    {
      channel: IPC_CHANNELS.AUDIO.NORMALIZE_AUDIO_VOLUME,
      schema: [AudioPathSchema, z.number().optional()],
      description: 'normalize audio volume',
      handler: (audioPath, targetDb) =>
        audioService.normalizeAudioVolume(audioPath, targetDb !== undefined ? targetDb : 5),
    },
    {
      channel: IPC_CHANNELS.AUDIO.LOAD_AUDIO_BASE64,
      schema: AudioPathSchema,
      description: 'load audio as base64',
      handler: (audioPath) => audioService.loadAudioBase64(audioPath),
    },
    {
      channel: IPC_CHANNELS.AUDIO.REGENERATE_AUDIO,
      schema: z
        .object({
          text: TextSchema,
          language: LanguageSchema.optional(),
          word: TextSchema.optional(),
          wordId: z.number().int().optional(),
          sentenceId: z.number().int().positive().optional(),
          variantId: z.number().int().optional(),
          existingPath: AudioPathSchema.optional(),
          audioType: z.enum(['before', 'main', 'after']).optional(),
          forceElevenLabs: z.boolean().optional(),
        })
        .optional(),
      description: 'regenerate audio',
      handler: async (payload) => {
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
          validatedPayload.existingPath,
          validatedPayload.forceElevenLabs
        );

        if (validatedPayload.sentenceId && databaseLayer) {
          try {
            if (validatedPayload.audioType === 'before') {
              await databaseLayer.updateBeforeSentenceAudioPath(
                validatedPayload.sentenceId,
                audioPath
              );
            } else if (validatedPayload.audioType === 'after') {
              await databaseLayer.updateAfterSentenceAudioPath(
                validatedPayload.sentenceId,
                audioPath
              );
            } else {
              const voiceId = audioService.getAudioGenerationInfo().voiceId;
              if (voiceId) {
                await databaseLayer.updateSentenceAudioPath(
                  validatedPayload.sentenceId,
                  audioPath,
                  voiceId
                );
              }
            }
          } catch (error) {
            getLogger().warn({ error }, 'Failed to update audio path after regeneration');
          }
        }

        return { audioPath };
      },
    },
    {
      channel: IPC_CHANNELS.AUDIO.START_RECORDING,
      schema: z
        .object({
          sampleRate: z.number().optional(),
          channels: z.number().optional(),
          threshold: z.number().optional(),
          silence: z.string().optional(),
          endOnSilence: z.boolean().optional(),
          device: z.string().optional(),
        })
        .optional(),
      description: 'start recording',
      handler: (options) => audioService.startRecording(options || undefined),
    },
    {
      channel: IPC_CHANNELS.AUDIO.STOP_RECORDING,
      schema: undefined,
      description: 'stop recording',
      handler: () => audioService.stopRecording(),
    },
    {
      channel: IPC_CHANNELS.AUDIO.CANCEL_RECORDING,
      schema: undefined,
      description: 'cancel recording',
      handler: () => audioService.cancelRecording(),
    },
    {
      channel: IPC_CHANNELS.AUDIO.GET_CURRENT_RECORDING_SESSION,
      schema: undefined,
      description: 'get current recording session',
      handler: () => {
        try {
          return audioService.getCurrentRecordingSession();
        } catch {
          return null;
        }
      },
    },
    {
      channel: IPC_CHANNELS.AUDIO.IS_RECORDING,
      schema: undefined,
      description: 'check recording status',
      handler: () => {
        try {
          return audioService.isRecording();
        } catch {
          return false;
        }
      },
    },
    {
      channel: IPC_CHANNELS.AUDIO.GET_AVAILABLE_RECORDING_DEVICES,
      schema: undefined,
      description: 'get available recording devices',
      handler: async () => {
        try {
          return await audioService.getAvailableRecordingDevices();
        } catch {
          return ['default'];
        }
      },
    },
    {
      channel: IPC_CHANNELS.AUDIO.DELETE_RECORDING,
      schema: AudioPathSchema,
      description: 'delete recording',
      handler: (filePath) => audioService.deleteRecording(filePath),
    },
    {
      channel: IPC_CHANNELS.AUDIO.GET_RECORDING_INFO,
      schema: AudioPathSchema,
      description: 'get recording info',
      handler: async (filePath) => {
        try {
          return await audioService.getRecordingInfo(filePath);
        } catch {
          return null;
        }
      },
    },
    {
      channel: IPC_CHANNELS.AUDIO.INITIALIZE_SPEECH_RECOGNITION,
      schema: undefined,
      description: 'initialize speech recognition',
      handler: () => audioService.initializeSpeechRecognition(),
    },
    {
      channel: IPC_CHANNELS.AUDIO.COMPARE_TRANSCRIPTION,
      schema: [TextSchema, TextSchema, z.string().nullable().optional()],
      description: 'compare transcription',
      handler: (transcribed, expected, proficiencyLevel) =>
        audioService.compareTranscription(transcribed, expected, proficiencyLevel),
    },
    {
      channel: IPC_CHANNELS.AUDIO.IS_SPEECH_RECOGNITION_READY,
      schema: undefined,
      description: 'check speech recognition status',
      handler: async () => {
        try {
          return await audioService.isSpeechRecognitionReady();
        } catch {
          return false;
        }
      },
    },
    {
      channel: IPC_CHANNELS.AUDIO.SWITCH_TO_ELEVENLABS,
      schema: z.string().min(1),
      description: 'switch to ElevenLabs',
      handler: (apiKey) => audioService.switchToElevenLabs(apiKey),
    },
    {
      channel: IPC_CHANNELS.AUDIO.SWITCH_TO_SYSTEM_TTS,
      schema: undefined,
      description: 'switch to system TTS',
      handler: () => audioService.switchToSystemTTS(),
    },
    {
      channel: IPC_CHANNELS.AUDIO.GET_VOICE_MAPPINGS,
      schema: undefined,
      description: 'get voice mappings',
      handler: () => audioService.getVoiceMappings(),
    },
    {
      channel: IPC_CHANNELS.AUDIO.SAVE_VOICE_MAPPINGS,
      schema: z.record(z.string(), z.array(z.string().min(1))),
      description: 'save voice mappings',
      handler: async (mappings) => {
        const validatedMappings: Record<string, string[]> = {};
        for (const [lang, voices] of Object.entries(mappings)) {
          validatedMappings[lang] = (voices as string[]).map((v: string) => v.trim());
        }
        await audioService.saveVoiceMappings(validatedMappings);
      },
    },
    {
      channel: IPC_CHANNELS.AUDIO.RESET_VOICE_MAPPINGS_TO_DEFAULTS,
      schema: undefined,
      description: 'reset voice mappings to defaults',
      handler: () => audioService.resetVoiceMappingsToDefaults(),
    },
  ]);

  // TRANSCRIBE_AUDIO needs event for progress callbacks — registered directly
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

      const transcriptionOptions = {
        ...validatedOptions,
        onProgress: (text: string, isFinal: boolean) => {
          event.sender.send(IPC_CHANNELS.AUDIO.TRANSCRIBE_AUDIO_PROGRESS, { text, isFinal });
        },
      };

      return await audioService.transcribeAudio(validatedFilePath, transcriptionOptions);
    } catch (error) {
      getLogger().error({ error }, 'Error transcribing audio');
      throw wrapError(error, `Failed to transcribe audio`);
    }
  });
}

function setupQuizHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.QUIZ.GET_WEAKEST_WORDS,
      schema: LimitSchema,
      description: 'get weakest words',
      handler: async (limit) => {
        const language = await databaseLayer.getCurrentLanguage();
        return databaseLayer.getWeakestWords(limit, language);
      },
    },
    {
      channel: IPC_CHANNELS.QUIZ.GET_RANDOM_SENTENCE_FOR_WORD,
      schema: WordIdSchema,
      description: 'get random sentence for word',
      handler: (wordId) => databaseLayer.getRandomSentenceForWord(wordId),
    },
  ]);
}

function setupSRSHandlers(srsService: SRSService, databaseLayer: SQLiteDatabaseLayer): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.SRS.PROCESS_REVIEW,
      schema: [WordIdSchema, z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])],
      description: 'process review',
      handler: (wordId, recall) => srsService.processReview(wordId, { recall }),
    },
    {
      channel: IPC_CHANNELS.SRS.PROCESS_QUIZ_RESULTS,
      schema: [
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
      description: 'process quiz results',
      handler: (results, language, sessionId) =>
        srsService.processQuizResults(results, language, sessionId),
    },
    {
      channel: IPC_CHANNELS.SRS.GET_TODAYS_STUDY_WORDS,
      schema: [LimitSchema.optional(), LanguageSchema.optional()],
      description: 'get todays study words',
      handler: async (maxWords, language) => {
        const validatedLanguage = language || (await databaseLayer.getCurrentLanguage());
        return srsService.getTodaysStudyWords(validatedLanguage, maxWords);
      },
    },
    {
      channel: IPC_CHANNELS.SRS.GET_DASHBOARD_STATS,
      schema: LanguageSchema.optional(),
      description: 'get dashboard stats',
      handler: async (language) => {
        const validatedLanguage = language || (await databaseLayer.getCurrentLanguage());
        return srsService.getDashboardStats(validatedLanguage);
      },
    },
    {
      channel: IPC_CHANNELS.SRS.MARK_WORD_DIFFICULTY,
      schema: [WordIdSchema, z.enum(['easy', 'hard'])],
      description: 'mark word difficulty',
      handler: (wordId, difficulty) => srsService.markWordDifficulty(wordId, difficulty),
    },
    {
      channel: IPC_CHANNELS.SRS.RESET_WORD_PROGRESS,
      schema: WordIdSchema,
      description: 'reset word progress',
      handler: (wordId) => srsService.resetWordProgress(wordId),
    },
    {
      channel: IPC_CHANNELS.SRS.GET_OVERDUE_WORDS,
      schema: LanguageSchema.optional(),
      description: 'get overdue words',
      handler: async (language) => {
        const validatedLanguage = language || (await databaseLayer.getCurrentLanguage());
        return srsService.getOverdueWords(validatedLanguage);
      },
    },
    {
      channel: IPC_CHANNELS.SRS.INITIALIZE_EXISTING_WORDS,
      schema: LanguageSchema.optional(),
      description: 'initialize existing words',
      handler: async (language) => {
        const validatedLanguage = language || (await databaseLayer.getCurrentLanguage());
        return srsService.initializeExistingWords(validatedLanguage);
      },
    },
  ]);
}

function setupJobHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  const EnqueueOptionsSchema = z
    .object({
      topic: TopicSchema.optional(),
      language: LanguageSchema.optional(),
      desiredSentenceCount: z.number().int().min(1).max(10).optional(),
    })
    .optional();

  registerHandlers([
    {
      channel: IPC_CHANNELS.JOBS.ENQUEUE_WORD_GENERATION,
      schema: [WordIdSchema, EnqueueOptionsSchema],
      description: 'enqueue word generation',
      handler: async (wordId, options) => {
        let language = options?.language;
        if (!language) {
          const word = await databaseLayer.getWordById(wordId);
          if (!word) throw new Error(`Word with ID ${wordId} not found`);
          language = word.language;
        }
        await databaseLayer.enqueueWordGeneration(
          wordId,
          language,
          options?.topic,
          options?.desiredSentenceCount ?? 3
        );
      },
    },
    {
      channel: IPC_CHANNELS.JOBS.GET_WORD_STATUS,
      schema: WordIdSchema,
      description: 'get word status',
      handler: (wordId) => databaseLayer.getWordProcessingInfo(wordId),
    },
    {
      channel: IPC_CHANNELS.JOBS.GET_QUEUE_SUMMARY,
      schema: LanguageSchema.optional(),
      description: 'get queue summary',
      handler: (language) => databaseLayer.getWordGenerationQueueSummary(language || undefined),
    },
  ]);
}

function setupLifecycleHandlers(
  lifecycleManager: LifecycleManager,
  updateManager: UpdateManager,
  audioService?: AudioService,
  wordGenerationRunner?: WordGenerationRunner
): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.LIFECYCLE.CREATE_BACKUP,
      schema: undefined,
      description: 'create backup',
      handler: () => lifecycleManager.createBackup(),
    },
    {
      channel: IPC_CHANNELS.LIFECYCLE.RESTORE_FROM_BACKUP,
      schema: z.string().min(1),
      description: 'restore from backup',
      handler: (backupPath) => lifecycleManager.restoreFromBackup(backupPath),
    },
    {
      channel: IPC_CHANNELS.LIFECYCLE.CHECK_FOR_UPDATES,
      schema: undefined,
      description: 'check for updates',
      handler: async () => {
        try {
          const updateInfo = await updateManager.checkForUpdates(true);
          return updateInfo !== null;
        } catch {
          return false;
        }
      },
    },
    {
      channel: IPC_CHANNELS.LIFECYCLE.GET_APP_VERSION,
      schema: undefined,
      description: 'get app version',
      handler: () => app.getVersion(),
    },
    {
      channel: IPC_CHANNELS.LIFECYCLE.RESTART_ALL,
      schema: z.string().min(1),
      description: 'restart language',
      handler: (language: string) => lifecycleManager.restartLanguage(language),
    },
    {
      channel: IPC_CHANNELS.LIFECYCLE.OPEN_BACKUP_DIALOG,
      schema: undefined,
      description: 'open backup dialog',
      handler: async () => {
        const result = await dialog.showOpenDialog({
          title: 'Select Backup Directory',
          properties: ['openDirectory'],
          message: 'Select a backup directory to restore from',
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
      },
    },
    {
      channel: IPC_CHANNELS.LIFECYCLE.OPEN_BACKUP_DIRECTORY,
      schema: undefined,
      description: 'open backup directory',
      handler: () => lifecycleManager.openBackupDirectory(),
    },
    {
      channel: IPC_CHANNELS.LIFECYCLE.CLOSE_APP,
      schema: undefined,
      description: 'close app',
      handler: async () => {
        getLogger().info('Close app requested via IPC');

        if (wordGenerationRunner) {
          await wordGenerationRunner.stop();
        }

        if (audioService) {
          audioService.stopAudio();
          try {
            const isRecording = await audioService.isRecording();
            if (isRecording) {
              await audioService.stopRecording();
            }
          } catch (error) {
            getLogger().warn({ error }, 'Error stopping recording during app close');
          }
        }

        updateManager.cleanup();
        cleanupIPCHandlers();
        await lifecycleManager.handleShutdown();
        app.quit();
      },
    },
  ]);
}

/**
 * Clean up IPC handlers (call this on app shutdown)
 */
export function cleanupIPCHandlers(): void {
  Object.values(IPC_CHANNELS.DATABASE).forEach((channel) => ipcMain.removeAllListeners(channel));
  Object.values(IPC_CHANNELS.LLM).forEach((channel) => ipcMain.removeAllListeners(channel));
  Object.values(IPC_CHANNELS.AUDIO).forEach((channel) => ipcMain.removeAllListeners(channel));
  Object.values(IPC_CHANNELS.QUIZ).forEach((channel) => ipcMain.removeAllListeners(channel));
  Object.values(IPC_CHANNELS.LIFECYCLE).forEach((channel) => ipcMain.removeAllListeners(channel));
  Object.values(IPC_CHANNELS.FREQUENCY).forEach((channel) => ipcMain.removeAllListeners(channel));
  Object.values(IPC_CHANNELS.SRS).forEach((channel) => ipcMain.removeAllListeners(channel));
  Object.values(IPC_CHANNELS.JOBS).forEach((channel) => ipcMain.removeAllListeners(channel));
  Object.values(IPC_CHANNELS.LEMMATIZATION).forEach((channel) =>
    ipcMain.removeAllListeners(channel)
  );
  Object.values(IPC_CHANNELS.DIALOG).forEach((channel) => ipcMain.removeAllListeners(channel));
  Object.values(IPC_CHANNELS.FLOW).forEach((channel) => ipcMain.removeAllListeners(channel));
  Object.values(IPC_CHANNELS.EXPORT).forEach((channel) => ipcMain.removeAllListeners(channel));

  getLogger().info('IPC handlers cleaned up');
}

function setupLemmatizationHandlers(lemmatizationService: LemmatizationService): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.LEMMATIZATION.GET_STATUS,
      schema: undefined,
      description: 'get lemmatization status',
      handler: () => lemmatizationService.getStatus(),
    },
    {
      channel: IPC_CHANNELS.LEMMATIZATION.LOAD_MODEL,
      schema: LanguageSchema,
      description: 'load lemmatization model',
      handler: (language) => lemmatizationService.loadModel(language),
    },
    {
      channel: IPC_CHANNELS.LEMMATIZATION.LEMMATIZE_WORDS,
      schema: [z.array(z.string().min(1).max(200)), LanguageSchema],
      description: 'lemmatize words',
      handler: (words, language) => lemmatizationService.lemmatizeWords(words, language),
    },
    {
      channel: IPC_CHANNELS.LEMMATIZATION.GET_WORD_FREQUENCIES,
      schema: [z.array(z.string().min(1).max(200)), LanguageSchema],
      description: 'get word frequencies',
      handler: (words, language) => lemmatizationService.getWordFrequencies(words, language),
    },
  ]);
}

function setupJapaneseTokenizationHandlers(): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.JAPANESE_TOKENIZATION.TOKENIZE,
      schema: TextSchema,
      description: 'tokenize Japanese sentence',
      handler: (sentence) => tokenizeJapanese(sentence),
    },
    {
      channel: IPC_CHANNELS.JAPANESE_TOKENIZATION.GET_WORD_READINGS,
      schema: z.array(z.string()),
      description: 'get Japanese word readings',
      handler: (words) => getWordReadings(words),
    },
  ]);
}

function setupDialogHandlers(
  databaseLayer: SQLiteDatabaseLayer,
  llmClient: LLMClient,
  audioService: AudioService
): void {
  const dialogService = new DialogService(databaseLayer, llmClient);
  const ExcludeIdsSchema = z.array(z.number().int().nonnegative()).optional();

  registerHandlers([
    {
      channel: IPC_CHANNELS.DIALOG.SELECT_SENTENCE,
      schema: ExcludeIdsSchema,
      description: 'select sentence for dialog',
      handler: async (excludeIds) => {
        const language = await databaseLayer.getCurrentLanguage();
        return dialogService.selectSentence(language, excludeIds);
      },
    },
    {
      channel: IPC_CHANNELS.DIALOG.SELECT_SENTENCE_WITH_TOPIC,
      schema: ExcludeIdsSchema,
      description: 'select sentence with topic for dialog',
      handler: async (excludeIds) => {
        const language = await databaseLayer.getCurrentLanguage();
        return dialogService.selectSentenceWithTopic(language, excludeIds);
      },
    },
    {
      channel: IPC_CHANNELS.DIALOG.GENERATE_VARIANTS,
      schema: SentenceIdSchema,
      description: 'generate dialogue variants',
      handler: async (sentenceId) => {
        const sentence = await databaseLayer.getSentenceById(sentenceId);
        if (!sentence) throw new Error(`Sentence with ID ${sentenceId} not found`);

        const existingVariants = await databaseLayer.getDialogueVariantsBySentenceId(sentenceId);

        const language = await databaseLayer.getCurrentLanguage();
        const allWords = await databaseLayer.getAllWords(language, true, false);
        const dialogServiceConfig = dialogService as any;
        const minWordStrength = dialogServiceConfig.config?.minWordStrength ?? 40;
        const maxKnownWords = dialogServiceConfig.config?.maxKnownWordsForVariants ?? 50;
        const knownWords = allWords
          .filter((w) => w.known || (w.strength ?? 0) >= minWordStrength)
          .slice(0, maxKnownWords)
          .map((w) => w.word);

        const variants = await dialogService.generateDialogueVariants(
          sentence,
          existingVariants,
          knownWords,
          language
        );

        return Promise.all(
          variants.map(async (variant) => {
            try {
              const audioPath = await audioService.generateAudio(
                variant.variantSentence,
                language,
                '_variant_sentence',
                undefined,
                undefined,
                variant.id
              );
              await databaseLayer.updateDialogueVariantSentenceAudio(variant.id, audioPath);
              return { ...variant, variantSentenceAudio: audioPath };
            } catch (audioError) {
              getLogger().warn(
                { error: audioError, variantId: variant.id },
                '[IPC] Failed to generate variant sentence audio'
              );
              return variant;
            }
          })
        );
      },
    },
    {
      channel: IPC_CHANNELS.DIALOG.ANALYZE_TRANSCRIPTION,
      schema: [TextSchema, LanguageSchema, TextSchema, z.string().optional()],
      description: 'analyze transcription for corrections and grammar',
      handler: (transcription, language, assistantSentence, topic) =>
        llmClient.analyzeTranscription(transcription, language, assistantSentence, topic),
    },
    {
      channel: IPC_CHANNELS.DIALOG.GENERATE_FOLLOW_UP,
      schema: [VariantIdSchema, ConversationHistorySchema.optional()],
      description: 'generate follow-up',
      handler: async (variantId, conversationHistory) => {
        const language = await databaseLayer.getCurrentLanguage();
        const followUp = await dialogService.generateFollowUp(
          variantId,
          language,
          conversationHistory
        );

        let continuationAudio: string | undefined;
        if (followUp.text && followUp.text.trim().length > 0 && variantId > 0) {
          try {
            const variant = await databaseLayer.getDialogueVariantById(variantId);
            const shouldUseCachedAudio =
              variant && variant.continuationAudio && variant.continuationText === followUp.text;

            if (shouldUseCachedAudio) {
              continuationAudio = variant.continuationAudio;
            } else {
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
                await databaseLayer.updateDialogueVariantContinuation(
                  variantId,
                  followUp.text,
                  followUp.translation,
                  audioPath
                );
                getLogger().debug({ audioPath }, '[IPC] Generated and cached continuation audio');
              }
            }
          } catch (audioError) {
            getLogger().error({ error: audioError }, '[IPC] Failed to generate continuation audio');
          }
        } else if (followUp.text && followUp.text.trim().length > 0 && variantId < 0) {
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
              getLogger().debug(
                { audioPath },
                '[IPC] Generated continuation audio for pseudo-variant (not cached in DB)'
              );
            }
          } catch (audioError) {
            getLogger().error(
              { error: audioError },
              '[IPC] Failed to generate continuation audio for pseudo-variant'
            );
          }
        }

        return {
          text: followUp.text,
          translation: followUp.translation,
          audio: continuationAudio,
          pronunciation: followUp.pronunciation,
        };
      },
    },
    {
      channel: IPC_CHANNELS.DIALOG.PREGENERATE_SESSION,
      schema: undefined,
      description: 'pregenerate dialog session',
      handler: async () => {
        try {
          const language = await databaseLayer.getCurrentLanguage();
          const sessions = await dialogService.pregenerateSessions(1, language);
          if (sessions.length === 0) return null;

          const session = sessions[0];
          let beforeSentenceAudio: string | undefined;
          let afterSentenceAudio: string | undefined;

          if (session.sentenceId) {
            try {
              const sentence = await databaseLayer.getSentenceById(session.sentenceId);
              if (!sentence) throw new Error(`Sentence with ID ${session.sentenceId} not found`);
              const lang = await databaseLayer.getCurrentLanguage();

              if (session.contextBefore) {
                const audioPath = await audioService.generateAudio(
                  session.contextBefore,
                  lang,
                  '_before_sentence',
                  sentence.wordId,
                  session.sentenceId
                );
                if (audioPath && (await audioService.audioExists(audioPath))) {
                  beforeSentenceAudio = audioPath;
                  try {
                    await databaseLayer.updateBeforeSentenceAudioPath(
                      session.sentenceId,
                      audioPath
                    );
                  } catch (dbError) {
                    getLogger().warn(
                      { error: dbError },
                      '[IPC] Failed to save beforeSentence audio path to database'
                    );
                  }
                }
              }

              if (session.contextAfter) {
                const audioPath = await audioService.generateAudio(
                  session.contextAfter,
                  lang,
                  '_after_sentence',
                  sentence.wordId,
                  session.sentenceId
                );
                if (audioPath && (await audioService.audioExists(audioPath))) {
                  afterSentenceAudio = audioPath;
                  try {
                    await databaseLayer.updateAfterSentenceAudioPath(session.sentenceId, audioPath);
                  } catch (dbError) {
                    getLogger().warn(
                      { error: dbError },
                      '[IPC] Failed to save afterSentence audio path to database'
                    );
                  }
                }
              }
            } catch (error) {
              getLogger().warn(
                { error },
                '[IPC] Failed to generate context sentences audio during pre-generation'
              );
            }
          }

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
          getLogger().error({ error }, 'Error pre-generating dialog session');
          return null;
        }
      },
    },
    {
      channel: IPC_CHANNELS.DIALOG.PREGENERATE_SESSIONS,
      schema: z.number().int().min(1).max(100),
      description: 'pregenerate dialog sessions',
      handler: async (count) => {
        try {
          const language = await databaseLayer.getCurrentLanguage();
          const sessions = await dialogService.pregenerateSessions(count, language);
          if (sessions.length === 0) return [];

          return Promise.all(
            sessions.map(async (session) => {
              let beforeSentenceAudio: string | undefined;
              let afterSentenceAudio: string | undefined;

              if (session.sentenceId) {
                try {
                  const sentence = await databaseLayer.getSentenceById(session.sentenceId);
                  if (!sentence)
                    throw new Error(`Sentence with ID ${session.sentenceId} not found`);

                  if (session.contextBefore) {
                    const audioPath = await audioService.generateAudio(
                      session.contextBefore,
                      language,
                      '_before_sentence',
                      sentence.wordId,
                      session.sentenceId
                    );
                    if (audioPath && (await audioService.audioExists(audioPath))) {
                      beforeSentenceAudio = audioPath;
                      try {
                        await databaseLayer.updateBeforeSentenceAudioPath(
                          session.sentenceId,
                          audioPath
                        );
                      } catch (dbError) {
                        getLogger().warn(
                          { error: dbError, sentenceId: session.sentenceId },
                          `[IPC] Failed to save beforeSentence audio path to database for session ${session.sentenceId}`
                        );
                      }
                    }
                  }

                  if (session.contextAfter) {
                    const audioPath = await audioService.generateAudio(
                      session.contextAfter,
                      language,
                      '_after_sentence',
                      sentence.wordId,
                      session.sentenceId
                    );
                    if (audioPath && (await audioService.audioExists(audioPath))) {
                      afterSentenceAudio = audioPath;
                      try {
                        await databaseLayer.updateAfterSentenceAudioPath(
                          session.sentenceId,
                          audioPath
                        );
                      } catch (dbError) {
                        getLogger().warn(
                          { error: dbError, sentenceId: session.sentenceId },
                          `[IPC] Failed to save afterSentence audio path to database for session ${session.sentenceId}`
                        );
                      }
                    }
                  }
                } catch (error) {
                  getLogger().warn(
                    { error, sentenceId: session.sentenceId },
                    `[IPC] Failed to generate context sentences audio for session ${session.sentenceId}`
                  );
                }
              }

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
        } catch (error) {
          getLogger().error({ error }, 'Error pre-generating dialog sessions');
          return [];
        }
      },
    },
  ]);
}

function setupFlowHandlers(databaseLayer: SQLiteDatabaseLayer, audioService: AudioService): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.FLOW.GET_FLOW_SENTENCES,
      schema: LanguageSchema.optional(),
      description: 'get flow sentences',
      handler: async (language) => {
        const validatedLanguage = language || (await databaseLayer.getCurrentLanguage());
        const flowSentences = await databaseLayer.getFlowSentences(validatedLanguage);

        const result = await Promise.all(
          flowSentences.map(async (item) => {
            const mainAudioExists = await audioService.audioExists(item.audioPath);
            if (!mainAudioExists) return null;

            let englishAudioPath: string | undefined;
            if (item.englishAudioPath && (await audioService.audioExists(item.englishAudioPath))) {
              englishAudioPath = item.englishAudioPath;
            }

            let beforeSentenceAudio: string | undefined;
            if (
              item.beforeSentenceAudio &&
              (await audioService.audioExists(item.beforeSentenceAudio))
            ) {
              beforeSentenceAudio = item.beforeSentenceAudio;
            }

            let afterSentenceAudio: string | undefined;
            if (
              item.afterSentenceAudio &&
              (await audioService.audioExists(item.afterSentenceAudio))
            ) {
              afterSentenceAudio = item.afterSentenceAudio;
            }

            const existingContinuationAudios: string[] = [];
            for (const audioPath of item.continuationAudios) {
              if (await audioService.audioExists(audioPath)) {
                existingContinuationAudios.push(audioPath);
              }
            }

            const existingVariantSentenceAudios: string[] = [];
            for (const audioPath of item.variantSentenceAudios) {
              if (await audioService.audioExists(audioPath)) {
                existingVariantSentenceAudios.push(audioPath);
              }
            }

            return {
              audioPath: item.audioPath,
              englishAudioPath,
              beforeSentenceAudio,
              afterSentenceAudio,
              continuationAudios: existingContinuationAudios,
              variantSentenceAudios: existingVariantSentenceAudios,
            };
          })
        );

        return result.filter((item): item is NonNullable<typeof item> => item !== null);
      },
    },
    {
      channel: IPC_CHANNELS.FLOW.STITCH_AUDIO,
      schema: [z.array(z.string().min(1).max(500)), LanguageSchema],
      description: 'stitch audio',
      handler: async (audioPaths, language) => {
        const stitchedPath = await audioService.stitchAudio(audioPaths, language);
        if (!stitchedPath) throw new Error('Failed to stitch audio files');
        return stitchedPath;
      },
    },
    {
      channel: IPC_CHANNELS.FLOW.STITCH_AUDIO_WITH_ENGLISH,
      schema: [
        z.array(z.tuple([z.string().min(1).max(500), z.string().min(1).max(500)])),
        LanguageSchema,
      ],
      description: 'stitch audio with English pattern',
      handler: (audioPathPairs, language) =>
        audioService.stitchAudioWithEnglish(audioPathPairs, language),
    },
    {
      channel: IPC_CHANNELS.FLOW.GET_FILE_STATS,
      schema: z.string().min(1).max(500),
      description: 'get file stats',
      handler: async (filePath) => {
        try {
          const absolutePath = AudioService.resolveAudioPath(filePath);
          const { stat } = require('fs').promises;
          const stats = await stat(absolutePath);
          return { mtime: stats.mtime };
        } catch {
          return null;
        }
      },
    },
    {
      channel: IPC_CHANNELS.FLOW.EXPORT_FLOW_MP3,
      schema: LanguageSchema,
      description: 'export bilingual flow mp3',
      handler: async (language) => {
        const flowSentences = await databaseLayer.getFlowSentences(language);
        const audioPathPairs: Array<[string, string]> = [];

        for (const item of flowSentences) {
          if (!item.audioPath || !(await audioService.audioExists(item.audioPath))) continue;
          if (item.englishAudioPath && (await audioService.audioExists(item.englishAudioPath))) {
            audioPathPairs.push([item.englishAudioPath, item.audioPath]);
          }
        }

        if (audioPathPairs.length === 0) {
          throw new Error(
            'No bilingual audio available. Generate sentences with English audio first.'
          );
        }

        // Delete cached file to force fresh generation
        const audioDir = join(app.getPath('userData'), 'audio');
        const cachedPath = join(audioDir, `flow_stitched_english_${language}.mp3`);
        try {
          await fsPromises.unlink(cachedPath);
        } catch {
          // File doesn't exist yet, that's fine
        }

        const relativePath = await audioService.stitchAudioWithEnglish(audioPathPairs, language);
        if (!relativePath) {
          throw new Error('Failed to generate bilingual flow audio. Ensure ffmpeg is installed.');
        }

        const absolutePath = AudioService.resolveAudioPath(relativePath);

        const saveResult = await dialog.showSaveDialog({
          title: 'Export Flow MP3',
          defaultPath: join(app.getPath('documents'), `flow-${language}.mp3`),
          filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }],
        });

        if (saveResult.canceled || !saveResult.filePath) {
          return { canceled: true, filePath: null };
        }

        await fsPromises.copyFile(absolutePath, saveResult.filePath);
        return { canceled: false, filePath: saveResult.filePath };
      },
    },
  ]);
}

function setupTrackingHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.TRACKING.CREATE_SESSION,
      schema: [z.enum(['learning', 'quiz', 'dialog', 'flow']), LanguageSchema],
      description: 'create learning session',
      handler: async (mode, language) => {
        const sessionId = await databaseLayer.createLearningSession({ mode, language });
        getLogger().debug(
          { sessionId, mode, language },
          `[Tracking] Learning session created: id=${sessionId}, mode=${mode}, language=${language}`
        );
        return sessionId;
      },
    },
    {
      channel: IPC_CHANNELS.TRACKING.UPDATE_SESSION,
      schema: [
        z.number().int().positive(),
        z.object({
          wordCount: z.number().int().nonnegative().optional(),
          sentenceCount: z.number().int().nonnegative().optional(),
          audioPlayedCount: z.number().int().nonnegative().optional(),
        }),
      ],
      description: 'update learning session',
      handler: async (sessionId, data) => {
        await databaseLayer.updateLearningSession(sessionId, data);
        const counts = [
          data.wordCount !== undefined ? `words=${data.wordCount}` : null,
          data.sentenceCount !== undefined ? `sentences=${data.sentenceCount}` : null,
          data.audioPlayedCount !== undefined ? `audio=${data.audioPlayedCount}` : null,
        ]
          .filter(Boolean)
          .join(', ');
        getLogger().debug(
          { sessionId, counts },
          `[Tracking] Learning session updated: id=${sessionId}${counts ? ', ' + counts : ''}`
        );
      },
    },
    {
      channel: IPC_CHANNELS.TRACKING.RECORD_AUDIO_PLAYBACK,
      schema: z.object({
        sessionId: z.number().int().positive().optional(),
        sentenceId: z.number().int().positive().optional(),
        audioPath: AudioPathSchema,
        language: LanguageSchema,
        mode: z.enum(['learning', 'quiz', 'dialog', 'flow']),
        playbackSpeed: z.number().min(0.1).max(3.0).optional(),
      }),
      description: 'record audio playback',
      handler: async (data) => {
        const id = await databaseLayer.recordAudioPlayback(data);
        getLogger().debug(
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
    },
    {
      channel: IPC_CHANNELS.TRACKING.RECORD_NEGLECTED_WORDS,
      schema: z.array(
        z.object({
          word: z.string().min(1),
          language: LanguageSchema,
          topic: z.string().optional(),
          translation: z.string().optional(),
          sessionId: z.number().int().positive().optional(),
          frequencyPosition: z.number().int().nonnegative().optional(),
        })
      ),
      description: 'record neglected words',
      handler: async (data) => {
        const count = await databaseLayer.recordNeglectedWords(data);
        if (count > 0) {
          getLogger().debug(
            { count, language: data[0]?.language || 'unknown', topic: data[0]?.topic || 'none' },
            `[Tracking] Neglected words (batch): count=${count}, language=${data[0]?.language || 'unknown'}, topic=${data[0]?.topic || 'none'}`
          );
        }
        return count;
      },
    },
    {
      channel: IPC_CHANNELS.TRACKING.RECORD_DICTIONARY_HOVER,
      schema: z.object({
        word: z.string().min(1),
        language: LanguageSchema,
        sentenceId: z.number().int().positive().optional(),
        sessionId: z.number().int().positive().optional(),
        hoverDurationMs: z.number().int().positive().min(1000),
        dictionaryKey: z.string().optional(),
        foundInDict: z.boolean(),
      }),
      description: 'record dictionary hover',
      handler: async (data) => {
        const id = await databaseLayer.recordDictionaryHover(data);
        getLogger().debug(
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
    },
  ]);
}

function setupLogHandlers(): void {
  const logger = getLogger();
  registerHandlers([
    {
      channel: IPC_CHANNELS.LOG.LOG,
      schema: [
        z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
        z.string(),
        z.any().optional(),
      ],
      description: 'log from renderer',
      handler: (
        level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
        message: string,
        data?: any
      ) => {
        try {
          if (data) {
            (logger as any)[level]({ ...data, process: 'renderer' }, message);
          } else {
            (logger as any)[level]({ process: 'renderer' }, message);
          }
        } catch (error) {
          getLogger().error({ error }, 'Error logging from renderer');
        }
      },
    },
  ]);
}

function setupTopicsHandlers(): void {
  let cachedTopics: string[] | null = null;

  async function loadTopicsFromFile(): Promise<string[]> {
    if (cachedTopics !== null) return cachedTopics;
    try {
      const topicsPath = join(process.cwd(), 'topics.txt');
      const content = await fsPromises.readFile(topicsPath, 'utf-8');
      cachedTopics = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return cachedTopics;
    } catch (error) {
      getLogger().error({ error }, '[Topics] Error loading topics from file');
      cachedTopics = [];
      return [];
    }
  }

  registerHandlers([
    {
      channel: IPC_CHANNELS.TOPICS.GET_TOPICS,
      schema: [],
      description: 'get topics',
      handler: () => loadTopicsFromFile(),
    },
  ]);
}

function setupExportHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.EXPORT.EXPORT_ANKI,
      schema: z.string().min(2).max(20),
      description: 'export language to Anki',
      handler: async (language: string) => {
        const result = await exportLanguageToApkg(databaseLayer, language);

        if (result.cardCount === 0) {
          return { canceled: false, filePath: null, cardCount: 0, mediaCount: 0 };
        }

        const saveResult = await dialog.showSaveDialog({
          title: 'Export to Anki',
          defaultPath: `kotoba-${language}.apkg`,
          filters: [{ name: 'Anki Deck', extensions: ['apkg'] }],
        });

        if (saveResult.canceled || !saveResult.filePath) {
          return { canceled: true, filePath: null, cardCount: 0, mediaCount: 0 };
        }

        await fsPromises.writeFile(saveResult.filePath, result.data);

        return {
          canceled: false,
          filePath: saveResult.filePath,
          cardCount: result.cardCount,
          mediaCount: result.mediaCount,
        };
      },
    },
  ]);
}

/**
 * Set up Scoring-related IPC handlers
 */
export function setupScoringHandlers(
  scoringService: import('../scoring/scoring-service.js').ScoringService
): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.SCORING.GET_NEXT_MODE,
      schema: z.object({
        currentMode: z.enum(['topic-selection', 'learning', 'quiz', 'dialog', 'flow']).nullable(),
        language: z.string().min(1).max(50).nullable(),
        initialTakeover: z.boolean(),
      }),
      description: 'get next mode',
      handler: async (options) => {
        return scoringService.getNextMode({
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
      },
    },
  ]);

  getLogger().info(
    { channel: IPC_CHANNELS.SCORING.GET_NEXT_MODE },
    'Scoring IPC handler registered'
  );
}

/**
 * Set up Proficiency-related IPC handlers
 */
export function setupProficiencyHandlers(
  proficiencyService: import('../scoring/proficiency-service.js').ProficiencyService
): void {
  registerHandlers([
    {
      channel: IPC_CHANNELS.SCORING.GET_LANGUAGE_PROFICIENCY,
      schema: [z.string().min(1).max(50).nullable(), z.number().int().min(1).max(365).optional()],
      description: 'get language proficiency',
      handler: async (language, timeWindowDays) =>
        proficiencyService.calculateLanguageProficiency(language || '', timeWindowDays),
    },
  ]);

  getLogger().info(
    { channel: IPC_CHANNELS.SCORING.GET_LANGUAGE_PROFICIENCY },
    'Proficiency IPC handler registered'
  );
}
