/**
 * Lemmatization service that communicates with the FastAPI Stanza service
 */

import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';
import { DatabaseLayer } from '../../shared/types/database.js';

export interface LemmatizationServiceConfig {
  serverUrl?: string;
  database?: DatabaseLayer;
}

export interface LemmatizationStatus {
  status: string;
  loadedModels: string[];
  service: string;
}

export interface LemmatizeWordsResponse {
  lemmas: Record<string, string>; // word -> lemma mapping
}

export interface GetWordFrequenciesResponse {
  frequencies: Record<string, number>; // word -> zipf_frequency
}

export class LemmatizationService {
  private serverUrl: string;
  private readonly logger: Logger;
  private readonly database?: DatabaseLayer;

  constructor(config: LemmatizationServiceConfig = {}) {
    this.logger = getLogger();
    this.serverUrl = config.serverUrl || 'http://127.0.0.1:8888';
    this.database = config.database;
  }

  /**
   * Map app language names to Stanza language codes
   */
  private mapLanguageToCode(language: string): string {
    const normalized = language.toLowerCase().trim();
    const languageMap: Record<string, string> = {
      spanish: 'es',
      italian: 'it',
      portuguese: 'pt',
      polish: 'pl',
      indonesian: 'id',
      japanese: 'ja',
      // Also handle ISO codes directly
      es: 'es',
      it: 'it',
      pt: 'pt',
      pl: 'pl',
      id: 'id',
      ja: 'ja',
    };
    return languageMap[normalized] || 'es'; // Default to Spanish
  }

  /**
   * Get service status
   */
  async getStatus(): Promise<LemmatizationStatus> {
    const response = await fetch(`${this.serverUrl}/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return {
      status: data.status,
      loadedModels: data.loaded_models || [],
      service: data.service,
    };
  }

  /**
   * Load a Stanza model for the given language
   */
  async loadModel(language: string): Promise<void> {
    // Skip loading model for Japanese (not supported by Stanza in the same way)
    const normalizedLanguage = language.toLowerCase().trim();
    if (normalizedLanguage === 'japanese' || normalizedLanguage === 'ja') {
      this.logger.debug({ language }, '[Lemmatization] Skipping model load for Japanese');
      return;
    }

    const languageCode = this.mapLanguageToCode(language);

    const response = await fetch(`${this.serverUrl}/load_model`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ language: languageCode }),
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ detail: `HTTP error! status: ${response.status}` }));
      throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // This shows up multiple times in logs, that's OK, we don't actually loaded twice on the server.
    if (data.status === 'already_loaded') {
      this.logger.debug({ languageCode, language }, '[Lemmatization] Stanza model already loaded');
    } else {
      this.logger.info(
        { languageCode, language },
        '[Lemmatization] Stanza model loaded successfully'
      );
    }
  }

  /**
   * Lemmatize a list of words
   */
  async lemmatizeWords(words: string[], language: string): Promise<Record<string, string>> {
    // Skip lemmatization for Japanese (not supported by Stanza in the same way)
    const normalizedLanguage = language.toLowerCase().trim();
    if (normalizedLanguage === 'japanese' || normalizedLanguage === 'ja') {
      this.logger.debug(
        { language, wordCount: words.length },
        '[Lemmatization] Skipping lemmatization for Japanese'
      );
      // Return empty object (no lemmas) for Japanese
      return {};
    }

    const languageCode = this.mapLanguageToCode(language);

    this.logger.debug(
      {
        wordCount: words.length,
        languageCode,
        language,
      },
      '[Lemmatization] Calling lemmatize_words API'
    );

    const response = await fetch(`${this.serverUrl}/lemmatize_words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        words: words,
        language: languageCode,
      }),
      signal: AbortSignal.timeout(10000), // 10 second timeout (lemmatization can take a moment)
    });

    this.logger.debug(
      { status: response.status, languageCode, language },
      '[Lemmatization] lemmatize_words API response'
    );

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ detail: `HTTP error! status: ${response.status}` }));
      throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
    }

    const data: LemmatizeWordsResponse = await response.json();
    return data.lemmas || {};
  }

  /**
   * Get Zipf frequencies for a list of words
   * Checks cache first, then fetches only missing words from API
   */
  async getWordFrequencies(words: string[], language: string): Promise<Record<string, number>> {
    const languageCode = this.mapLanguageToCode(language);
    const result: Record<string, number> = {};

    // Step 1: Check cache if database is available
    let cachedFrequencies: Record<string, number> = {};
    let wordsToFetch: string[] = words;

    if (this.database) {
      try {
        cachedFrequencies = await this.database.getZipfFrequencies(words, language);
        // Identify words not in cache
        wordsToFetch = words.filter((word) => !(word in cachedFrequencies));
        this.logger.debug(
          {
            totalWords: words.length,
            cachedWords: Object.keys(cachedFrequencies).length,
            wordsToFetch: wordsToFetch.length,
          },
          '[Lemmatization] Cache check complete'
        );
      } catch (error) {
        this.logger.warn(
          { err: error },
          '[Lemmatization] Failed to check cache, fetching all words'
        );
        // If cache check fails, fetch all words
        wordsToFetch = words;
      }
    }

    // Step 2: Fetch missing words from API
    if (wordsToFetch.length > 0) {
      this.logger.debug(
        {
          wordCount: wordsToFetch.length,
          languageCode,
          language,
        },
        '[Lemmatization] Calling freqword API for missing words'
      );

      const response = await fetch(`${this.serverUrl}/freqword`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          words: wordsToFetch,
          language: languageCode,
        }),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      this.logger.debug(
        { status: response.status, languageCode, language },
        '[Lemmatization] freqword API response'
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: `HTTP error! status: ${response.status}` }));
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const data: GetWordFrequenciesResponse = await response.json();
      const fetchedFrequencies = data.frequencies || {};

      // Step 3: Store fetched results in cache (only for words that exist in database)
      if (this.database && Object.keys(fetchedFrequencies).length > 0) {
        try {
          await this.database.updateZipfFrequencies(fetchedFrequencies, language);
          this.logger.debug(
            { wordCount: Object.keys(fetchedFrequencies).length },
            '[Lemmatization] Cached fetched frequencies'
          );
        } catch (error) {
          this.logger.warn(
            { err: error },
            '[Lemmatization] Failed to cache frequencies, continuing anyway'
          );
        }
      }

      // Merge fetched frequencies into result
      Object.assign(result, fetchedFrequencies);
    }

    // Step 4: Merge cached frequencies into result
    Object.assign(result, cachedFrequencies);

    return result;
  }
}
