/**
 * IPC handlers for secure communication between main and renderer processes
 */

import { ipcMain, app } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/types/ipc.js';
import { SQLiteDatabaseLayer } from '../database/database-layer.js';
import { OllamaClient, ContentGenerator } from '../llm/index.js';
import { AudioService } from '../audio/audio-service.js';
import { LifecycleManager, UpdateManager } from '../lifecycle/index.js';
import { CreateWordRequest } from '../../shared/types/core.js';

// Validation schemas for input sanitization
const CreateWordSchema = z.object({
  word: z.string().min(1).max(100),
  translation: z.string().min(1).max(200),
  language: z.string().min(2).max(10),
  audioPath: z.string().optional()
});

const WordIdSchema = z.number().int().positive();
const StrengthSchema = z.number().int().min(0).max(100);
const BooleanSchema = z.boolean();
const LimitSchema = z.number().int().positive().max(1000);
const LanguageSchema = z.string().min(2).max(10);
const TextSchema = z.string().min(1).max(1000);
const TopicSchema = z.string().min(1).max(200);
const AudioPathSchema = z.string().min(1).max(500);

/**
 * Set up all IPC handlers with proper validation and error handling
 */
export function setupIPCHandlers(
  databaseLayer: SQLiteDatabaseLayer,
  llmClient: OllamaClient,
  contentGenerator: ContentGenerator,
  audioService: AudioService,
  lifecycleManager?: LifecycleManager,
  updateManager?: UpdateManager
): void {
  // Database handlers
  setupDatabaseHandlers(databaseLayer);
  
  // LLM handlers
  setupLLMHandlers(llmClient, contentGenerator);
  
  // Audio handlers
  setupAudioHandlers(audioService);

  // Quiz handlers
  setupQuizHandlers(databaseLayer);

  // Lifecycle handlers
  if (lifecycleManager && updateManager) {
    setupLifecycleHandlers(lifecycleManager, updateManager);
  }

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

  ipcMain.handle(IPC_CHANNELS.DATABASE.INSERT_SENTENCE, async (event, wordId, sentence, translation, audioPath) => {
    try {
      const validatedWordId = WordIdSchema.parse(wordId);
      const validatedSentence = TextSchema.parse(sentence);
      const validatedTranslation = TextSchema.parse(translation);
      const validatedAudioPath = z.string().parse(audioPath);
      
      return await databaseLayer.insertSentence(
        validatedWordId,
        validatedSentence,
        validatedTranslation,
        validatedAudioPath
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
}

/**
 * Set up LLM-related IPC handlers
 */
function setupLLMHandlers(llmClient: OllamaClient, contentGenerator: ContentGenerator): void {
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
        10
      );
    } catch (error) {
      console.error('Error generating words:', error);
      throw new Error(`Failed to generate words: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LLM.GENERATE_SENTENCES, async (event, word, language) => {
    try {
      const validatedWord = TextSchema.parse(word);
      const validatedLanguage = LanguageSchema.parse(language);
      
      // Use ContentGenerator for better error handling and validation
      return await contentGenerator.generateWordSentences(validatedWord, validatedLanguage, 3);
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
}

/**
 * Set up audio-related IPC handlers
 */
function setupAudioHandlers(audioService: AudioService): void {
  ipcMain.handle(IPC_CHANNELS.AUDIO.GENERATE_AUDIO, async (event, text, language) => {
    try {
      const validatedText = TextSchema.parse(text);
      const validatedLanguage = language ? LanguageSchema.parse(language) : undefined;
      
      return await audioService.generateAudio(validatedText, validatedLanguage);
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
      console.error('Error playing audio:', error);
      throw new Error(`Failed to play audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
 * Set up lifecycle-related IPC handlers
 */
function setupLifecycleHandlers(lifecycleManager: LifecycleManager, updateManager: UpdateManager): void {
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

  console.log('IPC handlers cleaned up');
}