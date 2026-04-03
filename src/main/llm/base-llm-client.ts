/**
 * Base class for LLM clients with shared functionality
 */

import { GeneratedWord, GeneratedSentence } from '../../shared/types/core.js';
import { LLMConfig, LLMError } from '../../shared/types/llm.js';
import { LLM_CONFIG } from '../../shared/constants/index.js';
import { ensureError } from '../../shared/utils/error.js';
import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';
import {
  WordGenerationResponseSchema,
  SentenceGenerationResponseSchema,
  ContextSentenceResponseSchema,
  DialogueVariantResponseSchema,
  FollowUpResponseSchema,
  TranscriptionAnalysisSchema,
  PronunciationResponseSchema, // Add this import
} from './schemas.js';
import { z } from 'zod';
import { TranscriptionAnalysis } from '../../shared/types/core.js';
import axios from 'axios';

/**
 * Language-specific grammar descriptions for proficiency level guidance
 * Structure: language -> proficiencyLevel -> sentence description
 */
export const languageGrammarDescriptions: Record<string, Record<string, string>> = {
  italian: {
    newbie:
      'presente (essere/avere/regular verbs), simple S-V and S-V-O sentence patterns, fixed modal chunks (posso/devo/voglio), fixed reflexives (mi chiamo/si chiama), basic adjective-noun agreement patterns, basic connectors (e/ma/perché), and singular-plural endings (-o/-a/-i/-e)',
    a1: 'presente (all persons), passato prossimo (recognition only), simple reflexive verbs, modal verbs + infinitive, basic imperatives (tu/voi), "andare a + infinitive" future form, common quantifiers (molto/poco/troppo), interrogatives (dove/quando/perché/quanto), and negation ("non + verb")',
    a2: 'productive passato prossimo, recognition of imperfetto and futuro semplice, gerundio progressivo (sto + gerundio), basic condizionale presente (vorrei/potrei/mi piacerebbe), expanded reflexives (daily routine/emotions), direct object pronouns (lo/la/li/le in simple contexts), piacere forms (mi piace/mi piacciono/mi piacerebbe), temporal connectors (poi/mentre/prima di/dopo), and comparatives (più/meno… di).',
    b1: 'productive imperfetto, recognition of trapassato prossimo and futuro anteriore, productive futuro semplice, full condizionale presente plus recognition of condizionale passato, recognition of congiuntivo presente, clitic combinations (ce l\'ho, me ne vado, glielo do), relative clauses with "che"/"cui," expanded connectors (però/quindi/comunque/anche se), and basic passive forms (è fatto/è stato scritto).',
  },
  spanish: {
    newbie:
      'presente (ser/estar/tener/haber/ir/hacer + regular verbs), simple S-V and S-V-O patterns, fixed modal chunks (puedo/debo/quiero), basic reflexives in fixed phrases (me llamo/se llama), gender-number agreement patterns, basic connectors (y/pero/porque), and plural endings (-s/-es)',
    a1: 'presente (all persons), pretérito perfecto compuesto (he comido) for recognition only, basic reflexives (levantarse/llamarse), modal verbs + infinitive (puedo ir/tengo que estudiar), basic imperatives (tú/ustedes), periphrastic future “ir a + infinitive,” common quantifiers (mucho/poco/demasiado), question words (dónde/cuándo/por qué/cuánto), and negation (“no + verb”)',
    a2: 'pretérito perfecto compuesto, recognition of pretérito imperfecto and pretérito indefinido, periphrastic progressive (“estar + gerundio”), basic condicional simple (me gustaría/podría), expanded reflexives (daily routine/emotions), direct object pronouns (lo/la/los/las) in simple contexts, gustar-type verbs (me gusta/me gustan/me gustaría), temporal connectors (luego/mientras/antes de/después de), and comparatives (más/menos… que)',
    b1: 'productive use of present subjunctive (venga, sea, vaya), advanced connectors (sin embargo, por lo tanto, a pesar de, puesto que), conversational idioms and frases hechas (tomar el pelo, echar una mano, estar por las nubes), and complex relative clauses (quien, el cual).',
  },
  portuguese: {
    newbie:
      'presente (ser/estar/ter/haver/regular verbs), simple S-V and S-V-O patterns, fixed modal-like chunks (pode/precisa/quer), basic reflexives with “se” in set phrases, gender/number agreement (-o/-a/-os/-as), basic connectors (e/mas/porque), and singular-plural endings',
    a1: 'presente (all persons), pretérito perfeito (recognition only), simple pronominal verbs, modal structures with “poder/precisar/querer” + infinitive, basic imperatives (tu/você), “ir + infinitive” future form, common quantifiers (muito/pouco/bastante), WH-questions (onde/quando/por que/quanto), and negation with “não”.',
    a2: 'pretérito perfeito, recognition of pretérito imperfeito and futuro do presente, progressive aspect with “estar + gerúndio”, basic condicional (“gostaria”, “poderia”), expanded pronominal verbs, direct object pronouns in simple contexts (o/a/os/as), constructions with “gostar de + infinitive/noun”, temporal connectors (depois/enquanto/antes de), and comparatives (mais/menos… que)',
    b1: 'pretérito imperfeito, recognition of pretérito mais-que-perfeito and futuro composto, productive futuro do presente, full condicional presente plus recognition of condicional composto, recognition of subjuntivo presente, clitic and mesoclisis avoidance patterns with standard BP pronoun placement (me/te/se/nos/lhe etc.), relative clauses with “que/onde”, expanded connectors (porém/então/contudo/mesmo que), and basic passive forms (é feito/foi feito/está sendo feito)',
  },
  polish: {
    newbie:
      'basic present tense (być/mieć + common regular verbs), simple S-V-O patterns, fixed phrases/chunks (mam na imię…, proszę/dziękuję/przepraszam), basic personal pronouns (ja/ty/on/ona/my/wy), simple negation (nie + verb), and noun gender patterns (m/f/n in singular)',
    a1: 'present tense (all persons), past tense (recognition only, masculine/feminine singular), verbal aspect exposure (imperfective only), basic cases in fixed patterns (accusative for objects, locative after w/na), modal verbs (mogę/chcę/muszę + infinitive), simple imperative (2nd person), common preposition + case chunks, and basic question forms (kto/co/gdzie/kiedy/dlaczego)',
    a2: 'past tense (all genders/numbers), future tense (czas przyszły złożony: będę + infinitive), recognition of perfective/imperfective contrast, productive accusative/dative/locative usage in predictable patterns, verb-noun government patterns (lubię + accusative), reflexive verbs with “się,” motion verbs (iść/chodzić/jechać/jeździć), aspectual pairs exposure, and comparative forms (większy/mniejszy/lepszy)',
    b1: 'future tense (simple perfective future), productive use of perfective/imperfective contrast, recognition of conditional forms (by/bym/byś), past conditional (would-have equivalents), instrumental and genitive case in common constructions, object/clause order flexibility, subordinate clauses with “że” and “żeby,” verbal prefixes (po-/wy-/prze-/do-/od-), and aspect-driven meaning shifts in narratives',
  },
  indonesian: {
    newbie:
      'simple S-V and S-V-O patterns, basic stative verbs/adjectives (besar/kecil/bagus), very common verbs (makan/minum/pergi/dateng), basic affix-less verbs (tidur/belajar), simple negation (tidak/bukan), basic time words (sekarang/nanti/kemarin), and common pronouns (saya/kamu/dia/kita/kami/mereka)',
    a1: 'simple verb constructions without affixes, the me- prefix in its most common forms (makan→memakan, baca→membaca), the ber- prefix in everyday verbs (berjalan/berbicara), negation patterns (tidak vs bukan), simple question words (apa/siapa/di mana/kapan/kenapa/bagaimana), basic prepositions (di/ke/dari), possessives with -nya, and reduplication for plural or emphasis (anak-anak/pelan-pelan)',
    a2: 'use of me- and ber- verbs, passive di- forms (dipakai/dibuat), ke-…-an nouns (kecelakaan/keadaan), simple modal verbs (bisa/harus/mau/perlu), aspect markers (sedang/sudah/belum/akan), comparison forms (lebih/kurang… daripada), clause connectors (karena/jadi/kalau/lalu/setelah), and embedded clauses using yang',
    b1: 'varied affix combinations (per-…-an, pe-…, memper-…, memper-kan), full passive system (di-, ter- for accidental states), mid-complex clause structures (kalau/seandainya/meskipun), relative clauses with yang in more abstract contexts, aspectual nuance (telah/baru/tengah), object fronting patterns, me- verb phonological alternations (men-/mem-/meng-/meny-), and more advanced reduplication (meaning shifts, distributive uses)',
  },
  japanese: {
    newbie:
      'basic copula forms (です／ではありません), simple verb dictionary forms (食べる／行く), polite present forms (食べます／行きます), basic particles (は・が・を・に・で・と), simple noun-adjective patterns (大きい＋名詞／きれいな＋名詞), fixed expressions (これ／それ／あれ, いくら／どこ／いつ), and simple SOV sentence patterns',
    a1: 'polite past forms (〜ました／〜ませんでした), te-form recognition (〜て／〜で), existence verbs (あります／います), basic motion grammar (〜へ行きます／〜から来ました), present progressive recognition (〜ています), counting expressions with common counters (〜つ／〜人), basic adjective past forms (暑かった／静かでした), and core particles in simple constructions (へ・から・まで)',
    a2: 'te-form usage (requests 〜てください, linking actions 〜て、〜), informal/plain present and past forms (行く／行った), potential form (〜られる／〜できる), volitional recognition (〜ましょう／〜よう), basic conditional forms (〜たら／〜なら), giving/receiving (あげる／くれる／もらう), common aspect forms (〜ている for state vs action), and core sentence-final expressions (と思います／でしょう)',
    b1: 'full plain-form conjugation, extended te-forms (〜てしまう／〜ておく), passive and causative recognition (〜られる, 〜させる), combined passive-causative recognition (〜させられる), advanced conditionals (〜ば／〜と), concessive forms (〜ても), relative clauses before nouns, nominalizers (こと／の), common modality (かもしれない／はずだ), and increasing use of discourse markers (しかし／それで／ところが)',
  },
};

