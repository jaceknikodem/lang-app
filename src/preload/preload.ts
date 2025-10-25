/**
 * Electron preload script for secure IPC communication
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types/ipc.js';

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
    getWordsToStudy: (limit: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_WORDS_TO_STUDY, limit),
    getWordById: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_WORD_BY_ID, wordId),
    insertSentence: (wordId: number, sentence: string, translation: string, audioPath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.INSERT_SENTENCE, wordId, sentence, translation, audioPath),
    getSentencesByWord: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_SENTENCES_BY_WORD, wordId),
    updateLastStudied: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.UPDATE_LAST_STUDIED, wordId),
    getStudyStats: () => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_STUDY_STATS)
  },

  // LLM operations
  llm: {
    generateWords: (topic: string | undefined, language: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GENERATE_WORDS, topic, language),
    generateSentences: (word: string, language: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GENERATE_SENTENCES, word, language),
    isAvailable: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.IS_AVAILABLE)
  },

  // Audio operations
  audio: {
    generateAudio: (text: string, language: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.GENERATE_AUDIO, text, language),
    playAudio: (audioPath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.PLAY_AUDIO, audioPath),
    audioExists: (audioPath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.AUDIO_EXISTS, audioPath)
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
        getWordsToStudy: (limit: number) => Promise<any[]>;
        getWordById: (wordId: number) => Promise<any | null>;
        insertSentence: (wordId: number, sentence: string, translation: string, audioPath: string) => Promise<number>;
        getSentencesByWord: (wordId: number) => Promise<any[]>;
        updateLastStudied: (wordId: number) => Promise<void>;
        getStudyStats: () => Promise<any>;
      };
      llm: {
        generateWords: (topic: string | undefined, language: string) => Promise<any[]>;
        generateSentences: (word: string, language: string) => Promise<any[]>;
        isAvailable: () => Promise<boolean>;
      };
      audio: {
        generateAudio: (text: string, language: string) => Promise<string>;
        playAudio: (audioPath: string) => Promise<void>;
        audioExists: (audioPath: string) => Promise<boolean>;
      };
    };
  }
}