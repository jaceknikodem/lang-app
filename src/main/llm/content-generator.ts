/**
 * Content generation workflows using LLM client
 */

import { lookup } from 'node:dns/promises';
import { GeneratedWord, GeneratedSentence } from '../../shared/types/core.js';
import { LLMClient } from '../../shared/types/llm.js';
import { DatabaseLayer } from '../../shared/types/database.js';
import { LLMFactory, LLMFactoryConfig, LLMProvider } from './llm-factory.js';
import { FrequencyWordManager } from './frequency-word-manager.js';
import type { LemmatizationService } from '../lemmatization/index.js';
import { wrapError, serializeErrorForLogging } from '../../shared/utils/error.js';
import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';

const TATOEBA_API_URL = 'https://tatoeba.org/en/api_v0/search';
const TATOEBA_TARGET_LANGUAGE = 'eng';
const TATOEBA_LANGUAGE_CODES: Record<string, string> = {
  italian: 'ita',
  spanish: 'spa',
  portuguese: 'por',
  polish: 'pol',
  indonesian: 'ind',
};

export interface ContentGeneratorConfig {
  defaultLanguage: string;
  defaultWordCount: number;
  defaultSentenceCount: number;
  retryAttempts: number;
  retryDelay: number;
  llmProvider?: LLMProvider;
  geminiApiKey?: string;
  mlxLmBaseUrl?: string;
  lemmatizationService?: LemmatizationService;
}

export class ContentGenerator {
  private llmClient: LLMClient;
  private config: ContentGeneratorConfig;
  private frequencyWordManager: FrequencyWordManager;
  private lemmatizationService?: LemmatizationService;
  private readonly logger: Logger;

  constructor(llmClient?: LLMClient, config?: Partial<ContentGeneratorConfig>) {
    this.logger = getLogger();
    this.config = {
      defaultLanguage: config?.defaultLanguage || 'Spanish',
      defaultWordCount: config?.defaultWordCount || 10,
      defaultSentenceCount: config?.defaultSentenceCount || 3,
      retryAttempts: config?.retryAttempts || 2,
      retryDelay: config?.retryDelay || 1000,
      llmProvider: config?.llmProvider || 'ollama',
      geminiApiKey: config?.geminiApiKey,
      mlxLmBaseUrl: config?.mlxLmBaseUrl,
    };

    // Create LLM client using factory if not provided
    if (llmClient) {
      this.llmClient = llmClient;
    } else {
      this.llmClient = this.createLLMClient();
    }

    this.frequencyWordManager = new FrequencyWordManager();
    this.lemmatizationService = config?.lemmatizationService;
  }

  /**
   * Initialize the content generator and frequency word manager
   */
  async initialize(): Promise<void> {
    await this.frequencyWordManager.initialize();
  }

  /**
   * Create LLM client based on configuration
   */
  private createLLMClient(): LLMClient {
    const factoryConfig: LLMFactoryConfig = {
      provider: this.config.llmProvider || 'ollama',
    };

    if (this.config.llmProvider === 'gemini') {
      factoryConfig.geminiConfig = {
        apiKey: this.config.geminiApiKey || '',
      };
    } else if (this.config.llmProvider === 'mlx-lm') {
      factoryConfig.mlxLmConfig = this.config.mlxLmBaseUrl
        ? { baseUrl: this.config.mlxLmBaseUrl }
        : {};
    }

    this.logger.info({
      provider: this.config.llmProvider,
      hasApiKey: !!(this.config.geminiApiKey && this.config.geminiApiKey.trim()),
    });

    return LLMFactory.createClient(factoryConfig);
  }

  /**
   * Switch LLM provider and recreate client
   */
  switchProvider(provider: LLMProvider, geminiApiKey?: string, mlxLmBaseUrl?: string): void {
    this.logger.info({
      from: this.config.llmProvider,
      to: provider,
      providedApiKey: !!geminiApiKey,
      existingApiKey: !!(this.config.geminiApiKey && this.config.geminiApiKey.trim()),
    });

    this.config.llmProvider = provider;
    if (provider === 'gemini' && geminiApiKey !== undefined) {
      this.config.geminiApiKey = geminiApiKey;
    }
    if (provider === 'mlx-lm' && mlxLmBaseUrl !== undefined) {
      this.config.mlxLmBaseUrl = mlxLmBaseUrl;
    }
    this.llmClient = this.createLLMClient();
  }