/**
 * Abstract base class for LLM clients that implements common functionality
 */
export abstract class BaseLLMClient {
  protected config: LLMConfig;
  protected databaseLayer?: any;
  protected readonly logger: Logger;

  constructor(config: Partial<LLMConfig> = {}) {
    this.logger = getLogger();
    this.config = {
      baseUrl: config.baseUrl || '',
      model: config.model || '',
      wordGenerationModel: config.wordGenerationModel,
      sentenceGenerationModel: config.sentenceGenerationModel,
      timeout: config.timeout || LLM_CONFIG.DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || LLM_CONFIG.MAX_RETRIES,
    };
  }

  /**
   * Set database layer for duplicate checking
   */
  setDatabaseLayer(databaseLayer: any): void {
    this.databaseLayer = databaseLayer;
  }

  // Model management methods
  setModel(model: string): void {
    this.config.model = model;
  }

  getCurrentModel(): string {
    return this.config.model;
  }

  setWordGenerationModel(model: string): void {
    this.config.wordGenerationModel = model;
  }

  setSentenceGenerationModel(model: string): void {
    this.config.sentenceGenerationModel = model;
  }

  getWordGenerationModel(): string {
    return this.config.wordGenerationModel ?? this.config.model;
  }

  getSentenceGenerationModel(): string {
    return this.config.sentenceGenerationModel ?? this.config.model;
  }

