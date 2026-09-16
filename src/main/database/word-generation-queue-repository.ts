/**
 * Background word-generation job queue and per-word processing status.
 */

import { addMilliseconds } from 'date-fns';
import {
  JobWordInfo,
  WordGenerationJob,
  WordGenerationJobStatus,
  WordProcessingStatus,
} from '../../shared/types/database.js';
import { wrapError } from '../../shared/utils/error.js';
import { mapRowToWordGenerationJob } from './mappers.js';
import { BaseRepository } from './base-repository.js';

export class WordGenerationQueueRepository extends BaseRepository {
  async updateWordProcessingStatus(wordId: number, status: WordProcessingStatus): Promise<void> {
    this.query(`Failed to update word processing status`, (db) => {
      const stmt = db.prepare(`
        UPDATE words
        SET processing_status = ?
        WHERE id = ?
      `);
      stmt.run(status, wordId);
    });
  }

  async getWordProcessingInfo(
    wordId: number
  ): Promise<{ processingStatus: WordProcessingStatus; sentenceCount: number } | null> {
    return this.query(`Failed to get word processing info`, (db) => {
      const stmt = db.prepare(`
        SELECT processing_status, sentence_count
        FROM words
        WHERE id = ?
      `);

      const row = stmt.get(wordId) as
        | { processing_status: WordProcessingStatus; sentence_count: number }
        | undefined;
      return row
        ? {
            processingStatus: row.processing_status ?? 'ready',
            sentenceCount: row.sentence_count ?? 0,
          }
        : null;
    });
  }

  async getWordGenerationQueueSummary(language?: string): Promise<{
    queued: number;
    processing: number;
    failed: number;
    queuedWords: JobWordInfo[];
    processingWords: JobWordInfo[];
  }> {
    return this.query(`Failed to get queue summary`, (db) => {
      const statusQuery = `
        SELECT status, COUNT(*) as total
        FROM word_generation_queue
        ${language ? 'WHERE language = ?' : ''}
        GROUP BY status
      `;

      const rows = (
        language ? db.prepare(statusQuery).all(language) : db.prepare(statusQuery).all()
      ) as Array<{ status: string; total: number }>;

      const summary = rows.reduce(
        (acc, row) => {
          if (row.status === 'queued') acc.queued += row.total;
          if (row.status === 'processing') acc.processing += row.total;
          if (row.status === 'failed') acc.failed += row.total;
          return acc;
        },
        {
          queued: 0,
          processing: 0,
          failed: 0,
          queuedWords: [] as JobWordInfo[],
          processingWords: [] as JobWordInfo[],
        }
      );

      const jobWordQuery = `
        SELECT 
          q.word_id as wordId,
          q.status as status,
          q.language as language,
          q.topic as topic,
          w.word as word
        FROM word_generation_queue q
        INNER JOIN words w ON w.id = q.word_id
        WHERE q.status IN ('queued', 'processing')
          AND w.processing_status != 'failed'
          ${language ? 'AND q.language = ?' : ''}
        ORDER BY 
          CASE q.status WHEN 'processing' THEN 0 ELSE 1 END,
          q.updated_at ASC
      `;

      const jobWordRows = (
        language ? db.prepare(jobWordQuery).all(language) : db.prepare(jobWordQuery).all()
      ) as Array<{
        wordId: number;
        status: string;
        language: string;
        topic: string | null;
        word: string;
      }>;

      for (const job of jobWordRows) {
        const info: JobWordInfo = {
          wordId: job.wordId,
          word: job.word,
          status: job.status as WordGenerationJobStatus,
          language: job.language,
          topic: job.topic ?? undefined,
        };
        if (job.status === 'processing') {
          summary.processingWords.push(info);
        } else if (job.status === 'queued') {
          summary.queuedWords.push(info);
        }
      }

      return summary;
    });
  }

  async enqueueWordGeneration(
    wordId: number,
    language: string,
    topic?: string,
    desiredSentenceCount: number = 3
  ): Promise<void> {
    return this.queryAsync(`Failed to enqueue word generation`, async (db) => {
      const stmt = db.prepare(`
        INSERT INTO word_generation_queue (
          word_id, language, topic, desired_sentence_count, status, attempts, last_error, created_at, updated_at, started_at
        )
        VALUES (?, ?, ?, ?, 'queued', 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
        ON CONFLICT(word_id) DO UPDATE SET
          language = excluded.language,
          topic = excluded.topic,
          desired_sentence_count = excluded.desired_sentence_count,
          status = 'queued',
          attempts = 0,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP,
          started_at = NULL
      `);

      stmt.run(wordId, language, topic || null, desiredSentenceCount);

      await this.updateWordProcessingStatus(wordId, 'queued');
    });
  }

  async getNextWordGenerationJob(): Promise<WordGenerationJob | null> {
    return this.query(`Failed to get next word generation job`, (db) => {
      const row = db
        .prepare(
          `
        SELECT * FROM word_generation_queue
        WHERE status = 'queued'
        ORDER BY updated_at ASC, created_at ASC
        LIMIT 1
      `
        )
        .get() as any | undefined;

      return row ? mapRowToWordGenerationJob(row) : null;
    });
  }

  async markWordGenerationJobProcessing(jobId: number): Promise<void> {
    this.query(`Failed to mark job processing`, (db) => {
      const stmt = db.prepare(`
        UPDATE word_generation_queue
        SET status = 'processing',
            attempts = attempts + 1,
            started_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      stmt.run(jobId);
    });
  }

  async rescheduleWordGenerationJob(
    jobId: number,
    delayMs: number,
    lastError?: string
  ): Promise<void> {
    const db = this.getDb();
    const nextAttempt = addMilliseconds(new Date(), delayMs).toISOString();

    try {
      const stmt = db.prepare(`
        UPDATE word_generation_queue
        SET status = 'queued',
            updated_at = ?,
            started_at = NULL,
            last_error = COALESCE(?, last_error)
        WHERE id = ?
      `);
      stmt.run(nextAttempt, lastError || null, jobId);
    } catch (error) {
      throw wrapError(error, `Failed to reschedule job`);
    }
  }

  async completeWordGenerationJob(jobId: number): Promise<void> {
    this.query(`Failed to complete job`, (db) => {
      const stmt = db.prepare(`
        UPDATE word_generation_queue
        SET status = 'completed',
            updated_at = CURRENT_TIMESTAMP,
            started_at = NULL
        WHERE id = ?
      `);
      stmt.run(jobId);
    });
  }

  async failWordGenerationJob(jobId: number, errorMessage: string): Promise<void> {
    this.query(`Failed to mark job failed`, (db) => {
      const stmt = db.prepare(`
        UPDATE word_generation_queue
        SET status = 'failed',
            last_error = ?,
            updated_at = CURRENT_TIMESTAMP,
            started_at = NULL
        WHERE id = ?
      `);
      stmt.run(errorMessage, jobId);
    });
  }
}
