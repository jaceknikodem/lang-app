/**
 * Helper utilities for dialog session pregeneration
 */

import type { DialogSessionState } from './session-manager.js';

export interface DialogSessionData {
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
}

/**
 * Transform dialog session data from API response to DialogSessionState
 */
export function transformDialogSessionData(
  sessionsData: DialogSessionData[],
  startIndex: number = 0
): DialogSessionState[] {
  return sessionsData.map((sessionData, index) => {
    // Convert response options dates from ISO strings to Date objects
    const responseOptionsWithDates = sessionData.responseOptions.map((v) => ({
      id: v.id,
      sentenceId: v.sentenceId,
      variantSentence: v.variantSentence,
      variantTranslation: v.variantTranslation,
      createdAt: new Date(v.createdAt)
    }));

    // Create dialog session state
    const dialogSession: DialogSessionState = {
      id: `dialog-${Date.now()}-${startIndex + index}-${Math.random().toString(36).slice(2, 8)}`,
      sentenceId: sessionData.sentenceId,
      sentence: sessionData.sentence,
      translation: sessionData.translation,
      contextBefore: sessionData.contextBefore,
      contextBeforeTranslation: sessionData.contextBeforeTranslation,
      contextAfter: sessionData.contextAfter,
      contextAfterTranslation: sessionData.contextAfterTranslation,
      beforeSentenceAudio: sessionData.beforeSentenceAudio,
      afterSentenceAudio: sessionData.afterSentenceAudio,
      responseOptions: responseOptionsWithDates.map((v) => ({
        id: v.id,
        sentenceId: v.sentenceId,
        variantSentence: v.variantSentence,
        variantTranslation: v.variantTranslation,
        createdAt: v.createdAt.toISOString()
      })),
      createdAt: new Date().toISOString()
    };

    return dialogSession;
  });
}

/**
 * Queue dialog sessions into session manager
 * Handles both adding to existing queue and setting new queue
 */
export function queueDialogSessions(
  generatedSessions: DialogSessionState[],
  existingSessions: DialogSessionState[],
  currentDialogIndex: number | undefined,
  setDialogSessions: (sessions: DialogSessionState[], startIndex: number) => void,
  addDialogSession: (session: DialogSessionState) => void
): void {
  if (generatedSessions.length === 0) {
    return;
  }

  const startIndex = currentDialogIndex ?? 0;

  if (existingSessions.length === 0) {
    // No existing sessions, set all at once
    setDialogSessions(generatedSessions, startIndex);
  } else {
    // Add to existing queue
    for (const session of generatedSessions) {
      addDialogSession(session);
    }
  }
}

