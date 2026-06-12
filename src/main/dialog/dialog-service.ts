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
import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';

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
    variantPronunciation: variant.variantPronunciation,
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
  private readonly logger: Logger;

  constructor(database: DatabaseLayer, llmClient: LLMClient, config?: DialogServiceConfig) {
    this.logger = getLogger();
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
   * Select a sentence with a topic for topic-based dialog flow
   * Prefers sentences with non-zero audio playback
   */
  async selectSentenceWithTopic(language: string): Promise<Sentence | null> {
    const sentence = await this.database.getRandomSentenceWithTopic(language);

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
      const selected = shuffleAndTake(existingVariants, 2);
      return this.ensurePronunciation(selected, language);
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
      this.logger.warn(
        { error, language },
        'Failed to retrieve proficiency level for dialogue variant generation'
      );
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

    // Return full DialogueVariant objects with IDs, with pronunciation filled in
    const selected = shuffleAndTake(allVariants, 2);
    return this.ensurePronunciation(selected, language);
  }

  /**
   * Ensure all variants have pronunciation filled in for supported languages (Japanese).
   * Variants that already have pronunciation are left unchanged.
   * New pronunciations are persisted to the DB and returned on the in-memory objects.
   */
  private async ensurePronunciation(
    variants: DialogueVariant[],
    language: string
  ): Promise<DialogueVariant[]> {
    const lang = language.toLowerCase();
    if (lang !== 'japanese' && lang !== 'ja') {
      return variants;
    }

    const missing = variants.filter((v) => v.id > 0 && !v.variantPronunciation);
    if (missing.length === 0) {
      return variants;
    }

    try {
      const pronunciations = await this.llmClient.convertToPronunciation(
        missing.map((v) => v.variantSentence),
        language
      );

      await Promise.all(
        missing.map(async (variant, i) => {
          const pron = pronunciations[i];
          if (pron) {
            variant.variantPronunciation = pron;
            await this.database.updateDialogueVariantPronunciation(variant.id, pron);
          }
        })
      );
    } catch (error) {
      this.logger.warn({ error }, 'Failed to generate pronunciation for dialogue variants');
    }

    return variants;
  }

  /**
   * Helper method to get or create a variant from a variant ID
   * Handles both regular variants (positive IDs) and pseudo-variants (negative IDs)
   */
  private async getOrCreateVariant(variantId: number): Promise<DialogueVariant | null> {
    const isOriginalSentence = variantId < 0;

    if (isOriginalSentence) {
      // For original sentence, create a variant entry if it doesn't exist
      const sentenceId = Math.abs(variantId);
      const sentence = await this.database.getSentenceById(sentenceId);
      if (!sentence) {
        return null;
      }

      // Check if a variant already exists for the original sentence
      const existingVariants = await this.database.getDialogueVariantsBySentenceId(sentenceId);
      const originalVariant = existingVariants.find(
        (v) =>
          v.variantSentence === sentence.sentence && v.variantTranslation === sentence.translation
      );

      if (originalVariant) {
        return originalVariant;
      }

      // Create a variant entry for the original sentence
      const variantIdFromDb = await this.database.insertDialogueVariant(
        sentenceId,
        sentence.sentence,
        sentence.translation
      );
      return await this.database.getDialogueVariantById(variantIdFromDb);
    }

    // Regular variant - get from database
    return await this.database.getDialogueVariantById(variantId);
  }

  /**
   * Helper method to get proficiency level for a language
   */
  private async getProficiencyLevel(language: string): Promise<string | undefined> {
    try {
      const proficiencyKey = `language_proficiency_${language.toLowerCase()}`;
      return (await this.database.getSetting(proficiencyKey)) || undefined;
    } catch (error) {
      this.logger.warn(
        { error, language },
        'Failed to retrieve proficiency level for follow-up generation'
      );
      return undefined;
    }
  }

  /**
   * Generate follow-up continuation text with translation (cached per variant)
   */
  async generateFollowUp(
    variantId: number,
    language: string,
    conversationHistory?: string[]
  ): Promise<{ text: string; translation: string }> {
    const variant = await this.getOrCreateVariant(variantId);
    if (!variant) {
      return { text: '', translation: '' };
    }

    // Build conversation history from variant sentence + any additional history
    const fullHistory: string[] = [];

    // If we have a variant sentence, include it in the history
    if (variant.variantSentence) {
      fullHistory.push(variant.variantSentence);
    }

    // Add any additional conversation history
    if (conversationHistory && conversationHistory.length > 0) {
      fullHistory.push(...conversationHistory);
    }

    // Return cached continuation if available (only if no additional conversation history, as history changes the context)
    if (
      variant.continuationText &&
      variant.continuationTranslation &&
      (!conversationHistory || conversationHistory.length === 0)
    ) {
      return {
        text: variant.continuationText,
        translation: variant.continuationTranslation,
      };
    }

    const proficiencyLevel = await this.getProficiencyLevel(language);

    // Use unified history-based approach
    const result = await this.llmClient.generateFollowUp(fullHistory, language, proficiencyLevel);

    // Cache the continuation for this variant (use actual variant ID, not the pseudo ID)
    // Only cache if no additional conversation history was provided
    if (
      result.text &&
      result.translation &&
      (!conversationHistory || conversationHistory.length === 0)
    ) {
      try {
        await this.database.updateDialogueVariantContinuation(
          variant.id,
          result.text,
          result.translation
        );
      } catch (error) {
        this.logger.warn({ error, variantId: variant.id }, 'Failed to cache continuation');
      }
    }

    return result;
  }

  /**
   * Pre-generate multiple dialog sessions (batch DB queries, controlled concurrent LLM calls)
   * Batches database queries for efficiency and uses controlled concurrency for LLM requests
   * to avoid flooding the LLM service while allowing parallel processing
   * Randomly generates a mix of topic-based and variant-based sessions
   */
  async pregenerateSessions(count: number, language: string): Promise<DialogSession[]> {
    if (count <= 0) {
      return [];
    }

    // Step 1: Determine flow type for each session (randomly choose topic-based or variant-based)
    const sessionFlowTypes: boolean[] = [];
    for (let i = 0; i < count; i++) {
      sessionFlowTypes.push(Math.random() < 0.5); // true = topic-based, false = variant-based
    }

    // Step 2: Separate sessions by flow type for batch processing
    const topicBasedIndices: number[] = [];
    const variantBasedIndices: number[] = [];
    sessionFlowTypes.forEach((isTopicBased, index) => {
      if (isTopicBased) {
        topicBasedIndices.push(index);
      } else {
        variantBasedIndices.push(index);
      }
    });

    const sessions: DialogSession[] = new Array(count);

    // Step 3: Process topic-based sessions
    if (topicBasedIndices.length > 0) {
      for (const index of topicBasedIndices) {
        try {
          const sentence = await this.database.getRandomSentenceWithTopic(language);
          if (!sentence) {
            // If no topic-based sentence available, skip this session
            continue;
          }

          sessions[index] = {
            sentenceId: sentence.id,
            sentence: sentence.sentence,
            translation: sentence.translation,
            contextBefore: sentence.contextBefore,
            contextBeforeTranslation: sentence.contextBeforeTranslation,
            contextAfter: sentence.contextAfter,
            contextAfterTranslation: sentence.contextAfterTranslation,
            beforeSentenceAudio: undefined, // Will be set by IPC handler
            afterSentenceAudio: undefined, // Will be set by IPC handler
            responseOptions: [], // Topic-based sessions have no variants
            isTopicBasedFlow: true,
          };
        } catch {
          // Continue with other sessions even if one fails
        }
      }
    }

    // Step 4: Process variant-based sessions (batch query for efficiency)
    if (variantBasedIndices.length > 0) {
      // Batch query - get all variant-based sentences at once
      const variantSentences = await this.database.getRandomDialogSentences(
        variantBasedIndices.length,
        language
      );

      if (variantSentences.length > 0) {
        // Extract known words once (used for all variant generations)
        const knownWords = await this.database.getKnownWords(
          language,
          this.config.minWordStrength!,
          this.config.maxKnownWordsForVariants!
        );

        // Batch query - get existing variants for all sentences at once
        const sentenceIds = variantSentences.map((s) => s.id);
        const allExistingVariantsMap = new Map<number, DialogueVariant[]>();

        // Fetch existing variants for all sentences (can be done in parallel)
        await Promise.all(
          sentenceIds.map(async (sentenceId) => {
            const variants = await this.database.getDialogueVariantsBySentenceId(sentenceId);
            allExistingVariantsMap.set(sentenceId, variants);
          })
        );

        // Process each variant-based sentence sequentially to avoid flooding the LLM service
        for (let i = 0; i < variantSentences.length && i < variantBasedIndices.length; i++) {
          const sentence = variantSentences[i];
          const index = variantBasedIndices[i];

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

            sessions[index] = {
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
              isTopicBasedFlow: false,
            };
          } catch {
            // Continue with other sentences even if one fails
          }
        }
      }
    }

    // Filter out any undefined sessions (failed generations)
    return sessions.filter((session): session is DialogSession => session !== undefined);
  }
}
