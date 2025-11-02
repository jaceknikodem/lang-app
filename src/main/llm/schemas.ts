/**
 * Shared Zod schemas for LLM response validation
 */

import { z } from 'zod';

// Base schemas for generated content
export const GeneratedWordSchema = z.object({
  word: z.string().min(1, "Word cannot be empty").trim(),
  translation: z.string().min(1, "Translation cannot be empty").trim()
});

export const GeneratedSentenceSchema = z.object({
  sentence: z.string().min(1, "Sentence cannot be empty").trim(),
  translation: z.string().min(1, "Translation cannot be empty").trim(),
  contextBefore: z.string().optional(),
  contextAfter: z.string().optional(),
  contextBeforeTranslation: z.string().optional(),
  contextAfterTranslation: z.string().optional()
});

// Fallback schemas for when LLM returns unexpected formats
export const LooseWordSchema = z.object({
  word: z.string().transform(s => s.trim()).pipe(z.string().min(1)),
  translation: z.string().transform(s => s.trim()).pipe(z.string().min(1))
}).transform(obj => ({
  word: obj.word,
  translation: obj.translation
}));

export const LooseSentenceSchema = z.object({
  sentence: z.string().transform(s => s.trim()).pipe(z.string().min(1)),
  translation: z.string().transform(s => s.trim()).pipe(z.string().min(1)),
  contextBefore: z.string().optional().transform(s => s?.trim()),
  contextAfter: z.string().optional().transform(s => s?.trim()),
  contextBeforeTranslation: z.string().optional().transform(s => s?.trim()),
  contextAfterTranslation: z.string().optional().transform(s => s?.trim())
});

// Flexible response schemas that can handle various formats
export const WordGenerationResponseSchema = z.union([
  z.array(GeneratedWordSchema),
  z.array(LooseWordSchema), // Fallback for loose validation
  GeneratedWordSchema.transform(word => [word]), // Single word -> array
  LooseWordSchema.transform(word => [word]), // Single loose word -> array
  z.object({
    words: z.array(GeneratedWordSchema)
  }).transform(obj => obj.words),
  z.object({
    words: z.array(LooseWordSchema)
  }).transform(obj => obj.words),
  z.object({
    response: z.array(GeneratedWordSchema)
  }).transform(obj => obj.response),
  z.object({
    response: z.array(LooseWordSchema)
  }).transform(obj => obj.response),
  // Handle any array of objects with word/translation properties
  z.array(z.record(z.any())).transform(arr =>
    arr.filter(item => item.word && item.translation).map(item => ({
      word: String(item.word).trim(),
      translation: String(item.translation).trim()
    }))
  )
]);

export const SentenceGenerationResponseSchema = z.union([
  z.array(GeneratedSentenceSchema),
  z.array(LooseSentenceSchema), // Fallback for loose validation
  GeneratedSentenceSchema.transform(sentence => [sentence]), // Single sentence -> array
  LooseSentenceSchema.transform(sentence => [sentence]), // Single loose sentence -> array
  z.object({
    sentences: z.array(GeneratedSentenceSchema)
  }).transform(obj => obj.sentences),
  z.object({
    sentences: z.array(LooseSentenceSchema)
  }).transform(obj => obj.sentences),
  z.object({
    response: z.array(GeneratedSentenceSchema)
  }).transform(obj => obj.response),
  z.object({
    response: z.array(LooseSentenceSchema)
  }).transform(obj => obj.response),
  // Handle any array of objects with sentence/translation properties
  z.array(z.record(z.any())).transform(arr =>
    arr.filter(item => item.sentence && item.translation).map(item => ({
      sentence: String(item.sentence).trim(),
      translation: String(item.translation).trim()
    }))
  )
]);

export const ContextSentenceSchema = z.object({
  contextBefore: z.string().optional(),
  contextAfter: z.string().optional(),
  contextBeforeTranslation: z.string().optional(),
  contextAfterTranslation: z.string().optional()
});

export const ContextSentenceResponseSchema = z.union([
  ContextSentenceSchema,
  z.object({
    response: ContextSentenceSchema
  }).transform(obj => obj.response),
  z.record(z.any()).transform(obj => ({
    contextBefore: obj.contextBefore ? String(obj.contextBefore).trim() : undefined,
    contextAfter: obj.contextAfter ? String(obj.contextAfter).trim() : undefined,
    contextBeforeTranslation: obj.contextBeforeTranslation ? String(obj.contextBeforeTranslation).trim() : undefined,
    contextAfterTranslation: obj.contextAfterTranslation ? String(obj.contextAfterTranslation).trim() : undefined
  }))
]);

