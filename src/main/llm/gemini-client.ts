/**
 * Google Gemini API client for cloud-based LLM communication
 */

import { GeneratedWord, GeneratedSentence } from '../../shared/types/core.js';
import { LLMClient, LLMConfig } from '../../shared/types/llm.js';
import { LLM_CONFIG } from '../../shared/constants/index.js';
import { cleanLLMResponse } from './utils.js';
import { BaseLLMClient } from './base-llm-client.js';
import { ensureError } from '../../shared/utils/error.js';
import axios from 'axios';

interface GeminiRequest {
  contents: Array<{
    parts: Array<{
      text: string;
    }>;
  }>;
  generationConfig?: {
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}

export class GeminiClient extends BaseLLMClient implements LLMClient {
  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(apiKey: string, config: Partial<LLMConfig> = {}) {
    const defaultBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
    super({
      baseUrl: config.baseUrl || defaultBaseUrl,
      model: config.model || LLM_CONFIG.GEMINI_DEFAULT_MODEL,
      wordGenerationModel: config.wordGenerationModel || LLM_CONFIG.GEMINI_DEFAULT_FAST_MODEL,
      sentenceGenerationModel:
        config.sentenceGenerationModel || LLM_CONFIG.GEMINI_DEFAULT_FULL_MODEL,
      timeout: config.timeout || LLM_CONFIG.GEMINI_DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || LLM_CONFIG.MAX_RETRIES,
    });
    this.apiKey = apiKey || '';
  }

  /**
   * Update the API key after construction
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey || '';
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey || this.apiKey.trim() === '') {
      this.logger.warn('[GeminiClient] API key is empty or not set');
      return false;
    }

    try {
      // Try the models endpoint first (lightweight check)
      const modelsUrl = `${this.baseUrl}?key=${this.apiKey}`;

      const response = await axios.get(modelsUrl, {
        timeout: 5000,
        validateStatus: () => true, // Don't throw on any status
      });

      if (response.status !== 200) {
        let errorMessage = '';
        try {
          if (typeof response.data === 'string') {
            errorMessage = response.data.substring(0, 200);
            // Try to parse JSON error response
            try {
              const errorJson = JSON.parse(response.data);
              if (errorJson?.error?.message) {
                errorMessage = errorJson.error.message;
              }
            } catch {
              // Not JSON, use the text as-is
            }
          } else if (response.data?.error?.message) {
            errorMessage = response.data.error.message;
          }
        } catch {
          errorMessage = 'Unable to read error response';
        }

        this.logger.warn(
          { status: response.status, statusText: response.statusText, errorMessage },
          '[GeminiClient] Availability check failed'
        );

        // If it's a 403 or 400, it might be a regional/billing issue
        if (response.status === 403 || response.status === 400) {
          this.logger.warn(
            '[GeminiClient] This might be a regional restriction or billing issue. Check your Google Cloud Console settings.'
          );
        }

        return false;
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn({ error, errorMessage }, '[GeminiClient] Availability check error');

      // If it's a timeout, log that specifically
      if (
        axios.isAxiosError(error) &&
        (error.code === 'ECONNABORTED' || error.message.includes('timeout'))
      ) {
        this.logger.warn(
          '[GeminiClient] Request timed out. This might indicate network issues or the API is slow to respond.'
        );
      }

      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    // Return fixed list of supported Gemini models
    return [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
    ];
  }

  /**
   * Helper method to log validation errors with a specific prefix
   */
  private logValidationError(error: unknown, prefix: string): void {
    if (error instanceof Error && error.message.includes('Invalid response format')) {
      this.logger.error({ error, prefix }, 'Validation error');
    }
  }

  /**
   * Helper method to check if API key is configured
   */
  private ensureApiKey(): void {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw super.createLLMError(
        new Error('Gemini API key is required'),
        'Gemini API key not configured',
        'MODEL_ERROR',
        false
      );
    }
  }

