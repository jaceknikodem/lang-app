/**
 * Audio paths on sentences, playback logging and the read-aloud cache.
 */

import { SentenceAudioBackfillItem } from '../../shared/types/database.js';
import { BaseRepository } from './base-repository.js';

export class AudioRepository extends BaseRepository {
  private updateSentenceColumn(sentenceId: number, column: string, value: unknown): void {
    const result = this.getDb()
      .prepare(`UPDATE sentences SET ${column} = ? WHERE id = ?`)
      .run(value, sentenceId);
    this.requireChange(result, 'Sentence', sentenceId);
  }

  async getSentencesWithoutAudio(): Promise<SentenceAudioBackfillItem[]> {
    return this.query('Failed to get sentences without audio', (db) => {
      const rows = db
        .prepare(
          `SELECT s.id AS sentenceId, s.sentence, s.pronunciation, s.language,
                  w.id AS wordId, w.word AS wordText
           FROM sentences s
           JOIN words w ON w.id = s.word_id
           WHERE (s.audio_path IS NULL OR TRIM(s.audio_path) = '')
             AND (s.ignored IS NULL OR s.ignored = FALSE)`
        )
        .all() as Array<{
        sentenceId: number;
        sentence: string;
        pronunciation: string | null;
        language: string;
        wordId: number;
        wordText: string;
      }>;
      return rows.map((r) => ({
        sentenceId: r.sentenceId,
        sentence: r.sentence,
        pronunciation: r.pronunciation ?? undefined,
        language: r.language,
        wordId: r.wordId,
        wordText: r.wordText,
      }));
    });
  }
  async updateSentenceAudioPath(
    sentenceId: number,
    audioPath: string,
    audioGenerationVoiceId?: string
  ): Promise<void> {
    this.query(`Failed to update sentence audio path`, (db) => {
      if (audioGenerationVoiceId !== undefined) {
        // Update both audio path and voice ID
        const stmt = db.prepare(`
          UPDATE sentences
          SET audio_path = ?, audio_generation_voice_id = ?
          WHERE id = ?
        `);
        const result = stmt.run(audioPath, audioGenerationVoiceId || null, sentenceId);
        this.requireChange(result, 'Sentence', sentenceId);
      } else {
        // Update only audio path
        const stmt = db.prepare(`
          UPDATE sentences
          SET audio_path = ?
          WHERE id = ?
        `);
        const result = stmt.run(audioPath, sentenceId);
        this.requireChange(result, 'Sentence', sentenceId);
      }
    });
  }
  async updateBeforeSentenceAudioPath(sentenceId: number, audioPath: string): Promise<void> {
    this.query(`Failed to update before sentence audio path`, () => {
      this.updateSentenceColumn(sentenceId, 'before_sentence_audio_path', audioPath);
    });
  }

  async updateAfterSentenceAudioPath(sentenceId: number, audioPath: string): Promise<void> {
    this.query(`Failed to update after sentence audio path`, () => {
      this.updateSentenceColumn(sentenceId, 'after_sentence_audio_path', audioPath);
    });
  }
  async recordAudioPlayback(data: {
    sessionId?: number;
    sentenceId?: number;
    audioPath: string;
    language: string;
    mode: 'learning' | 'quiz' | 'dialog' | 'flow';
    playbackSpeed?: number;
  }): Promise<number> {
    return this.query(`Failed to record audio playback`, (db) => {
      const stmt = db.prepare(`
        INSERT INTO audio_playback_events (session_id, sentence_id, audio_path, language, mode, playback_speed)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.sessionId || null,
        data.sentenceId || null,
        data.audioPath,
        data.language,
        data.mode,
        data.playbackSpeed ?? 1.0
      );

      return result.lastInsertRowid as number;
    });
  }
  async getReadAloudCache(
    text: string,
    language: string
  ): Promise<{ id: number; rawText: string; audioPath: string } | null> {
    return this.query(`Failed to get read aloud cache`, (db) => {
      const stmt = db.prepare(`
        SELECT id, raw_text, audio_path
        FROM read_aloud_cache
        WHERE raw_text = ? AND language = ?
      `);

      const row = stmt.get(text, language) as
        | { id: number; raw_text: string; audio_path: string }
        | undefined;

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        rawText: row.raw_text,
        audioPath: row.audio_path,
      };
    });
  }
  async insertReadAloudCache(text: string, language: string, audioPath: string): Promise<number> {
    return this.query(`Failed to insert read aloud cache`, (db) => {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO read_aloud_cache (raw_text, language, audio_path)
        VALUES (?, ?, ?)
      `);

      const result = stmt.run(text, language, audioPath);
      return result.lastInsertRowid as number;
    });
  }
}