  /**
   * Abstract method for generating plain text responses - must be implemented by subclasses
   */
  protected abstract generateResponse(prompt: string, model?: string): Promise<string>;

  /**
   * Abstract method for making requests - must be implemented by subclasses
   */
  protected abstract makeRequest(prompt: string, model?: string): Promise<any>;

  /**
   * Generate topic words - shared implementation
   */
  async generateTopicWords(
    topic: string,
    language: string,
    count: number,
    proficiencyLevel?: string
  ): Promise<GeneratedWord[]> {
    // Get a small sample of existing words for the prompt (to help LLM avoid obvious duplicates)
    // We only need a sample, not all words - this is just for prompt context
    const existingWords = await this.getExistingWords(
      language,
      topic,
      LLM_CONFIG.MAX_EXISTING_WORDS_IN_PROMPT
    );
    const prompt = this.createTopicWordsPrompt(
      topic,
      language,
      count,
      existingWords,
      proficiencyLevel
    );

    try {
      const response = await this.makeRequest(prompt, this.getWordGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = WordGenerationResponseSchema.safeParse(response);

      if (!parseResult.success) {
        this.logger.error(
          { issues: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
          'Validation failed'
        );
        throw new Error(
          `Invalid response format: ${parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`
        );
      }

      const words = parseResult.data;

      // Remove duplicates within generated words (case-insensitive)
      const uniqueWords = words.filter(
        (word, index, arr) =>
          arr.findIndex((w) => w.word.toLowerCase() === word.word.toLowerCase()) === index
      );

      // Efficiently check which generated words already exist in database using batch lookup
      // This is much more efficient than fetching all words and doing in-memory comparison
      const generatedWordStrings = uniqueWords.map((w) => w.word);
      const existingWordsSet = await this.checkWordsExist(language, generatedWordStrings, topic);

      // Filter out words that already exist in database (learning, known, or ignored)
      const newWords = uniqueWords.filter((word) => {
        const wordLower = word.word.toLowerCase();
        return !existingWordsSet.has(wordLower);
      });

      this.logger.info(
        {
          uniqueWords: uniqueWords.length,
          newWords: newWords.length,
          duplicates: uniqueWords.length - newWords.length,
          checkedCount: generatedWordStrings.length,
        },
        `Generated ${uniqueWords.length} unique words, ${newWords.length} are new (${uniqueWords.length - newWords.length} duplicates filtered via efficient batch lookup)`
      );

      // If we got significantly fewer new words than requested, throw an error to trigger retry.
      const minWords = Math.max(1, Math.floor(count * LLM_CONFIG.MIN_WORD_COUNT_THRESHOLD));
      if (newWords.length < minWords) {
        throw new Error(
          `Insufficient new words generated: got ${newWords.length}, expected at least ${minWords}`
        );
      }

      return newWords;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw this.createLLMError(error, 'Response validation failed', 'INVALID_RESPONSE', false);
      }

      // Preserve the original error if it's already a meaningful Error with a specific message
      // (e.g., "Insufficient new words generated")
      if (error instanceof Error && error.message.includes('Insufficient new words generated')) {
        throw this.createLLMError(error, error.message, 'MODEL_ERROR', false);
      }

      const err = ensureError(error);
      throw this.createLLMError(err, `Failed to generate words`);
    }
  }

  /**
   * Generate sentences - shared implementation
   */
  async generateSentences(
    word: string,
    language: string,
    count: number,
    topic?: string,
    proficiencyLevel?: string
  ): Promise<GeneratedSentence[]> {
    // Get known words to include in sentences when possible
    const knownWords = await this.getKnownWords(language);
    const prompt = this.createSentencesPrompt(
      word,
      language,
      count,
      knownWords,
      topic,
      proficiencyLevel
    );

    try {
      const response = await this.makeRequest(prompt, this.getSentenceGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = SentenceGenerationResponseSchema.safeParse(response);

      if (!parseResult.success) {
        this.logger.error(
          { issues: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
          'Sentence validation failed'
        );
        throw new Error(
          `Invalid response format: ${parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`
        );
      }

      const sentences = parseResult.data;

      // If we got significantly fewer sentences than requested, throw an error to trigger retry
      const minSentences = Math.max(1, Math.floor(count * LLM_CONFIG.MIN_SENTENCE_COUNT_THRESHOLD));
      if (sentences.length < minSentences) {
        throw new Error(
          `Insufficient sentences generated: got ${sentences.length}, expected at least ${minSentences}`
        );
      }

      return sentences;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw this.createLLMError(error, 'Response validation failed', 'INVALID_RESPONSE', false);
      }
      throw this.createLLMError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to generate sentences'
      );
    }
  }

  /**
   * Generate context sentences - shared implementation
   */
  async generateContextSentences(
    sentence: string,
    translation: string,
    language: string,
    proficiencyLevel?: string
  ): Promise<{
    contextBefore?: string;
    contextAfter?: string;
    contextBeforeTranslation?: string;
    contextAfterTranslation?: string;
  }> {
    const prompt = this.createContextSentencesPrompt(
      sentence,
      translation,
      language,
      proficiencyLevel
    );

    try {
      const response = await this.makeRequest(prompt, this.getSentenceGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = ContextSentenceResponseSchema.safeParse(response);

      if (!parseResult.success) {
        this.logger.warn(
          { issues: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
          'Context sentence validation failed'
        );
        return {};
      }

      const context = parseResult.data;

      // Filter out empty strings
      return {
        contextBefore:
          context.contextBefore && context.contextBefore.trim()
            ? context.contextBefore.trim()
            : undefined,
        contextAfter:
          context.contextAfter && context.contextAfter.trim()
            ? context.contextAfter.trim()
            : undefined,
        contextBeforeTranslation:
          context.contextBeforeTranslation && context.contextBeforeTranslation.trim()
            ? context.contextBeforeTranslation.trim()
            : undefined,
        contextAfterTranslation:
          context.contextAfterTranslation && context.contextAfterTranslation.trim()
            ? context.contextAfterTranslation.trim()
            : undefined,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        this.logger.warn(
          { error },
          'Context sentence generation validation failed, returning empty context'
        );
        return {};
      }
      // On any error, return empty context instead of throwing
      this.logger.warn({ error }, 'Context sentence generation failed, returning empty context');
      return {};
    }
  }

  /**
   * Get existing words from database to avoid duplicates
   */
  protected async getExistingWords(
    language: string,
    topic?: string,
    limit?: number
  ): Promise<string[]> {
    if (!this.databaseLayer) {
      this.logger.warn('Database layer not set, cannot check for duplicates');
      return [];
    }

    try {
      return await this.databaseLayer.getExistingWordsForDuplicateChecking(language, topic, limit);
    } catch (error) {
      this.logger.error({ error }, 'Failed to get existing words for duplicate checking');
      return [];
    }
  }

  /**
   * Get known words from database to include in sentence generation
   */
  protected async getKnownWords(language: string): Promise<string[]> {
    if (!this.databaseLayer) {
      this.logger.warn('Database layer not set, cannot get known words');
      return [];
    }

    try {
      return await this.databaseLayer.getKnownWordsForSentenceGeneration(language, 50);
    } catch (error) {
      this.logger.error({ error }, 'Failed to get known words for sentence generation');
      return [];
    }
  }

  /**
   * Check which of the provided words already exist in the database (efficient batch lookup)
   * This is more efficient than fetching all words and doing in-memory comparison
   */
  protected async checkWordsExist(
    language: string,
    words: string[],
    topic?: string
  ): Promise<Set<string>> {
    if (!this.databaseLayer) {
      this.logger.warn('Database layer not set, cannot check words existence');
      return new Set();
    }

    try {
      return await this.databaseLayer.checkWordsExist(language, words, topic);
    } catch (error) {
      this.logger.error({ error }, 'Failed to check words existence');
      return new Set();
    }
  }

  /**
   * Create proficiency level guidance text with language-specific grammar descriptions
   */
  private createProficiencyGuidance(
    proficiencyLevel: string | undefined,
    guidanceType: 'vocabulary' | 'sentence',
    language: string
  ): string {
    if (!proficiencyLevel) {
      return '';
    }

    // Vocabulary guidance is generic across all languages
    if (guidanceType === 'vocabulary') {
      const levelGuidance =
        proficiencyLevel.toLowerCase() === 'b1'
          ? `Prioritize idiomatic expressions and conversational "chunks" (frases hechas) rather than simple single words.`
          : `Use everyday words appropriate for ${proficiencyLevel.toUpperCase()} level`;
      return `\nIMPORTANT: The user's proficiency level is ${proficiencyLevel.toUpperCase()}. Adjust vocabulary complexity accordingly: ${levelGuidance}`;
    }

    // Sentence guidance is language-specific
    const languageLower = language.toLowerCase();
    const languageDescriptions = languageGrammarDescriptions[languageLower];

    if (languageDescriptions && languageDescriptions[proficiencyLevel]) {
      const levelGuidance = languageDescriptions[proficiencyLevel];
      return `\nIMPORTANT: The user's proficiency level is ${proficiencyLevel.toUpperCase()}. Adjust sentence complexity accordingly: ${levelGuidance}`;
    }

    // Return empty string if no language-specific description exists
    return '';
  }

  /**
   * Get follow-up sentence count based on proficiency level
   */
  private getFollowUpSentenceCount(proficiencyLevel?: string): number {
    switch (proficiencyLevel) {
      case 'newbie':
        return 1;
      case 'a1':
        return 2;
      case 'a2':
        return 3;
      case 'b1':
        return 4;
      default:
        return 2;
    }
  }

  /**
   * Create prompt for topic word generation
   */
  protected createTopicWordsPrompt(
    topic: string,
    language: string,
    count: number,
    existingWords: string[] = [],
    proficiencyLevel?: string
  ): string {
    const example = `  {"word": "${language.toLowerCase()}_word1", "translation": "english_translation1"}`;

    // Create exclusion list for prompt
    // Safeguard: truncate if somehow more words are passed than the config limit
    // (normally this is handled at the database layer, but this protects against edge cases)
    const wordsToInclude = existingWords.slice(0, LLM_CONFIG.MAX_EXISTING_WORDS_IN_PROMPT);
    const hasMore = existingWords.length > LLM_CONFIG.MAX_EXISTING_WORDS_IN_PROMPT;
    const exclusionText =
      wordsToInclude.length > 0
        ? `\nIMPORTANT: Do NOT include any of these existing words: ${wordsToInclude.join(', ')}${hasMore ? '...' : ''}`
        : '';

    // Create proficiency level guidance
    const proficiencyText = this.createProficiencyGuidance(
      proficiencyLevel,
      'vocabulary',
      language
    );

    // Topic is always specified when this method is called
    return `CRITICAL: You must return exactly ${count} words in a JSON array. No more, no less.
CRITICAL: Return ONLY the JSON array, no explanations or extra text.
CRITICAL: All words must be in their canonical dictionary form (infinitive for verbs, singular for nouns, base form for adjectives).

Task: Generate exactly ${count} different ${language} words related to "${topic}".${proficiencyText}${exclusionText}

Expected output format (${count} items):
[
${example}
  ...
]

Rules:
1. Must be exactly ${count} words
2. Each word must be different and unique
3. All words should relate to "${topic}"
4. Include nouns, verbs, and adjectives
5. CRITICAL: Use only canonical dictionary forms:
   - Verbs: infinitive form (e.g., "robić" not "robimy", "do" not "does")
   - Nouns: singular form (e.g., "cat" not "cats", "dom" not "domy")
   - Adjectives: base form (e.g., "good" not "better", "dobry" not "dobrzy")
6. Do NOT use any words from the exclusion list above
7. Return ONLY the JSON array, nothing else`;
  }

  /**
   * Create prompt for sentence generation
   */
  protected createSentencesPrompt(
    word: string,
    language: string,
    count: number,
    knownWords: string[] = [],
    topic?: string,
    proficiencyLevel?: string
  ): string {
    const example = `  {
    "sentence": "${language.toLowerCase()}_sentence1_with_${word}",
    "translation": "english_translation1",
    "contextBefore": "${language.toLowerCase()}_context_before1",
    "contextAfter": "${language.toLowerCase()}_context_after1",
    "contextBeforeTranslation": "english_context_before1",
    "contextAfterTranslation": "english_context_after1"
  }`;

    // Create known words guidance
    const knownWordsText =
      knownWords.length > 0
        ? `\nWhen possible, try to include some of these known words in your sentences (when it makes sense naturally): ${knownWords.join(', ')}`
        : '';

    // Create topic guidance
    const topicText =
      topic && topic.trim()
        ? `\nIMPORTANT: All sentences should relate to or be contextually relevant to the topic: "${topic.trim()}"`
        : '';

    // Create proficiency level guidance
    const proficiencyText = this.createProficiencyGuidance(proficiencyLevel, 'sentence', language);

    return `CRITICAL: You must return exactly ${count} sentences in a JSON array. No more, no less.
CRITICAL: Return ONLY the JSON array, no explanations or extra text.

Task: Generate exactly ${count} natural, conversational sentences in ${language} using the word '${word}' (note: this word is in its canonical dictionary form).${knownWordsText}${topicText}${proficiencyText}

Expected output format (${count} items):
[
${example}
  ...
]

Rules:
1. Must be exactly ${count} sentences
2. Each sentence must contain the word '${word}' or its appropriate conjugated/inflected form
3. The word '${word}' is provided in its canonical dictionary form - use the appropriate conjugated/inflected form that fits naturally in each sentence
4. Keep sentences short (5-15 words)
5. Make them conversational and natural
6. Each sentence must be different
7. When natural and appropriate, include some known words from the provided list
8. Don't force known words if they don't fit naturally
9. Return ONLY the JSON array, nothing else
10. Include contextBefore and contextAfter sentences that provide meaningful context
11. The context sentences should form a natural dialog between two people
12. Provide English translations for all context sentences
13. Context sentences should be short (3-10 words each)
14. The main sentence should make sense when read with its context`;
  }

  /**
   * Create prompt for context sentence generation
   */
  protected createContextSentencesPrompt(
    sentence: string,
    translation: string,
    language: string,
    proficiencyLevel?: string
  ): string {
    // Create proficiency level guidance
    const proficiencyText = this.createProficiencyGuidance(proficiencyLevel, 'sentence', language);

    return `CRITICAL: Return ONLY a JSON object, no explanations or extra text.

Task: Given this sentence in ${language} and its English translation, suggest what sentence would make sense BEFORE and AFTER it to provide context for language learning.

Sentence in ${language}: "${sentence}"
English translation: "${translation}"${proficiencyText}

Expected output format:
{
  "contextBefore": "sentence_before_in_${language.toLowerCase()}",
  "contextAfter": "sentence_after_in_${language.toLowerCase()}",
  "contextBeforeTranslation": "english_translation_of_before",
  "contextAfterTranslation": "english_translation_of_after"
}

Rules:
1. Context sentences should be short (3-10 words each)
2. They should form a natural conversation or narrative flow with the given sentence
3. The contextBefore should logically precede the given sentence, like it's a dialog between two people.
4. The contextAfter should logically follow the given sentence
5. Provide English translations for both context sentences
6. The sentences should make sense when read together: [contextBefore] [given sentence] [contextAfter]
7. Return ONLY the JSON object, nothing else`;
  }

  /**
   * Generate dialogue variants - shared implementation
   */
  async generateDialogueVariants(
    triggerSentence: string,
    triggerTranslation: string,
    language: string,
    knownWords: string[],
    count: number,
    proficiencyLevel?: string
  ): Promise<Array<{ sentence: string; translation: string }>> {
    const prompt = this.createDialogueVariantPrompt(
      triggerSentence,
      triggerTranslation,
      language,
      knownWords,
      count,
      proficiencyLevel
    );

    try {
      const response = await this.makeRequest(prompt, this.getSentenceGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = DialogueVariantResponseSchema.safeParse(response);

      if (!parseResult.success) {
        this.logger.error(
          { issues: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
          'Dialogue variant validation failed'
        );
        throw new Error(
          `Invalid response format: ${parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`
        );
      }

      const variants = parseResult.data;

      // Ensure we have an array of variants
      const variantArray = Array.isArray(variants) ? variants : [];

      // If we got significantly fewer variants than requested, throw an error to trigger retry
      const minVariants = Math.max(1, Math.floor(count * LLM_CONFIG.MIN_SENTENCE_COUNT_THRESHOLD));
      if (variantArray.length < minVariants) {
        throw new Error(
          `Insufficient variants generated: got ${variantArray.length}, expected at least ${minVariants}`
        );
      }

      return variantArray;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw this.createLLMError(error, 'Response validation failed', 'INVALID_RESPONSE', false);
      }
      throw this.createLLMError(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to generate dialogue variants'
      );
    }
  }

  /**
   * Create prompt for dialogue variant generation
   */
  protected createDialogueVariantPrompt(
    triggerSentence: string,
    triggerTranslation: string,
    language: string,
    knownWords: string[],
    count: number,
    proficiencyLevel?: string
  ): string {
    const languageName = language.charAt(0).toUpperCase() + language.slice(1);
    const examples = Array.from(
      { length: count },
      (_, i) =>
        `  {
    "sentence": "${languageName.toLowerCase()}_response_${i + 1}",
    "translation": "english_translation_${i + 1}"
  }`
    ).join(',\n');

    const knownWordsText =
      knownWords.length > 0
        ? `\nIMPORTANT: Use words from this list when possible: ${knownWords.slice(0, 20).join(', ')}`
        : '';

    // Create proficiency level guidance
    const proficiencyText = this.createProficiencyGuidance(proficiencyLevel, 'sentence', language);

    return `CRITICAL: You must return exactly ${count} ${languageName} response sentence(s) in a JSON array. No more, no less.
CRITICAL: Return ONLY the JSON array, no explanations or extra text.

Task: Generate exactly ${count} diverse ${languageName} response sentence(s) that could naturally follow this trigger sentence.${knownWordsText}${proficiencyText}

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
   * Generate follow-up continuation from conversation history (in foreign language)
   */
  async generateFollowUp(
    conversationHistory: string[],
    language: string,
    proficiencyLevel?: string
  ): Promise<{ text: string; translation: string }> {
    const prompt = this.createFollowUpPrompt(conversationHistory, language, proficiencyLevel);

    try {
      const response = await this.makeRequest(prompt, this.getSentenceGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = FollowUpResponseSchema.safeParse(response);

      if (!parseResult.success) {
        this.logger.warn(
          {
            issues: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          },
          'Follow-up validation failed'
        );
        // Return empty object on validation failure instead of throwing
        return { text: '', translation: '' };
      }

      // Zod already normalizes the data to { text: string, translation: string }
      return parseResult.data;
    } catch (error) {
      // On any error (including ZodError), return empty result instead of throwing
      this.logger.warn({ error }, 'Follow-up generation failed, returning empty result');
      return { text: '', translation: '' };
    }
  }

  /**
   * Create prompt for follow-up continuation generation from conversation history
   */
  protected createFollowUpPrompt(
    conversationHistory: string[],
    language: string,
    proficiencyLevel?: string
  ): string {
    const languageName = language.charAt(0).toUpperCase() + language.slice(1);

    // Get sentence count based on proficiency level
    const sentenceCount = this.getFollowUpSentenceCount(proficiencyLevel);
    const sentenceText = sentenceCount === 1 ? 'sentence' : 'sentences';

    // Create proficiency level guidance
    const proficiencyText = this.createProficiencyGuidance(proficiencyLevel, 'sentence', language);

    return `Given this ${languageName} conversation:

${conversationHistory.map((msg, index) => `${index + 1}. ${msg}`).join('\n')}

Generate a natural continuation of about ${sentenceCount} ${sentenceText} in ${languageName} that continues the conversation. This should:
1. NOT be a question
2. Continue the thought or provide related context
3. Be suitable for reading/listening practice
4. Be natural and coherent${proficiencyText}
5. Take into account the previous conversation context

IMPORTANT: You must return BOTH the ${languageName} text AND its English translation.

Preferred JSON format:
{
  "text": "${languageName} continuation text here",
  "translation": "English translation here"
}
`;
  }

  /**
   * Analyze transcription for corrections and grammar explanations
   */
  async analyzeTranscription(
    transcription: string,
    language: string,
    assistantSentence: string,
    topic?: string
  ): Promise<TranscriptionAnalysis> {
    const prompt = this.createTranscriptionAnalysisPrompt(
      transcription,
      language,
      assistantSentence,
      topic
    );

    try {
      const response = await this.makeRequest(prompt, this.getSentenceGenerationModel());

      // Use Zod to parse and validate the response
      const parseResult = TranscriptionAnalysisSchema.safeParse(response);

      if (!parseResult.success) {
        this.logger.warn(
          { issues: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
          'Transcription analysis validation failed'
        );
        // Return default result on validation failure
        return {
          hasGrammarMistakes: false,
        };
      }

      return parseResult.data;
    } catch (error) {
      if (error instanceof z.ZodError) {
        this.logger.warn(
          { error },
          'Transcription analysis validation failed, returning default result'
        );
        return {
          hasGrammarMistakes: false,
        };
      }
      // On any error, return default result instead of throwing
      this.logger.warn({ error }, 'Transcription analysis failed, returning default result');
      return {
        hasGrammarMistakes: false,
      };
    }
  }

  /**
   * Create prompt for transcription analysis
   */
  protected createTranscriptionAnalysisPrompt(
    transcription: string,
    language: string,
    assistantSentence: string,
    topic?: string
  ): string {
    const languageName = language.charAt(0).toUpperCase() + language.slice(1);

    let topicContext = '';
    if (topic) {
      topicContext = `\nTopic: The conversation is about "${topic}". Use this context to provide more relevant feedback.\n`;
    }

    return `Analyze this ${languageName} transcription from a language learner:

"${transcription}"

Context: The learner was responding to this ${languageName} sentence from the assistant:
"${assistantSentence}"${topicContext}
Provide:
1. A correction suggestion if there are better ways to express this (just the corrected/better sentence, no explanation)
2. A grammar explanation if there are grammar mistakes detected
3. Whether there are grammar mistakes (true/false)

IMPORTANT: You must return JSON format:
{
  "correction": "optional correction suggestion",
  "grammarExplanation": "optional grammar explanation if mistakes detected",
  "hasGrammarMistakes": true or false
}

If there are no mistakes, you can omit correction and grammarExplanation, but always include hasGrammarMistakes.
`;
  }

  /**
   * Convert sentences to pronunciation (e.g., Romaji for Japanese)
   * Returns array of space-separated pronunciation text
   */
  async convertToPronunciation(sentences: string[], language: string): Promise<string[]> {
    // Handle empty input
    if (!sentences || sentences.length === 0) {
      return [];
    }

    const prompt = this.createPronunciationPrompt(sentences, language);

    // If prompt is empty (language not supported), return empty strings
    if (!prompt || !prompt.trim()) {
      return sentences.map(() => '');
    }

    try {
      // Use makeRequest for JSON responses
      const response = await this.makeRequest(prompt, this.getWordGenerationModel());
      return this.parsePronunciationResponse(response, sentences.length);
    } catch (error) {
      // On error, return empty strings (graceful degradation)
      this.logger.warn(
        { error, sentenceCount: sentences.length, language },
        'Failed to convert to pronunciation'
      );
      return sentences.map(() => '');
    }
  }

  /**
   * Parse the LLM response containing multiple pronunciations using Zod validation
   * Expected format: JSON array of strings
   */
  private parsePronunciationResponse(response: any, expectedCount: number): string[] {
    try {
      // Use Zod to parse and validate the response
      const parseResult = PronunciationResponseSchema.safeParse(response);

      if (!parseResult.success) {
        this.logger.warn(
          {
            issues: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
            response,
            expectedCount,
          },
          'Pronunciation response validation failed'
        );
        return Array(expectedCount).fill('');
      }

      const pronunciations = parseResult.data;

      // Ensure we have an array
      const pronunciationArray = Array.isArray(pronunciations) ? pronunciations : [];

      // Pad or truncate to expected count
      while (pronunciationArray.length < expectedCount) {
        pronunciationArray.push('');
      }

      return pronunciationArray.slice(0, expectedCount);
    } catch (error) {
      this.logger.warn(
        { error, response, expectedCount },
        'Could not parse pronunciation response correctly'
      );
      return Array(expectedCount).fill('');
    }
  }

  /**
   * Create prompt for pronunciation conversion
   */
  protected createPronunciationPrompt(sentences: string[], language: string): string {
    if (language.toLowerCase() === 'japanese' || language.toLowerCase() === 'ja') {
      const sentencesList = sentences
        .map((sentence, index) => `${index + 1}. "${sentence}"`)
        .join('\n');

      return `Convert these Japanese sentences to Romaji (romanized Japanese). Return ONLY a JSON array of space-separated Romaji text for each sentence.

Japanese sentences:
${sentencesList}

Rules:
1. Convert all Kanji and Kana to Romaji for each sentence
2. Use space-separated format (e.g., "watashi wa gakusei desu" not "watashiwa gakuseidesu")
3. Preserve punctuation marks as-is
4. Return a JSON array with exactly ${sentences.length} elements, one Romaji string per sentence
5. Return ONLY the JSON array, no explanations or additional text

CRITICAL: You must return exactly ${sentences.length} pronunciations in a JSON array. No more, no less.
CRITICAL: Return ONLY the JSON array, nothing else.

Example format: ["watashi wa gakusei desu", "kore wa hon desu"]`;
    }

    // For other languages, return empty string (can be extended later)
    return '';
  }

  /**
   * Explain the grammar of a word in a sentence
   */
  async explainGrammar(
    word: string,
    sentence: string,
    language: string,
    proficiencyLevel?: string
  ): Promise<string> {
    const prompt = this.createGrammarExplanationPrompt(word, sentence, language, proficiencyLevel);

    try {
      // Use generateResponse for plain text/markdown responses
      const response = await this.generateResponse(prompt, this.getSentenceGenerationModel());
      return response.trim();
    } catch (error) {
      const err = ensureError(error);
      throw this.createLLMError(err, 'Failed to explain grammar');
    }
  }

  /**
   * Create prompt for grammar explanation
   */
  protected createGrammarExplanationPrompt(
    word: string,
    sentence: string,
    language: string,
    proficiencyLevel?: string
  ): string {
    const languageName = language.charAt(0).toUpperCase() + language.slice(1);
    const proficiencyText = this.createProficiencyGuidance(proficiencyLevel, 'sentence', language);

    return `Explain the grammar of the word "${word}" in this ${languageName} sentence: "${sentence}"${proficiencyText}

Provide a clear, educational, teacher-like explanation of the grammatical role and usage of this word. Adjust the complexity and depth of your explanation based on the user's proficiency level.
DO NOT explain obvious things like what verbs are in general, or imperative is.
Explain concept specific/unique to ${languageName}.
DO NOT include "Summary" section, nor a greeting at the beginning.
Provide similar examples of usage of the word in the sentence.

Return your response in Markdown format. The explanation HAS TO BE IN ENGLISH`;
  }

  /**
   * Check if an error is a timeout error
   */
  private isTimeoutError(error: unknown): boolean {
    return (
      error instanceof Error &&
      axios.isAxiosError(error) &&
      (error.code === 'ECONNABORTED' || error.message.includes('timeout'))
    );
  }

  /**
   * Retry helper with exponential backoff
   * @param requestFn Function that performs the request and returns a Promise
   * @param customRetryDelayExtractor Optional function to extract custom retry delay from error (returns ms or null)
   * @returns Result of the request function
   * @throws LLMError if all retries are exhausted or a non-retryable error occurs
   */
  protected async retryWithBackoff<T>(
    requestFn: () => Promise<T>,
    customRetryDelayExtractor?: (error: unknown) => number | null
  ): Promise<T> {
    const maxRetries = this.config.maxRetries!;
    const minTimeout = 1000; // 1 second minimum
    const maxTimeout = 120000; // 2 minutes maximum
    const factor = 2; // Exponential backoff factor

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await requestFn();
      } catch (error: unknown) {
        lastError = error;

        // Check for non-retryable errors
        if (error instanceof Error) {
          // Timeout errors - don't retry
          if (this.isTimeoutError(error)) {
            throw this.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
          }

          // JSON parsing errors - don't retry (unless it's "Insufficient" which might be retryable)
          if (error.message.includes('JSON') && !error.message.includes('Insufficient')) {
            throw this.createLLMError(error, 'Invalid response format', 'INVALID_RESPONSE', false);
          }
        }

        // If we've exhausted retries, throw the error
        if (attempt > maxRetries) {
          if (this.isTimeoutError(lastError)) {
            throw this.createLLMError(ensureError(lastError), 'Request timeout', 'TIMEOUT', false);
          }
          throw this.createLLMError(
            ensureError(lastError),
            'Max retries exceeded',
            'CONNECTION_ERROR',
            false
          );
        }

        // Calculate retry delay
        let retryDelayMs: number | null = null;

        // Try custom retry delay extractor first (e.g., for Gemini 429 errors)
        if (customRetryDelayExtractor && error instanceof Error) {
          retryDelayMs = customRetryDelayExtractor(error);
        }

        // If no custom delay, use exponential backoff
        if (retryDelayMs === null) {
          const backoffSeconds = Math.min(
            Math.max(Math.pow(factor, attempt - 1), minTimeout / 1000),
            maxTimeout / 1000
          );
          retryDelayMs = backoffSeconds * 1000;
          this.logger.info(
            { attemptNumber: attempt, retryDelay: backoffSeconds },
            `Attempt ${attempt} failed, retrying in ${backoffSeconds}s...`
          );
        } else {
          // Custom delay was extracted (e.g., from API response)
          const seconds = Math.ceil(retryDelayMs / 1000);
          this.logger.info(
            { attemptNumber: attempt, retryDelay: seconds },
            `Attempt ${attempt} failed, retrying in ${seconds}s (as specified by API)...`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    // Should never reach here, but TypeScript needs it
    throw this.createLLMError(
      ensureError(lastError),
      'Max retries exceeded',
      'CONNECTION_ERROR',
      false
    );
  }

  /**
   * Create LLM error with proper typing and cause chaining
   */
  protected createLLMError(
    originalError: Error,
    message: string,
    code: LLMError['code'] = 'MODEL_ERROR',
    retryable: boolean = true
  ): LLMError {
    // @ts-expect-error - Error constructor with cause is supported in Node.js 16.9.0+ but TypeScript types may not include it
    const error = new Error(message, { cause: originalError }) as LLMError;
    error.code = code;
    error.retryable = retryable;
    return error;
  }
}
