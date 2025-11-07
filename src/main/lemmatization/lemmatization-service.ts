/**
 * Lemmatization service that communicates with the FastAPI Stanza service
 */

import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';

export interface LemmatizationServiceConfig {
  serverUrl?: string;
}

export interface LemmatizationStatus {
  status: string;
  loadedModels: string[];
  service: string;
}

export interface LemmatizeWordsResponse {
  lemmas: Record<string, string>; // word -> lemma mapping
}

export class LemmatizationService {
  private serverUrl: string;
  private readonly logger: Logger;

  constructor(config: LemmatizationServiceConfig = {}) {
    this.logger = getLogger();
    this.serverUrl = config.serverUrl || 'http://127.0.0.1:8888';
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
      // Also handle ISO codes directly
      es: 'es',
      it: 'it',
      pt: 'pt',
      pl: 'pl',
      id: 'id',
    };
    return languageMap[normalized] || 'es'; // Default to Spanish
  }

  /**
   * Get service status
   * Returns null if service is unavailable (optional service)
   */
  async getStatus(): Promise<LemmatizationStatus | null> {
    try {
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
    } catch (error) {
      // Service is optional - don't throw, just log and return null
      if (
        error instanceof Error &&
        (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed'))
      ) {
        this.logger.warn(
          { error: error.message, serverUrl: this.serverUrl },
          '[Lemmatization] Service unavailable (optional)'
        );
      } else {
        this.logger.warn({ error }, '[Lemmatization] Failed to get service status (non-critical)');
      }
      return null;
    }
  }

  /**
   * Load a Stanza model for the given language
   * Service is optional - silently fails if unavailable
   */
  async loadModel(language: string): Promise<void> {
    try {
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
        this.logger.debug(
          { languageCode, language },
          '[Lemmatization] Stanza model already loaded'
        );
      } else {
        this.logger.info(
          { languageCode, language },
          '[Lemmatization] Stanza model loaded successfully'
        );
      }
    } catch (error) {
      // Service is optional - don't throw, just log warning
      if (
        error instanceof Error &&
        (error.message.includes('ECONNREFUSED') ||
          error.message.includes('fetch failed') ||
          error.message.includes('timeout'))
      ) {
        this.logger.warn(
          { language, languageCode },
          '[Lemmatization] Service unavailable, skipping model load (non-critical)'
        );
      } else {
        this.logger.warn(
          { error, language, languageCode },
          '[Lemmatization] Failed to load model (non-critical)'
        );
      }
      // Don't throw - service is optional
    }
  }

  /**
   * Lemmatize a list of words
   * Returns empty object if service is unavailable (optional service)
   * This allows the app to work without lemmatization
   */
  async lemmatizeWords(words: string[], language: string): Promise<Record<string, string>> {
    try {
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
    } catch (error) {
      // Service is optional - return empty object so app can continue
      if (
        error instanceof Error &&
        (error.message.includes('ECONNREFUSED') ||
          error.message.includes('fetch failed') ||
          error.message.includes('timeout'))
      ) {
        // Silently fail - words will be used as their own lemmas
        return {};
      }
      // Other errors - log but still return empty (non-critical)
      this.logger.warn(
        { error, language, wordCount: words.length },
        '[Lemmatization] Failed to lemmatize words (non-critical)'
      );
      return {};
    }
  }
}