  /**
   * Get current LLM provider
   */
  getCurrentProvider(): LLMProvider {
    return this.config.llmProvider || 'ollama';
  }

  /**
   * Set Gemini API key and optionally switch to Gemini
   */
  setGeminiApiKey(apiKey: string, switchToGemini: boolean = false): void {
    this.config.geminiApiKey = apiKey;

    // If we're currently using Gemini, update the API key in the client
    if (this.config.llmProvider === 'gemini' && 'setApiKey' in this.llmClient) {
      (this.llmClient as any).setApiKey(apiKey);
    }

    if (switchToGemini) {
      this.switchProvider('gemini', apiKey);
    }
  }

  /**
   * Get current LLM client instance
   */
  getCurrentClient(): LLMClient {
    return this.llmClient;
  }

  /**
   * Extract key vocabulary from article text, applying the same validation,
   * proficiency awareness, and frequency tagging as topic generation.
   */
  async extractArticleVocabulary(
    text: string,
    language?: string,
    count?: number,
    database?: DatabaseLayer
  ): Promise<GeneratedWord[]> {
    const targetLanguage = language || this.config.defaultLanguage;
    const wordCount = count || this.config.defaultWordCount;

    const isAvailable = await this.llmClient.isAvailable();
    if (!isAvailable) {
      throw new Error('LLM service is not available. Please check your configuration.');
    }

    let proficiencyLevel: string | undefined;
    if (database) {
      const proficiencyKey = `language_proficiency_${targetLanguage.toLowerCase()}`;
      proficiencyLevel = (await database.getSetting(proficiencyKey)) || undefined;
    }

    try {
      const words = await this.llmClient.extractWordsFromText(
        text,
        targetLanguage,
        wordCount,
        proficiencyLevel
      );
      const validWords = this.validateGeneratedWords(words);

      // Tag with frequency info so the selector can show tiers, then shuffle.
      const wordsWithFrequencyInfo: GeneratedWord[] = validWords.map((word) => {
        const frequencyPosition = this.frequencyWordManager.getWordFrequencyPosition(
          word.word,
          targetLanguage.toLowerCase()
        );
        const frequencyTier = frequencyPosition
          ? this.frequencyWordManager.getFrequencyTier(frequencyPosition)
          : undefined;
        return {
          ...word,
          ...(frequencyPosition !== undefined && { frequencyPosition }),
          ...(frequencyTier !== undefined && { frequencyTier }),
        };
      });

      return this.shuffleArray(wordsWithFrequencyInfo);
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        throw error;
      }
      throw this.handleContentGenerationError(error, 'article vocabulary extraction');
    }
  }

  /**
   * Generate vocabulary words for a given topic with frequency classification
   * If no topic is provided, uses frequency-ordered word lists
   */
  async generateTopicVocabulary(
    topic?: string,
    language?: string,
    count?: number,
    database?: DatabaseLayer
  ): Promise<GeneratedWord[]> {
    const targetLanguage = language || this.config.defaultLanguage;
    const wordCount = count || this.config.defaultWordCount;
    const topicText = topic?.trim() || '';

    try {
      // Get proficiency level to determine generation method
      let proficiencyLevel: string | undefined;
      if (database) {
        const proficiencyKey = `language_proficiency_${targetLanguage.toLowerCase()}`;
        proficiencyLevel = (await database.getSetting(proficiencyKey)) || undefined;
      }

      // If no topic is provided and we have a database, use frequency-based selection
      // EXCEPT for B1 proficiency, which should use LLM-based generation.
      // Requires a frequency word list for the language; languages without one
      // (e.g. Japanese) fall through to LLM generation.
      const hasWordList = this.frequencyWordManager
        .getAvailableLanguages()
        .includes(targetLanguage.toLowerCase());
      if (!topicText && database && proficiencyLevel?.toLowerCase() !== 'b1' && hasWordList) {
        return await this.generateFrequencyBasedVocabulary(
          targetLanguage.toLowerCase(),
          wordCount,
          database
        );
      }

      // Otherwise, use LLM-based topic generation (including B1 proficiency)
      return await this.generateLLMTopicVocabulary(topicText, targetLanguage, wordCount);
    } catch (error) {
      // If it's an LLMError, preserve it
      if (error instanceof Error && 'code' in error) {
        throw error;
      }
      throw this.handleContentGenerationError(error, 'vocabulary generation');
    }
  }

  /**
   * Generate vocabulary using frequency-ordered word lists
   */
  private async generateFrequencyBasedVocabulary(
    language: string,
    count: number,
    database: DatabaseLayer
  ): Promise<GeneratedWord[]> {
    this.logger.info({ language, count }, 'Generating frequency-based vocabulary');

    // Get proficiency level for the language
    let proficiencyLevel: string | undefined;
    try {
      const proficiencyKey = `language_proficiency_${language.toLowerCase()}`;
      proficiencyLevel = (await database.getSetting(proficiencyKey)) || undefined;
    } catch (error) {
      this.logger.warn({ error }, 'Failed to retrieve proficiency level');
    }

    // Check if there are more words to process
    const hasMore = await this.frequencyWordManager.hasMoreWords(language, database);
    if (!hasMore) {
      throw new Error(
        `All words from the frequency list have been processed for ${language}. Consider using a topic instead.`
      );
    }

    // Get the next words from the frequency list
    // Pass proficiency level to adjust starting position (A1 starts at 200, A2 at 500, B1 at 1000)
    const nextWordEntries = await this.frequencyWordManager.getNextWordsToProcess(
      language,
      database,
      count,
      proficiencyLevel
    );

    if (nextWordEntries.length === 0) {
      throw new Error(`No new words available from frequency list for ${language}`);
    }

    this.logger.info(
      { wordCount: nextWordEntries.length, words: nextWordEntries.map((e) => e.word) },
      `Selected ${nextWordEntries.length} words from frequency list`
    );

    // Process word entries - translations are always present in word lists
    const generatedWords: GeneratedWord[] = [];

    for (const wordEntry of nextWordEntries) {
      // Get frequency position and tier information
      const frequencyPosition = wordEntry.position;
      const frequencyTier = frequencyPosition
        ? this.frequencyWordManager.getFrequencyTier(frequencyPosition)
        : undefined;

      generatedWords.push({
        word: wordEntry.word,
        translation: wordEntry.translation,
        frequencyPosition,
        frequencyTier,
      });
    }

    if (generatedWords.length === 0) {
      throw new Error('Failed to generate translations for frequency-based words');
    }

    // Step 1: Lemmatize the words (skip for Japanese)
    let lemmatizedWords: GeneratedWord[] = generatedWords;
    const isJapanese = language.toLowerCase() === 'japanese' || language.toLowerCase() === 'ja';
    if (this.lemmatizationService && !isJapanese) {
      const wordsToLemmatize = generatedWords.map((w) => w.word);
      const lemmas = await this.lemmatizationService.lemmatizeWords(
        wordsToLemmatize,
        language.toLowerCase()
      );

      // Update words with their lemmas (use lemma if available, otherwise keep original)
      lemmatizedWords = generatedWords.map((word) => {
        const lemma = lemmas[word.word.toLowerCase()];
        const finalWord = lemma || word.word;

        // Re-check frequency position for lemmatized word
        const frequencyPosition = this.frequencyWordManager.getWordFrequencyPosition(
          finalWord,
          language.toLowerCase()
        );
        const frequencyTier = frequencyPosition
          ? this.frequencyWordManager.getFrequencyTier(frequencyPosition)
          : undefined;

        return {
          ...word,
          word: finalWord,
          frequencyPosition: frequencyPosition || word.frequencyPosition, // Use new position if found, otherwise keep original
          frequencyTier: frequencyTier || word.frequencyTier,
        };
      });
    }

    // Step 2: Filter based on proficiency level
    let filteredWords = lemmatizedWords;
    if (proficiencyLevel) {
      filteredWords = this.filterWordsByProficiencyLevel(
        lemmatizedWords,
        proficiencyLevel,
        language.toLowerCase()
      );
    }

    if (filteredWords.length === 0) {
      throw new Error(
        'No words remain after filtering. Please try again or adjust your proficiency level.'
      );
    }

    return filteredWords;
  }

  /**
   * Generate vocabulary using LLM for a specific topic
   */
  private async generateLLMTopicVocabulary(
    topicText: string,
    targetLanguage: string,
    wordCount: number
  ): Promise<GeneratedWord[]> {
    // Validate LLM availability before attempting generation
    const isAvailable = await this.llmClient.isAvailable();
    if (!isAvailable) {
      const providerName = this.getCurrentProvider();
      if (providerName === 'ollama') {
        throw new Error('LLM service is not available. Please ensure Ollama is running.');
      } else if (providerName === 'gemini') {
        throw new Error(
          'Gemini API is not available. Please check your API key and internet connection.'
        );
      } else if (providerName === 'mlx-lm') {
        throw new Error(
          'mlx-lm server is not available. Start it with: mlx_lm.server --model <model> --port 8020'
        );
      } else {
        throw new Error('LLM service is not available. Please check your configuration.');
      }
    }

    this.logger.info(
      { topic: topicText, language: targetLanguage, count: wordCount },
      'Generating LLM vocabulary'
    );

    try {
      const words = await this.llmClient.generateTopicWords(topicText, targetLanguage, wordCount);

      // Validate and filter results
      const validWords = this.validateGeneratedWords(words);

      if (validWords.length === 0) {
        throw new Error('No valid words were generated. Please try again.');
      }

      // Step 1: Lemmatize the words (skip for Japanese)
      let lemmatizedWords: GeneratedWord[] = validWords;
      const isJapanese =
        targetLanguage.toLowerCase() === 'japanese' || targetLanguage.toLowerCase() === 'ja';
      if (this.lemmatizationService && !isJapanese) {
        const wordsToLemmatize = validWords.map((w) => w.word);
        const lemmas = await this.lemmatizationService.lemmatizeWords(
          wordsToLemmatize,
          targetLanguage.toLowerCase()
        );

        // Update words with their lemmas (use lemma if available, otherwise keep original)
        lemmatizedWords = validWords.map((word) => {
          const lemma = lemmas[word.word.toLowerCase()];
          return {
            ...word,
            word: lemma || word.word, // Use lemma if available, otherwise keep original
          };
        });
      }

      // Step 2: Add frequency position information for lemmatized words
      const wordsWithFrequencyInfo: GeneratedWord[] = lemmatizedWords.map((word) => {
        const frequencyPosition = this.frequencyWordManager.getWordFrequencyPosition(
          word.word,
          targetLanguage.toLowerCase()
        );
        const frequencyTier = frequencyPosition
          ? this.frequencyWordManager.getFrequencyTier(frequencyPosition)
          : undefined;

        const result: GeneratedWord = {
          ...word,
          ...(frequencyPosition !== undefined && { frequencyPosition }),
          ...(frequencyTier !== undefined && { frequencyTier }),
        };
        return result;
      });

      // Shuffle the words to ensure variety in presentation order
      return this.shuffleArray(wordsWithFrequencyInfo);
    } catch (error) {
      // If it's an LLMError, preserve it
      if (error instanceof Error && 'code' in error) {
        throw error;
      }
      // Otherwise, wrap it
      throw this.handleContentGenerationError(error, 'vocabulary generation');
    }
  }

  /**
   * Filter words based on proficiency level and frequency position
   * A1: filter out words in top 200
   * A2: filter out words in top 500
   * B1: filter out words in top 1000
   */
  private filterWordsByProficiencyLevel(
    words: GeneratedWord[],
    proficiencyLevel: string,
    _language: string
  ): GeneratedWord[] {
    const level = proficiencyLevel.toLowerCase();
    let maxFrequency: number;

    switch (level) {
      case 'a1':
        maxFrequency = 200;
        break;
      case 'a2':
        maxFrequency = 500;
        break;
      case 'b1':
        maxFrequency = 1000;
        break;
      default:
        // For other levels (newbie, b2, etc.), don't filter
        return words;
    }

    return words.filter((word) => {
      // If word doesn't have frequency position, keep it (might be topic-specific)
      if (!word.frequencyPosition) {
        return true;
      }

      // Filter out words that are in the top N frequency words
      return word.frequencyPosition > maxFrequency;
    });
  }

  /**
   * Generate contextual sentences for a vocabulary word with translations
   */
  async generateWordSentences(
    word: string,
    language?: string,
    count?: number,
    database?: DatabaseLayer,
    topic?: string,
    translation?: string
  ): Promise<GeneratedSentence[]> {
    const targetLanguage = language || this.config.defaultLanguage;
    const sentenceCount = count || this.config.defaultSentenceCount;

    if (!word?.trim()) {
      throw new Error('Word parameter is required for sentence generation');
    }

    try {
      // Prefer supplemental sentences when Tatoeba has plenty of coverage
      let supplementalSentences: GeneratedSentence[] = [];
      try {
        const tatoebaExamples = await this.fetchTatoebaExamples(
          word.trim(),
          targetLanguage,
          sentenceCount
        );
        supplementalSentences = this.validateGeneratedSentences(tatoebaExamples, word);

        // Always generate context sentences for Tatoeba examples
        if (supplementalSentences.length > 0) {
          const isLLMAvailable = await this.llmClient.isAvailable();

          if (isLLMAvailable) {
            // Get proficiency level for the language (same as for sentence generation)
            let proficiencyLevel: string | undefined;
            if (database) {
              try {
                const proficiencyKey = `language_proficiency_${targetLanguage.toLowerCase()}`;
                proficiencyLevel = (await database.getSetting(proficiencyKey)) || undefined;
              } catch (error) {
                this.logger.warn(
                  { error },
                  'Failed to retrieve proficiency level for context generation'
                );
              }
            }

            // Generate context for each Tatoeba sentence
            const sentencesWithContext = await Promise.all(
              supplementalSentences.map(async (sentence) => {
                try {
                  const context = await this.llmClient.generateContextSentences(
                    sentence.sentence,
                    sentence.translation,
                    targetLanguage,
                    proficiencyLevel
                  );

                  // Also convert to pronunciation for Japanese
                  const isJapanese =
                    targetLanguage.toLowerCase() === 'japanese' ||
                    targetLanguage.toLowerCase() === 'ja';
                  let pronunciation: string | undefined;
                  let contextBeforePronunciation: string | undefined;
                  let contextAfterPronunciation: string | undefined;

                  if (isJapanese) {
                    try {
                      // Batch all pronunciation conversions
                      const sentencesToConvert = [
                        sentence.sentence,
                        ...(context.contextBefore ? [context.contextBefore] : []),
                        ...(context.contextAfter ? [context.contextAfter] : []),
                      ];

                      const pronunciations = await this.llmClient.convertToPronunciation(
                        sentencesToConvert,
                        targetLanguage
                      );

                      pronunciation = pronunciations[0] || undefined;
                      if (context.contextBefore) {
                        contextBeforePronunciation = pronunciations[1] || undefined;
                      }
                      if (context.contextAfter) {
                        contextAfterPronunciation =
                          pronunciations[context.contextBefore ? 2 : 1] || undefined;
                      }
                    } catch (pronError) {
                      this.logger.warn(
                        { error: pronError },
                        'Failed to convert Tatoeba sentence to pronunciation'
                      );
                    }
                  }

                  return {
                    ...sentence,
                    contextBefore: context.contextBefore,
                    contextAfter: context.contextAfter,
                    contextBeforeTranslation: context.contextBeforeTranslation,
                    contextAfterTranslation: context.contextAfterTranslation,
                    pronunciation,
                    contextBeforePronunciation,
                    contextAfterPronunciation,
                  };
                } catch (error) {
                  this.logger.warn(
                    { error },
                    '[ContentGenerator] Failed to generate context for Tatoeba sentence'
                  );
                  // Return sentence without context on error
                  return sentence;
                }
              })
            );
            supplementalSentences = sentencesWithContext;
          }
        }
      } catch (supplementError) {
        this.logger.warn({ error: supplementError }, 'Failed to fetch Tatoeba examples');
      }

      // Calculate how many more sentences are needed
      const needed = sentenceCount - supplementalSentences.length;

      // If we have enough sentences from Tatoeba, return them directly
      if (needed <= 0) {
        if (supplementalSentences.length === 0) {
          throw new Error(`No valid sentences were generated for word: ${word}. Please try again.`);
        }
        const shuffled = this.shuffleArray(supplementalSentences);
        return shuffled.slice(0, sentenceCount);
      }

      // Validate LLM availability (only needed if we need more sentences)
      const isAvailable = await this.llmClient.isAvailable();
      if (!isAvailable) {
        const providerName = this.getCurrentProvider();
        if (providerName === 'ollama') {
          throw new Error('LLM service is not available. Please ensure Ollama is running.');
        } else if (providerName === 'gemini') {
          throw new Error(
            'Gemini API is not available. Please check your API key and internet connection.'
          );
        } else if (providerName === 'mlx-lm') {
          throw new Error(
            'mlx-lm server is not available. Start it with: mlx_lm.server --model <model> --port 8020'
          );
        } else {
          throw new Error('LLM service is not available. Please check your configuration.');
        }
      }

      // Get proficiency level for the language
      let proficiencyLevel: string | undefined;
      if (database) {
        try {
          const proficiencyKey = `language_proficiency_${targetLanguage.toLowerCase()}`;
          proficiencyLevel = (await database.getSetting(proficiencyKey)) || undefined;
        } catch (error) {
          this.logger.warn({ error }, 'Failed to retrieve proficiency level');
        }
      }

      // Generate only the needed number of sentences
      // Retries are now handled at the HTTP level in the LLM clients

      // When a topic is set, always generate 2 topic sentences + 2 generic sentences in parallel.
      // This gives per-sentence-group variety without randomization.
      let sentences: GeneratedSentence[];
      if (topic) {
        const [withTopic, withoutTopic] = await Promise.all([
          this.llmClient.generateSentences(
            word.trim(),
            targetLanguage,
            2,
            topic,
            proficiencyLevel,
            translation
          ),
          this.llmClient.generateSentences(
            word.trim(),
            targetLanguage,
            2,
            undefined,
            proficiencyLevel,
            translation
          ),
        ]);
        sentences = [...withTopic, ...withoutTopic];
      } else {
        sentences = await this.llmClient.generateSentences(
          word.trim(),
          targetLanguage,
          4,
          undefined,
          proficiencyLevel,
          translation
        );
      }

      // Validate and filter LLM results
      const generatedSentences = this.validateGeneratedSentences(sentences, word);

      const combinedSentences = this.combineSentenceSources(
        generatedSentences,
        supplementalSentences
      );

      if (combinedSentences.length === 0) {
        throw new Error(`No valid sentences were generated for word: ${word}. Please try again.`);
      }

      // Convert to pronunciation for Japanese sentences not already annotated
      const isJapanese =
        targetLanguage.toLowerCase() === 'japanese' || targetLanguage.toLowerCase() === 'ja';
      if (isJapanese) {
        try {
          // Build a batch of only the texts that are still missing pronunciation
          const allSentencesToConvert: string[] = [];
          const sentenceIndices: number[] = [];
          const contextBeforeIndices: number[] = [];
          const contextAfterIndices: number[] = [];

          combinedSentences.forEach((sentence) => {
            if (!sentence.pronunciation) {
              sentenceIndices.push(allSentencesToConvert.length);
              allSentencesToConvert.push(sentence.sentence);
            } else {
              sentenceIndices.push(-1);
            }

            if (sentence.contextBefore && !sentence.contextBeforePronunciation) {
              contextBeforeIndices.push(allSentencesToConvert.length);
              allSentencesToConvert.push(sentence.contextBefore);
            } else {
              contextBeforeIndices.push(-1);
            }

            if (sentence.contextAfter && !sentence.contextAfterPronunciation) {
              contextAfterIndices.push(allSentencesToConvert.length);
              allSentencesToConvert.push(sentence.contextAfter);
            } else {
              contextAfterIndices.push(-1);
            }
          });

          // Fast path: all sentences already have pronunciation (single-call LLM path)
          if (allSentencesToConvert.length === 0) {
            return combinedSentences;
          }

          const pronunciations = await this.llmClient.convertToPronunciation(
            allSentencesToConvert,
            targetLanguage
          );

          return combinedSentences.map((sentence, index) => ({
            ...sentence,
            pronunciation:
              sentenceIndices[index] >= 0
                ? pronunciations[sentenceIndices[index]] || undefined
                : sentence.pronunciation,
            contextBeforePronunciation:
              contextBeforeIndices[index] >= 0
                ? pronunciations[contextBeforeIndices[index]] || undefined
                : sentence.contextBeforePronunciation,
            contextAfterPronunciation:
              contextAfterIndices[index] >= 0
                ? pronunciations[contextAfterIndices[index]] || undefined
                : sentence.contextAfterPronunciation,
          }));
        } catch (error) {
          this.logger.warn({ error }, 'Failed to batch convert to pronunciation');
          // Continue without pronunciation (graceful degradation)
        }
      }

      // Return combined sentences (LLM results shuffled, Tatoeba examples appended)
      return combinedSentences;
    } catch (error) {
      const errorDetails = serializeErrorForLogging(error);
      this.logger.error(
        {
          word,
          language: targetLanguage,
          requestedCount: sentenceCount,
          error: errorDetails,
        },
        '[ContentGenerator] Error in generateWordSentences'
      );
      throw this.handleContentGenerationError(error, 'sentence generation');
    }
  }

  /**
   * Check if the LLM service is available and ready
   */
  async isServiceAvailable(): Promise<boolean> {
    try {
      return await this.llmClient.isAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Get frequency-based progress for a language
   */
  async getFrequencyProgress(
    language: string,
    database: DatabaseLayer
  ): Promise<{
    totalWords: number;
    processedWords: number;
    currentPosition: number;
    percentComplete: number;
  }> {
    return await this.frequencyWordManager.getLanguageProgress(language, database);
  }

  /**
   * Get available languages from frequency word lists
   */
  getAvailableFrequencyLanguages(): string[] {
    return this.frequencyWordManager.getAvailableLanguages();
  }

  /**
   * Get random assessment words from a frequency position range.
   * Used for adaptive proficiency assessment — the caller drives the zone.
   */
  async getAssessmentWords(
    language: string,
    minPos: number,
    maxPos: number
  ): Promise<{ word: string; translation: string }[]> {
    const words = await this.frequencyWordManager.getSampleWordsInRange(
      language,
      minPos,
      maxPos,
      6
    );
    // Shuffle so position order isn't visible
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
    return words.map(({ word, translation }) => ({ word, translation }));
  }

  /**
   * Validate generated words and filter out invalid entries
   */
  private validateGeneratedWords(words: GeneratedWord[]): GeneratedWord[] {
    if (!Array.isArray(words)) {
      return [];
    }

    return words.filter((word) => {
      // Check required fields
      if (!word.word || !word.translation) {
        this.logger.warn({ word }, 'Skipping invalid word entry');
        return false;
      }

      // Check word length (reasonable bounds)
      if (word.word.trim().length === 0 || word.word.length > 50) {
        this.logger.warn({ word: word.word }, 'Skipping word with invalid length');
        return false;
      }

      // Check translation length
      if (word.translation.trim().length === 0 || word.translation.length > 100) {
        this.logger.warn(
          { translation: word.translation },
          'Skipping word with invalid translation length'
        );
        return false;
      }

      return true;
    });
  }

  /**
   * Validate generated sentences and filter out invalid entries
   */
  private validateGeneratedSentences(
    sentences: GeneratedSentence[],
    _targetWord: string
  ): GeneratedSentence[] {
    if (!Array.isArray(sentences)) {
      return [];
    }

    return sentences.filter((sentence) => {
      // Check required fields
      if (!sentence.sentence || !sentence.translation) {
        this.logger.warn({ sentence }, 'Skipping invalid sentence entry');
        return false;
      }

      // Check sentence length (reasonable bounds)
      if (sentence.sentence.trim().length === 0 || sentence.sentence.length > 200) {
        this.logger.warn({ sentence: sentence.sentence }, 'Skipping sentence with invalid length');
        return false;
      }

      // Check translation length
      if (sentence.translation.trim().length === 0 || sentence.translation.length > 300) {
        this.logger.warn(
          { translation: sentence.translation },
          'Skipping sentence with invalid translation length'
        );
        return false;
      }

      // Note: Removed rigid word inclusion check as it was too restrictive
      // LLM may use word variations, conjugations, or related forms

      return true;
    });
  }

  /**
   * Combine LLM-generated sentences with supplemental sources (e.g., Tatoeba)
   * while preserving ordering expectations.
   */
  private combineSentenceSources(
    generated: GeneratedSentence[],
    supplemental: GeneratedSentence[]
  ): GeneratedSentence[] {
    const primary = this.shuffleArray(generated);
    if (!supplemental.length) {
      return primary;
    }

    const seen = new Set(
      primary.map((sentence) => this.normalizeSentenceKey(sentence.sentence)).filter(Boolean)
    );
    const uniqueSupplemental = supplemental.filter((sentence) => {
      const key = this.normalizeSentenceKey(sentence.sentence);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    if (!uniqueSupplemental.length) {
      return primary;
    }

    return [...primary, ...uniqueSupplemental];
  }

  private normalizeSentenceKey(sentence: string): string | undefined {
    if (!sentence) {
      return undefined;
    }
    return sentence.trim().toLowerCase();
  }

  /**
   * Fetch example sentences from Tatoeba when network connectivity is available.
   */
  private async fetchTatoebaExamples(
    query: string,
    language: string,
    limit: number
  ): Promise<GeneratedSentence[]> {
    const sourceLang = this.getTatoebaLanguageCode(language);
    if (!sourceLang) {
      // Tatoeba lookup skipped due to unsupported language
      return [];
    }

    if (!(await this.isOnline())) {
      // Tatoeba lookup skipped because offline
      return [];
    }

    const fetchLimit = Math.max(4, Math.max(1, limit));

    const params = new URLSearchParams({
      from: sourceLang,
      to: TATOEBA_TARGET_LANGUAGE,
      query,
      has_audio: 'yes',
      native: 'yes',
      sort: 'relevance',
      unapproved: 'no',
      word_count_min: '3',
      limit: String(fetchLimit),
    });

    const response = await fetch(`${TATOEBA_API_URL}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Tatoeba API request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { results?: unknown[] };
    const results = Array.isArray(data?.results) ? data.results.slice(0, fetchLimit) : [];

    return results
      .map((item): GeneratedSentence => {
        // Type guard for item structure
        const itemObj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const sentenceText = typeof itemObj?.text === 'string' ? itemObj.text : '';
        const translationText =
          Array.isArray(itemObj?.translations) &&
          Array.isArray(itemObj.translations[0]) &&
          itemObj.translations[0][0] &&
          typeof itemObj.translations[0][0] === 'object' &&
          'text' in itemObj.translations[0][0] &&
          typeof itemObj.translations[0][0].text === 'string'
            ? itemObj.translations[0][0].text
            : '';
        const audioId =
          Array.isArray(itemObj?.audios) &&
          itemObj.audios[0] &&
          typeof itemObj.audios[0] === 'object' &&
          'id' in itemObj.audios[0]
            ? itemObj.audios[0].id
            : undefined;
        const audioUrl = audioId ? `https://tatoeba.org/en/audio/download/${audioId}` : undefined;

        return {
          sentence: sentenceText,
          translation: translationText,
          audioUrl,
        };
      })
      .filter(
        (sentence) => sentence.sentence.trim().length > 0 && sentence.translation.trim().length > 0
      );
  }

  private getTatoebaLanguageCode(language: string): string | undefined {
    if (!language) {
      return undefined;
    }

    const normalized = language.trim().toLowerCase();
    return TATOEBA_LANGUAGE_CODES[normalized];
  }

  private async isOnline(): Promise<boolean> {
    try {
      await lookup('tatoeba.org');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Handle and format content generation errors
   */
  private handleContentGenerationError(error: unknown, operation: string): Error {
    // If it's already an LLMError, preserve it
    if (error instanceof Error && 'code' in error) {
      return error;
    }

    // Wrap other errors with context
    // The original error is preserved in error.cause, so we don't need to duplicate the message
    return wrapError(error, `${operation} failed`);
  }

  /**
   * Shuffle an array using Fisher-Yates algorithm
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
