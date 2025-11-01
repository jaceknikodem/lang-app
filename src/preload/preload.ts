/**
 * Electron preload script for secure IPC communication
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types/ipc.js';

console.log('Preload script loaded!');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  database: {
    insertWord: (word: any) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE.INSERT_WORD, word),
    updateWordStrength: (wordId: number, strength: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.UPDATE_WORD_STRENGTH, wordId, strength),
    markWordKnown: (wordId: number, known: boolean) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.MARK_WORD_KNOWN, wordId, known),
    markWordIgnored: (wordId: number, ignored: boolean) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.MARK_WORD_IGNORED, wordId, ignored),
    getWordsToStudy: (limit: number, language?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_WORDS_TO_STUDY, limit, language),
    getWordById: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_WORD_BY_ID, wordId),
    getWordsByIds: (wordIds: number[]) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_WORDS_BY_IDS, wordIds),
    getAllWords: (includeKnown?: boolean, includeIgnored?: boolean, language?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_ALL_WORDS, includeKnown, includeIgnored, language),
    getWordsWithSentences: (includeKnown?: boolean, includeIgnored?: boolean, language?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_WORDS_WITH_SENTENCES, includeKnown, includeIgnored, language),
    getWordsWithSentencesOrderedByStrength: (includeKnown?: boolean, includeIgnored?: boolean, language?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_WORDS_WITH_SENTENCES_ORDERED_BY_STRENGTH, includeKnown, includeIgnored, language),
    getRecentStudySessions: (limit?: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_RECENT_STUDY_SESSIONS, limit),
    insertSentence: (
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
      audioGenerationModel?: string
    ) => 
      ipcRenderer.invoke(
        IPC_CHANNELS.DATABASE.INSERT_SENTENCE,
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
        audioGenerationModel
      ),
    getSentencesByWord: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_SENTENCES_BY_WORD, wordId),
    getSentencesByIds: (sentenceIds: number[]) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_SENTENCES_BY_IDS, sentenceIds),
    deleteSentence: (sentenceId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.DELETE_SENTENCE, sentenceId),
    updateSentenceLastShown: (sentenceId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.UPDATE_SENTENCE_LAST_SHOWN, sentenceId),
    updateSentenceAudioPath: (sentenceId: number, audioPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.UPDATE_SENTENCE_AUDIO_PATH, sentenceId, audioPath),
    incrementSentencePlayCount: (sentenceId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.INCREMENT_SENTENCE_PLAY_COUNT, sentenceId),
    updateLastStudied: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.UPDATE_LAST_STUDIED, wordId),
    getStudyStats: (language?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_STUDY_STATS, language),
    recordStudySession: (wordsStudied: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.RECORD_STUDY_SESSION, wordsStudied),
    getSetting: (key: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_SETTING, key),
    setSetting: (key: string, value: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.SET_SETTING, key, value),
    getCurrentLanguage: () => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_CURRENT_LANGUAGE),
    setCurrentLanguage: (language: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.SET_CURRENT_LANGUAGE, language),
    getAvailableLanguages: () => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_AVAILABLE_LANGUAGES),
    getLanguageStats: () => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_LANGUAGE_STATS),
    lookupDictionary: (word: string, language?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.LOOKUP_DICTIONARY, word, language)
  },

  // LLM operations
  llm: {
    generateWords: (topic: string | undefined, language: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GENERATE_WORDS, topic, language),
    generateSentences: (word: string, language: string, topic?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GENERATE_SENTENCES, word, language, topic),
    isAvailable: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.IS_AVAILABLE),
    getAvailableModels: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GET_AVAILABLE_MODELS),
    setModel: (model: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.SET_MODEL, model),
    getCurrentModel: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GET_CURRENT_MODEL),
    setWordGenerationModel: (model: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.SET_WORD_GENERATION_MODEL, model),
    setSentenceGenerationModel: (model: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.SET_SENTENCE_GENERATION_MODEL, model),
    getWordGenerationModel: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GET_WORD_GENERATION_MODEL),
    getSentenceGenerationModel: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GET_SENTENCE_GENERATION_MODEL),
    // Provider management
    getCurrentProvider: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GET_CURRENT_PROVIDER),
    switchProvider: (provider: 'ollama' | 'gemini', geminiApiKey?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.SWITCH_PROVIDER, provider, geminiApiKey),
    setGeminiApiKey: (apiKey: string, switchToGemini?: boolean) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.SET_GEMINI_API_KEY, apiKey, switchToGemini),
    getAvailableProviders: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GET_AVAILABLE_PROVIDERS),
    getModelsForProvider: (provider: 'ollama' | 'gemini') => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GET_MODELS_FOR_PROVIDER, provider)
  },

  // Audio operations
  audio: {
    generateAudio: (text: string, language: string, word?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.GENERATE_AUDIO, text, language, word),
    playAudio: (audioPath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.PLAY_AUDIO, audioPath),
    stopAudio: () => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.STOP_AUDIO),
    audioExists: (audioPath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.AUDIO_EXISTS, audioPath),
    normalizeAudioVolume: (audioPath: string, targetDb?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.NORMALIZE_AUDIO_VOLUME, audioPath, targetDb),
    loadAudioBase64: (audioPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.LOAD_AUDIO_BASE64, audioPath),
    regenerateAudio: (options: { text: string; language?: string; word?: string; existingPath?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.REGENERATE_AUDIO, options),
    startRecording: (options?: any) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.START_RECORDING, options),
    stopRecording: () => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.STOP_RECORDING),
    cancelRecording: () => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.CANCEL_RECORDING),
    getCurrentRecordingSession: () => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.GET_CURRENT_RECORDING_SESSION),
    isRecording: () => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.IS_RECORDING),
    getAvailableRecordingDevices: () => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.GET_AVAILABLE_RECORDING_DEVICES),
    deleteRecording: (filePath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.DELETE_RECORDING, filePath),
    getRecordingInfo: (filePath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.GET_RECORDING_INFO, filePath),
    initializeSpeechRecognition: () => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.INITIALIZE_SPEECH_RECOGNITION),
    transcribeAudio: (filePath: string, options?: any) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.TRANSCRIBE_AUDIO, filePath, options),
    onTranscriptionProgress: (
      callback: (payload: { text: string; isFinal: boolean }) => void
    ) => {
      const channel = IPC_CHANNELS.AUDIO.TRANSCRIBE_AUDIO_PROGRESS;
      const listener = (_event: Electron.IpcRendererEvent, payload: { text: string; isFinal: boolean }) => {
        callback(payload);
      };
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },
    compareTranscription: (transcribed: string, expected: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.COMPARE_TRANSCRIPTION, transcribed, expected),
    isSpeechRecognitionReady: () => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.IS_SPEECH_RECOGNITION_READY),
    switchToElevenLabs: (apiKey: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.SWITCH_TO_ELEVENLABS, apiKey),
    switchToSystemTTS: () => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.SWITCH_TO_SYSTEM_TTS)
  },

  // Quiz operations
  quiz: {
    getWeakestWords: (limit: number, language?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.QUIZ.GET_WEAKEST_WORDS, limit, language),
    getRandomSentenceForWord: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.QUIZ.GET_RANDOM_SENTENCE_FOR_WORD, wordId)
  },

  // Lifecycle operations
  lifecycle: {
    createBackup: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.CREATE_BACKUP),
    restoreFromBackup: (backupPath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.RESTORE_FROM_BACKUP, backupPath),
    checkForUpdates: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.CHECK_FOR_UPDATES),
    getAppVersion: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.GET_APP_VERSION),
    restartAll: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.RESTART_ALL),
    openBackupDialog: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.OPEN_BACKUP_DIALOG),
    openBackupDirectory: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.OPEN_BACKUP_DIRECTORY),
    closeApp: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.CLOSE_APP)
  },

  // Frequency word management
  frequency: {
    getProgress: (language: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.FREQUENCY.GET_PROGRESS, language),
    getAvailableLanguages: () => 
      ipcRenderer.invoke(IPC_CHANNELS.FREQUENCY.GET_AVAILABLE_LANGUAGES)
  },

  jobs: {
    enqueueWordGeneration: (
      wordId: number,
      options?: { language?: string; topic?: string; desiredSentenceCount?: number }
    ) => ipcRenderer.invoke(IPC_CHANNELS.JOBS.ENQUEUE_WORD_GENERATION, wordId, options),
    getWordStatus: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.JOBS.GET_WORD_STATUS, wordId),
    getQueueSummary: (language?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.JOBS.GET_QUEUE_SUMMARY, language),
    onWordUpdated: (
      callback: (payload: { wordId: number; processingStatus: 'queued' | 'processing' | 'ready' | 'failed'; sentenceCount: number }) => void
    ) => {
      const channel = IPC_CHANNELS.JOBS.WORD_UPDATED;
      const listener = (_event: Electron.IpcRendererEvent, payload: { wordId: number; processingStatus: 'queued' | 'processing' | 'ready' | 'failed'; sentenceCount: number }) => {
        callback(payload);
      };
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    }
  },

  // SRS operations
  srs: {
    processReview: (wordId: number, recall: 0 | 1 | 2 | 3) => 
      ipcRenderer.invoke(IPC_CHANNELS.SRS.PROCESS_REVIEW, wordId, recall),
    processQuizResults: (results: Array<{
      wordId: number;
      correct: boolean;
      responseTime?: number;
      difficulty?: 'easy' | 'medium' | 'hard';
    }>) => 
      ipcRenderer.invoke(IPC_CHANNELS.SRS.PROCESS_QUIZ_RESULTS, results),
    getTodaysStudyWords: (maxWords?: number, language?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.SRS.GET_TODAYS_STUDY_WORDS, maxWords, language),
    getDashboardStats: (language?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.SRS.GET_DASHBOARD_STATS, language),
    markWordDifficulty: (wordId: number, difficulty: 'easy' | 'hard') => 
      ipcRenderer.invoke(IPC_CHANNELS.SRS.MARK_WORD_DIFFICULTY, wordId, difficulty),
    resetWordProgress: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.SRS.RESET_WORD_PROGRESS, wordId),
      getOverdueWords: (language?: string) => 
        ipcRenderer.invoke(IPC_CHANNELS.SRS.GET_OVERDUE_WORDS, language),
      initializeExistingWords: (language?: string) => 
        ipcRenderer.invoke(IPC_CHANNELS.SRS.INITIALIZE_EXISTING_WORDS, language)
    },

    // Lemmatization operations
    lemmatization: {
      getStatus: () => 
        ipcRenderer.invoke(IPC_CHANNELS.LEMMATIZATION.GET_STATUS),
      loadModel: (language: string) => 
        ipcRenderer.invoke(IPC_CHANNELS.LEMMATIZATION.LOAD_MODEL, language),
      lemmatizeWords: (words: string[], language: string) => 
        ipcRenderer.invoke(IPC_CHANNELS.LEMMATIZATION.LEMMATIZE_WORDS, words, language)
    },

    // Dialog operations
    dialog: {
      selectSentence: () => 
        ipcRenderer.invoke(IPC_CHANNELS.DIALOG.SELECT_SENTENCE),
      generateVariants: (sentenceId: number) => 
        ipcRenderer.invoke(IPC_CHANNELS.DIALOG.GENERATE_VARIANTS, sentenceId),
      generateFollowUp: (variantId: number) => 
        ipcRenderer.invoke(IPC_CHANNELS.DIALOG.GENERATE_FOLLOW_UP, variantId),
      ensureBeforeSentenceAudio: (sentenceId: number) => 
        ipcRenderer.invoke(IPC_CHANNELS.DIALOG.ENSURE_BEFORE_SENTENCE_AUDIO, sentenceId),
      pregenerateSession: () => 
        ipcRenderer.invoke(IPC_CHANNELS.DIALOG.PREGENERATE_SESSION),
      pregenerateSessions: (count: number) =>
        ipcRenderer.invoke(IPC_CHANNELS.DIALOG.PREGENERATE_SESSIONS, count)
    }
  });

// Type declaration for the exposed API
declare global {
  interface Window {
    electronAPI: {
      database: {
        insertWord: (word: any) => Promise<number>;
        updateWordStrength: (wordId: number, strength: number) => Promise<void>;
        markWordKnown: (wordId: number, known: boolean) => Promise<void>;
        markWordIgnored: (wordId: number, ignored: boolean) => Promise<void>;
        getWordsToStudy: (limit: number, language?: string) => Promise<any[]>;
        getWordById: (wordId: number) => Promise<any | null>;
        getWordsByIds: (wordIds: number[]) => Promise<any[]>;
        getAllWords: (includeKnown?: boolean, includeIgnored?: boolean, language?: string) => Promise<any[]>;
        getWordsWithSentences: (includeKnown?: boolean, includeIgnored?: boolean, language?: string) => Promise<any[]>;
        getWordsWithSentencesOrderedByStrength: (includeKnown?: boolean, includeIgnored?: boolean, language?: string) => Promise<any[]>;
        getRecentStudySessions: (limit?: number) => Promise<any[]>;
        insertSentence: (wordId: number, sentence: string, translation: string, audioPath: string, contextBefore?: string, contextAfter?: string, contextBeforeTranslation?: string, contextAfterTranslation?: string) => Promise<number>;
        getSentencesByWord: (wordId: number) => Promise<any[]>;
        getSentencesByIds: (sentenceIds: number[]) => Promise<any[]>;
        deleteSentence: (sentenceId: number) => Promise<void>;
        updateSentenceLastShown: (sentenceId: number) => Promise<void>;
        updateSentenceAudioPath: (sentenceId: number, audioPath: string) => Promise<void>;
        incrementSentencePlayCount: (sentenceId: number) => Promise<void>;
        updateLastStudied: (wordId: number) => Promise<void>;
        getStudyStats: (language?: string) => Promise<any>;
        recordStudySession: (wordsStudied: number) => Promise<void>;
        getSetting: (key: string) => Promise<string | null>;
        setSetting: (key: string, value: string) => Promise<void>;
        getCurrentLanguage: () => Promise<string>;
        setCurrentLanguage: (language: string) => Promise<void>;
        getAvailableLanguages: () => Promise<string[]>;
        getLanguageStats: () => Promise<Array<{language: string, totalWords: number, studiedWords: number}>>;
        lookupDictionary: (word: string, language?: string) => Promise<Array<{
          word: string;
          pos: string;
          glosses: string[];
          lang: string;
        }>>;
      };
      llm: {
        generateWords: (topic: string | undefined, language: string) => Promise<any[]>;
        generateSentences: (word: string, language: string, topic?: string) => Promise<any[]>;
        isAvailable: () => Promise<boolean>;
        getAvailableModels: () => Promise<string[]>;
        setModel: (model: string) => Promise<void>;
        getCurrentModel: () => Promise<string>;
        setWordGenerationModel: (model: string) => Promise<void>;
        setSentenceGenerationModel: (model: string) => Promise<void>;
        getWordGenerationModel: () => Promise<string>;
        getSentenceGenerationModel: () => Promise<string>;
        // Provider management
        getCurrentProvider: () => Promise<'ollama' | 'gemini'>;
        switchProvider: (provider: 'ollama' | 'gemini', geminiApiKey?: string) => Promise<void>;
        setGeminiApiKey: (apiKey: string, switchToGemini?: boolean) => Promise<void>;
        getAvailableProviders: () => Promise<Array<'ollama' | 'gemini'>>;
        getModelsForProvider: (provider: 'ollama' | 'gemini') => Promise<string[]>;
      };
      audio: {
        generateAudio: (text: string, language?: string, word?: string) => Promise<string>;
        playAudio: (audioPath: string) => Promise<void>;
        stopAudio: () => Promise<void>;
        audioExists: (audioPath: string) => Promise<boolean>;
        normalizeAudioVolume: (audioPath: string, targetDb?: number) => Promise<string | null>;
        loadAudioBase64: (audioPath: string) => Promise<{ data: ArrayBuffer; mimeType: string } | null>;
        regenerateAudio: (options: { text: string; language?: string; word?: string; existingPath?: string }) => Promise<{ audioPath: string }>;
        startRecording: (options?: any) => Promise<any>;
        stopRecording: () => Promise<any>;
        cancelRecording: () => Promise<void>;
        getCurrentRecordingSession: () => Promise<any>;
        isRecording: () => Promise<boolean>;
        getAvailableRecordingDevices: () => Promise<string[]>;
        deleteRecording: (filePath: string) => Promise<void>;
        getRecordingInfo: (filePath: string) => Promise<{ size: number; duration?: number } | null>;
        initializeSpeechRecognition: () => Promise<void>;
        transcribeAudio: (filePath: string, options?: any) => Promise<any>;
        onTranscriptionProgress: (
          callback: (payload: { text: string; isFinal: boolean }) => void
        ) => () => void;
        compareTranscription: (transcribed: string, expected: string) => Promise<any>;
        isSpeechRecognitionReady: () => Promise<boolean>;
        switchToElevenLabs: (apiKey: string) => Promise<void>;
        switchToSystemTTS: () => Promise<void>;
      };
      quiz: {
        getWeakestWords: (limit: number, language?: string) => Promise<any[]>;
        getRandomSentenceForWord: (wordId: number) => Promise<any | null>;
      };
      lifecycle: {
        createBackup: () => Promise<string>;
        restoreFromBackup: (backupPath: string) => Promise<void>;
        checkForUpdates: () => Promise<boolean>;
        getAppVersion: () => Promise<string>;
        restartAll: () => Promise<void>;
        openBackupDialog: () => Promise<string | null>;
        openBackupDirectory: () => Promise<void>;
        closeApp: () => Promise<void>;
      };
      frequency: {
        getProgress: (language: string) => Promise<{
          totalWords: number;
          processedWords: number;
          currentPosition: number;
          percentComplete: number;
        }>;
        getAvailableLanguages: () => Promise<string[]>;
      };
      jobs: {
        enqueueWordGeneration: (
          wordId: number,
          options?: { language?: string; topic?: string; desiredSentenceCount?: number }
        ) => Promise<void>;
        getWordStatus: (wordId: number) => Promise<{
          processingStatus: 'queued' | 'processing' | 'ready' | 'failed';
          sentenceCount: number;
        } | null>;
        getQueueSummary: (language?: string) => Promise<{
          queued: number;
          processing: number;
          failed: number;
          queuedWords: Array<{
            wordId: number;
            word: string;
            status: 'queued' | 'processing' | 'completed' | 'failed';
            language: string;
            topic?: string;
          }>;
          processingWords: Array<{
            wordId: number;
            word: string;
            status: 'queued' | 'processing' | 'completed' | 'failed';
            language: string;
            topic?: string;
          }>;
        }>;
        onWordUpdated: (
          callback: (payload: { wordId: number; processingStatus: 'queued' | 'processing' | 'ready' | 'failed'; sentenceCount: number }) => void
        ) => () => void;
      };
      srs: {
        processReview: (wordId: number, recall: 0 | 1 | 2 | 3) => Promise<void>;
        processQuizResults: (results: Array<{
          wordId: number;
          correct: boolean;
          responseTime?: number;
          difficulty?: 'easy' | 'medium' | 'hard';
        }>) => Promise<void>;
        getTodaysStudyWords: (maxWords?: number, language?: string) => Promise<any[]>;
        getDashboardStats: (language?: string) => Promise<{
          totalWords: number;
          dueToday: number;
          overdue: number;
          averageInterval: number;
          averageEaseFactor: number;
          recommendedStudySize: number;
        }>;
        markWordDifficulty: (wordId: number, difficulty: 'easy' | 'hard') => Promise<void>;
        resetWordProgress: (wordId: number) => Promise<void>;
        getOverdueWords: (language?: string) => Promise<any[]>;
        initializeExistingWords: (language?: string) => Promise<number>;
      };
      lemmatization: {
        getStatus: () => Promise<{ status: string; loadedModels: string[]; service: string } | null>;
        loadModel: (language: string) => Promise<void>;
        lemmatizeWords: (words: string[], language: string) => Promise<Record<string, string>>;
      };
      dialog: {
        selectSentence: () => Promise<any | null>;
        generateVariants: (sentenceId: number) => Promise<any[]>;
        generateFollowUp: (variantId: number) => Promise<{ text: string; translation: string; audio?: string }>;
        ensureBeforeSentenceAudio: (sentenceId: number) => Promise<string | null>;
        pregenerateSession: () => Promise<any | null>;
        pregenerateSessions: (count: number) => Promise<any[]>;
      };
    };
  }
}
