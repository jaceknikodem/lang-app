/**
 * Shared Zod schemas for LLM response validation
 */

import { z } from 'zod';

/**
 * Clean special tokens from text (e.g., <sos>, <eos>, <bos>, <pad>, <unk>)
 * These tokens can appear in LLM responses and should be removed
 */
function cleanSpecialTokens(text: string): string {
  return text
    .replace(/<sos>/gi, '')
    .replace(/<eos>/gi, '')
    .replace(/<bos>/gi, '')
    .replace(/<pad>/gi, '')
    .replace(/<unk>/gi, '')
    .trim();
}

// Base schemas for generated content
export const GeneratedWordSchema = z.object({
  word: z
    .string()
    .min(1, 'Word cannot be empty')
    .transform(cleanSpecialTokens)
    .pipe(z.string().min(1)),
  translation: z
    .string()
    .min(1, 'Translation cannot be empty')
    .transform(cleanSpecialTokens)
    .pipe(z.string().min(1)),
});

export const GeneratedSentenceSchema = z.object({
  sentence: z
    .string()
    .min(1, 'Sentence cannot be empty')
    .transform(cleanSpecialTokens)
    .pipe(z.string().min(1)),
  translation: z
    .string()
    .min(1, 'Translation cannot be empty')
    .transform(cleanSpecialTokens)
    .pipe(z.string().min(1)),
  contextBefore: z
    .string()
    .optional()
    .transform((s) => (s ? cleanSpecialTokens(s) : undefined)),
  contextAfter: z
    .string()
    .optional()
    .transform((s) => (s ? cleanSpecialTokens(s) : undefined)),
  contextBeforeTranslation: z
    .string()
    .optional()
    .transform((s) => (s ? cleanSpecialTokens(s) : undefined)),
  contextAfterTranslation: z
    .string()
    .optional()
    .transform((s) => (s ? cleanSpecialTokens(s) : undefined)),
});

// Fallback schemas for when LLM returns unexpected formats
export const LooseWordSchema = z
  .object({
    word: z
      .string()
      .transform((s) => cleanSpecialTokens(s))
      .pipe(z.string().min(1)),
    translation: z
      .string()
      .transform((s) => cleanSpecialTokens(s))
      .pipe(z.string().min(1)),
  })
  .transform((obj) => ({
    word: obj.word,
    translation: obj.translation,
  }));

export const LooseSentenceSchema = z.object({
  sentence: z
    .string()
    .transform((s) => cleanSpecialTokens(s))
    .pipe(z.string().min(1)),
  translation: z
    .string()
    .transform((s) => cleanSpecialTokens(s))
    .pipe(z.string().min(1)),
  contextBefore: z
    .string()
    .optional()
    .transform((s) => (s ? cleanSpecialTokens(s) : undefined)),
  contextAfter: z
    .string()
    .optional()
    .transform((s) => (s ? cleanSpecialTokens(s) : undefined)),
  contextBeforeTranslation: z
    .string()
    .optional()
    .transform((s) => (s ? cleanSpecialTokens(s) : undefined)),
  contextAfterTranslation: z
    .string()
    .optional()
    .transform((s) => (s ? cleanSpecialTokens(s) : undefined)),
});

// Flexible response schemas that can handle various formats
export const WordGenerationResponseSchema = z.union([
  z.array(GeneratedWordSchema),
  z.array(LooseWordSchema), // Fallback for loose validation
  GeneratedWordSchema.transform((word) => [word]), // Single word -> array
  LooseWordSchema.transform((word) => [word]), // Single loose word -> array
  z
    .object({
      words: z.array(GeneratedWordSchema),
    })
    .transform((obj) => obj.words),
  z
    .object({
      words: z.array(LooseWordSchema),
    })
    .transform((obj) => obj.words),
  z
    .object({
      response: z.array(GeneratedWordSchema),
    })
    .transform((obj) => obj.response),
  z
    .object({
      response: z.array(LooseWordSchema),
    })
    .transform((obj) => obj.response),
  // Handle any array of objects with word/translation properties
  z.array(z.record(z.any())).transform((arr) =>
    arr
      .filter((item) => item.word && item.translation)
      .map((item) => ({
        word: cleanSpecialTokens(String(item.word)),
        translation: cleanSpecialTokens(String(item.translation)),
      }))
  ),
]);

