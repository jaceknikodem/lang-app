/**
 * Dialog service for conversational practice mode
 * Handles sentence selection, variant generation, and follow-up continuation
 */

import { DatabaseLayer } from '../../shared/types/database.js';
import { LLMClient } from '../../shared/types/llm.js';
import { Sentence, DialogueVariant } from '../../shared/types/core.js';
import { z } from 'zod';

const DialogueVariantResponseSchema = z.union([
  z.object({
    variants: z.array(z.object({
      sentence: z.string(),
      translation: z.string()
    }))
  }),
  z.array(z.object({
    sentence: z.string(),
    translation: z.string()
  })),
  z.object({
    sentence: z.string(),
    translation: z.string()
  }).transform(v => [{ sentence: v.sentence, translation: v.translation }]),
  z.record(z.any()).transform(obj => {
    // Try to extract variants from various formats
    if (obj.variants && Array.isArray(obj.variants)) {
      return obj.variants;
    }
    if (Array.isArray(obj)) {
      return obj;
    }
    return [];
  })
]);

const FollowUpResponseSchema = z.union([
  z.string().transform(text => ({ text, translation: '' })),
  z.object({
    text: z.string(),
    translation: z.string().optional()
  }),
  z.object({
    continuation: z.string(),
    translation: z.string().optional()
  }),
  z.object({
    text: z.string(),
    english: z.string().optional()
  }),
  z.record(z.any()).transform(obj => {
    if (typeof obj === 'string') return { text: obj, translation: '' };
    if (obj.text || obj.continuation) {
      const text = String(obj.text || obj.continuation);
      const translation = String(obj.translation || obj.english || '');
      return { text, translation };
    }
    return { text: '', translation: '' };
  })
]);

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
      
      // Single database query handles all filtering and random selection:
      // - Filters by language, strength >= minWordStrength, ignored = FALSE
      // - Filters by contextBefore exists and is not empty
      // - Randomly selects one result
      const sentence = await this.database.getRandomDialogSentence(
        this.config.minWordStrength!,
        currentLanguage
      );
      
      if (!sentence) {
        console.log('[DialogService] No suitable sentences found for dialog', {
          language: currentLanguage,
          minStrength: this.config.minWordStrength
        });
        return null;
      }
      
      console.log('[DialogService] Selected sentence for dialog', {
        sentenceId: sentence.id,
        wordId: sentence.wordId
      });
      
      return sentence;
    } catch (error) {
      console.error('[DialogService] Failed to select sentence for dialog:', error);
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
      
      if (neededCount === 0 && maxToGenerate <= 0) {
        // We have enough variants cached (at max limit), just return 2 random ones
        const shuffled = [...existingVariants].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, 2); // Return full DialogueVariant objects
      }

      // Generate new variants - generate up to maxVariantsPerSentence to cache for future use
      // But at minimum, generate enough to have 2 options
      // Generate as many as needed at a time for efficiency.
      const generateCount = Math.max(neededCount, Math.min(this.config.maxVariantsPerSentence! + 1, maxToGenerate));
      
      // Use contextBefore (trigger sentence) instead of the sentence itself
      const triggerSentence = sentence.contextBefore || sentence.sentence;
      const triggerTranslation = sentence.contextBeforeTranslation || sentence.translation;
      
      const prompt = this.createVariantPrompt(
        triggerSentence,
        triggerTranslation,
        language,
        wordsToUse,
        generateCount
      );

      // Use makeRequest if available (for Gemini client), otherwise use generateResponse
      let parsedResponse: any;
      
      // Check if the LLM client has a makeRequest method (Gemini client)
      const geminiClient = this.llmClient as any;
      if (typeof geminiClient.makeRequest === 'function') {
        // Use makeRequest which handles JSON parsing and cleaning
        parsedResponse = await geminiClient.makeRequest(prompt, geminiClient.getSentenceGenerationModel?.());
      } else {
        // For Ollama or other clients, use generateResponse and parse manually
        const response = await this.llmClient.generateResponse(prompt);
        
        // Clean the response (remove markdown code blocks, leading text, etc.)
        let cleanResponse = typeof response === 'string' ? response : String(response);
        
        // Remove markdown code blocks
        cleanResponse = cleanResponse.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
        
        // Remove leading text before JSON
        cleanResponse = cleanResponse.replace(/^(Here's|Here is|The|Response:|JSON:)\s*/i, '');
        
        // Extract JSON array or object
        const jsonMatch = cleanResponse.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (jsonMatch) {
          cleanResponse = jsonMatch[0];
        }
        
        try {
          parsedResponse = JSON.parse(cleanResponse.trim());
        } catch (parseError) {
          console.error('[DialogService] JSON parsing failed:', parseError);
          console.error('[DialogService] Clean response:', cleanResponse);
          throw new Error('Could not parse LLM response as JSON');
        }
      }

      // Validate with Zod
      const parseResult = DialogueVariantResponseSchema.safeParse(parsedResponse);
      
      if (!parseResult.success) {
        console.error('[DialogService] Zod validation failed for dialogue variants');
        console.error('[DialogService] Parsed response:', JSON.stringify(parsedResponse, null, 2));
        console.error('[DialogService] Zod errors:', parseResult.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code
        })));
        throw new Error(`Invalid response format: ${parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
      }

      const variants = parseResult.data;
      
      // Ensure we have an array of variants
      const variantArray = Array.isArray(variants) ? variants : variants.variants || [];
      
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
          console.log('[DialogService] Skipping duplicate variant:', variant.sentence);
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
          
          console.log('[DialogService] Stored dialogue variant', {
            sentenceId: sentence.id,
            variantId,
            variantSentence: variant.sentence.slice(0, 50)
          });
        } catch (error) {
          console.warn('[DialogService] Failed to store dialogue variant:', error);
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
      console.error('Failed to generate dialogue variants:', error);
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
          console.error('[DialogService] Sentence not found for variant:', variantId);
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
            console.error('[DialogService] Failed to create variant for original sentence');
            return { text: '', translation: '' };
          }
        }
      } else {
        // Regular variant - get from database
        variant = await this.database.getDialogueVariantById(variantId);
        if (!variant) {
          console.error('[DialogService] Variant not found:', variantId);
          return { text: '', translation: '' };
        }
      }

      // Return cached continuation if available
      if (variant.continuationText && variant.continuationTranslation) {
        console.log('[DialogService] Using cached continuation for variant:', variant.id);
        return {
          text: variant.continuationText,
          translation: variant.continuationTranslation
        };
      }

      const currentLanguage = language || await this.database.getCurrentLanguage();
      
      // Use the variant sentence as context (what the user said), not the original sentence
      const prompt = this.createFollowUpPrompt(
        variant.variantSentence,
        variant.variantTranslation,
        currentLanguage
      );

      // Use makeRequest if available (for Gemini client), otherwise use generateResponse
      let parsedResponse: any;
      
      // Check if the LLM client has a makeRequest method (Gemini client)
      const geminiClient = this.llmClient as any;
      if (typeof geminiClient.makeRequest === 'function') {
        // Use makeRequest which handles JSON parsing and cleaning
        try {
          parsedResponse = await geminiClient.makeRequest(prompt, geminiClient.getSentenceGenerationModel?.());
        } catch (error) {
          // If makeRequest fails, fall back to generateResponse
          const rawResponse = await this.llmClient.generateResponse(prompt);
          parsedResponse = rawResponse;
        }
      } else {
        // For Ollama or other clients, use generateResponse
        const rawResponse = await this.llmClient.generateResponse(prompt);
        parsedResponse = rawResponse;
      }
      
      // If response is a string that might be JSON, try to parse it
      if (typeof parsedResponse === 'string') {
        // Clean the response (remove markdown code blocks, leading text, etc.)
        let cleanResponse = parsedResponse.trim();
        
        // Remove markdown code blocks
        cleanResponse = cleanResponse.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
        
        // Remove leading text before JSON
        cleanResponse = cleanResponse.replace(/^(Here's|Here is|The|Response:|JSON:)\s*/i, '');
        
        // Try to extract JSON object
        const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsedResponse = JSON.parse(jsonMatch[0]);
          } catch (parseError) {
            // If JSON parsing fails, treat as plain text
            console.log('[DialogService] JSON parsing failed, treating as plain text');
          }
        } else {
          // No JSON found, check if it's plain text with translation separated by blank line
          const parts = cleanResponse.split('\n\n');
          if (parts.length >= 2) {
            parsedResponse = {
              text: parts[0].trim(),
              translation: parts.slice(1).join('\n').trim()
            };
          } else {
            // Plain text only
            parsedResponse = { text: cleanResponse, translation: '' };
          }
        }
      }
      
      // Parse response - follow-up can be plain text or JSON with text and translation
      const parseResult = FollowUpResponseSchema.safeParse(parsedResponse);
      
      if (!parseResult.success) {
        console.error('[DialogService] Failed to parse follow-up:', parseResult.error);
        console.error('[DialogService] Parsed response:', parsedResponse);
        // Return empty object on parse failure instead of crashing
        return { text: '', translation: '' };
      }

      const parsedData = parseResult.data;
      
      // Extract text and translation - parsedData can be various formats, but schema ensures it has text and translation
      let text = '';
      let translation = '';
      
      if ('text' in parsedData) {
        text = String(parsedData.text);
        // Check if text contains translation separated by blank line
        const parts = text.split('\n\n');
        if (parts.length >= 2) {
          text = parts[0].trim();
          translation = parts.slice(1).join('\n').trim();
        }
      } else if ('continuation' in parsedData) {
        text = String(parsedData.continuation);
      }
      
      // If we don't have translation from text parsing, check object properties
      if (!translation) {
        if ('translation' in parsedData && parsedData.translation) {
          translation = String(parsedData.translation);
        } else if ('english' in parsedData && parsedData.english) {
          translation = String(parsedData.english);
        }
      }

      // If no translation was provided, try to generate it separately
      if (!translation && text) {
        console.log('[DialogService] No translation in response, generating separately...');
        // Could add translation logic here if needed
      }

      const result = { 
        text: text.trim(), 
        translation: translation.trim() 
      };

      // Cache the continuation for this variant (use actual variant ID, not the pseudo ID)
      if (result.text && result.translation) {
        try {
          await this.database.updateDialogueVariantContinuation(
            variant.id, // Use the actual database variant ID
            result.text,
            result.translation
          );
          console.log('[DialogService] Cached continuation for variant:', variant.id);
        } catch (cacheError) {
          console.error('[DialogService] Failed to cache continuation:', cacheError);
          // Continue even if caching fails
        }
      }

      return result;
    } catch (error) {
      console.error('Failed to generate follow-up:', error);
      return { text: '', translation: '' };
    }
  }

  /**
   * Create prompt for generating dialogue variants
   */
  private createVariantPrompt(
    triggerSentence: string,
    triggerTranslation: string,
    language: string,
    knownWords: string[],
    count: number
  ): string {
    const languageName = language.charAt(0).toUpperCase() + language.slice(1);
    const examples = Array.from({ length: count }, (_, i) =>
      `  {
    "sentence": "${languageName.toLowerCase()}_response_${i + 1}",
    "translation": "english_translation_${i + 1}"
  }`
    ).join(',\n');
    
    const knownWordsText = knownWords.length > 0
      ? `\nIMPORTANT: Use words from this list when possible: ${knownWords.slice(0, 20).join(', ')}`
      : '';
    
    return `CRITICAL: You must return exactly ${count} ${languageName} response sentence(s) in a JSON array. No more, no less.
CRITICAL: Return ONLY the JSON array, no explanations or extra text.

Task: Generate exactly ${count} diverse ${languageName} response sentence(s) that could naturally follow this trigger sentence.${knownWordsText}

Trigger sentence: "${triggerSentence}"
Trigger translation: "${triggerTranslation}"

Expected output format (${count} items):
[
${examples}
]

Requirements:
1. Must be exactly ${count} responses
2. Each response should be DIFFERENT from the others - provide diverse options
3. Responses should naturally follow the trigger sentence conversationally
4. Make them natural and idiomatic
5. Each response must have both the ${languageName} sentence and English translation
6. Responses should vary in wording, structure, or approach when possible
${knownWords.length > 0 ? '7. Prefer using words from the provided list when possible' : ''}
8. Return ONLY the JSON array, nothing else`;
  }

  /**
   * Create prompt for generating follow-up continuation
   */
  private createFollowUpPrompt(
    sentence: string,
    translation: string,
    language: string
  ): string {
    const languageName = language.charAt(0).toUpperCase() + language.slice(1);
    
    return `Given this ${languageName} sentence and its English translation:

"${sentence}"
"${translation}"

Generate a natural continuation of about 3 sentences in ${languageName}. This should:
1. NOT be a question
2. Continue the thought or provide related context
3. Be suitable for reading/listening practice
4. Be natural and coherent

IMPORTANT: You must return BOTH the ${languageName} text AND its English translation.

Preferred JSON format:
{
  "text": "${languageName} continuation text here",
  "translation": "English translation here"
}
`;
  }

  /**
   * Pre-generate multiple dialog sessions (batch DB queries, sequential LLM calls)
   * Batches database queries for efficiency but processes LLM-dependent operations sequentially
   * to avoid flooding the LLM service
   */
  async pregenerateSessions(count: number, language?: string): Promise<Array<{
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
  }>> {
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
        console.log('[DialogService] No suitable sentences found for batch generation', {
          language: currentLanguage,
          minStrength: this.config.minWordStrength,
          requestedCount: count
        });
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
          console.error(`[DialogService] Failed to generate variants for sentence ${sentence.id}:`, error);
          // Continue with other sentences even if one fails
        }
      }

      console.log(`[DialogService] Successfully pre-generated ${sessions.length} of ${count} requested dialog sessions`);
      return sessions;
    } catch (error) {
      console.error('[DialogService] Failed to pre-generate dialog sessions:', error);
      return [];
    }
  }

  /**
   * Ensure beforeSentence audio exists and return the path
   */
  async ensureBeforeSentenceAudio(sentenceId: number): Promise<string | null> {
    // This method will be implemented by calling the audio service via IPC
    // For now, we'll delegate to the main process
    return null; // Will be handled by IPC handler
  }
}

