/**
 * Dialog service for conversational practice mode
 * Handles sentence selection, variant generation, and follow-up continuation
 */

import { DatabaseLayer } from '../../shared/types/database.js';
import { LLMClient } from '../../shared/types/llm.js';
import {
  Sentence,
  DialogueVariant,
  DialogSession,
  DialogResponseOption,
} from '../../shared/types/core.js';

export interface DialogServiceConfig {
  minWordStrength?: number;
  maxVariantsPerSentence?: number;
  maxKnownWordsForVariants?: number;
}

/**
 * Convert DialogueVariant to DialogResponseOption by extracting only the relevant fields
 */
function toDialogResponseOption(variant: DialogueVariant): DialogResponseOption {
  return {
    id: variant.id,
    sentenceId: variant.sentenceId,
    variantSentence: variant.variantSentence,
    variantTranslation: variant.variantTranslation,
    createdAt: variant.createdAt,
  };
}

/**
 * Shuffle an array and return the first N items
 */
function shuffleAndTake<T>(array: T[], count: number = 2): T[] {
  return [...array].sort(() => Math.random() - 0.5).slice(0, count);
}

export class DialogService {
  private database: DatabaseLayer;
  private llmClient: LLMClient;
  private config: DialogServiceConfig;

  constructor(database: DatabaseLayer, llmClient: LLMClient, config?: DialogServiceConfig) {
    this.database = database;
    this.llmClient = llmClient;
    this.config = {
      minWordStrength: config?.minWordStrength ?? 40,
      maxVariantsPerSentence: config?.maxVariantsPerSentence ?? 6,
      maxKnownWordsForVariants: config?.maxKnownWordsForVariants ?? 50,
    };
  }

  /**
   * Select a sentence for dialog practice
   * All filtering and random selection is handled at the database level for efficiency
   */
  async selectSentence(language: string): Promise<Sentence | null> {
    const sentence = await this.database.getRandomDialogSentence(language);

    return sentence;
  }

  /**
   * Generate dialogue variants for a sentence
   * Returns 2 variants plus the original sentence (3 total options)
   */
  async generateDialogueVariants(
    sentence: Sentence,
    existingVariants: DialogueVariant[],
    knownWords: string[],
    language: string
  ): Promise<DialogueVariant[]> {
    // Check how many variants we need (need 2, excluding original)
    const neededCount = Math.max(0, 2 - existingVariants.length);
    if (neededCount === 0) {
      // We have enough variants cached in DB (2+), use them - avoid expensive LLM generation
      return shuffleAndTake(existingVariants, 2);
    }

    // Generate enough variants to have at least 2 options
    const generateCount = Math.max(neededCount, this.config.maxVariantsPerSentence!);

    // Use contextBefore (trigger sentence) instead of the sentence itself
    const triggerSentence = sentence.contextBefore || sentence.sentence;
    const triggerTranslation = sentence.contextBeforeTranslation || sentence.translation;

    // Get proficiency level for the language
    let proficiencyLevel: string | undefined;
    try {
      const proficiencyKey = `language_proficiency_${language.toLowerCase()}`;
      proficiencyLevel = (await this.database.getSetting(proficiencyKey)) || undefined;
    } catch (error) {
      console.warn('Failed to retrieve proficiency level for dialogue variant generation:', error);
    }

    // Use LLM client method which handles prompt creation, JSON parsing, and validation
    const variantArray = await this.llmClient.generateDialogueVariants(
      triggerSentence,
      triggerTranslation,
      language,
      knownWords,
      generateCount,
      proficiencyLevel
    );

    // Store all generated variants to cache them for future use
    const storedVariants: DialogueVariant[] = [];

    // Store all variants that were generated
    for (const variant of variantArray) {
      try {
        const variantId = await this.database.insertDialogueVariant(
          sentence.id,
          variant.sentence,
          variant.translation
        );

        // Track stored variant
        storedVariants.push({
          id: variantId,
          sentenceId: sentence.id,
          variantSentence: variant.sentence,
          variantTranslation: variant.translation,
          createdAt: new Date(),
        });
      } catch {
        // Continue storing other variants even if one fails
      }
    }

    // Fetch all variants (existing + newly stored) to get accurate count
    const allStoredVariants = await this.database.getDialogueVariantsBySentenceId(sentence.id);

    // Combine existing and new variants, return 2 random ones
    const allVariants =
      allStoredVariants.length > 0 ? allStoredVariants : [...existingVariants, ...storedVariants];

    // Return full DialogueVariant objects with IDs
    return shuffleAndTake(allVariants, 2);
  }

