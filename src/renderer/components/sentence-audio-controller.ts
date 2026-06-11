import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { Sentence, Word } from '../../shared/types/core.js';
import { audioPlayer } from '../utils/audio-player-service.js';
import { sessionManager } from '../utils/session-manager.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../shared/utils/error.js';

export interface AudioHost extends ReactiveControllerHost {
  sentence: Sentence;
  targetWord: Word;
  playbackSpeed?: number;
  dispatchEvent(event: Event): boolean;
  /** Called by the controller when it needs to update the sentence (e.g. regenerated audio path). */
  updateSentence(sentence: Sentence): void;
}

/**
 * ReactiveController that owns all audio playback and regeneration for SentenceViewer.
 *
 * State exposed to the host (read-only from outside):
 *   localPlayingAudio  — which part is currently playing: 'before' | 'main' | 'after' | null
 *   isRegeneratingAudio — true while recreate-audio is in progress
 *
 * Arrow-function event handlers (handleContextBeforeClick, handleSentenceTextClick,
 * handleContextAfterClick) are safe to pass directly to @click in Lit templates.
 */
export class SentenceAudioController implements ReactiveController {
  private readonly host: AudioHost;

  localPlayingAudio: 'before' | 'main' | 'after' | null = null;
  isRegeneratingAudio = false;

