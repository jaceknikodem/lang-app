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
  setupAudioHandlers(audioService);

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

  console.log('IPC handlers registered successfully');
}

/**
 * Set up database-related IPC handlers
 */
function setupDatabaseHandlers(databaseLayer: SQLiteDatabaseLayer): void {
  ipcMain.handle(IPC_CHANNELS.DATABASE.INSERT_WORD, async (event, wordData) => {
    try {
      const validatedData = CreateWordSchema.parse(wordData);
      return await databaseLayer.insertWord(validatedData);
    } catch (error) {
      console.error('Error inserting word:', error);
      throw new Error(`Failed to insert word: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.UPDATE_WORD_STRENGTH, async (event, wordId, strength) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      const validatedStrength = StrengthSchema.parse(strength);
      return await databaseLayer.updateWordStrength(validatedWordId, validatedStrength);
    } catch (error) {
      console.error('Error updating word strength:', error);
      throw new Error(`Failed to update word strength: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.MARK_WORD_KNOWN, async (event, wordId, known) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      const validatedKnown = BooleanSchema.parse(known);
      return await databaseLayer.markWordKnown(validatedWordId, validatedKnown);
    } catch (error) {
      console.error('Error marking word known:', error);
      throw new Error(`Failed to mark word known: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.MARK_WORD_IGNORED, async (event, wordId, ignored) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      const validatedIgnored = BooleanSchema.parse(ignored);
      return await databaseLayer.markWordIgnored(validatedWordId, validatedIgnored);
    } catch (error) {
      console.error('Error marking word ignored:', error);
      throw new Error(`Failed to mark word ignored: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_WORDS_TO_STUDY, async (event, limit) => {
    try {
      const validatedLimit = LimitSchema.parse(limit);
      return await databaseLayer.getWordsToStudy(validatedLimit);
    } catch (error) {
      console.error('Error getting words to study:', error);
      throw new Error(`Failed to get words to study: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_WORD_BY_ID, async (event, wordId) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      return await databaseLayer.getWordById(validatedWordId);
    } catch (error) {
      console.error('Error getting word by ID:', error);
      throw new Error(`Failed to get word by ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_WORDS_BY_IDS, async (event, wordIds) => {
    try {
      const validatedWordIds = WordIdsSchema.parse(wordIds);
      return await databaseLayer.getWordsByIds(validatedWordIds);
    } catch (error) {
      console.error('Error getting words by IDs:', error);
      throw new Error(`Failed to get words by IDs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.INSERT_SENTENCE, async (event, wordId, sentence, translation, audioPath, contextBefore, contextAfter, contextBeforeTranslation, contextAfterTranslation, sentenceParts, sentenceGenerationModel, audioGenerationService, audioGenerationModel) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      const validatedSentence = TextSchema.parse(sentence);
      const validatedTranslation = TextSchema.parse(translation);
      const validatedAudioPath = z.string().parse(audioPath);
      const validatedContextBefore = contextBefore ? TextSchema.parse(contextBefore) : undefined;
      const validatedContextAfter = contextAfter ? TextSchema.parse(contextAfter) : undefined;
      const validatedContextBeforeTranslation = contextBeforeTranslation ? TextSchema.parse(contextBeforeTranslation) : undefined;
      const validatedContextAfterTranslation = contextAfterTranslation ? TextSchema.parse(contextAfterTranslation) : undefined;
      const validatedSentenceParts = sentenceParts ? z.array(z.string()).parse(sentenceParts) : undefined;
      const validatedSentenceGenerationModel = sentenceGenerationModel ? z.string().parse(sentenceGenerationModel) : undefined;
      const validatedAudioGenerationService = audioGenerationService ? z.string().parse(audioGenerationService) : undefined;
      const validatedAudioGenerationModel = audioGenerationModel ? z.string().parse(audioGenerationModel) : undefined;

      return await databaseLayer.insertSentence(
        validatedWordId,
        validatedSentence,
        validatedTranslation,
        validatedAudioPath,
        validatedContextBefore,
        validatedContextAfter,
        validatedContextBeforeTranslation,
        validatedContextAfterTranslation,
        validatedSentenceParts
      );
    } catch (error) {
      console.error('Error inserting sentence:', error);
      throw new Error(`Failed to insert sentence: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_SENTENCES_BY_WORD, async (event, wordId) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      return await databaseLayer.getSentencesByWord(validatedWordId);
    } catch (error) {
      console.error('Error getting sentences by word:', error);
      throw new Error(`Failed to get sentences by word: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_SENTENCES_BY_IDS, async (event, sentenceIds) => {
    try {
      const validatedSentenceIds = SentenceIdsSchema.parse(sentenceIds);
      return await databaseLayer.getSentencesByIds(validatedSentenceIds);
    } catch (error) {
      console.error('Error getting sentences by IDs:', error);
      throw new Error(`Failed to get sentences by IDs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.DELETE_SENTENCE, async (event, sentenceId) => {
    try {
      const validatedSentenceId = SentenceIdSchema.parse(sentenceId);
      await databaseLayer.deleteSentence(validatedSentenceId);
    } catch (error) {
      console.error('Error deleting sentence:', error);
      throw new Error(`Failed to delete sentence: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.UPDATE_SENTENCE_LAST_SHOWN, async (event, sentenceId) => {
    try {
      const validatedSentenceId = SentenceIdSchema.parse(sentenceId);
      return await databaseLayer.updateSentenceLastShown(validatedSentenceId);
    } catch (error) {
      console.error('Error updating sentence last shown:', error);
      throw new Error(`Failed to update sentence last shown: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.UPDATE_SENTENCE_AUDIO_PATH, async (event, sentenceId, audioPath) => {
    try {
      const validatedSentenceId = SentenceIdSchema.parse(sentenceId);
      const validatedAudioPath = AudioPathSchema.parse(audioPath);
      return await databaseLayer.updateSentenceAudioPath(validatedSentenceId, validatedAudioPath);
    } catch (error) {
      console.error('Error updating sentence audio path:', error);
      throw new Error(`Failed to update sentence audio path: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.UPDATE_LAST_STUDIED, async (event, wordId) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      return await databaseLayer.updateLastStudied(validatedWordId);
    } catch (error) {
      console.error('Error updating last studied:', error);
      throw new Error(`Failed to update last studied: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_STUDY_STATS, async (event) => {
    try {
      return await databaseLayer.getStudyStats();
    } catch (error) {
      console.error('Error getting study stats:', error);
      throw new Error(`Failed to get study stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.RECORD_STUDY_SESSION, async (event, wordsStudied) => {
    try {
      const validatedWordsStudied = z.number().int().min(0).parse(wordsStudied);
      return await databaseLayer.recordStudySession(validatedWordsStudied);
    } catch (error) {
      console.error('Error recording study session:', error);
      throw new Error(`Failed to record study session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_ALL_WORDS, async (event, includeKnown, includeIgnored) => {
    try {
      const validatedIncludeKnown = includeKnown !== undefined ? BooleanSchema.parse(includeKnown) : true;
      const validatedIncludeIgnored = includeIgnored !== undefined ? BooleanSchema.parse(includeIgnored) : false;
      return await databaseLayer.getAllWords(validatedIncludeKnown, validatedIncludeIgnored);
    } catch (error) {
      console.error('Error getting all words:', error);
      throw new Error(`Failed to get all words: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_WORDS_WITH_SENTENCES, async (event, includeKnown, includeIgnored) => {
    try {
      const validatedIncludeKnown = includeKnown !== undefined ? BooleanSchema.parse(includeKnown) : true;
      const validatedIncludeIgnored = includeIgnored !== undefined ? BooleanSchema.parse(includeIgnored) : false;
      return await databaseLayer.getWordsWithSentences(validatedIncludeKnown, validatedIncludeIgnored);
    } catch (error) {
      console.error('Error getting words with sentences:', error);
      throw new Error(`Failed to get words with sentences: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_WORDS_WITH_SENTENCES_ORDERED_BY_STRENGTH, async (event, includeKnown, includeIgnored) => {
    try {
      const validatedIncludeKnown = includeKnown !== undefined ? BooleanSchema.parse(includeKnown) : true;
      const validatedIncludeIgnored = includeIgnored !== undefined ? BooleanSchema.parse(includeIgnored) : false;
      return await databaseLayer.getWordsWithSentencesOrderedByStrength(validatedIncludeKnown, validatedIncludeIgnored);
    } catch (error) {
      console.error('Error getting words with sentences ordered by strength:', error);
      throw new Error(`Failed to get words with sentences ordered by strength: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_RECENT_STUDY_SESSIONS, async (event, limit) => {
    try {
      const validatedLimit = limit !== undefined ? LimitSchema.parse(limit) : 10;
      return await databaseLayer.getRecentStudySessions(validatedLimit);
    } catch (error) {
      console.error('Error getting recent study sessions:', error);
      throw new Error(`Failed to get recent study sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_SETTING, async (event, key) => {
    try {
      const validatedKey = z.string().min(1).max(100).parse(key);
      return await databaseLayer.getSetting(validatedKey);
    } catch (error) {
      console.error('Error getting setting:', error);
      throw new Error(`Failed to get setting: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.SET_SETTING, async (event, key, value) => {
    try {
      const validatedKey = z.string().min(1).max(100).parse(key);
      const validatedValue = z.string().max(1000).parse(value);
      return await databaseLayer.setSetting(validatedKey, validatedValue);
    } catch (error) {
      console.error('Error setting setting:', error);
      throw new Error(`Failed to set setting: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_CURRENT_LANGUAGE, async (event) => {
    try {
      return await databaseLayer.getCurrentLanguage();
    } catch (error) {
      console.error('Error getting current language:', error);
      throw new Error(`Failed to get current language: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.SET_CURRENT_LANGUAGE, async (event, language) => {
    try {
      const validatedLanguage = LanguageSchema.parse(language);
      return await databaseLayer.setCurrentLanguage(validatedLanguage);
    } catch (error) {
      console.error('Error setting current language:', error);
      throw new Error(`Failed to set current language: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_AVAILABLE_LANGUAGES, async (event) => {
    try {
      return await databaseLayer.getAvailableLanguages();
    } catch (error) {
      console.error('Error getting available languages:', error);
      throw new Error(`Failed to get available languages: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_LANGUAGE_STATS, async (event) => {
    try {
      return await databaseLayer.getLanguageStats();
    } catch (error) {
      console.error('Error getting language stats:', error);
      throw new Error(`Failed to get language stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATABASE.LOOKUP_DICTIONARY, async (event, word, language) => {
    try {
      const validatedWord = DictionaryWordSchema.parse(word);
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      return await databaseLayer.lookupDictionary(validatedWord, validatedLanguage);
    } catch (error) {
      console.error('Error looking up dictionary entry:', error);
      throw new Error(`Failed to lookup dictionary entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
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
      throw new Error(`Failed to generate words: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to generate sentences: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to set model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GET_CURRENT_MODEL, async (event) => {
    try {
      return llmClient.getCurrentModel();
    } catch (error) {
      console.error('Error getting current model:', error);
      throw new Error(`Failed to get current model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.SET_WORD_GENERATION_MODEL, async (event, model) => {
    try {
      const validatedModel = z.string().min(1).parse(model);
      llmClient.setWordGenerationModel(validatedModel);
    } catch (error) {
      console.error('Error setting word generation model:', error);
      throw new Error(`Failed to set word generation model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.SET_SENTENCE_GENERATION_MODEL, async (event, model) => {
    try {
      const validatedModel = z.string().min(1).parse(model);
      llmClient.setSentenceGenerationModel(validatedModel);
    } catch (error) {
      console.error('Error setting sentence generation model:', error);
      throw new Error(`Failed to set sentence generation model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GET_WORD_GENERATION_MODEL, async (event) => {
    try {
      return llmClient.getWordGenerationModel();
    } catch (error) {
      console.error('Error getting word generation model:', error);
      throw new Error(`Failed to get word generation model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GET_SENTENCE_GENERATION_MODEL, async (event) => {
    try {
      return llmClient.getSentenceGenerationModel();
    } catch (error) {
      console.error('Error getting sentence generation model:', error);
      throw new Error(`Failed to get sentence generation model: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to get frequency progress: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FREQUENCY.GET_AVAILABLE_LANGUAGES, async (event) => {
    try {
      return contentGenerator.getAvailableFrequencyLanguages();
    } catch (error) {
      console.error('Error getting available frequency languages:', error);
      throw new Error(`Failed to get available frequency languages: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Provider management handlers
  ipcMain.handle(IPC_CHANNELS.LLM.GET_CURRENT_PROVIDER, async (event) => {
    try {
      return contentGenerator.getCurrentProvider();
    } catch (error) {
      console.error('Error getting current provider:', error);
      throw new Error(`Failed to get current provider: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to switch provider: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to set Gemini API key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GET_AVAILABLE_PROVIDERS, async (event) => {
    try {
      return LLMFactory.getAvailableProviders();
    } catch (error) {
      console.error('Error getting available providers:', error);
      throw new Error(`Failed to get available providers: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to get models for provider: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
}

/**
 * Set up audio-related IPC handlers
 */
function setupAudioHandlers(audioService: AudioService): void {
  ipcMain.handle(IPC_CHANNELS.AUDIO.GENERATE_AUDIO, async (event, text, language, word) => {
    try {
      const validatedText = TextSchema.parse(text);
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      const validatedWord = word ? TextSchema.parse(word) : undefined;

      return await audioService.generateAudio(validatedText, validatedLanguage, validatedWord);
    } catch (error) {
      console.error('Error generating audio:', error);
      throw new Error(`Failed to generate audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.PLAY_AUDIO, async (event, audioPath) => {
    try {
      const validatedAudioPath = AudioPathSchema.parse(audioPath);
      return await audioService.playAudio(validatedAudioPath);
    } catch (error) {
      // Check if this is an AudioError with a code
      if (error instanceof Error && 'code' in error) {
        const audioError = error as { code: string };
        // Don't log PLAYBACK_STOPPED errors - they're expected/intentional
        if (audioError.code === 'PLAYBACK_STOPPED') {
          throw error; // Re-throw as-is without logging
        }
        // For other AudioErrors, log and re-throw as-is
        console.error('Error playing audio:', error);
        throw error; // Re-throw AudioError as-is to preserve code
      }
      // For non-AudioError errors, wrap and log
      console.error('Error playing audio:', error);
      throw new Error(`Failed to play audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.STOP_AUDIO, async (event) => {
    try {
      audioService.stopAudio();
    } catch (error) {
      console.error('Error stopping audio:', error);
      throw new Error(`Failed to stop audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
        existingPath: AudioPathSchema.optional()
      }).parse(payload ?? {});

      const audioPath = await audioService.regenerateAudio(
        validatedPayload.text,
        validatedPayload.language,
        validatedPayload.word,
        validatedPayload.existingPath
      );

      return { audioPath };
    } catch (error) {
      console.error('Error regenerating audio:', error);
      throw new Error(`Failed to regenerate audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to start recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.STOP_RECORDING, async (event) => {
    try {
      return await audioService.stopRecording();
    } catch (error) {
      console.error('Error stopping recording:', error);
      throw new Error(`Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.CANCEL_RECORDING, async (event) => {
    try {
      await audioService.cancelRecording();
    } catch (error) {
      console.error('Error cancelling recording:', error);
      throw new Error(`Failed to cancel recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to delete recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      const validatedOptions = options ? z.object({
        language: z.string().optional(),
        model: z.enum(['tiny', 'base', 'small', 'medium', 'large']).optional(),
        temperature: z.number().optional(),
        best_of: z.number().optional(),
        beam_size: z.number().optional(),
        patience: z.number().optional(),
        length_penalty: z.number().optional(),
        suppress_tokens: z.string().optional(),
        initial_prompt: z.string().optional(),
        condition_on_previous_text: z.boolean().optional(),
        fp16: z.boolean().optional(),
        compression_ratio_threshold: z.number().optional(),
        logprob_threshold: z.number().optional(),
        no_speech_threshold: z.number().optional()
      }).parse(options) : undefined;

      // Create progress callback that sends IPC events
      const transcriptionOptions = validatedOptions ? {
        ...validatedOptions,
        onProgress: (text: string, isFinal: boolean) => {
          // Send progress updates via IPC event
          event.sender.send(IPC_CHANNELS.AUDIO.TRANSCRIBE_AUDIO_PROGRESS, {
            text,
            isFinal
          });
        }
      } : {
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
      throw new Error(`Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.COMPARE_TRANSCRIPTION, async (event, transcribed, expected) => {
    try {
      const validatedTranscribed = TextSchema.parse(transcribed);
      const validatedExpected = TextSchema.parse(expected);
      
      return audioService.compareTranscription(validatedTranscribed, validatedExpected);
    } catch (error) {
      console.error('Error comparing transcription:', error);
      throw new Error(`Failed to compare transcription: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to switch to ElevenLabs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO.SWITCH_TO_SYSTEM_TTS, async (event) => {
    try {
      await audioService.switchToSystemTTS();
    } catch (error) {
      console.error('Error switching to system TTS:', error);
      throw new Error(`Failed to switch to system TTS: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to get weakest words: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.QUIZ.GET_RANDOM_SENTENCE_FOR_WORD, async (event, wordId) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      return await databaseLayer.getRandomSentenceForWord(validatedWordId);
    } catch (error) {
      console.error('Error getting random sentence for word:', error);
      throw new Error(`Failed to get random sentence for word: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to process review: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.PROCESS_QUIZ_RESULTS, async (event, results) => {
    try {
      const validatedResults = z.array(z.object({
        wordId: WordIdSchema,
        correct: BooleanSchema,
        responseTime: z.number().optional(),
        difficulty: z.enum(['easy', 'medium', 'hard']).optional()
      })).parse(results);
      return await srsService.processQuizResults(validatedResults);
    } catch (error) {
      console.error('Error processing quiz results:', error);
      throw new Error(`Failed to process quiz results: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.GET_TODAYS_STUDY_WORDS, async (event, maxWords, language) => {
    try {
      const validatedMaxWords = maxWords ? LimitSchema.parse(maxWords) : undefined;
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      return await srsService.getTodaysStudyWords(validatedMaxWords, validatedLanguage);
    } catch (error) {
      console.error('Error getting todays study words:', error);
      throw new Error(`Failed to get todays study words: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.GET_DASHBOARD_STATS, async (event, language) => {
    try {
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      return await srsService.getDashboardStats(validatedLanguage);
    } catch (error) {
      console.error('Error getting dashboard stats:', error);
      throw new Error(`Failed to get dashboard stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.MARK_WORD_DIFFICULTY, async (event, wordId, difficulty) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      const validatedDifficulty = z.enum(['easy', 'hard']).parse(difficulty);
      return await srsService.markWordDifficulty(validatedWordId, validatedDifficulty);
    } catch (error) {
      console.error('Error marking word difficulty:', error);
      throw new Error(`Failed to mark word difficulty: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.RESET_WORD_PROGRESS, async (event, wordId) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      return await srsService.resetWordProgress(validatedWordId);
    } catch (error) {
      console.error('Error resetting word progress:', error);
      throw new Error(`Failed to reset word progress: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.GET_OVERDUE_WORDS, async (event, language) => {
    try {
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      return await srsService.getOverdueWords(validatedLanguage);
    } catch (error) {
      console.error('Error getting overdue words:', error);
      throw new Error(`Failed to get overdue words: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SRS.INITIALIZE_EXISTING_WORDS, async (event, language) => {
    try {
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      return await srsService.initializeExistingWords(validatedLanguage);
    } catch (error) {
      console.error('Error initializing existing words:', error);
      throw new Error(`Failed to initialize existing words: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to enqueue word generation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.JOBS.GET_WORD_STATUS, async (event, wordId) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      return await databaseLayer.getWordProcessingInfo(validatedWordId);
    } catch (error) {
      console.error('Error getting word processing status:', error);
      throw new Error(`Failed to get word status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.JOBS.GET_QUEUE_SUMMARY, async (_event, language) => {
    try {
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      return await databaseLayer.getWordGenerationQueueSummary(validatedLanguage);
    } catch (error) {
      console.error('Error getting queue summary:', error);
      throw new Error(`Failed to get queue summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LIFECYCLE.RESTORE_FROM_BACKUP, async (event, backupPath) => {
    try {
      const validatedBackupPath = z.string().min(1).parse(backupPath);
      await lifecycleManager.restoreFromBackup(validatedBackupPath);
    } catch (error) {
      console.error('Error restoring from backup:', error);
      throw new Error(`Failed to restore from backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to get app version: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      return await dialogService.selectSentence();
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
      
      // Generate variants
      return await dialogService.generateDialogueVariants(sentence, existingVariants);
    } catch (error) {
      console.error('Error generating dialogue variants:', error);
      throw new Error(`Failed to generate variants: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG.GENERATE_FOLLOW_UP, async (event, variantId) => {
    try {
      const validatedVariantId = VariantIdSchema.parse(variantId); // Use VariantIdSchema to allow negative IDs
      
      // Generate follow-up (will check cache and generate if needed)
      const followUp = await dialogService.generateFollowUp(validatedVariantId);
      
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
              `_continuation_${validatedVariantId}`
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
            `_continuation_${validatedVariantId}`
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
      // Pre-generate a dialog session (non-blocking - can fail silently)
      const session = await dialogService.pregenerateSession();
      if (!session) {
        return null;
      }

      // Generate audio if needed (non-blocking - don't fail if audio generation fails)
      let beforeSentenceAudio: string | undefined;
      if (session.contextBefore) {
        try {
          const audioPath = await audioService.generateAudio(
            session.contextBefore,
            await databaseLayer.getCurrentLanguage(),
            '_before_sentence'
          );
          
          // Check if audio was generated successfully
          if (audioPath && await audioService.audioExists(audioPath)) {
            beforeSentenceAudio = audioPath;
          }
        } catch (error) {
          console.warn('[IPC] Failed to generate beforeSentence audio during pre-generation:', error);
          // Continue without audio
        }
      }

      // Convert Date objects to ISO strings for IPC transfer
      return {
        ...session,
        beforeSentenceAudio,
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

      // Check if audio already exists for beforeSentence
      // We'll use a path pattern: audio/<lang>/_before_sentence_<sentence_id>.mp3
      const language = await databaseLayer.getCurrentLanguage();
      const audioPath = `audio/${language}/_before_sentence_${validatedSentenceId}.mp3`;
      
      const exists = await audioService.audioExists(audioPath);
      if (exists) {
        return audioPath;
      }

      // Generate audio with ElevenLabs (or fall back to system TTS)
      const generatedPath = await audioService.generateAudio(
        sentence.contextBefore,
        language,
        '_before_sentence'
      );

      return generatedPath;
    } catch (error) {
      console.error('Error ensuring before sentence audio:', error);
      throw new Error(`Failed to ensure before sentence audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
}
