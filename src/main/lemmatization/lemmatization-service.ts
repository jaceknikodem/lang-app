/**
 * Lemmatization service that communicates with the FastAPI Stanza service
 */

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

  constructor(config: LemmatizationServiceConfig = {}) {
    this.serverUrl = config.serverUrl || 'http://127.0.0.1:8888';
  }

  /**
   * Map app language names to Stanza language codes
   */
  private mapLanguageToCode(language: string): string {
    const normalized = language.toLowerCase().trim();
    const languageMap: Record<string, string> = {
      'spanish': 'es',
      'italian': 'it',
      'portuguese': 'pt',
      'polish': 'pl',
      'indonesian': 'id',
      // Also handle ISO codes directly
      'es': 'es',
      'it': 'it',
      'pt': 'pt',
      'pl': 'pl',
      'id': 'id'
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
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        status: data.status,
        loadedModels: data.loaded_models || [],
        service: data.service
      };
    } catch (error) {
      // Service is optional - don't throw, just log and return null
      if (error instanceof Error && (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed'))) {
        console.warn('[Lemmatization] Service unavailable (optional):', error.message);
      } else {
        console.warn('[Lemmatization] Failed to get service status (non-critical):', error);
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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ language: languageCode }),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: `HTTP error! status: ${response.status}` }));
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.status === 'already_loaded') {
        console.log(`[Lemmatization] Stanza model for ${languageCode} (${language}) already loaded`);
      } else {
        console.log(`[Lemmatization] Stanza model for ${languageCode} (${language}) loaded successfully`);
      }
    } catch (error) {
      // Service is optional - don't throw, just log warning
      if (error instanceof Error && (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed') || error.message.includes('timeout'))) {
        console.warn(`[Lemmatization] Service unavailable, skipping model load for ${language} (non-critical)`);
      } else {
        console.warn(`[Lemmatization] Failed to load model for ${language} (non-critical):`, error);
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
      
      console.log(`[Lemmatization] Calling lemmatize_words API: ${words.length} words for ${languageCode} (${language})`);
      
      const response = await fetch(`${this.serverUrl}/lemmatize_words`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          words: words,
          language: languageCode
        }),
        signal: AbortSignal.timeout(10000) // 10 second timeout (lemmatization can take a moment)
      });
      
      console.log(`[Lemmatization] lemmatize_words API response status: ${response.status}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: `HTTP error! status: ${response.status}` }));
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const data: LemmatizeWordsResponse = await response.json();
      return data.lemmas || {};
    } catch (error) {
      // Service is optional - return empty object so app can continue
      if (error instanceof Error && (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed') || error.message.includes('timeout'))) {
        // Silently fail - words will be used as their own lemmas
        return {};
      }
      // Other errors - log but still return empty (non-critical)
      console.warn('[Lemmatization] Failed to lemmatize words (non-critical):', error);
      return {};
    }
  }
}