  constructor(host: AudioHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected(): void {}
  hostDisconnected(): void {}

  // ─── public API ─────────────────────────────────────────────────────────────

  async handlePlayAudio(): Promise<void> {
    if (!this.host.sentence.audioPath) return;

    try {
      const { audioPaths, audioTypes } = await this.buildAudioSequence();
      if (audioPaths.length === 0) return;

      let currentIndex = 0;
      const playbackSpeed = this.host.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;

      this.localPlayingAudio = audioTypes[0];
      this.host.requestUpdate();

      await audioPlayer.playSequence(audioPaths, {
        playbackSpeed,
        onEnded: () => {
          currentIndex++;
          if (currentIndex < audioTypes.length) {
            this.localPlayingAudio = audioTypes[currentIndex];
            this.host.requestUpdate();
          } else {
            this.localPlayingAudio = null;
            this.host.requestUpdate();
            this.host.dispatchEvent(
              new CustomEvent('sentence-audio-played', {
                detail: { sentenceId: this.host.sentence.id, wordId: this.host.targetWord.id },
                bubbles: true,
                composed: true,
              })
            );
            this.host.dispatchEvent(
              new CustomEvent('sentence-audio-completed', {
                detail: { sentenceId: this.host.sentence.id, wordId: this.host.targetWord.id },
                bubbles: true,
                composed: true,
              })
            );
          }
        },
        onError: (error) => {
          logger.error({ error }, 'Failed to play audio sequence');
          this.localPlayingAudio = null;
          this.host.requestUpdate();
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to play audio');
      this.localPlayingAudio = null;
      this.host.requestUpdate();
    }
  }

  handleContextBeforeClick = async (_e: MouseEvent): Promise<void> => {
    const { sentence } = this.host;
    if (!sentence.contextBefore || !sentence.id) return;

    try {
      const beforePath = await window.electronAPI.dialog.ensureBeforeSentenceAudio(sentence.id);
      if (beforePath) {
        const playbackSpeed = this.host.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;
        this.localPlayingAudio = 'before';
        this.host.requestUpdate();
        await audioPlayer.play(beforePath, {
          playbackSpeed,
          onEnded: () => {
            this.localPlayingAudio = null;
            this.host.requestUpdate();
          },
          onError: () => {
            this.localPlayingAudio = null;
            this.host.requestUpdate();
          },
        });
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to get before sentence audio');
      this.localPlayingAudio = null;
      this.host.requestUpdate();
    }
  };

  handleSentenceTextClick = async (e: MouseEvent): Promise<void> => {
    const target = e.target as HTMLElement | Node;
    if (target instanceof HTMLElement && target.closest('.word-in-sentence')) return;
    const path = e.composedPath();
    if (path.some((n) => n instanceof HTMLElement && n.classList?.contains('word-in-sentence'))) {
      return;
    }

    const { sentence } = this.host;
    if (!sentence.audioPath) return;

    const playbackSpeed = this.host.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;
    this.localPlayingAudio = 'main';
    this.host.requestUpdate();
    await audioPlayer.play(sentence.audioPath, {
      playbackSpeed,
      onEnded: () => {
        this.localPlayingAudio = null;
        this.host.requestUpdate();
      },
      onError: () => {
        this.localPlayingAudio = null;
        this.host.requestUpdate();
      },
    });
  };

  handleContextAfterClick = async (_e: MouseEvent): Promise<void> => {
    const { sentence } = this.host;
    if (!sentence.contextAfter || !sentence.id) return;

    try {
      const contextAudio = await window.electronAPI.dialog.ensureContextSentences(sentence.id);
      const afterPath = contextAudio.afterSentenceAudio;
      if (afterPath) {
        const playbackSpeed = this.host.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;
        this.localPlayingAudio = 'after';
        this.host.requestUpdate();
        await audioPlayer.play(afterPath, {
          playbackSpeed,
          onEnded: () => {
            this.localPlayingAudio = null;
            this.host.requestUpdate();
          },
          onError: () => {
            this.localPlayingAudio = null;
            this.host.requestUpdate();
          },
        });
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to get after sentence audio');
      this.localPlayingAudio = null;
      this.host.requestUpdate();
    }
  };

  async handleRecreateAudio(): Promise<void> {
    if (this.isRegeneratingAudio || !this.host.sentence?.sentence) return;

    this.isRegeneratingAudio = true;
    try {
      try {
        audioPlayer.stop();
        await window.electronAPI.audio.stopAudio();
      } catch (e) {
        logger.warn({ error: e }, 'Stop audio before regenerate failed (non-fatal)');
      }

      const { sentence, targetWord } = this.host;
      const oldPath = sentence.audioPath;
      const language =
        targetWord?.language || (await window.electronAPI.database.getCurrentLanguage());
      const word = targetWord?.word;

      let regeneratedPath: string | undefined;

      if (typeof window.electronAPI.audio.regenerateAudio === 'function') {
        const result = await window.electronAPI.audio.regenerateAudio({
          text: sentence.sentence,
          language,
          word,
          wordId: sentence.wordId || targetWord?.id,
          sentenceId: sentence.id,
          existingPath: oldPath,
        });
        regeneratedPath = result?.audioPath;
      } else {
        logger.warn('Recreate audio: regenerateAudio not available, using fallback flow');
        const fallbackLanguage =
          language ||
          targetWord?.language ||
          (await window.electronAPI.database.getCurrentLanguage());

        regeneratedPath = await window.electronAPI.audio.generateAudio(
          sentence.sentence,
          fallbackLanguage,
          word || targetWord?.word || undefined,
          sentence.wordId || targetWord?.id || undefined,
          sentence.id || undefined
        );

        if (oldPath && oldPath !== regeneratedPath) {
          await window.electronAPI.database.updateSentenceAudioPath(sentence.id, regeneratedPath);
          try {
            await window.electronAPI.audio.deleteRecording(oldPath);
          } catch (deleteError) {
            logger.warn(
              { error: deleteError, oldPath },
              'Recreate audio (fallback): failed to delete previous audio'
            );
          }
        }
      }

      if (!regeneratedPath) throw new Error('Audio regeneration returned an empty path');

      if (
        typeof window.electronAPI.audio.regenerateAudio === 'function' &&
        (!oldPath || regeneratedPath !== oldPath)
      ) {
        await window.electronAPI.database.updateSentenceAudioPath(sentence.id, regeneratedPath);
      }

      this.host.updateSentence({ ...sentence, audioPath: regeneratedPath });

      this.host.dispatchEvent(
        new CustomEvent('sentence-audio-regenerated', {
          detail: { sentenceId: sentence.id, audioPath: regeneratedPath },
          bubbles: true,
          composed: true,
        })
      );

      setTimeout(async () => {
        try {
          audioPlayer.stop();
          await window.electronAPI.audio.stopAudio();
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (regeneratedPath) {
            const playbackSpeed =
              this.host.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;
            await audioPlayer.play(regeneratedPath, { playbackSpeed });
          }
        } catch (playError) {
          logger.warn({ error: playError }, 'Failed to play newly regenerated audio');
        }
      }, 100);
    } catch (error) {
      logger.error({ error }, 'Failed to regenerate audio');
      window.alert(`Failed to recreate audio: ${getErrorMessage(error)}`);
    } finally {
      this.isRegeneratingAudio = false;
      this.host.requestUpdate();
    }
  }

  // ─── private ────────────────────────────────────────────────────────────────

  private async buildAudioSequence(): Promise<{
    audioPaths: string[];
    audioTypes: ('before' | 'main' | 'after')[];
  }> {
    const { sentence } = this.host;
    const audioPaths: string[] = [];
    const audioTypes: ('before' | 'main' | 'after')[] = [];

    if (sentence.contextBefore && sentence.id) {
      try {
        const beforePath = await window.electronAPI.dialog.ensureBeforeSentenceAudio(sentence.id);
        if (beforePath) {
          audioPaths.push(beforePath);
          audioTypes.push('before');
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to get before sentence audio');
      }
    }

    if (sentence.audioPath) {
      audioPaths.push(sentence.audioPath);
      audioTypes.push('main');
    }

    if (sentence.contextAfter && sentence.id) {
      try {
        const contextAudio = await window.electronAPI.dialog.ensureContextSentences(sentence.id);
        const afterPath = contextAudio.afterSentenceAudio;
        if (afterPath) {
          audioPaths.push(afterPath);
          audioTypes.push('after');
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to get after sentence audio');
      }
    }

    return { audioPaths, audioTypes };
  }
}
