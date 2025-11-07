/**
 * IPC handlers for secure communication between main and renderer processes
 */

import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/types/ipc.js';
import { SQLiteDatabaseLayer } from '../database/database-layer.js';
import { LLMClient, ContentGenerator, LLMFactory, LLMProvider } from '../llm/index.js';
import { AudioService } from '../audio/audio-service.js';
import { LifecycleManager, UpdateManager } from '../lifecycle/index.js';
import { SRSService } from '../srs/srs-service.js';
import { WordGenerationRunner } from '../jobs/word-generation-runner.js';
import { CreateWordRequest } from '../../shared/types/core.js';
import { LemmatizationService } from '../lemmatization/index.js';
import { DialogService } from '../dialog/index.js';
import { existsSync, mkdirSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { dirname, join } from 'path';
import { createIPCHandler } from './ipc-handler-helper.js';
import { getErrorMessage, wrapError } from '../../shared/utils/error.js';

// Validation schemas for input sanitization
const CreateWordSchema = z.object({
  word: z.string().min(1).max(100),
  translation: z.string().min(1).max(200),
  language: z.string().min(2).max(10),
  audioPath: z.string().optional()
});

const WordIdSchema = z.number().int().positive();
const WordIdsSchema = z.array(z.number().int().positive());
const SentenceIdSchema = z.number().int().positive();
const SentenceIdsSchema = z.array(z.number().int().positive());
const VariantIdSchema = z.number().int().refine((val) => val !== 0, {
  message: "Variant ID must be non-zero"
}); // Allows positive and negative integers (for pseudo-variants with negative IDs)
const StrengthSchema = z.number().int().min(0);
const BooleanSchema = z.boolean();
const LimitSchema = z.number().int().positive().max(1000);
const LanguageSchema = z.string().min(2).max(10);
const TextSchema = z.string().min(1).max(1000);
const TopicSchema = z.string().min(1).max(200);
const AudioPathSchema = z.string().min(1).max(500);
const DictionaryWordSchema = z.string().min(1).max(100);

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
  setupSRSHandlers(srsService);

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
  setupDialogHandlers(databaseLayer, llmClient, contentGenerator, audioService);

  // Flow handlers
  setupFlowHandlers(databaseLayer, audioService);

  // Log handlers
  setupLogHandlers();

  // Tracking handlers
  setupTrackingHandlers(databaseLayer);

  // Scoring handlers (if scoringService is provided, will be added in main.ts)
  // setupScoringHandlers is called separately after scoring service initialization

  const { getLogger } = require('../utils/logger.js');
  const logger = getLogger();
  logger.info('IPC handlers registered successfully');
}

/**
 * Set up database-related IPC handlers
 */
function setupDatabaseHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  ipcMain.handle(
    IPC_CHANNELS.DATABASE.INSERT_WORD,
    createIPCHandler(CreateWordSchema, (wordData) => databaseLayer.insertWord(wordData), 'insert word')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.UPDATE_WORD_STRENGTH,
    createIPCHandler([WordIdSchema, StrengthSchema], async (wordId, strength) => {
      await databaseLayer.updateWordStrength(wordId, strength);
      console.log(`[Tracking] Word progress: wordId=${wordId}, strength=${strength}`);
    }, 'update word strength')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.MARK_WORD_KNOWN,
    createIPCHandler([WordIdSchema, BooleanSchema], async (wordId, known) => {
      await databaseLayer.markWordKnown(wordId, known);
      console.log(`[Tracking] Word progress: wordId=${wordId}, known=${known}`);
    }, 'mark word known')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.MARK_WORD_IGNORED,
    createIPCHandler([WordIdSchema, BooleanSchema], async (wordId, ignored) => {
      await databaseLayer.markWordIgnored(wordId, ignored);
      console.log(`[Tracking] Word progress: wordId=${wordId}, ignored=${ignored}`);
    }, 'mark word ignored')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_WORDS_TO_STUDY,
    createIPCHandler(LimitSchema, (limit) => databaseLayer.getWordsToStudy(limit), 'get words to study')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_WORD_BY_ID,
    createIPCHandler(WordIdSchema, (wordId) => databaseLayer.getWordById(wordId), 'get word by ID')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_WORDS_BY_IDS,
    createIPCHandler(WordIdsSchema, (wordIds) => databaseLayer.getWordsByIds(wordIds), 'get words by IDs')
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
        z.string().optional()
      ],
      (wordId, sentence, translation, audioPath, contextBefore, contextAfter, contextBeforeTranslation, contextAfterTranslation, sentenceParts, sentenceGenerationModel, audioGenerationService, audioGenerationModel, audioGenerationVoiceId) =>
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
    createIPCHandler(WordIdSchema, (wordId) => databaseLayer.getSentencesByWord(wordId), 'get sentences by word')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_SENTENCES_BY_IDS,
    createIPCHandler(SentenceIdsSchema, (sentenceIds) => databaseLayer.getSentencesByIds(sentenceIds), 'get sentences by IDs')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.DELETE_SENTENCE,
    createIPCHandler(SentenceIdSchema, (sentenceId) => databaseLayer.deleteSentence(sentenceId), 'delete sentence')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.UPDATE_SENTENCE_LAST_SHOWN,
    createIPCHandler(SentenceIdSchema, (sentenceId) => databaseLayer.updateSentenceLastShown(sentenceId), 'update sentence last shown')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.INCREMENT_SENTENCE_PLAY_COUNT,
    createIPCHandler(SentenceIdSchema, (sentenceId) => databaseLayer.incrementSentencePlayCount(sentenceId), 'increment sentence play count')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.RECORD_PRONUNCIATION_ATTEMPT,
    createIPCHandler(
      [SentenceIdSchema, z.number().min(0).max(1), z.string(), z.string(), z.string().optional().nullable()],
      (sentenceId, similarityScore, expectedText, transcribedText, audioPath) => {
        console.log(`[Pronunciation] Recording attempt: sentenceId=${sentenceId}, similarity=${similarityScore.toFixed(2)}, audioPath=${audioPath || 'none'}`);
        return databaseLayer.recordPronunciationAttempt(sentenceId, similarityScore, expectedText, transcribedText, audioPath || null);
      },
      'record pronunciation attempt'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_PRONUNCIATION_HISTORY,
    createIPCHandler(
      [SentenceIdSchema, z.number().int().positive().optional()],
      (sentenceId, limit) => databaseLayer.getPronunciationHistory(
        sentenceId,
        limit !== undefined ? Math.max(1, Math.floor(limit)) : undefined
      ),
      'get pronunciation history'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.UPDATE_SENTENCE_AUDIO_PATH,
    createIPCHandler(
      [SentenceIdSchema, AudioPathSchema, z.string().optional()],
      (sentenceId, audioPath, audioGenerationVoiceId) => databaseLayer.updateSentenceAudioPath(sentenceId, audioPath, audioGenerationVoiceId),
      'update sentence audio path'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.UPDATE_LAST_STUDIED,
    createIPCHandler(WordIdSchema, async (wordId) => {
      await databaseLayer.updateLastStudied(wordId);
      console.log(`[Tracking] Word progress: wordId=${wordId}, lastStudied=now`);
    }, 'update last studied')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_STUDY_STATS,
    createIPCHandler(undefined, () => databaseLayer.getStudyStats(), 'get study stats')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.RECORD_STUDY_SESSION,
    createIPCHandler(z.number().int().min(0), (wordsStudied) => databaseLayer.recordStudySession(wordsStudied), 'record study session')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_ALL_WORDS,
    createIPCHandler(
      [z.boolean().optional(), z.boolean().optional(), LanguageSchema.optional()],
      (includeKnown, includeIgnored, language) => databaseLayer.getAllWords(
        includeKnown !== undefined ? includeKnown : true,
        includeIgnored !== undefined ? includeIgnored : false,
        language
      ),
      'get all words'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_WORDS_WITH_SENTENCES,
    createIPCHandler(
      [z.boolean().optional(), z.boolean().optional(), LanguageSchema.optional()],
      (includeKnown, includeIgnored, language) => databaseLayer.getWordsWithSentences(
        includeKnown !== undefined ? includeKnown : true,
        includeIgnored !== undefined ? includeIgnored : false,
        language
      ),
      'get words with sentences'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_WORDS_WITH_SENTENCES_ORDERED_BY_STRENGTH,
    createIPCHandler(
      [z.boolean().optional(), z.boolean().optional(), LanguageSchema.optional()],
      (includeKnown, includeIgnored, language) => databaseLayer.getWordsWithSentencesOrderedByStrength(
        includeKnown !== undefined ? includeKnown : true,
        includeIgnored !== undefined ? includeIgnored : false,
        language
      ),
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
    createIPCHandler(z.string().min(1).max(100), (key) => databaseLayer.getSetting(key), 'get setting')
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
    createIPCHandler(LanguageSchema, (language) => databaseLayer.setCurrentLanguage(language), 'set current language')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_AVAILABLE_LANGUAGES,
    createIPCHandler(undefined, () => databaseLayer.getAvailableLanguages(), 'get available languages')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_LANGUAGE_STATS,
    createIPCHandler(undefined, () => databaseLayer.getLanguageStats(), 'get language stats')
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.LOOKUP_DICTIONARY,
    createIPCHandler(
      [DictionaryWordSchema, LanguageSchema.optional()],
      (word, language) => databaseLayer.lookupDictionary(word, language),
      'lookup dictionary entry'
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_NEW_WORD_COUNT,
    createIPCHandler(
      LanguageSchema.optional(),
      (language) => databaseLayer.getNewWordCount(language),
      'get new word count'
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
}

/**
 * Set up LLM-related IPC handlers
 */
function setupLLMHandlers(llmClient: LLMClient, contentGenerator: ContentGenerator, databaseLayer?: SQLiteDatabaseLayer): void {
  ipcMain.handle(IPC_CHANNELS.LLM.GENERATE_WORDS, async (event, topic, language) => {
    try {
      const validatedLanguage = LanguageSchema.parse(language);

      // Validate topic if provided
      if (topic && topic.trim()) {
        TopicSchema.parse(topic.trim());
      }

      // Use ContentGenerator for better error handling and validation
      return await contentGenerator.generateTopicVocabulary(
        topic && topic.trim() ? topic.trim() : undefined,
        validatedLanguage,
        undefined, // Use default word count from ContentGenerator (5)
        databaseLayer
      );
    } catch (error) {
      console.error('Error generating words:', error);
      throw wrapError(error, `Failed to generate words`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GENERATE_SENTENCES, async (event, word, language, topic) => {
    try {
      const validatedWord = TextSchema.parse(word);
      const validatedLanguage = LanguageSchema.parse(language);
      const validatedTopic = topic && topic.trim() ? TopicSchema.parse(topic.trim()) : undefined;

      // Use ContentGenerator for better error handling and validation
      return await contentGenerator.generateWordSentences(validatedWord, validatedLanguage, 3, databaseLayer, validatedTopic);
    } catch (error) {
      console.error('Error generating sentences:', error);
      throw wrapError(error, `Failed to generate sentences`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.IS_AVAILABLE, async (event) => {
    try {
      return await llmClient.isAvailable();
    } catch (error) {
      console.error('Error checking LLM availability:', error);
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GET_AVAILABLE_MODELS, async (event) => {
    try {
      return await llmClient.getAvailableModels();
    } catch (error) {
      console.error('Error getting available models:', error);
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.SET_MODEL, async (event, model) => {
    try {
      const validatedModel = z.string().min(1).parse(model);
      llmClient.setModel(validatedModel);
    } catch (error) {
      console.error('Error setting model:', error);
      throw wrapError(error, `Failed to set model`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GET_CURRENT_MODEL, async (event) => {
    try {
      return llmClient.getCurrentModel();
    } catch (error) {
      console.error('Error getting current model:', error);
      throw wrapError(error, `Failed to get current model`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.SET_WORD_GENERATION_MODEL, async (event, model) => {
    try {
      const validatedModel = z.string().min(1).parse(model);
      llmClient.setWordGenerationModel(validatedModel);
    } catch (error) {
      console.error('Error setting word generation model:', error);
      throw wrapError(error, `Failed to set word generation model`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.SET_SENTENCE_GENERATION_MODEL, async (event, model) => {
    try {
      const validatedModel = z.string().min(1).parse(model);
      llmClient.setSentenceGenerationModel(validatedModel);
    } catch (error) {
      console.error('Error setting sentence generation model:', error);
      throw wrapError(error, `Failed to set sentence generation model`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GET_WORD_GENERATION_MODEL, async (event) => {
    try {
      return llmClient.getWordGenerationModel();
    } catch (error) {
      console.error('Error getting word generation model:', error);
      throw wrapError(error, `Failed to get word generation model`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GET_SENTENCE_GENERATION_MODEL, async (event) => {
    try {
      return llmClient.getSentenceGenerationModel();
    } catch (error) {
      console.error('Error getting sentence generation model:', error);
      throw wrapError(error, `Failed to get sentence generation model`);
    }
  });

  // Frequency word management handlers
  ipcMain.handle(IPC_CHANNELS.FREQUENCY.GET_PROGRESS, async (event, language) => {
    try {
      const validatedLanguage = LanguageSchema.parse(language);
      if (!databaseLayer) {
        throw new Error('Database layer not available');
      }
      return await contentGenerator.getFrequencyProgress(validatedLanguage, databaseLayer);
    } catch (error) {
      console.error('Error getting frequency progress:', error);
      throw wrapError(error, `Failed to get frequency progress`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FREQUENCY.GET_AVAILABLE_LANGUAGES, async (event) => {
    try {
      return contentGenerator.getAvailableFrequencyLanguages();
    } catch (error) {
      console.error('Error getting available frequency languages:', error);
      throw wrapError(error, `Failed to get available frequency languages`);
    }
  });

  // Provider management handlers
  ipcMain.handle(IPC_CHANNELS.LLM.GET_CURRENT_PROVIDER, async (event) => {
    try {
      return contentGenerator.getCurrentProvider();
    } catch (error) {
      console.error('Error getting current provider:', error);
      throw wrapError(error, `Failed to get current provider`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.SWITCH_PROVIDER, async (event, provider, geminiApiKey) => {
    try {
      const validatedProvider = z.enum(['ollama', 'gemini']).parse(provider);
      let validatedApiKey = geminiApiKey ? z.string().min(1).parse(geminiApiKey) : undefined;

      // If switching to Gemini and no API key provided, get it from database
      if (validatedProvider === 'gemini' && !validatedApiKey && databaseLayer) {
        const storedApiKey = await databaseLayer.getSetting('gemini_api_key');
        console.log('Retrieved Gemini API key from database:', !!storedApiKey);
        validatedApiKey = storedApiKey || undefined;
      }

      // Switch provider in content generator
      contentGenerator.switchProvider(validatedProvider, validatedApiKey);

      // Persist selected provider so it survives app restarts
      if (databaseLayer) {
        await databaseLayer.setSetting('llm_provider', validatedProvider);
      }

      // Update the main process llmClient reference
      const newClient = contentGenerator.getCurrentClient();
      if (newClient && databaseLayer) {
        newClient.setDatabaseLayer(databaseLayer);
      }

      console.log(`Switched to ${validatedProvider} provider`);
    } catch (error) {
      console.error('Error switching provider:', error);
      throw wrapError(error, `Failed to switch provider`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.SET_GEMINI_API_KEY, async (event, apiKey, switchToGemini) => {
    try {
      const validatedApiKey = z.string().min(1).parse(apiKey);
      const validatedSwitch = switchToGemini !== undefined ? z.boolean().parse(switchToGemini) : false;

      contentGenerator.setGeminiApiKey(validatedApiKey, validatedSwitch);

      // If switching to Gemini, update the main process llmClient reference
      if (validatedSwitch) {
        const newClient = contentGenerator.getCurrentClient();
        if (newClient && databaseLayer) {
          newClient.setDatabaseLayer(databaseLayer);
        }
      }

      console.log('Gemini API key set successfully');
    } catch (error) {
      console.error('Error setting Gemini API key:', error);
      throw wrapError(error, `Failed to set Gemini API key`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GET_AVAILABLE_PROVIDERS, async (event) => {
    try {
      return LLMFactory.getAvailableProviders();
    } catch (error) {
      console.error('Error getting available providers:', error);
      throw wrapError(error, `Failed to get available providers`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GET_MODELS_FOR_PROVIDER, async (event, provider) => {
    try {
      const validatedProvider = z.enum(['ollama', 'gemini']).parse(provider);
      
      if (validatedProvider === 'ollama') {
        // Create a temporary Ollama client to get models
        const ollamaClient = LLMFactory.createOllamaClient();
        return await ollamaClient.getAvailableModels();
      } else if (validatedProvider === 'gemini') {
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
    } catch (error) {
      console.error('Error getting models for provider:', error);
      throw wrapError(error, `Failed to get models for provider`);
    }
  });
}

/**
 * Set up audio-related IPC handlers
 */
function setupAudioHandlers(audioService: AudioService, databaseLayer?: SQLiteDatabaseLayer): void {
  ipcMain.handle(IPC_CHANNELS.AUDIO.GENERATE_AUDIO, async (event, text, language, word, wordId, sentenceId, variantId) => {
    try {
      const validatedText = TextSchema.parse(text);
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      const validatedWord = word ? TextSchema.parse(word) : undefined;
      const validatedWordId = wordId !== undefined ? z.number().int().parse(wordId) : undefined;
      const validatedSentenceId = sentenceId !== undefined ? z.number().int().positive().parse(sentenceId) : undefined;
      const validatedVariantId = variantId !== undefined ? z.number().int().parse(variantId) : undefined;

      return await audioService.generateAudio(validatedText, validatedLanguage, validatedWord, validatedWordId, validatedSentenceId, validatedVariantId);
    } catch (error) {
      console.error('Error generating audio:', error);
      throw wrapError(error, `Failed to generate audio`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.PLAY_AUDIO, async (event, audioPath) => {
    try {
      const validatedAudioPath = AudioPathSchema.parse(audioPath);
      // Catch expected errors immediately with .catch() to prevent Electron logging
      const playPromise = audioService.playAudio(validatedAudioPath).catch((error: any) => {
        // Silently handle PLAYBACK_STOPPED errors - they're expected when audio is stopped
        if (error?.code === 'PLAYBACK_STOPPED') {
          // Return undefined instead of throwing to prevent Electron from logging the error
          return undefined;
        }
        // Silently handle FILE_NOT_FOUND errors - missing files are handled gracefully by the UI
        if (error?.code === 'FILE_NOT_FOUND') {
          // Return undefined instead of throwing to prevent Electron from logging the error
          return undefined;
        }
        // Re-throw other errors
        throw error;
      });
      
      return await playPromise;
    } catch (error) {
      // Check if this is an AudioError with a code
      if (error instanceof Error && 'code' in error) {
        const audioError = error as { code: string };
        // Don't log or re-throw expected errors - they're handled gracefully
        // This prevents Electron from logging "Error occurred in handler"
        if (audioError.code === 'PLAYBACK_STOPPED' || audioError.code === 'FILE_NOT_FOUND') {
          // Return undefined instead of re-throwing to prevent error logging
          // The renderer side already handles this gracefully
          return;
        }
        // For other AudioErrors, log and re-throw as-is
        console.error('Error playing audio:', error);
        throw error; // Re-throw AudioError as-is to preserve code
      }
      // For non-AudioError errors, wrap and log
      console.error('Error playing audio:', error);
      throw wrapError(error, `Failed to play audio`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.STOP_AUDIO, async (event) => {
    try {
      audioService.stopAudio();
    } catch (error) {
      console.error('Error stopping audio:', error);
      throw wrapError(error, `Failed to stop audio`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.AUDIO_EXISTS, async (event, audioPath) => {
    try {
      const validatedAudioPath = AudioPathSchema.parse(audioPath);
      return await audioService.audioExists(validatedAudioPath);
    } catch (error) {
      console.error('Error checking audio existence:', error);
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.NORMALIZE_AUDIO_VOLUME, async (event, audioPath, targetDb) => {
    try {
      const validatedAudioPath = AudioPathSchema.parse(audioPath);
      const validatedTargetDb = typeof targetDb === 'number' ? targetDb : 5; // Default to 5dB amplification
      return await audioService.normalizeAudioVolume(validatedAudioPath, validatedTargetDb);
    } catch (error) {
      console.error('Error normalizing audio volume:', error);
      // Return original path if normalization fails
      return audioPath;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.LOAD_AUDIO_BASE64, async (event, audioPath) => {
    try {
      const validatedAudioPath = AudioPathSchema.parse(audioPath);
      return await audioService.loadAudioBase64(validatedAudioPath);
    } catch (error) {
      console.error('Error loading audio as base64:', error);
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.REGENERATE_AUDIO, async (event, payload) => {
    try {
      const validatedPayload = z.object({
        text: TextSchema,
        language: LanguageSchema.optional(),
        word: TextSchema.optional(),
        wordId: z.number().int().optional(),
        sentenceId: z.number().int().positive().optional(),
        variantId: z.number().int().optional(),
        existingPath: AudioPathSchema.optional()
      }).parse(payload ?? {});

      const audioPath = await audioService.regenerateAudio(
        validatedPayload.text,
        validatedPayload.language,
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
            await databaseLayer.updateSentenceAudioPath(validatedPayload.sentenceId, audioPath, voiceId);
          }
        } catch (error) {
          console.warn('Failed to update voiceID after regeneration:', error);
        }
      }

      return { audioPath };
    } catch (error) {
      console.error('Error regenerating audio:', error);
      throw wrapError(error, `Failed to regenerate audio`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.START_RECORDING, async (event, options) => {
    try {
      const validatedOptions = options ? z.object({
        sampleRate: z.number().optional(),
        channels: z.number().optional(),
        threshold: z.number().optional(),
        silence: z.string().optional(),
        endOnSilence: z.boolean().optional(),
        device: z.string().optional()
      }).parse(options) : undefined;
      
      return await audioService.startRecording(validatedOptions);
    } catch (error) {
      console.error('Error starting recording:', error);
      throw wrapError(error, `Failed to start recording`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.STOP_RECORDING, async (event) => {
    try {
      return await audioService.stopRecording();
    } catch (error) {
      console.error('Error stopping recording:', error);
      throw wrapError(error, `Failed to stop recording`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.CANCEL_RECORDING, async (event) => {
    try {
      await audioService.cancelRecording();
    } catch (error) {
      console.error('Error cancelling recording:', error);
      throw wrapError(error, `Failed to cancel recording`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.GET_CURRENT_RECORDING_SESSION, async (event) => {
    try {
      return audioService.getCurrentRecordingSession();
    } catch (error) {
      console.error('Error getting current recording session:', error);
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.IS_RECORDING, async (event) => {
    try {
      return audioService.isRecording();
    } catch (error) {
      console.error('Error checking recording status:', error);
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.GET_AVAILABLE_RECORDING_DEVICES, async (event) => {
    try {
      return await audioService.getAvailableRecordingDevices();
    } catch (error) {
      console.error('Error getting available recording devices:', error);
      return ['default'];
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.DELETE_RECORDING, async (event, filePath) => {
    try {
      const validatedFilePath = AudioPathSchema.parse(filePath);
      await audioService.deleteRecording(validatedFilePath);
    } catch (error) {
      console.error('Error deleting recording:', error);
      throw wrapError(error, `Failed to delete recording`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.GET_RECORDING_INFO, async (event, filePath) => {
    try {
      const validatedFilePath = AudioPathSchema.parse(filePath);
      return await audioService.getRecordingInfo(validatedFilePath);
    } catch (error) {
      console.error('Error getting recording info:', error);
      return null;
    }
  });

  // Speech recognition handlers
  ipcMain.handle(IPC_CHANNELS.AUDIO.INITIALIZE_SPEECH_RECOGNITION, async (event) => {
    // Non-blocking: does not throw errors if server is unavailable
    // Use isSpeechRecognitionReady() to check if initialization was successful
    await audioService.initializeSpeechRecognition();
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.TRANSCRIBE_AUDIO, async (event, filePath, options) => {
    try {
      const validatedFilePath = AudioPathSchema.parse(filePath);
      if (!options || !options.language) {
        throw new Error('Language is required for transcription');
      }
      
      const validatedOptions = z.object({
        language: z.string(),
        temperature: z.number().optional()
      }).parse(options);

      // Create progress callback that sends IPC events
      const transcriptionOptions = {
        ...validatedOptions,
        onProgress: (text: string, isFinal: boolean) => {
          // Send progress updates via IPC event
          event.sender.send(IPC_CHANNELS.AUDIO.TRANSCRIBE_AUDIO_PROGRESS, {
            text,
            isFinal
          });
        }
      };
      
      return await audioService.transcribeAudio(validatedFilePath, transcriptionOptions);
    } catch (error) {
      console.error('Error transcribing audio:', error);
      throw wrapError(error, `Failed to transcribe audio`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.COMPARE_TRANSCRIPTION, async (event, transcribed, expected, proficiencyLevel) => {
    try {
      const validatedTranscribed = TextSchema.parse(transcribed);
      const validatedExpected = TextSchema.parse(expected);
      
      return await audioService.compareTranscription(validatedTranscribed, validatedExpected, proficiencyLevel);
    } catch (error) {
      console.error('Error comparing transcription:', error);
      throw wrapError(error, `Failed to compare transcription`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.IS_SPEECH_RECOGNITION_READY, async (event) => {
    try {
      return await audioService.isSpeechRecognitionReady();
    } catch (error) {
      console.error('Error checking speech recognition status:', error);
      return false;
    }
  });

  // ElevenLabs TTS handlers
  ipcMain.handle(IPC_CHANNELS.AUDIO.SWITCH_TO_ELEVENLABS, async (event, apiKey) => {
    try {
      const validatedApiKey = z.string().min(1).parse(apiKey);
      
      await audioService.switchToElevenLabs(validatedApiKey);
    } catch (error) {
      console.error('Error switching to ElevenLabs:', error);
      throw wrapError(error, `Failed to switch to ElevenLabs`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.SWITCH_TO_SYSTEM_TTS, async (event) => {
    try {
      await audioService.switchToSystemTTS();
    } catch (error) {
      console.error('Error switching to system TTS:', error);
      throw wrapError(error, `Failed to switch to system TTS`);
    }
  });

  // Voice mapping handlers
  ipcMain.handle(IPC_CHANNELS.AUDIO.GET_VOICE_MAPPINGS, async (event) => {
    try {
      return await audioService.getVoiceMappings();
    } catch (error) {
      console.error('Error getting voice mappings:', error);
      throw wrapError(error, `Failed to get voice mappings`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.SAVE_VOICE_MAPPINGS, async (event, mappings) => {
    try {
      // Validate mappings is an object
      if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
        throw new Error('Voice mappings must be an object');
      }
      
      // Validate each language entry is an array of strings
      const validatedMappings: Record<string, string[]> = {};
      for (const [lang, voices] of Object.entries(mappings)) {
        if (!Array.isArray(voices)) {
          throw new Error(`Voice IDs for language "${lang}" must be an array`);
        }
        validatedMappings[lang] = voices.map(v => {
          if (typeof v !== 'string' || v.trim().length === 0) {
            throw new Error(`Invalid voice ID in language "${lang}": must be a non-empty string`);
          }
          return v.trim();
        });
      }
      
      await audioService.saveVoiceMappings(validatedMappings);
    } catch (error) {
      console.error('Error saving voice mappings:', error);
      throw wrapError(error, `Failed to save voice mappings`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.RESET_VOICE_MAPPINGS_TO_DEFAULTS, async (event) => {
    try {
      await audioService.resetVoiceMappingsToDefaults();
    } catch (error) {
      console.error('Error resetting voice mappings:', error);
      throw wrapError(error, `Failed to reset voice mappings`);
    }
  });
}

/**
 * Set up quiz-related IPC handlers
 */
function setupQuizHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  ipcMain.handle(IPC_CHANNELS.QUIZ.GET_WEAKEST_WORDS, async (event, limit) => {
    try {
      const validatedLimit = LimitSchema.parse(limit);
      return await databaseLayer.getWeakestWords(validatedLimit);
    } catch (error) {
      console.error('Error getting weakest words:', error);
      throw wrapError(error, `Failed to get weakest words`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.QUIZ.GET_RANDOM_SENTENCE_FOR_WORD, async (event, wordId) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      return await databaseLayer.getRandomSentenceForWord(validatedWordId);
    } catch (error) {
      console.error('Error getting random sentence for word:', error);
      throw wrapError(error, `Failed to get random sentence for word`);
    }
  });
}

/**
 * Set up SRS-related IPC handlers
 */
function setupSRSHandlers(srsService: SRSService): void {
  ipcMain.handle(IPC_CHANNELS.SRS.PROCESS_REVIEW, async (event, wordId, recall) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      const validatedRecall = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).parse(recall);
      return await srsService.processReview(validatedWordId, { recall: validatedRecall });
    } catch (error) {
      console.error('Error processing review:', error);
      throw wrapError(error, `Failed to process review`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.PROCESS_QUIZ_RESULTS, async (event, results, language, sessionId) => {
    try {
      const validatedResults = z.array(z.object({
        wordId: WordIdSchema,
        correct: BooleanSchema,
        responseTime: z.number().optional(),
        difficulty: z.enum(['easy', 'medium', 'hard']).optional()
      })).parse(results);
      const validatedLanguage = z.string().min(1).parse(language);
      const validatedSessionId = sessionId !== undefined ? z.number().int().positive().parse(sessionId) : undefined;
      return await srsService.processQuizResults(validatedResults, validatedLanguage, validatedSessionId);
    } catch (error) {
      console.error('Error processing quiz results:', error);
      throw wrapError(error, `Failed to process quiz results`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.GET_TODAYS_STUDY_WORDS, async (event, maxWords, language) => {
    try {
      const validatedMaxWords = maxWords ? LimitSchema.parse(maxWords) : undefined;
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      return await srsService.getTodaysStudyWords(validatedMaxWords, validatedLanguage);
    } catch (error) {
      console.error('Error getting todays study words:', error);
      throw wrapError(error, `Failed to get todays study words`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.GET_DASHBOARD_STATS, async (event, language) => {
    try {
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      return await srsService.getDashboardStats(validatedLanguage);
    } catch (error) {
      console.error('Error getting dashboard stats:', error);
      throw wrapError(error, `Failed to get dashboard stats`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.MARK_WORD_DIFFICULTY, async (event, wordId, difficulty) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      const validatedDifficulty = z.enum(['easy', 'hard']).parse(difficulty);
      return await srsService.markWordDifficulty(validatedWordId, validatedDifficulty);
    } catch (error) {
      console.error('Error marking word difficulty:', error);
      throw wrapError(error, `Failed to mark word difficulty`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.RESET_WORD_PROGRESS, async (event, wordId) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      return await srsService.resetWordProgress(validatedWordId);
    } catch (error) {
      console.error('Error resetting word progress:', error);
      throw wrapError(error, `Failed to reset word progress`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.GET_OVERDUE_WORDS, async (event, language) => {
    try {
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      return await srsService.getOverdueWords(validatedLanguage);
    } catch (error) {
      console.error('Error getting overdue words:', error);
      throw wrapError(error, `Failed to get overdue words`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.INITIALIZE_EXISTING_WORDS, async (event, language) => {
    try {
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      return await srsService.initializeExistingWords(validatedLanguage);
    } catch (error) {
      console.error('Error initializing existing words:', error);
      throw wrapError(error, `Failed to initialize existing words`);
    }
  });
}

/**
 * Set up word generation job queue handlers
 */
function setupJobHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  const EnqueueOptionsSchema = z.object({
    topic: TopicSchema.optional(),
    language: LanguageSchema.optional(),
    desiredSentenceCount: z.number().int().min(1).max(10).optional()
  }).optional();

  ipcMain.handle(IPC_CHANNELS.JOBS.ENQUEUE_WORD_GENERATION, async (event, wordId, options) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      const validatedOptions = EnqueueOptionsSchema.parse(options);

      let language = validatedOptions?.language;
      if (!language) {
        const word = await databaseLayer.getWordById(validatedWordId);
        if (!word) {
          throw new Error(`Word with ID ${validatedWordId} not found`);
        }
        language = word.language;
      }

      await databaseLayer.enqueueWordGeneration(
        validatedWordId,
        language,
        validatedOptions?.topic,
        validatedOptions?.desiredSentenceCount ?? 3
      );
    } catch (error) {
      console.error('Error enqueueing word generation:', error);
      throw wrapError(error, `Failed to enqueue word generation`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.JOBS.GET_WORD_STATUS, async (event, wordId) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      return await databaseLayer.getWordProcessingInfo(validatedWordId);
    } catch (error) {
      console.error('Error getting word processing status:', error);
      throw wrapError(error, `Failed to get word status`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.JOBS.GET_QUEUE_SUMMARY, async (_event, language) => {
    try {
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      return await databaseLayer.getWordGenerationQueueSummary(validatedLanguage);
    } catch (error) {
      console.error('Error getting queue summary:', error);
      throw wrapError(error, `Failed to get queue summary`);
    }
  });
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
  ipcMain.handle(IPC_CHANNELS.LIFECYCLE.CREATE_BACKUP, async (event) => {
    try {
      return await lifecycleManager.createBackup();
    } catch (error) {
      console.error('Error creating backup:', error);
      throw wrapError(error, `Failed to create backup`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIFECYCLE.RESTORE_FROM_BACKUP, async (event, backupPath) => {
    try {
      const validatedBackupPath = z.string().min(1).parse(backupPath);
      await lifecycleManager.restoreFromBackup(validatedBackupPath);
    } catch (error) {
      console.error('Error restoring from backup:', error);
      throw wrapError(error, `Failed to restore from backup`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIFECYCLE.CHECK_FOR_UPDATES, async (event) => {
    try {
      const updateInfo = await updateManager.checkForUpdates(true);
      return updateInfo !== null;
    } catch (error) {
      console.error('Error checking for updates:', error);
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIFECYCLE.GET_APP_VERSION, async (event) => {
    try {
      return app.getVersion();
    } catch (error) {
      console.error('Error getting app version:', error);
      throw wrapError(error, `Failed to get app version`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIFECYCLE.RESTART_ALL, async (event) => {
    try {
      await lifecycleManager.restartAll();
    } catch (error) {
      console.error('Error restarting all:', error);
      throw new Error(`Failed to restart all: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIFECYCLE.OPEN_BACKUP_DIALOG, async (event) => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Backup Directory',
        properties: ['openDirectory'],
        message: 'Select a backup directory to restore from'
      });
      
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      
      return result.filePaths[0];
    } catch (error) {
      console.error('Error opening backup dialog:', error);
      throw new Error(`Failed to open backup dialog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIFECYCLE.OPEN_BACKUP_DIRECTORY, async (event) => {
    try {
      await lifecycleManager.openBackupDirectory();
    } catch (error) {
      console.error('Error opening backup directory:', error);
      throw new Error(`Failed to open backup directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIFECYCLE.CLOSE_APP, async (event) => {
    try {
      console.log('Close app requested via IPC');
      
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
          console.warn('Error stopping recording during app close:', error);
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
    } catch (error) {
      console.error('Error during app close cleanup:', error);
      // Still quit even if cleanup failed
      app.quit();
    }
  });
}

/**
 * Clean up IPC handlers (call this on app shutdown)
 */
export function cleanupIPCHandlers(): void {
  // Remove all IPC handlers
  Object.values(IPC_CHANNELS.DATABASE).forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.LLM).forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.AUDIO).forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.QUIZ).forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.LIFECYCLE).forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.FREQUENCY).forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.SRS).forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.JOBS).forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.LEMMATIZATION).forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.DIALOG).forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  Object.values(IPC_CHANNELS.FLOW).forEach(channel => {
    ipcMain.removeAllListeners(channel);
  });

  console.log('IPC handlers cleaned up');
}

/**
 * Set up lemmatization-related IPC handlers
 */
function setupLemmatizationHandlers(lemmatizationService: LemmatizationService): void {
  ipcMain.handle(IPC_CHANNELS.LEMMATIZATION.GET_STATUS, async (event) => {
    try {
      return await lemmatizationService.getStatus();
    } catch (error) {
      // Service is optional - return null status instead of throwing
      console.warn('[Lemmatization] Error getting status (non-critical):', error);
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.LEMMATIZATION.LOAD_MODEL, async (event, language) => {
    try {
      const validatedLanguage = LanguageSchema.parse(language);
      await lemmatizationService.loadModel(validatedLanguage);
    } catch (error) {
      // Service is optional - don't throw, just log
      // loadModel already handles errors gracefully
      console.warn('[Lemmatization] Error loading model (non-critical):', error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LEMMATIZATION.LEMMATIZE_WORDS, async (event, words, language) => {
    try {
      const validatedWords = z.array(z.string().min(1).max(200)).parse(words);
      const validatedLanguage = LanguageSchema.parse(language);
      return await lemmatizationService.lemmatizeWords(validatedWords, validatedLanguage);
    } catch (error) {
      // Service is optional - return empty object instead of throwing
      // lemmatizeWords already handles errors gracefully and returns {}
      console.warn('[Lemmatization] Error lemmatizing words (non-critical):', error);
      return {};
    }
  });
}

/**
 * Set up dialog-related IPC handlers
 */
function setupDialogHandlers(
  databaseLayer: SQLiteDatabaseLayer,
  llmClient: LLMClient,
  contentGenerator: ContentGenerator,
  audioService: AudioService
): void {
  const dialogService = new DialogService(databaseLayer, llmClient);

  ipcMain.handle(IPC_CHANNELS.DIALOG.SELECT_SENTENCE, async (event) => {
    try {
      const language = await databaseLayer.getCurrentLanguage();
      return await dialogService.selectSentence(language);
    } catch (error) {
      console.error('Error selecting sentence for dialog:', error);
      throw new Error(`Failed to select sentence: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG.GENERATE_VARIANTS, async (event, sentenceId) => {
    try {
      const validatedSentenceId = SentenceIdSchema.parse(sentenceId);
      
      // Get the sentence
      const sentence = await databaseLayer.getSentenceById(validatedSentenceId);
      if (!sentence) {
        throw new Error(`Sentence with ID ${validatedSentenceId} not found`);
      }

      // Get existing variants
      const existingVariants = await databaseLayer.getDialogueVariantsBySentenceId(validatedSentenceId);
      
      // Get known words for variant generation
      const language = await databaseLayer.getCurrentLanguage();
      const allWords = await databaseLayer.getAllWords(true, false, language);
      const dialogServiceConfig = dialogService as any; // Access private config
      const minWordStrength = dialogServiceConfig.config?.minWordStrength ?? 40;
      const maxKnownWords = dialogServiceConfig.config?.maxKnownWordsForVariants ?? 50;
      const knownWords = allWords
        .filter(w => w.known || (w.strength ?? 0) >= minWordStrength)
        .slice(0, maxKnownWords)
        .map(w => w.word);
      
      // Generate variants
      return await dialogService.generateDialogueVariants(sentence, existingVariants, knownWords, language);
    } catch (error) {
      console.error('Error generating dialogue variants:', error);
      throw new Error(`Failed to generate variants: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG.GENERATE_FOLLOW_UP, async (event, variantId) => {
    try {
      const validatedVariantId = VariantIdSchema.parse(variantId); // Use VariantIdSchema to allow negative IDs
      const language = await databaseLayer.getCurrentLanguage();
      
      // Generate follow-up (will check cache and generate if needed)
      const followUp = await dialogService.generateFollowUp(validatedVariantId, language);
      
      // Generate audio on-demand if continuation text exists and no audio is cached yet
      // Only cache audio for actual variants (positive IDs), not pseudo-variants (negative IDs)
      let continuationAudio: string | undefined;
      if (followUp.text && followUp.text.trim().length > 0 && validatedVariantId > 0) {
        try {
          // Check if audio already exists in database
          const variant = await databaseLayer.getDialogueVariantById(validatedVariantId);
          if (variant && variant.continuationAudio) {
            // Audio already exists, use cached path
            continuationAudio = variant.continuationAudio;
          } else {
            // Generate audio on-demand
            const currentLanguage = await databaseLayer.getCurrentLanguage();
            const audioPath = await audioService.generateAudio(
              followUp.text,
              currentLanguage,
              undefined,
              undefined,
              undefined,
              validatedVariantId
            );
            
            if (audioPath) {
              continuationAudio = audioPath;
              
              // Update database with audio path (update continuation with audio path)
              // This also ensures the continuation text/translation are cached
              await databaseLayer.updateDialogueVariantContinuation(
                validatedVariantId,
                followUp.text,
                followUp.translation,
                audioPath
              );
              console.log('[IPC] Generated and cached continuation audio:', audioPath);
            }
          }
        } catch (audioError) {
          console.error('[IPC] Failed to generate continuation audio:', audioError);
          // Continue without audio - non-critical
        }
      } else if (followUp.text && followUp.text.trim().length > 0 && validatedVariantId < 0) {
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
            validatedVariantId
          );
          
          if (audioPath) {
            continuationAudio = audioPath;
            console.log('[IPC] Generated continuation audio for pseudo-variant (not cached in DB):', audioPath);
          }
        } catch (audioError) {
          console.error('[IPC] Failed to generate continuation audio for pseudo-variant:', audioError);
          // Continue without audio - non-critical
        }
      }
      
      return {
        text: followUp.text,
        translation: followUp.translation,
        audio: continuationAudio
      };
    } catch (error) {
      console.error('Error generating follow-up:', error);
      throw new Error(`Failed to generate follow-up: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG.PREGENERATE_SESSION, async (event) => {
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
            if (audioPath && await audioService.audioExists(audioPath)) {
              beforeSentenceAudio = audioPath;
              // Save the path to database
              try {
                await databaseLayer.updateBeforeSentenceAudioPath(session.sentenceId, audioPath);
              } catch (dbError) {
                console.warn('[IPC] Failed to save beforeSentence audio path to database:', dbError);
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
            if (audioPath && await audioService.audioExists(audioPath)) {
              afterSentenceAudio = audioPath;
              // Save the path to database
              try {
                await databaseLayer.updateAfterSentenceAudioPath(session.sentenceId, audioPath);
              } catch (dbError) {
                console.warn('[IPC] Failed to save afterSentence audio path to database:', dbError);
                // Continue - audio exists even if DB update fails
              }
            }
          }
        } catch (error) {
          console.warn('[IPC] Failed to generate context sentences audio during pre-generation:', error);
          // Continue without audio
        }
      }

      // Convert Date objects to ISO strings for IPC transfer
      return {
        ...session,
        beforeSentenceAudio,
        afterSentenceAudio,
        responseOptions: session.responseOptions.map(v => ({
          ...v,
          createdAt: v.createdAt.toISOString()
        }))
      };
    } catch (error) {
      console.error('Error pre-generating dialog session:', error);
      return null; // Don't throw - this is a background operation
    }
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG.PREGENERATE_SESSIONS, async (event, count: number) => {
    try {
      // Pre-generate multiple dialog sessions (non-blocking - can fail silently)
      const language = await databaseLayer.getCurrentLanguage();
      const sessions = await dialogService.pregenerateSessions(count, language);
      if (sessions.length === 0) {
        return [];
      }
      const sessionsWithAudio = await Promise.all(sessions.map(async (session) => {
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
              if (audioPath && await audioService.audioExists(audioPath)) {
                beforeSentenceAudio = audioPath;
                // Save the path to database
                try {
                  await databaseLayer.updateBeforeSentenceAudioPath(session.sentenceId, audioPath);
                } catch (dbError) {
                  console.warn(`[IPC] Failed to save beforeSentence audio path to database for session ${session.sentenceId}:`, dbError);
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
              if (audioPath && await audioService.audioExists(audioPath)) {
                afterSentenceAudio = audioPath;
                // Save the path to database
                try {
                  await databaseLayer.updateAfterSentenceAudioPath(session.sentenceId, audioPath);
                } catch (dbError) {
                  console.warn(`[IPC] Failed to save afterSentence audio path to database for session ${session.sentenceId}:`, dbError);
                  // Continue - audio exists even if DB update fails
                }
              }
            }
          } catch (error) {
            console.warn(`[IPC] Failed to generate context sentences audio for session ${session.sentenceId}:`, error);
            // Continue without audio
          }
        }

        // Convert Date objects to ISO strings for IPC transfer
        return {
          ...session,
          beforeSentenceAudio,
          afterSentenceAudio,
          responseOptions: session.responseOptions.map(v => ({
            ...v,
            createdAt: v.createdAt.toISOString()
          }))
        };
      }));

      return sessionsWithAudio;
    } catch (error) {
      console.error('Error pre-generating dialog sessions:', error);
      return []; // Don't throw - this is a background operation
    }
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG.ENSURE_BEFORE_SENTENCE_AUDIO, async (event, sentenceId) => {
    try {
      const validatedSentenceId = SentenceIdSchema.parse(sentenceId);
      
      // Get the sentence
      const sentence = await databaseLayer.getSentenceById(validatedSentenceId);
      if (!sentence) {
        throw new Error(`Sentence with ID ${validatedSentenceId} not found`);
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
        validatedSentenceId
      );

      // Save the path to database
      if (audioPath) {
        await databaseLayer.updateBeforeSentenceAudioPath(validatedSentenceId, audioPath);
      }

      return audioPath;
    } catch (error) {
      console.error('Error ensuring before sentence audio:', error);
      throw new Error(`Failed to ensure before sentence audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG.ENSURE_CONTEXT_SENTENCES, async (event, sentenceId) => {
    try {
      const validatedSentenceId = SentenceIdSchema.parse(sentenceId);
      
      // Get the sentence
      const sentence = await databaseLayer.getSentenceById(validatedSentenceId);
      if (!sentence) {
        throw new Error(`Sentence with ID ${validatedSentenceId} not found`);
      }

      const language = await databaseLayer.getCurrentLanguage();
      let beforeSentenceAudio: string | null = null;
      let afterSentenceAudio: string | null = null;

      // Generate beforeSentence audio if contextBefore exists
      if (sentence.contextBefore) {
        // If audio path already exists in database, use it
        if (sentence.beforeSentenceAudioPath) {
          beforeSentenceAudio = sentence.beforeSentenceAudioPath;
        } else {
          // Generate audio with wordId and sentenceId
          const audioPath = await audioService.generateAudio(
            sentence.contextBefore,
            language,
            '_before_sentence',
            sentence.wordId,
            validatedSentenceId
          );

          // Save the path to database
          if (audioPath) {
            await databaseLayer.updateBeforeSentenceAudioPath(validatedSentenceId, audioPath);
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
          // Generate audio with wordId and sentenceId
          const audioPath = await audioService.generateAudio(
            sentence.contextAfter,
            language,
            '_after_sentence',
            sentence.wordId,
            validatedSentenceId
          );

          // Save the path to database
          if (audioPath) {
            await databaseLayer.updateAfterSentenceAudioPath(validatedSentenceId, audioPath);
            afterSentenceAudio = audioPath;
          }
        }
      }

      return {
        beforeSentenceAudio,
        afterSentenceAudio
      };
    } catch (error) {
      console.error('Error ensuring context sentences audio:', error);
      throw new Error(`Failed to ensure context sentences audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
}

/**
 * Set up Flow-related IPC handlers
 */
function setupFlowHandlers(
  databaseLayer: SQLiteDatabaseLayer,
  audioService: AudioService
): void {
  ipcMain.handle(IPC_CHANNELS.FLOW.GET_FLOW_SENTENCES, async (event) => {
    try {
      // Get current language explicitly to ensure correct filtering
      const currentLanguage = await databaseLayer.getCurrentLanguage();
      const flowSentences = await databaseLayer.getFlowSentences(currentLanguage);
      
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
            continuationAudios: existingContinuationAudios
          };
        })
      );

      return result;
    } catch (error) {
      console.error('Error getting flow sentences:', error);
      throw new Error(`Failed to get flow sentences: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FLOW.STITCH_AUDIO, async (event, audioPaths: string[], language: string) => {
    try {
      const AudioPathsSchema = z.array(z.string().min(1).max(500));
      const validatedPaths = AudioPathsSchema.parse(audioPaths);
      
      // Validate language parameter
      if (!language || typeof language !== 'string') {
        // If not provided, get from database as fallback
        try {
          language = await databaseLayer.getCurrentLanguage();
        } catch (error) {
          throw new Error('Language parameter is required for stitching audio');
        }
      }
      
      // Don't log here - audioService.stitchAudio() will check cache first and log appropriately
      const stitchedPath = await audioService.stitchAudio(validatedPaths, language);
      
      if (!stitchedPath) {
        throw new Error('Failed to stitch audio files');
      }
      
      return stitchedPath;
    } catch (error) {
      console.error('Error stitching audio:', error);
      throw new Error(`Failed to stitch audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FLOW.GET_FILE_STATS, async (event, filePath: string) => {
    try {
      const FilePathSchema = z.string().min(1).max(500);
      const validatedPath = FilePathSchema.parse(filePath);
      
      // Resolve relative paths to absolute paths
      const absolutePath = AudioService.resolveAudioPath(validatedPath);
      
      const { stat } = require('fs').promises;
      const stats = await stat(absolutePath);
      
      return {
        mtime: stats.mtime
      };
    } catch (error) {
      // File doesn't exist or other error
      return null;
    }
  });
}

/**
 * Set up tracking-related IPC handlers
 */
function setupTrackingHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  ipcMain.handle(IPC_CHANNELS.TRACKING.CREATE_SESSION, async (event, mode, language) => {
    try {
      const validatedMode = z.enum(['learning', 'quiz', 'dialog', 'flow']).parse(mode);
      const validatedLanguage = LanguageSchema.parse(language);
      const sessionId = await databaseLayer.createLearningSession({ mode: validatedMode, language: validatedLanguage });
      console.log(`[Tracking] Learning session created: id=${sessionId}, mode=${validatedMode}, language=${validatedLanguage}`);
      return sessionId;
    } catch (error) {
      console.error('Error creating learning session:', error);
      throw wrapError(error, `Failed to create learning session`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TRACKING.UPDATE_SESSION, async (event, sessionId, data) => {
    try {
      const validatedSessionId = z.number().int().positive().parse(sessionId);
      const validatedData = z.object({
        wordCount: z.number().int().nonnegative().optional(),
        sentenceCount: z.number().int().nonnegative().optional(),
        audioPlayedCount: z.number().int().nonnegative().optional()
      }).parse(data);
      await databaseLayer.updateLearningSession(validatedSessionId, validatedData);
      const counts = [
        validatedData.wordCount !== undefined ? `words=${validatedData.wordCount}` : null,
        validatedData.sentenceCount !== undefined ? `sentences=${validatedData.sentenceCount}` : null,
        validatedData.audioPlayedCount !== undefined ? `audio=${validatedData.audioPlayedCount}` : null
      ].filter(Boolean).join(', ');
      console.log(`[Tracking] Learning session updated: id=${validatedSessionId}${counts ? ', ' + counts : ''}`);
    } catch (error) {
      console.error('Error updating learning session:', error);
      throw wrapError(error, `Failed to update learning session`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TRACKING.RECORD_AUDIO_PLAYBACK, async (event, data) => {
    try {
      const validatedData = z.object({
        sessionId: z.number().int().positive().optional(),
        sentenceId: z.number().int().positive().optional(),
        audioPath: AudioPathSchema,
        language: LanguageSchema,
        mode: z.enum(['learning', 'quiz', 'dialog', 'flow']),
        playbackSpeed: z.number().min(0.1).max(3.0).optional()
      }).parse(data);
      const id = await databaseLayer.recordAudioPlayback(validatedData);
      console.log(`[Tracking] Audio playback: mode=${validatedData.mode}, language=${validatedData.language}, speed=${validatedData.playbackSpeed?.toFixed(1) || '1.0'}x, sentenceId=${validatedData.sentenceId || 'none'}, sessionId=${validatedData.sessionId || 'none'}`);
      return id;
    } catch (error) {
      console.error('Error recording audio playback:', error);
      throw wrapError(error, `Failed to record audio playback`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TRACKING.RECORD_NEGLECTED_WORDS, async (event, data) => {
    try {
      const validatedData = z.array(z.object({
        word: z.string().min(1),
        language: LanguageSchema,
        topic: z.string().optional(),
        translation: z.string().optional(),
        sessionId: z.number().int().positive().optional(),
        frequencyPosition: z.number().int().nonnegative().optional()
      })).parse(data);
      const count = await databaseLayer.recordNeglectedWords(validatedData);
      if (count > 0) {
        console.log(`[Tracking] Neglected words (batch): count=${count}, language=${validatedData[0]?.language || 'unknown'}, topic=${validatedData[0]?.topic || 'none'}`);
      }
      return count;
    } catch (error) {
      console.error('Error recording neglected words:', error);
      throw wrapError(error, `Failed to record neglected words`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.TRACKING.RECORD_DICTIONARY_HOVER, async (event, data) => {
    try {
      const validatedData = z.object({
        word: z.string().min(1),
        language: LanguageSchema,
        sentenceId: z.number().int().positive().optional(),
        sessionId: z.number().int().positive().optional(),
        hoverDurationMs: z.number().int().positive().min(1000), // Must be >= 1000ms
        dictionaryKey: z.string().optional(),
        foundInDict: z.boolean()
      }).parse(data);
      const id = await databaseLayer.recordDictionaryHover(validatedData);
      console.log(`[Tracking] Dictionary hover: word="${validatedData.word}", language=${validatedData.language}, duration=${validatedData.hoverDurationMs}ms, foundInDict=${validatedData.foundInDict}, sentenceId=${validatedData.sentenceId || 'none'}, sessionId=${validatedData.sessionId || 'none'}`);
      return id;
    } catch (error) {
      console.error('Error recording dictionary hover:', error);
      throw wrapError(error, `Failed to record dictionary hover`);
    }
  });
}

function setupLogHandlers(): void {
  const { getLogger } = require('../utils/logger.js');
  const logger = getLogger();

  ipcMain.handle(IPC_CHANNELS.LOG.LOG, async (event, level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', message: string, data?: any) => {
    try {
      // Validate level
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
      if (!validLevels.includes(level)) {
        throw new Error(`Invalid log level: ${level}`);
      }

      // Log with appropriate level
      if (data) {
        logger[level]({ ...data, process: 'renderer' }, message);
      } else {
        logger[level]({ process: 'renderer' }, message);
      }
    } catch (error) {
      // Fallback to console if logger is not available
      console.error('Error logging from renderer:', error);
    }
  });
}

/**
 * Set up Scoring-related IPC handlers
 */
export function setupScoringHandlers(scoringService: import('../scoring/scoring-service.js').ScoringService): void {
  ipcMain.handle(IPC_CHANNELS.SCORING.GET_NEXT_MODE, async (event, options: { currentMode: string | null; language: string | null; initialTakeover: boolean }) => {
    try {
      // Validate options - all are required
      if (options.currentMode !== null) {
        const ModeSchema = z.enum(['topic-selection', 'learning', 'quiz', 'dialog', 'flow']);
        ModeSchema.parse(options.currentMode);
      }
      
      if (options.language !== null) {
        const LanguageSchema = z.string().min(1).max(50);
        LanguageSchema.parse(options.language);
      }
      
      z.boolean().parse(options.initialTakeover);
      
      const result = await scoringService.getNextMode({
        currentMode: options.currentMode as 'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow' | null,
        language: options.language,
        initialTakeover: options.initialTakeover
      });
      
      return result;
    } catch (error) {
      const { getLogger } = require('../utils/logger.js');
      const logger = getLogger();
      logger.error({ error }, 'Error getting next mode');
      throw new Error(`Failed to get next mode: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
  
  const { getLogger } = require('../utils/logger.js');
  const logger = getLogger();
  logger.info({ channel: IPC_CHANNELS.SCORING.GET_NEXT_MODE }, 'Scoring IPC handler registered');
}

/**
 * Set up Proficiency-related IPC handlers
 */
export function setupProficiencyHandlers(proficiencyService: import('../scoring/proficiency-service.js').ProficiencyService): void {
  ipcMain.handle(IPC_CHANNELS.SCORING.GET_LANGUAGE_PROFICIENCY, async (event, language: string | null, timeWindowDays?: number) => {
    try {
      if (language !== null) {
        const LanguageSchema = z.string().min(1).max(50);
        LanguageSchema.parse(language);
      }
      
      if (timeWindowDays !== undefined) {
        z.number().int().min(1).max(365).parse(timeWindowDays);
      }
      
      const proficiency = await proficiencyService.calculateLanguageProficiency(
        language || '',
        timeWindowDays
      );
      
      return proficiency;
    } catch (error) {
      const { getLogger } = require('../utils/logger.js');
      const logger = getLogger();
      logger.error({ error }, 'Error calculating language proficiency');
      throw new Error(`Failed to calculate language proficiency: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
  
  const { getLogger } = require('../utils/logger.js');
  const logger = getLogger();
  logger.info({ channel: IPC_CHANNELS.SCORING.GET_LANGUAGE_PROFICIENCY }, 'Proficiency IPC handler registered');
}
