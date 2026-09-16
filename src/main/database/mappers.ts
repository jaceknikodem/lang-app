/**
 * Row mappers: pure functions turning raw SQLite rows into domain objects.
 *
 * These are module-level functions rather than methods so they can be passed
 * directly to `rows.map(...)` without losing their `this` binding.
 */

import {
  WordGenerationJob,
  WordGenerationJobStatus,
  WordProcessingStatus,
} from '../../shared/types/database.js';
import { Word, Sentence, DialogueVariant } from '../../shared/types/core.js';
import { parseSentenceParts, parseTokenizedTokens } from '../../shared/utils/sentence.js';

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function mapRowToWord(row: Record<string, unknown>): Word {
  return {
    id: row.id as number,
    word: row.word as string,
    language: row.language as string,
    translation: row.translation as string,
    strength: row.strength as number,
    known: Boolean(row.known),
    ignored: Boolean(row.ignored),
    createdAt: new Date(row.created_at as string | number | Date),
    lastStudied: row.last_studied
      ? new Date(row.last_studied as string | number | Date)
      : undefined,
    intervalDays: (row.interval_days as number) || 1,
    easeFactor: (row.ease_factor as number) || 2.5,
    lastReview: row.last_review ? new Date(row.last_review as string | number | Date) : undefined,
    nextDue: row.next_due ? new Date(row.next_due as string | number | Date) : new Date(),
    fsrsDifficulty: (row.fsrs_difficulty as number) ?? undefined,
    fsrsStability: (row.fsrs_stability as number) ?? undefined,
    fsrsLapses: (row.fsrs_lapses as number) ?? undefined,
    fsrsLastRating: (row.fsrs_last_rating as number) ?? undefined,
    processingStatus: (row.processing_status as WordProcessingStatus) ?? 'ready',
    sentenceCount: (row.sentence_count as number) ?? 0,
    grammarExplanationCount: (row.grammar_explanation_count as number) ?? 0,
    topic: (row.topic as string) ?? undefined,
    addedVia: (row.added_via as string) ?? undefined,
    zipfFrequency: (row.zipf_frequency as number) ?? undefined,
  };
}

export function mapRowToSentence(row: Record<string, unknown>): Sentence {
  // Parse related_words JSON if present
  let relatedWords: string[] | undefined;
  if (row.related_words) {
    try {
      const parsed = JSON.parse(row.related_words as string);
      if (Array.isArray(parsed)) {
        relatedWords = parsed.map((w) => String(w));
      }
    } catch {
      // Ignore JSON parsing errors
    }
  }

  return {
    id: row.id as number,
    wordId: row.word_id as number,
    language: row.language as string,
    sentence: row.sentence as string,
    sentenceParts: parseSentenceParts(row.sentence_parts as string | null | undefined),
    tokenizedTokens: parseTokenizedTokens(row.sentence_tokens as string | null | undefined),
    translation: row.translation as string,
    audioPath: (row.audio_path as string) || '',
    createdAt: new Date(row.created_at as string | number | Date),
    lastShown: row.last_shown ? new Date(row.last_shown as string | number | Date) : undefined,
    playCount: (row.play_count as number) || 0,
    contextBefore: (row.context_before as string) || undefined,
    contextAfter: (row.context_after as string) || undefined,
    contextBeforeTranslation: (row.context_before_translation as string) || undefined,
    contextAfterTranslation: (row.context_after_translation as string) || undefined,
    sentenceGenerationModel: (row.sentence_generation_model as string) || undefined,
    audioGenerationService: (row.audio_generation_service as string) || undefined,
    audioGenerationModel: (row.audio_generation_model as string) || undefined,
    audioGenerationVoiceId: (row.audio_generation_voice_id as string) || undefined,
    beforeSentenceAudioPath: (row.before_sentence_audio_path as string) || undefined,
    afterSentenceAudioPath: (row.after_sentence_audio_path as string) || undefined,
    ignored: row.ignored === 1 || row.ignored === true,
    relatedWords,
    pronunciation: (row.pronunciation as string) || undefined,
    contextBeforePronunciation: (row.context_before_pronunciation as string) || undefined,
    contextAfterPronunciation: (row.context_after_pronunciation as string) || undefined,
    proficiencyLevel: (row.proficiency_level as string) || undefined,
  };
}

export function mapRowToDialogueVariant(row: Record<string, unknown>): DialogueVariant {
  return {
    id: row.id as number,
    sentenceId: row.sentence_id as number,
    variantSentence: row.variant_sentence as string,
    variantTranslation: row.variant_translation as string,
    variantPronunciation: (row.variant_pronunciation as string) || undefined,
    createdAt: new Date(row.created_at as string | number | Date),
    continuationText: (row.continuation_text as string) || undefined,
    continuationTranslation: (row.continuation_translation as string) || undefined,
    continuationAudio: (row.continuation_audio as string) || undefined,
    variantSentenceAudio: (row.variant_sentence_audio as string) || undefined,
  };
}

export function mapRowToWordGenerationJob(row: Record<string, unknown>): WordGenerationJob {
  return {
    id: row.id as number,
    wordId: row.word_id as number,
    language: row.language as string,
    topic: (row.topic as string) ?? undefined,
    desiredSentenceCount: (row.desired_sentence_count as number) ?? 3,
    status: row.status as WordGenerationJobStatus,
    attempts: (row.attempts as number) ?? 0,
    lastError: (row.last_error as string) ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at as string | number | Date) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at as string | number | Date) : new Date(),
    startedAt: row.started_at ? new Date(row.started_at as string | number | Date) : undefined,
  };
}

export function parseGlossesField(glosses: string): string[] {
  if (!glosses) {
    return [];
  }

  try {
    const parsed = JSON.parse(glosses);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Ignore JSON parsing errors and fall back to string parsing
  }

  return glosses
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}
