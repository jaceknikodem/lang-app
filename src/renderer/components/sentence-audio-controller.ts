import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { Sentence, Word } from '../../shared/types/core.js';
import { audioPlayer } from '../utils/audio-player-service.js';
import { sessionManager } from '../utils/session-manager.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../shared/utils/error.js';

export function buildSentenceAudioSequence(sentence: Sentence): {
  audioPaths: string[];
  audioTypes: ('before' | 'main' | 'after')[];
} {
  const audioPaths: string[] = [];
  const audioTypes: ('before' | 'main' | 'after')[] = [];

  if (sentence.contextBefore && sentence.beforeSentenceAudioPath) {
    audioPaths.push(sentence.beforeSentenceAudioPath);
    audioTypes.push('before');
  }

  if (sentence.audioPath) {
    audioPaths.push(sentence.audioPath);
    audioTypes.push('main');
  }

  if (sentence.contextAfter && sentence.afterSentenceAudioPath) {
    audioPaths.push(sentence.afterSentenceAudioPath);
    audioTypes.push('after');
  }

  return { audioPaths, audioTypes };
}

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
  isRegeneratingBeforeAudio = false;
  isRegeneratingAfterAudio = false;

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
    if (!sentence.contextBefore || !sentence.beforeSentenceAudioPath) return;

    const playbackSpeed = this.host.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;
    this.localPlayingAudio = 'before';
    this.host.requestUpdate();
    await audioPlayer.play(sentence.beforeSentenceAudioPath, {
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
    if (!sentence.contextAfter || !sentence.afterSentenceAudioPath) return;

    const playbackSpeed = this.host.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;
    this.localPlayingAudio = 'after';
    this.host.requestUpdate();
    await audioPlayer.play(sentence.afterSentenceAudioPath, {
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

  async handleRecreateAudio(): Promise<void> {
    if (this.isRegeneratingAudio || !this.host.sentence?.sentence) return;
    const { sentence, targetWord } = this.host;
    const language =
      targetWord?.language || (await window.electronAPI.database.getCurrentLanguage());
    this.isRegeneratingAudio = true;
    this.host.requestUpdate();
    try {
      const newPath = await this.regeneratePart(
        sentence.sentence,
        language,
        'main',
        targetWord?.word,
        sentence.wordId || targetWord?.id,
        sentence.audioPath || undefined
      );
      this.host.updateSentence({ ...sentence, audioPath: newPath });
      this.dispatchRegenerated(sentence.id, newPath, 'main');
      this.playAfterRegen(newPath);
    } catch (error) {
      logger.error({ error }, 'Failed to regenerate audio');
      window.alert(`Failed to recreate audio: ${getErrorMessage(error)}`);
    } finally {
      this.isRegeneratingAudio = false;
      this.host.requestUpdate();
    }
  }

  async handleRecreateBeforeAudio(): Promise<void> {
    if (this.isRegeneratingBeforeAudio || !this.host.sentence?.contextBefore) return;
    const { sentence, targetWord } = this.host;
    const language =
      targetWord?.language || (await window.electronAPI.database.getCurrentLanguage());
    const isJapanese = language === 'japanese' || language === 'ja';
    const text =
      isJapanese && sentence.contextBeforePronunciation
        ? sentence.contextBeforePronunciation
        : sentence.contextBefore!;
    this.isRegeneratingBeforeAudio = true;
    this.host.requestUpdate();
    try {
      const newPath = await this.regeneratePart(
        text,
        language,
        'before',
        '_before_sentence',
        sentence.wordId || targetWord?.id,
        sentence.beforeSentenceAudioPath || undefined
      );
      this.host.updateSentence({ ...sentence, beforeSentenceAudioPath: newPath });
      this.dispatchRegenerated(sentence.id, newPath, 'before');
      this.playAfterRegen(newPath);
    } catch (error) {
      logger.error({ error }, 'Failed to regenerate before-context audio');
      window.alert(`Failed to recreate audio: ${getErrorMessage(error)}`);
    } finally {
      this.isRegeneratingBeforeAudio = false;
      this.host.requestUpdate();
    }
  }

  async handleRecreateAfterAudio(): Promise<void> {
    if (this.isRegeneratingAfterAudio || !this.host.sentence?.contextAfter) return;
    const { sentence, targetWord } = this.host;
    const language =
      targetWord?.language || (await window.electronAPI.database.getCurrentLanguage());
    const isJapanese = language === 'japanese' || language === 'ja';
    const text =
      isJapanese && sentence.contextAfterPronunciation
        ? sentence.contextAfterPronunciation
        : sentence.contextAfter!;
    this.isRegeneratingAfterAudio = true;
    this.host.requestUpdate();
    try {
      const newPath = await this.regeneratePart(
        text,
        language,
        'after',
        '_after_sentence',
        sentence.wordId || targetWord?.id,
        sentence.afterSentenceAudioPath || undefined
      );
      this.host.updateSentence({ ...sentence, afterSentenceAudioPath: newPath });
      this.dispatchRegenerated(sentence.id, newPath, 'after');
      this.playAfterRegen(newPath);
    } catch (error) {
      logger.error({ error }, 'Failed to regenerate after-context audio');
      window.alert(`Failed to recreate audio: ${getErrorMessage(error)}`);
    } finally {
      this.isRegeneratingAfterAudio = false;
      this.host.requestUpdate();
    }
  }

  // ─── private ────────────────────────────────────────────────────────────────

  private async regeneratePart(
    text: string,
    language: string,
    audioType: 'before' | 'main' | 'after',
    word?: string,
    wordId?: number,
    existingPath?: string
  ): Promise<string> {
    try {
      audioPlayer.stop();
      await window.electronAPI.audio.stopAudio();
    } catch (e) {
      logger.warn({ error: e }, 'Stop audio before regenerate failed (non-fatal)');
    }
    const result = await window.electronAPI.audio.regenerateAudio({
      text,
      language,
      word,
      wordId,
      sentenceId: this.host.sentence.id,
      existingPath,
      audioType,
      forceElevenLabs: true,
    });
    if (!result?.audioPath) throw new Error('Audio regeneration returned an empty path');
    return result.audioPath;
  }

  private dispatchRegenerated(
    sentenceId: number,
    audioPath: string,
    audioType: 'before' | 'main' | 'after'
  ) {
    this.host.dispatchEvent(
      new CustomEvent('sentence-audio-regenerated', {
        detail: { sentenceId, audioPath, audioType },
        bubbles: true,
        composed: true,
      })
    );
  }

  private playAfterRegen(audioPath: string) {
    setTimeout(async () => {
      try {
        audioPlayer.stop();
        await window.electronAPI.audio.stopAudio();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const playbackSpeed = this.host.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;
        await audioPlayer.play(audioPath, { playbackSpeed });
      } catch (playError) {
        logger.warn({ error: playError }, 'Failed to play newly regenerated audio');
      }
    }, 100);
  }

  private buildAudioSequence() {
    return buildSentenceAudioSequence(this.host.sentence);
  }
}
