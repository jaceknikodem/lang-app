/**
 * Type declarations for Electron API exposed to renderer process
 */

/// <reference types="../../shared/types/core" />

import type { Word, Sentence, StudyStats, GeneratedWord, GeneratedSentence, CreateWordRequest, DictionaryEntry } from '../../shared/types/core.js';

declare global {
  interface Window {
    electronAPI: {
      database: {
        insertWord: (word: CreateWordRequest) => Promise<number>;
        updateWordStrength: (wordId: number, strength: number) => Promise<void>;
        markWordKnown: (wordId: number, known: boolean) => Promise<void>;
        markWordIgnored: (wordId: number, ignored: boolean) => Promise<void>;
        getWordsToStudy: (limit: number) => Promise<Word[]>;
        getWordById: (wordId: number) => Promise<Word | null>;
        getAllWords: (includeKnown?: boolean, includeIgnored?: boolean) => Promise<Word[]>;
        getWordsWithSentences: (includeKnown?: boolean, includeIgnored?: boolean) => Promise<Word[]>;
        getWordsWithSentencesOrderedByStrength: (includeKnown?: boolean, includeIgnored?: boolean) => Promise<Word[]>;
        getRecentStudySessions: (limit?: number) => Promise<Array<{id: number, wordsStudied: number, whenStudied: Date}>>;
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
        ) => Promise<number>;
        getSentencesByWord: (wordId: number) => Promise<Sentence[]>;
        deleteSentence: (sentenceId: number) => Promise<void>;
        updateLastStudied: (wordId: number) => Promise<void>;
        getStudyStats: () => Promise<StudyStats>;
        recordStudySession: (wordsStudied: number) => Promise<void>;
        getCurrentLanguage: () => Promise<string>;
        setCurrentLanguage: (language: string) => Promise<void>;
        getAvailableLanguages: () => Promise<string[]>;
        getLanguageStats: () => Promise<Array<{language: string, totalWords: number, studiedWords: number}>>;
        lookupDictionary: (word: string, language?: string) => Promise<DictionaryEntry[]>;
      };
      llm: {
        generateWords: (topic: string | undefined, language: string) => Promise<GeneratedWord[]>;
        generateSentences: (word: string, language: string, topic?: string) => Promise<GeneratedSentence[]>;
        isAvailable: () => Promise<boolean>;
      };
      audio: {
        generateAudio: (text: string, language: string, word?: string) => Promise<string>;
        playAudio: (audioPath: string) => Promise<void>;
        stopAudio: () => Promise<void>;
        audioExists: (audioPath: string) => Promise<boolean>;
        loadAudioBase64: (audioPath: string) => Promise<string | null>;
        regenerateAudio: (options: { text: string; language?: string; word?: string; existingPath?: string }) => Promise<string>;
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
        compareTranscription: (transcribed: string, expected: string) => Promise<any>;
        getAvailableSpeechModels: () => Promise<string[]>;
        setSpeechModel: (model: string) => Promise<void>;
        getCurrentSpeechModel: () => Promise<string>;
        isSpeechRecognitionReady: () => Promise<boolean>;
        switchToElevenLabs: (apiKey: string) => Promise<void>;
        switchToMinimax: (apiKey: string) => Promise<void>;
        switchToSystemTTS: () => Promise<void>;
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
      quiz: {
        getWeakestWords: (limit: number) => Promise<Word[]>;
        getRandomSentenceForWord: (wordId: number) => Promise<Sentence | null>;
      };
      lifecycle: {
        createBackup: () => Promise<string>;
        restoreFromBackup: (backupPath: string) => Promise<void>;
        checkForUpdates: () => Promise<boolean>;
        getAppVersion: () => Promise<string>;
        restartAll: () => Promise<void>;
        openBackupDialog: () => Promise<string | null>;
        openBackupDirectory: () => Promise<void>;
      };
    };
  }
}
