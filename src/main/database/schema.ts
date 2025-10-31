/**
 * Drizzle ORM schema definitions
 */

import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Words table
export const words = sqliteTable('words', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  word: text('word').notNull(),
  language: text('language').notNull().default('spanish'),
  translation: text('translation').notNull(),
  audioPath: text('audio_path'),
  strength: integer('strength').default(0).notNull().$type<number>(),
  known: integer('known', { mode: 'boolean' }).default(false).notNull(),
  ignored: integer('ignored', { mode: 'boolean' }).default(false).notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastStudied: text('last_studied'),
  // SRS fields
  intervalDays: integer('interval_days').default(1),
  easeFactor: real('ease_factor').default(2.5),
  lastReview: text('last_review'),
  nextDue: text('next_due'),
  // FSRS fields
  fsrsDifficulty: real('fsrs_difficulty').default(5.0),
  fsrsStability: real('fsrs_stability').default(1.0),
  fsrsLapses: integer('fsrs_lapses').default(0),
  fsrsLastRating: integer('fsrs_last_rating'),
  fsrsVersion: text('fsrs_version').default('fsrs-baseline'),
  // Processing status
  processingStatus: text('processing_status').default('ready').$type<'queued' | 'processing' | 'ready' | 'failed'>(),
  sentenceCount: integer('sentence_count').default(0),
}, (table) => ({
  strengthIdx: index('idx_words_strength').on(table.strength),
  lastStudiedIdx: index('idx_words_last_studied').on(table.lastStudied),
  knownIgnoredIdx: index('idx_words_known_ignored').on(table.known, table.ignored),
  nextDueIdx: index('idx_words_next_due').on(table.nextDue),
  srsReviewIdx: index('idx_words_srs_review').on(table.nextDue, table.strength),
  fsrsStateIdx: index('idx_words_fsrs_state').on(table.fsrsStability, table.fsrsDifficulty),
}));

// Sentences table
export const sentences = sqliteTable('sentences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  wordId: integer('word_id').notNull().references(() => words.id, { onDelete: 'cascade' }),
  sentence: text('sentence').notNull(),
  translation: text('translation').notNull(),
  audioPath: text('audio_path'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastShown: text('last_shown'),
  contextBefore: text('context_before'),
  contextAfter: text('context_after'),
  contextBeforeTranslation: text('context_before_translation'),
  contextAfterTranslation: text('context_after_translation'),
  sentenceParts: text('sentence_parts'),
}, (table) => ({
  wordIdIdx: index('idx_sentences_word_id').on(table.wordId),
}));

// Progress table
export const progress = sqliteTable('progress', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  wordsStudied: integer('words_studied').default(0),
  whenStudied: text('when_studied').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  whenStudiedIdx: index('idx_progress_when_studied').on(table.whenStudied),
}));

// Settings table
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Dictionary table
export const dict = sqliteTable('dict', {
  word: text('word'),
  pos: text('pos'),
  glosses: text('glosses'),
  lang: text('lang'),
}, (table) => ({
  wordLangIdx: index('idx_word_lang').on(table.word, table.lang),
}));

// Word generation queue table
export const wordGenerationQueue = sqliteTable('word_generation_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  wordId: integer('word_id').notNull().unique().references(() => words.id, { onDelete: 'cascade' }),
  language: text('language').notNull(),
  topic: text('topic'),
  desiredSentenceCount: integer('desired_sentence_count').notNull().default(3),
  status: text('status').notNull().default('queued').$type<'queued' | 'processing' | 'completed' | 'failed'>(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  startedAt: text('started_at'),
}, (table) => ({
  statusIdx: index('idx_word_generation_queue_status').on(table.status, table.updatedAt),
}));

// Migrations table (for tracking schema versions)
export const migrations = sqliteTable('migrations', {
  version: integer('version').primaryKey(),
  name: text('name').notNull(),
  appliedAt: text('applied_at').default(sql`CURRENT_TIMESTAMP`),
});