export const SentenceGenerationResponseSchema = z.union([
  z.array(GeneratedSentenceSchema),
  z.array(LooseSentenceSchema), // Fallback for loose validation
  GeneratedSentenceSchema.transform((sentence) => [sentence]), // Single sentence -> array
  LooseSentenceSchema.transform((sentence) => [sentence]), // Single loose sentence -> array
  z
    .object({
      sentences: z.array(GeneratedSentenceSchema),
    })
    .transform((obj) => obj.sentences),
  z
    .object({
      sentences: z.array(LooseSentenceSchema),
    })
    .transform((obj) => obj.sentences),
  z
    .object({
      response: z.array(GeneratedSentenceSchema),
    })
    .transform((obj) => obj.response),
  z
    .object({
      response: z.array(LooseSentenceSchema),
    })
    .transform((obj) => obj.response),
  // Handle any array of objects with sentence/translation properties
  z.array(z.record(z.any())).transform((arr) =>
    arr
      .filter((item) => item.sentence && item.translation)
      .map((item) => ({
        sentence: cleanSpecialTokens(String(item.sentence)),
        translation: cleanSpecialTokens(String(item.translation)),
      }))
  ),
]);

export const ContextSentenceSchema = z.object({
  contextBefore: z.string().optional(),
  contextAfter: z.string().optional(),
  contextBeforeTranslation: z.string().optional(),
  contextAfterTranslation: z.string().optional(),
});

export const ContextSentenceResponseSchema = z.union([
  ContextSentenceSchema,
  z
    .object({
      response: ContextSentenceSchema,
    })
    .transform((obj) => obj.response),
  z.record(z.any()).transform((obj) => ({
    contextBefore: obj.contextBefore ? cleanSpecialTokens(String(obj.contextBefore)) : undefined,
    contextAfter: obj.contextAfter ? cleanSpecialTokens(String(obj.contextAfter)) : undefined,
    contextBeforeTranslation: obj.contextBeforeTranslation
      ? cleanSpecialTokens(String(obj.contextBeforeTranslation))
      : undefined,
    contextAfterTranslation: obj.contextAfterTranslation
      ? cleanSpecialTokens(String(obj.contextAfterTranslation))
      : undefined,
  })),
]);

// Dialogue variant schema for conversation practice
const DialogueVariantItemSchema = z.object({
  sentence: z.string().min(1),
  translation: z.string().min(1),
});

export const DialogueVariantResponseSchema = z.union([
  z
    .object({
      variants: z.array(DialogueVariantItemSchema),
    })
    .transform((obj) => obj.variants),
  z.array(DialogueVariantItemSchema),
  DialogueVariantItemSchema.transform((v) => [v]),
  z.record(z.any()).transform((obj) => {
    // Try to extract variants from various formats
    if (obj.variants && Array.isArray(obj.variants)) {
      return obj.variants
        .filter((item: any) => item.sentence && item.translation)
        .map((item: any) => ({
          sentence: cleanSpecialTokens(String(item.sentence)),
          translation: cleanSpecialTokens(String(item.translation)),
        }));
    }
    if (Array.isArray(obj)) {
      return obj
        .filter((item: any) => item.sentence && item.translation)
        .map((item: any) => ({
          sentence: cleanSpecialTokens(String(item.sentence)),
          translation: cleanSpecialTokens(String(item.translation)),
        }));
    }
    return [];
  }),
]);

// Follow-up continuation schema for dialog practice
export const FollowUpResponseSchema = z
  .union([
    // Handle string - check for blank-line separated translation
    z.string().transform((str) => {
      const parts = str.split('\n\n');
      if (parts.length >= 2) {
        return {
          text: cleanSpecialTokens(parts[0]),
          translation: cleanSpecialTokens(parts.slice(1).join('\n')),
        };
      }
      return { text: cleanSpecialTokens(str), translation: '' };
    }),
    // Handle object with text and translation
    z.object({
      text: z.string().transform(cleanSpecialTokens),
      translation: z.string().transform(cleanSpecialTokens),
    }),
    // Handle object with continuation and translation (normalize continuation -> text)
    z
      .object({
        continuation: z.string(),
        translation: z.string(),
      })
      .transform((obj) => ({
        text: cleanSpecialTokens(obj.continuation),
        translation: cleanSpecialTokens(obj.translation),
      })),
    // Handle object with text and english (normalize english -> translation)
    z
      .object({
        text: z.string(),
        english: z.string(),
      })
      .transform((obj) => ({
        text: cleanSpecialTokens(obj.text),
        translation: cleanSpecialTokens(obj.english),
      })),
    // Generic record fallback - normalize all formats
    z.union([
      z.string().transform((str) => {
        const parts = str.split('\n\n');
        if (parts.length >= 2) {
          return {
            text: cleanSpecialTokens(parts[0]),
            translation: cleanSpecialTokens(parts.slice(1).join('\n')),
          };
        }
        return { text: cleanSpecialTokens(str), translation: '' };
      }),
      z.record(z.any()).transform((obj) => {
        const text = cleanSpecialTokens(
          String((obj as any).text || (obj as any).continuation || '')
        );
        const translation = cleanSpecialTokens(
          String((obj as any).translation || (obj as any).english || '')
        );
        return { text, translation };
      }),
    ]),
  ])
  .refine((data) => data.translation.length > 0, { message: 'Translation is required' });