  /**
   * Extract retry delay from Gemini API error response
   * @param errorText The error response text from the API (can be JSON string or already parsed object)
   * @param retryAfterHeader Optional Retry-After header value
   * @returns Retry delay in milliseconds, or null if not found or >= 2 minutes
   */
  private extractRetryDelay(errorText: string | object, retryAfterHeader?: string): number | null {
    try {
      // Parse errorText if it's a string, otherwise use it directly
      const errorJson = typeof errorText === 'string' ? JSON.parse(errorText) : errorText;

      // Check if error.details exists and is an array
      if (errorJson.error?.details && Array.isArray(errorJson.error.details)) {
        // Find the RetryInfo entry
        const retryInfo = errorJson.error.details.find(
          (detail: unknown) =>
            detail &&
            typeof detail === 'object' &&
            '@type' in detail &&
            detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
        ) as { retryDelay?: string } | undefined;

        if (retryInfo?.retryDelay) {
          // Parse delay string like "23s" or "23.41586998s"
          const delayStr = retryInfo.retryDelay;
          // Remove 's' suffix and parse as float
          const seconds = parseFloat(delayStr.replace(/s$/, ''));

          if (!isNaN(seconds)) {
            const milliseconds = seconds * 1000;
            const twoMinutes = 2 * 60 * 1000; // 120,000ms

            // If delay is >= 2 minutes, return null to give up
            if (milliseconds >= twoMinutes) {
              return null;
            }

            return Math.ceil(milliseconds); // Round up to ensure we wait long enough
          }
        }
      }

      // Fallback: check Retry-After header if provided
      if (retryAfterHeader) {
        const headerSeconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(headerSeconds)) {
          const milliseconds = headerSeconds * 1000;
          const twoMinutes = 2 * 60 * 1000; // 120,000ms
          if (milliseconds < twoMinutes) {
            return milliseconds;
          }
        }
      }
    } catch (parseError) {
      // If parsing fails, log and return null to fall back to exponential backoff
      this.logger.debug(
        {
          parseError,
          errorText: typeof errorText === 'string' ? errorText.substring(0, 200) : errorText,
        },
        'Failed to parse retry delay from error response'
      );
      return null;
    }

