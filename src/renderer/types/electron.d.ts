/**
 * Type declarations for Electron API exposed to renderer process
 */

/// <reference types="../../shared/types/core" />

import type {
  Word,
  Sentence,
  StudyStats,
  GeneratedWord,
  GeneratedSentence,
  CreateWordRequest,
  DictionaryEntry,
} from '../../shared/types/core.js';

declare global {
  interface Window {
    electronAPI: {
      database: {
        insertWord: (word: CreateWordRequest) => Promise<number>;
        updateWordStrength: (wordId: number, strength: number) => Promise<void>;
        markWordKnown: (wordId: number, known: boolean) => Promise<void>;
        markWordIgnored: (wordId: number, ignored: boolean) => Promise<void>;
        getWordsToStudy: (limit: number, language: string) => Promise<Word[]>;
        getWordById: (wordId: number) => Promise<Word | null>;
        getWordsByIds: (wordIds: number[]) => Promise<Word[]>;
        getAllWords: (
          language: string,
          includeKnown?: boolean,
          includeIgnored?: boolean
        ) => Promise<Word[]>;
        getWordsWithSentences: (
          language: string,
          includeKnown?: boolean,
          includeIgnored?: boolean
        ) => Promise<Word[]>;
        getWordsWithSentencesOrderedByStrength: (
          language: string,
          includeKnown?: boolean,
          includeIgnored?: boolean
        ) => Promise<Word[]>;
        getRecentStudySessions: (
          limit?: number
        ) => Promise<Array<{ id: number; wordsStudied: number; whenStudied: Date }>>;
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
          audioGenerationModel?: string,
          audioGenerationVoiceId?: string
        ) => Promise<number>;
        getSentencesByWord: (wordId: number) => Promise<Sentence[]>;
        getSentencesByIds: (sentenceIds: number[]) => Promise<Sentence[]>;
        deleteSentence: (sentenceId: number) => Promise<void>;
        updateSentenceLastShown: (sentenceId: number) => Promise<void>;
        updateSentenceAudioPath: (
          sentenceId: number,
          audioPath: string,
          audioGenerationVoiceId?: string
        ) => Promise<void>;
        incrementSentencePlayCount: (sentenceId: number) => Promise<void>;
        recordPronunciationAttempt: (
          sentenceId: number,
          similarityScore: number,
          expectedText: string,
          transcribedText: string,
          audioPath?: string | null
        ) => Promise<void>;
        getPronunciationHistory: (
          sentenceId: number,
          limit?: number
        ) => Promise<
          Array<{
            id: number;
            sentenceId: number;
            similarityScore: number;
            expectedText: string;
            transcribedText: string;
            audioPath: string | null;
            createdAt: Date;
          }>
        >;
        updateLastStudied: (wordId: number) => Promise<void>;
        getStudyStats: (language: string) => Promise<StudyStats>;
        recordStudySession: (wordsStudied: number) => Promise<void>;
        getSetting: (key: string) => Promise<string | null>;
        setSetting: (key: string, value: string) => Promise<void>;
        getCurrentLanguage: () => Promise<string>;
        setCurrentLanguage: (language: string) => Promise<void>;
        getAvailableLanguages: () => Promise<string[]>;
        getLanguageStats: () => Promise<
          Array<{
            language: string;
            totalWords: number;
            studiedWords: number;
            averagePronunciationScore: number | null;
            pronunciationAttemptCount: number;
          }>
        >;
        lookupDictionary: (word: string, language: string) => Promise<DictionaryEntry[]>;
        getNewWordCount: (language: string) => Promise<number>;
        resetLanguageProgress: (language: string) => Promise<void>;
        getTopicWordCounts: (language: string) => Promise<Array<{ topic: string; count: number }>>;
      };
      llm: {
        generateWords: (topic: string | undefined, language: string) => Promise<GeneratedWord[]>;
        generateSentences: (
          word: string,
          language: string,
          topic?: string
        ) => Promise<GeneratedSentence[]>;
        isAvailable: () => Promise<boolean>;
        getAvailableModels: () => Promise<string[]>;
        setModel: (model: string) => Promise<void>;
        getCurrentModel: () => Promise<string>;
        setWordGenerationModel: (model: string) => Promise<void>;
        setSentenceGenerationModel: (model: string) => Promise<void>;
        getWordGenerationModel: () => Promise<string>;
        getSentenceGenerationModel: () => Promise<string>;
        getCurrentProvider: () => Promise<'ollama' | 'gemini'>;
        switchProvider: (provider: 'ollama' | 'gemini', geminiApiKey?: string) => Promise<void>;
        setGeminiApiKey: (apiKey: string, switchToGemini?: boolean) => Promise<void>;
        getAvailableProviders: () => Promise<Array<'ollama' | 'gemini'>>;
        getModelsForProvider: (provider: 'ollama' | 'gemini') => Promise<string[]>;
      };
      audio: {
        generateAudio: (
          text: string,
          language: string,
          word?: string,
          wordId?: number,
          sentenceId?: number,
          variantId?: number
        ) => Promise<string>;
        playAudio: (audioPath: string) => Promise<void>;
        stopAudio: () => Promise<void>;
        audioExists: (audioPath: string) => Promise<boolean>;
        normalizeAudioVolume: (audioPath: string, targetDb?: number) => Promise<string | null>;
        loadAudioBase64: (
          audioPath: string
        ) => Promise<{ data: ArrayBuffer; mimeType: string } | null>;
        regenerateAudio: (options: {
          text: string;
          language: string;
          word?: string;
          wordId?: number;
          sentenceId?: number;
          variantId?: number;
          existingPath?: string;
        }) => Promise<{ audioPath: string }>;
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
        compareTranscription: (
          transcribed: string,
          expected: string,
          proficiencyLevel?: string | null
        ) => Promise<any>;
        isSpeechRecognitionReady: () => Promise<boolean>;
        switchToElevenLabs: (apiKey: string) => Promise<void>;
        switchToSystemTTS: () => Promise<void>;
        getVoiceMappings: () => Promise<Record<string, string[]>>;
        saveVoiceMappings: (mappings: Record<string, string[]>) => Promise<void>;
        resetVoiceMappingsToDefaults: () => Promise<void>;
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
          callback: (payload: {
            wordId: number;
            processingStatus: 'queued' | 'processing' | 'ready' | 'failed';
            sentenceCount: number;
          }) => void
        ) => () => void;
      };
      quiz: {
        getWeakestWords: (limit: number, language: string) => Promise<Word[]>;
        getRandomSentenceForWord: (wordId: number) => Promise<Sentence | null>;
      };
      flow: {
        getFlowSentences: (language: string) => Promise<
          Array<{
            sentence: Sentence;
            words: Word[];
            beforeSentenceAudio?: string;
            afterSentenceAudio?: string;
            continuationAudios: string[];
          }>
        >;
        stitchAudio: (audioPaths: string[], language: string) => Promise<string>;
        stitchAudioWithEnglish: (
          audioPathPairs: Array<[string, string]>,
          language: string
        ) => Promise<string>;
        getFileStats: (filePath: string) => Promise<{ mtime: Date } | null>;
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
      tracking: {
        createSession: (
          mode: 'learning' | 'quiz' | 'dialog' | 'flow',
          language: string
        ) => Promise<number>;
        updateSession: (
          sessionId: number,
          data: { wordCount?: number; sentenceCount?: number; audioPlayedCount?: number }
        ) => Promise<void>;
        recordAudioPlayback: (data: {
          sessionId?: number;
          sentenceId?: number;
          audioPath: string;
          language: string;
          mode: 'learning' | 'quiz' | 'dialog' | 'flow';
          playbackSpeed?: number;
        }) => Promise<number>;
        recordNeglectedWords: (
          data: Array<{
            word: string;
            language: string;
            topic?: string;
            translation?: string;
            sessionId?: number;
            frequencyPosition?: number;
          }>
        ) => Promise<number>;
        recordDictionaryHover: (data: {
          word: string;
          language: string;
          sentenceId?: number;
          sessionId?: number;
          hoverDurationMs: number;
          dictionaryKey?: string;
          foundInDict: boolean;
        }) => Promise<number>;
      };
      srs: {
        processReview: (wordId: number, recall: 0 | 1 | 2 | 3) => Promise<void>;
        processQuizResults: (
          results: Array<{
            wordId: number;
            correct: boolean;
            responseTime?: number;
            difficulty?: 'easy' | 'medium' | 'hard';
          }>
        ) => Promise<void>;
        getTodaysStudyWords: (language: string, maxWords?: number) => Promise<Word[]>;
        getDashboardStats: (language: string) => Promise<any>;
        markWordDifficulty: (wordId: number, difficulty: 'easy' | 'hard') => Promise<void>;
        resetWordProgress: (wordId: number) => Promise<void>;
        getOverdueWords: (language: string) => Promise<Word[]>;
        initializeExistingWords: (language: string) => Promise<void>;
      };
      lemmatization: {
        getStatus: () => Promise<{ loaded: boolean; language?: string }>;
        loadModel: (language: string) => Promise<void>;
        lemmatizeWords: (words: string[], language: string) => Promise<string[]>;
      };
      dialog: {
        selectSentence: () => Promise<Sentence | null>;
        generateVariants: (sentenceId: number) => Promise<
          Array<{
            id: number;
            sentenceId: number;
            variantSentence: string;
            variantTranslation: string;
            createdAt: Date;
          }>
        >;
        generateFollowUp: (
          variantId: number
        ) => Promise<{ text: string; translation: string; audio?: string }>;
        ensureBeforeSentenceAudio: (sentenceId: number) => Promise<string | null>;
        ensureContextSentences: (
          sentenceId: number
        ) => Promise<{ beforeSentenceAudio?: string; afterSentenceAudio?: string }>;
        pregenerateSession: () => Promise<{
          sentenceId: number;
          sentence: string;
          translation: string;
          contextBefore?: string;
          contextBeforeTranslation?: string;
          contextAfter?: string;
          contextAfterTranslation?: string;
          beforeSentenceAudio?: string;
          afterSentenceAudio?: string;
          responseOptions: Array<{
            id: number;
            sentenceId: number;
            variantSentence: string;
            variantTranslation: string;
            createdAt: string;
          }>;
        } | null>;
        pregenerateSessions: (count: number) => Promise<
          Array<{
            sentenceId: number;
            sentence: string;
            translation: string;
            contextBefore?: string;
            contextBeforeTranslation?: string;
            contextAfter?: string;
            contextAfterTranslation?: string;
            beforeSentenceAudio?: string;
            afterSentenceAudio?: string;
            responseOptions: Array<{
              id: number;
              sentenceId: number;
              variantSentence: string;
              variantTranslation: string;
              createdAt: string;
            }>;
          }>
        >;
      };
      scoring: {
        getNextMode: (options: {
          currentMode: 'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow' | null;
          language: string | null;
          initialTakeover: boolean;
        }) => Promise<{
          nextMode: 'learning' | 'quiz' | 'dialog' | 'flow' | null;
          rankedModes: Array<'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow'>;
        }>;
        getLanguageProficiency: (language: string | null, timeWindowDays?: number) => Promise<any>;
      };
      topics: {
        getTopics: () => Promise<string[]>;
      };
      frequency: {
        getProgress: (language: string) => Promise<any>;
        getAvailableLanguages: () => Promise<string[]>;
      };
    };
  }
}