  /**
   * Generate follow-up continuation text with translation (cached per variant)
   */
  async generateFollowUp(
    variantId: number,
    language: string
  ): Promise<{ text: string; translation: string }> {
    // Handle negative IDs (original sentence pseudo-variants)
    const isOriginalSentence = variantId < 0;
    let variant: DialogueVariant | null = null;

    if (isOriginalSentence) {
      // For original sentence, create a variant entry if it doesn't exist
      const sentenceId = Math.abs(variantId);
      const sentence = await this.database.getSentenceById(sentenceId);
      if (!sentence) {
        return { text: '', translation: '' };
      }

      // Check if a variant already exists for the original sentence
      const existingVariants = await this.database.getDialogueVariantsBySentenceId(sentenceId);
      const originalVariant = existingVariants.find(
        (v) =>
          v.variantSentence === sentence.sentence && v.variantTranslation === sentence.translation
      );

      if (originalVariant) {
        variant = originalVariant;
      } else {
        // Create a variant entry for the original sentence
        const variantIdFromDb = await this.database.insertDialogueVariant(
          sentenceId,
          sentence.sentence,
          sentence.translation
        );
        variant = await this.database.getDialogueVariantById(variantIdFromDb);
        if (!variant) {
          return { text: '', translation: '' };
        }
      }
    } else {
      // Regular variant - get from database
      variant = await this.database.getDialogueVariantById(variantId);
      if (!variant) {
        return { text: '', translation: '' };
      }
    }

    // Return cached continuation if available
    if (variant.continuationText && variant.continuationTranslation) {
      return {
        text: variant.continuationText,
        translation: variant.continuationTranslation,
      };
    }

    // Get proficiency level for the language
    let proficiencyLevel: string | undefined;
    try {
      const proficiencyKey = `language_proficiency_${language.toLowerCase()}`;
      proficiencyLevel = (await this.database.getSetting(proficiencyKey)) || undefined;
    } catch (error) {
      console.warn('Failed to retrieve proficiency level for follow-up generation:', error);
    }

    // Use LLM client method which handles prompt creation, JSON parsing, and validation
    // Use the variant sentence as context (what the user said), not the original sentence
    const result = await this.llmClient.generateFollowUp(
      variant.variantSentence,
      variant.variantTranslation,
      language,
      proficiencyLevel
    );

    // Cache the continuation for this variant (use actual variant ID, not the pseudo ID)
    if (result.text && result.translation) {
      try {
        await this.database.updateDialogueVariantContinuation(
          variant.id, // Use the actual database variant ID
          result.text,
          result.translation
        );
      } catch {
        // Continue even if caching fails
      }
    }

    return result;
  }

  /**
   * Pre-generate multiple dialog sessions (batch DB queries, controlled concurrent LLM calls)
   * Batches database queries for efficiency and uses controlled concurrency for LLM requests
   * to avoid flooding the LLM service while allowing parallel processing
   */
  async pregenerateSessions(count: number, language: string): Promise<DialogSession[]> {
    if (count <= 0) {
      return [];
    }

    // Step 1: Batch query - get all sentences at once from database
    const sentences = await this.database.getRandomDialogSentences(count, language);

    if (sentences.length === 0) {
      return [];
    }

    // Step 2: Extract known words once (used for all variant generations)
    const knownWords = await this.database.getKnownWords(
      language,
      this.config.minWordStrength!,
      this.config.maxKnownWordsForVariants!
    );

    // Step 3: Batch query - get existing variants for all sentences at once
    const sentenceIds = sentences.map((s) => s.id);
    const allExistingVariantsMap = new Map<number, DialogueVariant[]>();

    // Fetch existing variants for all sentences (can be done in parallel or batched)
    await Promise.all(
      sentenceIds.map(async (sentenceId) => {
        const variants = await this.database.getDialogueVariantsBySentenceId(sentenceId);
        allExistingVariantsMap.set(sentenceId, variants);
      })
    );

    // Step 4: Process each sentence with controlled concurrency for LLM-dependent operations
    // Limit to 1 concurrent LLM request to avoid flooding the service
    // Simple queue to limit LLM calls to 1 concurrent request
    let llmRequestQueue: Promise<any> = Promise.resolve();
    const queueLlmRequest = <T>(fn: () => Promise<T>): Promise<T> => {
      const current = llmRequestQueue.then(() => fn());
      llmRequestQueue = current.catch(() => {});
      return current;
    };
    const sessions: DialogSession[] = [];

    await Promise.all(
      sentences.map((sentence) =>
        queueLlmRequest(async () => {
          try {
            // Generate variants (LLM call)
            const existingVariants = allExistingVariantsMap.get(sentence.id) || [];
            const variants = await this.generateDialogueVariants(
              sentence,
              existingVariants,
              knownWords,
              language
            );

            // Create pseudo-variant for original sentence
            const originalVariant = {
              id: -sentence.id,
              sentenceId: sentence.id,
              variantSentence: sentence.sentence,
              variantTranslation: sentence.translation,
              createdAt: new Date(),
            };

            // Combine response options
            const responseOptions: DialogueVariant[] = shuffleAndTake(
              [originalVariant, ...variants],
              3 // original + up to 2 variants = 3 total
            );

            sessions.push({
              sentenceId: sentence.id,
              sentence: sentence.sentence,
              translation: sentence.translation,
              contextBefore: sentence.contextBefore,
              contextBeforeTranslation: sentence.contextBeforeTranslation,
              contextAfter: sentence.contextAfter,
              contextAfterTranslation: sentence.contextAfterTranslation,
              beforeSentenceAudio: undefined, // Will be set by IPC handler
              afterSentenceAudio: undefined, // Will be set by IPC handler
              responseOptions: responseOptions.map(toDialogResponseOption),
            });
          } catch {
            // Continue with other sentences even if one fails
          }
        })
      )
    );

    return sessions;
  }
}