    return null;
  }

  async generateTopicWords(
    topic: string,
    language: string,
    count: number,
    proficiencyLevel?: string
  ): Promise<GeneratedWord[]> {
    this.ensureApiKey();

    // Call base class implementation, but add validation logging
    try {
      const words = await super.generateTopicWords(topic, language, count, proficiencyLevel);
      return words;
    } catch (error) {
      this.logValidationError(error, 'GEMINI VALIDATION FAILED');
      throw error;
    }
  }

  async generateSentences(
    word: string,
    language: string,
    count: number,
    topic?: string,
    proficiencyLevel?: string,
    translation?: string
  ): Promise<GeneratedSentence[]> {
    this.ensureApiKey();

    // Call base class implementation, but add validation logging
    try {
      const sentences = await super.generateSentences(
        word,
        language,
        count,
        topic,
        proficiencyLevel,
        translation
      );
      return sentences;
    } catch (error) {
      this.logValidationError(error, 'GEMINI SENTENCE VALIDATION FAILED');
      throw error;
    }
  }

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
    if (!this.apiKey || this.apiKey.trim() === '') {
      // Return empty context instead of throwing if API key not configured
      return {};
    }

    // Call base class implementation, but add validation logging
    try {
      const context = await super.generateContextSentences(
        sentence,
        translation,
        language,
        proficiencyLevel
      );
      return context;
    } catch (error) {
      this.logValidationError(error, 'GEMINI CONTEXT SENTENCE VALIDATION FAILED');
      // Base class already returns empty context on error, but we'll return it anyway
      return {};
    }
  }

  protected async generateResponse(prompt: string, model?: string): Promise<string> {
    this.ensureApiKey();

    try {
      const selectedModel = model || this.config.model;
      const requestBody: GeminiRequest = {
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 4096,
        },
      };

      const response = await axios.post<GeminiResponse>(
        `${this.baseUrl}/${selectedModel}:generateContent?key=${this.apiKey}`,
        requestBody,
        {
          timeout: this.config.timeout || 60000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = response.data;

      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('No response candidates from Gemini');
      }

      const candidate = data.candidates[0];
      if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
        throw new Error('Empty response from Gemini');
      }

      return candidate.content.parts[0].text.trim();
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        (error.code === 'ECONNABORTED' || error.message.includes('timeout'))
      ) {
        throw super.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
      }
      const err = ensureError(error);
      throw super.createLLMError(err, `Failed to generate response`);
    }
  }

  protected async makeRequest(prompt: string, model?: string): Promise<any> {
    const selectedModel = model || this.config.model;
    const requestBody: GeminiRequest = {
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3, // Lower temperature for more consistent JSON output
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 4096, // Increased from 2048 to handle multiple sentences with full context
      },
    };

    // Custom retry delay extractor for 429 rate limit errors
    const customRetryDelayExtractor = (error: unknown): number | null => {
      // Check if error has status and errorText properties (from our custom error)
      const errorWithStatus = error as Error & {
        status?: number;
        errorText?: string | object;
        retryAfter?: string;
      };

      // Also check if it's an axios error with response
      const axiosError = axios.isAxiosError(error) ? error : null;
      const status = errorWithStatus.status ?? axiosError?.response?.status;
      const errorData = errorWithStatus.errorText ?? axiosError?.response?.data;
      const retryAfterHeader =
        errorWithStatus.retryAfter ?? axiosError?.response?.headers?.['retry-after'];

      if (status === 429) {
        this.logger.debug(
          {
            hasErrorData: !!errorData,
            hasRetryAfterHeader: !!retryAfterHeader,
            errorDataType: typeof errorData,
          },
          'Gemini 429 error detected, attempting to extract retry delay'
        );

        // Try to extract retry delay from error response
        if (errorData) {
          const retryDelayMs = this.extractRetryDelay(errorData, retryAfterHeader);

          // If retryDelay is null (>= 2 minutes or not found), fall back to exponential backoff
          // Don't throw here - let exponential backoff handle it
          if (retryDelayMs !== null) {
            this.logger.info(
              { retryDelayMs, retryDelaySeconds: Math.ceil(retryDelayMs / 1000) },
              'Extracted retry delay from Gemini API response'
            );
            return retryDelayMs;
          } else {
            this.logger.debug(
              'Could not extract retry delay from error response, will use exponential backoff'
            );
          }
        } else if (retryAfterHeader) {
          // If we have Retry-After header but no error data, use the header
          const headerSeconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(headerSeconds)) {
            const milliseconds = headerSeconds * 1000;
            const twoMinutes = 2 * 60 * 1000; // 120,000ms
            if (milliseconds < twoMinutes) {
              this.logger.info(
                { retryDelayMs: milliseconds, retryDelaySeconds: headerSeconds },
                'Using Retry-After header for retry delay'
              );
              return milliseconds;
            }
          }
        }
      }
      return null;
    };

    return this.retryWithBackoff(async () => {
      const response = await axios.post<GeminiResponse>(
        `${this.baseUrl}/${selectedModel}:generateContent?key=${this.apiKey}`,
        requestBody,
        {
          timeout: this.config.timeout || 60000,
          headers: {
            'Content-Type': 'application/json',
          },
          validateStatus: () => true, // Don't throw on any status
        }
      );

      if (response.status !== 200) {
        // Preserve the original data structure - don't stringify if it's already an object
        // This allows extractRetryDelay to work with both string and object formats
        const errorData = response.data;
        const errorText = typeof errorData === 'string' ? errorData : JSON.stringify(errorData);
        const error = new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
        // Attach response status, errorText (can be string or object), and Retry-After header to error for retry logic
        (error as any).status = response.status;
        (error as any).errorText = errorData; // Store original data, not stringified version
        (error as any).retryAfter =
          response.headers?.['retry-after'] || response.headers?.['Retry-After'];
        throw error;
      }

      const data = response.data;

      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('No response candidates from Gemini');
      }

      const candidate = data.candidates[0];
      if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
        throw new Error('Empty response from Gemini');
      }

      // Check if response was truncated
      if (candidate.finishReason === 'MAX_TOKENS') {
        this.logger.warn(
          {
            finishReason: candidate.finishReason,
            maxOutputTokens: requestBody.generationConfig?.maxOutputTokens,
          },
          'Gemini response was truncated due to token limit'
        );
      }

      let cleanResponse = cleanLLMResponse(candidate.content.parts[0].text);

      // If response was truncated and looks like an incomplete array, try to fix it
      if (candidate.finishReason === 'MAX_TOKENS' && cleanResponse.trim().startsWith('[')) {
        const trimmed = cleanResponse.trim();
        // If it starts with [ but doesn't end with ], try to add the closing bracket
        if (!trimmed.endsWith(']')) {
          // Count open brackets vs close brackets
          const openBrackets = (trimmed.match(/\[/g) || []).length;
          const closeBrackets = (trimmed.match(/\]/g) || []).length;
          const openBraces = (trimmed.match(/\{/g) || []).length;
          const closeBraces = (trimmed.match(/\}/g) || []).length;

          // If we have unmatched brackets/braces, try to close them
          if (openBrackets > closeBrackets || openBraces > closeBraces) {
            // Add missing closing braces first, then brackets
            let fixed = trimmed;
            for (let i = 0; i < openBraces - closeBraces; i++) {
              fixed += '\n}';
            }
            for (let i = 0; i < openBrackets - closeBrackets; i++) {
              fixed += '\n]';
            }
            this.logger.warn(
              'Attempting to fix truncated JSON by adding missing closing brackets/braces'
            );
            cleanResponse = fixed;
          }
        }
      }

      // Parse JSON
      try {
        return JSON.parse(cleanResponse);
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        this.logger.error(
          {
            parseError: errorMessage,
            parseErrorStack: parseError instanceof Error ? parseError.stack : undefined,
            finishReason: candidate.finishReason,
            cleanResponse,
          },
          'JSON parsing failed for response'
        );
        throw new Error(
          `Invalid JSON response${candidate.finishReason === 'MAX_TOKENS' ? ' (truncated due to token limit)' : ''}: ${cleanResponse.substring(0, 200)}...`
        );
      }
    }, customRetryDelayExtractor);
  }
}
