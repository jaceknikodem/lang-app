import { Sentence, DialogueVariant } from '../../shared/types/core.js';
import { sessionManager } from './session-manager.js';
import { logger } from './logger.js';
import { getErrorMessage } from '../../shared/utils/error.js';

export type DialogLoadResult =
  | {
      status: 'loaded';
      sentence: Sentence;
      beforeSentenceAudio: string | null;
      afterSentenceAudio: string | null;
      isTopicBasedFlow: boolean;
      responseOptions: DialogueVariant[];
      previousCorrections: string[];
    }
  | { status: 'show_summary' }
  | { status: 'no_sentences' }
  | { status: 'error'; message: string };

export async function loadDialogSession(dialogCount: number): Promise<DialogLoadResult> {
  try {
    const cachedSession = sessionManager.getCurrentDialogSession();

    if (cachedSession) {
      try {
        const sentences = await window.electronAPI.database.getSentencesByIds([
          cachedSession.sentenceId,
        ]);
        const sentence = sentences && sentences.length > 0 ? sentences[0] : null;

        if (!sentence) {
          sessionManager.consumeCurrentDialogSession();
        } else {
          const currentLanguage = await window.electronAPI.database.getCurrentLanguage();
          const word = await window.electronAPI.database.getWordById(sentence.wordId);

          if (word && word.language === currentLanguage) {
            const previousCorrections: string[] = [];
            const isTopicBasedFlow = cachedSession.isTopicBasedFlow ?? false;

            if (isTopicBasedFlow) {
              try {
                const corrections = await window.electronAPI.database.getDialogCorrections(
                  sentence.id,
                  currentLanguage,
                  3
                );
                previousCorrections.push(
                  ...corrections.map((c) => c.correctionText).filter((text) => text.length < 100)
                );
              } catch (error) {
                logger.warn({ error }, 'Failed to load dialog corrections from database');
              }
            }

            return {
              status: 'loaded',
              sentence,
              beforeSentenceAudio: cachedSession.beforeSentenceAudio || null,
              afterSentenceAudio: cachedSession.afterSentenceAudio || null,
              isTopicBasedFlow,
              previousCorrections,
              responseOptions: cachedSession.responseOptions.map((v) => ({
                id: v.id,
                sentenceId: v.sentenceId,
                variantSentence: v.variantSentence,
                variantTranslation: v.variantTranslation,
                variantPronunciation: v.variantPronunciation,
                createdAt: new Date(v.createdAt),
              })),
            };
          } else {
            sessionManager.consumeCurrentDialogSession();
          }
        }
      } catch (error) {
        logger.error({ error }, '[DialogSessionService] error during cache validation');
        sessionManager.consumeCurrentDialogSession();
      }
    }

    // Check if all sessions are consumed and we should show summary
    const currentSession = sessionManager.getCurrentSession();
    const hasNoMoreCachedSessions =
      !currentSession.dialogSessions || currentSession.dialogSessions.length === 0;
    const indexIsUndefined = currentSession.currentDialogIndex === undefined;
    const allSessionsConsumed =
      hasNoMoreCachedSessions ||
      (indexIsUndefined &&
        currentSession.dialogSessions &&
        currentSession.dialogSessions.length > 0);

    if (allSessionsConsumed && dialogCount > 0) {
      return { status: 'show_summary' };
    }

    // Generate a fresh session, excluding sentences already seen this session
    const isTopicBasedFlow = Math.random() < 0.5;
    const excludeIds = (currentSession.dialogSessions ?? []).map((s) => s.sentenceId);

    let sentence: Sentence | null = null;
    if (isTopicBasedFlow) {
      sentence = await window.electronAPI.dialog.selectSentenceWithTopic(
        excludeIds.length > 0 ? excludeIds : undefined
      );
    } else {
      sentence = await window.electronAPI.dialog.selectSentence(
        excludeIds.length > 0 ? excludeIds : undefined
      );
    }

    if (!sentence) {
      return { status: 'no_sentences' };
    }

    const previousCorrections: string[] = [];
    if (isTopicBasedFlow) {
      try {
        const language = await window.electronAPI.database.getCurrentLanguage();
        const corrections = await window.electronAPI.database.getDialogCorrections(
          sentence.id,
          language,
          3
        );
        previousCorrections.push(
          ...corrections.map((c) => c.correctionText).filter((text) => text.length < 100)
        );
      } catch (error) {
        logger.warn({ error }, 'Failed to load dialog corrections from database');
      }
    }

    const beforeSentenceAudio = sentence.beforeSentenceAudioPath || null;
    const afterSentenceAudio = sentence.afterSentenceAudioPath || null;

    if (!isTopicBasedFlow) {
      window.electronAPI.dialog.generateVariants(sentence.id).catch((error) => {
        logger.warn({ error }, 'Failed to pre-warm variants in background');
      });
    }

    try {
      sessionManager.addDialogSession({
        id: `dialog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sentenceId: sentence.id,
        sentence: sentence.sentence,
        translation: sentence.translation,
        contextBefore: sentence.contextBefore,
        contextBeforeTranslation: sentence.contextBeforeTranslation,
        contextAfter: sentence.contextAfter,
        contextAfterTranslation: sentence.contextAfterTranslation,
        beforeSentenceAudio: beforeSentenceAudio || undefined,
        afterSentenceAudio: afterSentenceAudio || undefined,
        responseOptions: [],
        createdAt: new Date().toISOString(),
        isTopicBasedFlow,
      });
    } catch (error) {
      logger.error({ error }, '[DialogSessionService] failed to save session to cache');
    }

    return {
      status: 'loaded',
      sentence,
      beforeSentenceAudio,
      afterSentenceAudio,
      isTopicBasedFlow,
      responseOptions: [],
      previousCorrections,
    };
  } catch (error) {
    return { status: 'error', message: getErrorMessage(error, 'Failed to load dialog session') };
  }
}
