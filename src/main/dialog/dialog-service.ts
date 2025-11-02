/**
 * Dialog service for conversational practice mode
 * Handles sentence selection, variant generation, and follow-up continuation
 */

import { DatabaseLayer } from '../../shared/types/database.js';
import { LLMClient } from '../../shared/types/llm.js';
import { Sentence, DialogueVariant, DialogSession } from '../../shared/types/core.js';

export interface DialogServiceConfig {
  minWordStrength?: number;
  maxVariantsPerSentence?: number;
  maxKnownWordsForVariants?: number;
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
      maxKnownWordsForVariants: config?.maxKnownWordsForVariants ?? 50
    };
  }

  /**
   * Select a sentence where word strengths are high
   * All filtering and random selection is handled at the database level for efficiency
   */
  async selectSentence(language?: string): Promise<Sentence | null> {
    try {
      const currentLanguage = language || await this.database.getCurrentLanguage();

      const sentence = await this.database.getRandomDialogSentence(
        this.config.minWordStrength!,
        currentLanguage
      );
      
      if (!sentence) {
        return null;
      }
      
      return sentence;
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate dialogue variants for a sentence
   * Returns 2 variants plus the original sentence (3 total options)
   */
  async generateDialogueVariants(
    sentence: Sentence,
    existingVariants: DialogueVariant[],
    knownWords?: string[]
  ): Promise<DialogueVariant[]> {
    try {
      const language = await this.database.getCurrentLanguage();
      
      // Get known words to use in variants (if not provided)
      let wordsToUse: string[];
      if (knownWords) {
        wordsToUse = knownWords;
      } else {
        const allWords = await this.database.getAllWords(true, false, language);
        wordsToUse = allWords
          .filter(w => w.known || (w.strength ?? 0) >= this.config.minWordStrength!)
          .slice(0, this.config.maxKnownWordsForVariants!)
          .map(w => w.word);
      }

      // Check how many variants we need (need 2, excluding original)
      const neededCount = Math.max(0, 2 - existingVariants.length);
      
      // Check how many more variants we can store.
      const currentCount = existingVariants.length;
      const maxToGenerate = Math.max(0, this.config.maxVariantsPerSentence! - currentCount);
      
      if (neededCount === 0) {
        // We have enough variants cached in DB (2+), use them - avoid expensive LLM generation
        const shuffled = [...existingVariants].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, 2); // Return full DialogueVariant objects
      }

      // Generate new variants - generate up to maxVariantsPerSentence to cache for future use
      // But at minimum, generate enough to have 2 options
      // Generate as many as needed at a time for efficiency.
      const generateCount = Math.max(neededCount, Math.min(this.config.maxVariantsPerSentence!, maxToGenerate));
      
      // Use contextBefore (trigger sentence) instead of the sentence itself
      const triggerSentence = sentence.contextBefore || sentence.sentence;
      const triggerTranslation = sentence.contextBeforeTranslation || sentence.translation;
      
      // Use LLM client method which handles prompt creation, JSON parsing, and validation
      const variantArray = await this.llmClient.generateDialogueVariants(
        triggerSentence,
        triggerTranslation,
        language,
        wordsToUse,
        generateCount
      );
      
      // Check how many we can actually store (respect max limit)
      const canStore = Math.min(variantArray.length, maxToGenerate);
      
      // Store all generated variants (up to max) to cache them for future use
      const storedVariants: DialogueVariant[] = [];
      const normalizedExisting = new Set(
        existingVariants.map(v => 
          `${v.variantSentence.toLowerCase().trim()}|${v.variantTranslation.toLowerCase().trim()}`
        )
      );
      
      for (let i = 0; i < canStore; i++) {
        const variant = variantArray[i];
        
        // Check for duplicates before storing
        const normalized = `${variant.sentence.toLowerCase().trim()}|${variant.translation.toLowerCase().trim()}`;
        if (normalizedExisting.has(normalized)) {
          continue;
        }
        
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
            createdAt: new Date()
          });
          
          // Add to existing set to avoid duplicates
          normalizedExisting.add(normalized);
        } catch (error) {
          // Continue storing other variants even if one fails
        }
      }

      // Fetch all variants (existing + newly stored) to get accurate count
      const allStoredVariants = await this.database.getDialogueVariantsBySentenceId(
        sentence.id,
        this.config.maxVariantsPerSentence!
      );
      
      // Combine existing and new variants, return 2 random ones
      const allVariants = allStoredVariants.length > 0 ? allStoredVariants : [...existingVariants, ...storedVariants];
      const shuffled = [...allVariants].sort(() => Math.random() - 0.5);
      
      // Return full DialogueVariant objects with IDs
      return shuffled.slice(0, 2);
    } catch (error) {
      // Return empty array on error
      return [];
    }
  }

  /**
   * Generate follow-up continuation text with translation (cached per variant)
   */
  async generateFollowUp(variantId: number, language?: string): Promise<{ text: string; translation: string }> {
    try {
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
          v => v.variantSentence === sentence.sentence && v.variantTranslation === sentence.translation
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
          translation: variant.continuationTranslation
        };
      }

      const currentLanguage = language || await this.database.getCurrentLanguage();
      
      // Use LLM client method which handles prompt creation, JSON parsing, and validation
      // Use the variant sentence as context (what the user said), not the original sentence
      const result = await this.llmClient.generateFollowUp(
        variant.variantSentence,
        variant.variantTranslation,
        currentLanguage
      );

      // Cache the continuation for this variant (use actual variant ID, not the pseudo ID)
      if (result.text && result.translation) {
        try {
          await this.database.updateDialogueVariantContinuation(
            variant.id, // Use the actual database variant ID
            result.text,
            result.translation
          );
        } catch (cacheError) {
          // Continue even if caching fails
        }
      }

      return result;
    } catch (error) {
      return { text: '', translation: '' };
    }
  }

  /**
   * Pre-generate multiple dialog sessions (batch DB queries, sequential LLM calls)
   * Batches database queries for efficiency but processes LLM-dependent operations sequentially
   * to avoid flooding the LLM service
   */
  async pregenerateSessions(count: number, language?: string): Promise<DialogSession[]> {
    if (count <= 0) {
      return [];
    }

    try {
      const currentLanguage = language || await this.database.getCurrentLanguage();
      
      // Step 1: Batch query - get all sentences at once from database
      const sentences = await this.database.getRandomDialogSentences(
        count,
        this.config.minWordStrength!,
        currentLanguage
      );

      if (sentences.length === 0) {
        return [];
      }

      // Step 2: Extract known words once (used for all variant generations)
      const allWords = await this.database.getAllWords(true, false, currentLanguage);
      const knownWords = allWords
        .filter(w => w.known || (w.strength ?? 0) >= this.config.minWordStrength!)
        .slice(0, this.config.maxKnownWordsForVariants!)
        .map(w => w.word);

      // Step 3: Batch query - get existing variants for all sentences at once
      const sentenceIds = sentences.map(s => s.id);
      const allExistingVariantsMap = new Map<number, DialogueVariant[]>();
      
      // Fetch existing variants for all sentences (can be done in parallel or batched)
      await Promise.all(sentenceIds.map(async (sentenceId) => {
        const variants = await this.database.getDialogueVariantsBySentenceId(sentenceId);
        allExistingVariantsMap.set(sentenceId, variants);
      }));

      // Step 4: Process each sentence sequentially for LLM-dependent operations
      // This avoids flooding the LLM service with concurrent requests
      const sessions: Array<{
        sentenceId: number;
        sentence: string;
        translation: string;
        contextBefore?: string;
        contextBeforeTranslation?: string;
        beforeSentenceAudio?: string;
        responseOptions: Array<{
          id: number;
          sentenceId: number;
          variantSentence: string;
          variantTranslation: string;
          createdAt: Date;
        }>;
      }> = [];

      for (const sentence of sentences) {
        try {
          // Generate variants sequentially (LLM call)
          const existingVariants = allExistingVariantsMap.get(sentence.id) || [];
          const variants = await this.generateDialogueVariants(sentence, existingVariants, knownWords);

          // Create pseudo-variant for original sentence
          const originalVariant = {
            id: -sentence.id,
            sentenceId: sentence.id,
            variantSentence: sentence.sentence,
            variantTranslation: sentence.translation,
            createdAt: new Date()
          };

          // Combine response options
          const responseOptions: DialogueVariant[] = [
            originalVariant,
            ...variants.slice(0, 2)
          ].sort(() => Math.random() - 0.5);

          sessions.push({
            sentenceId: sentence.id,
            sentence: sentence.sentence,
            translation: sentence.translation,
            contextBefore: sentence.contextBefore,
            contextBeforeTranslation: sentence.contextBeforeTranslation,
            beforeSentenceAudio: undefined, // Will be set by IPC handler
            responseOptions: responseOptions.map(v => ({
              id: v.id,
              sentenceId: v.sentenceId,
              variantSentence: v.variantSentence,
              variantTranslation: v.variantTranslation,
              createdAt: v.createdAt
            }))
          });
        } catch (error) {
          // Continue with other sentences even if one fails
        }
      }

      return sessions;
    } catch (error) {
      return [];
    }
  }

}

