/**
 * Google Gemini API client for cloud-based LLM communication
 */

import { GeneratedWord, GeneratedSentence } from '../../shared/types/core.js';
import { LLMClient, LLMConfig, LLMError } from '../../shared/types/llm.js';
import { LLM_CONFIG } from '../../shared/constants/index.js';
import { cleanLLMResponse } from './utils.js';
import { BaseLLMClient } from './base-llm-client.js';
import { ensureError } from '../../shared/utils/error.js';
import { getLogger } from '../utils/logger.js';
import { z } from 'zod';


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
      wordGenerationModel: config.wordGenerationModel || LLM_CONFIG.GEMINI_DEFAULT_WORD_MODEL,
      sentenceGenerationModel: config.sentenceGenerationModel || LLM_CONFIG.GEMINI_DEFAULT_SENTENCE_MODEL,
      timeout: config.timeout || LLM_CONFIG.GEMINI_DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || LLM_CONFIG.MAX_RETRIES
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
    const logger = getLogger();
    if (!this.apiKey || this.apiKey.trim() === '') {
      logger.warn('[GeminiClient] API key is empty or not set');
      return false;
    }
    
    try {
      // Try the models endpoint first (lightweight check)
      const modelsUrl = `${this.baseUrl}?key=${this.apiKey}`;
      const pTimeout = (await import('p-timeout')).default;
      
      const response = await pTimeout(
        fetch(modelsUrl, { method: 'GET' }),
        { milliseconds: 5000 }
      );
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        let errorMessage = errorText.substring(0, 200);
        
        // Try to parse JSON error response
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson?.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          // Not JSON, use the text as-is
        }
        
        logger.warn({ status: response.status, statusText: response.statusText, errorMessage }, '[GeminiClient] Availability check failed');
        
        // If it's a 403 or 400, it might be a regional/billing issue
        if (response.status === 403 || response.status === 400) {
          logger.warn('[GeminiClient] This might be a regional restriction or billing issue. Check your Google Cloud Console settings.');
        }
        
        return false;
      }
      
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn({ error, errorMessage }, '[GeminiClient] Availability check error');
      
      // If it's a timeout, log that specifically
      if (error instanceof Error && (error.name === 'TimeoutError' || error.message.includes('timeout'))) {
        logger.warn('[GeminiClient] Request timed out. This might indicate network issues or the API is slow to respond.');
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
    const logger = getLogger();
    if (error instanceof Error && error.message.includes('Invalid response format')) {
      logger.error({ error, prefix }, 'Validation error');
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
   * @param errorText The error response text from the API
   * @returns Retry delay in milliseconds, or null if not found or >= 2 minutes
   */
  private extractRetryDelay(errorText: string): number | null {
    try {
      const errorJson = JSON.parse(errorText);
      
      // Check if error.details exists and is an array
      if (errorJson.error?.details && Array.isArray(errorJson.error.details)) {
        // Find the RetryInfo entry
        const retryInfo = errorJson.error.details.find(
          (detail: any) => detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
        );
        
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
    } catch (parseError) {
      // If parsing fails, return null to fall back to exponential backoff
      return null;
    }
    
    return null;
  }

  async generateTopicWords(topic: string, language: string, count: number, proficiencyLevel?: string): Promise<GeneratedWord[]> {
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

  async generateSentences(word: string, language: string, count: number, topic?: string, proficiencyLevel?: string): Promise<GeneratedSentence[]> {
    this.ensureApiKey();

    // Call base class implementation, but add validation logging
    try {
      const sentences = await super.generateSentences(word, language, count, topic, proficiencyLevel);
      return sentences;
    } catch (error) {
      this.logValidationError(error, 'GEMINI SENTENCE VALIDATION FAILED');
      throw error;
    }
  }

  async generateContextSentences(sentence: string, translation: string, language: string, proficiencyLevel?: string): Promise<{ contextBefore?: string; contextAfter?: string; contextBeforeTranslation?: string; contextAfterTranslation?: string }> {
    if (!this.apiKey || this.apiKey.trim() === '') {
      // Return empty context instead of throwing if API key not configured
      return {};
    }

    // Call base class implementation, but add validation logging
    try {
      const context = await super.generateContextSentences(sentence, translation, language, proficiencyLevel);
      return context;
    } catch (error) {
      this.logValidationError(error, 'GEMINI CONTEXT SENTENCE VALIDATION FAILED');
      // Base class already returns empty context on error, but we'll return it anyway
      return {};
    }
  }

  async generateResponse(prompt: string, model?: string): Promise<string> {
    this.ensureApiKey();

    try {
      const selectedModel = model || this.config.model;
      const requestBody: GeminiRequest = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      };
      const pTimeout = (await import('p-timeout')).default;

      const response = await pTimeout(
        fetch(`${this.baseUrl}/${selectedModel}:generateContent?key=${this.apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        }),
        { milliseconds: this.config.timeout || 60000 }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const data: GeminiResponse = await response.json();

      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('No response candidates from Gemini');
      }

      const candidate = data.candidates[0];
      if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
        throw new Error('Empty response from Gemini');
      }

      return candidate.content.parts[0].text.trim();
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw super.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
      }
      const err = ensureError(error);
      throw super.createLLMError(err, `Failed to generate response`);
    }
  }

  protected async makeRequest(prompt: string, model?: string): Promise<any> {
    const selectedModel = model || this.config.model;
    const requestBody: GeminiRequest = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.3, // Lower temperature for more consistent JSON output
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048
      }
    };
    const pRetry = (await import('p-retry')).default;
    const pTimeout = (await import('p-timeout')).default;

    return await pRetry(
      async () => {
        const response = await pTimeout(
          fetch(`${this.baseUrl}/${selectedModel}:generateContent?key=${this.apiKey}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
          }),
          { milliseconds: this.config.timeout || 60000 }
        );

        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
          // Attach response status and errorText to error for retry logic
          (error as any).status = response.status;
          (error as any).errorText = errorText;
          throw error;
        }

        const data: GeminiResponse = await response.json();

        if (!data.candidates || data.candidates.length === 0) {
          throw new Error('No response candidates from Gemini');
        }

        const candidate = data.candidates[0];
        if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
          throw new Error('Empty response from Gemini');
        }

        const cleanResponse = cleanLLMResponse(candidate.content.parts[0].text);

        // Parse JSON
        let parsed: any;
        try {
          parsed = JSON.parse(cleanResponse);
        } catch (parseError) {
          const logger = getLogger();
          logger.error({ parseError, cleanResponse }, 'JSON parsing failed for response');
          throw new Error(`Invalid JSON response: ${cleanResponse}...`);
        }

        return parsed;
      },
      {
        retries: this.config.maxRetries!,
        onFailedAttempt: async (error) => {
          // Don't retry on certain errors
          if (error instanceof Error) {
            if (error.name === 'TimeoutError' || error.name === 'AbortError') {
              throw super.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
            }
            if (error.message.includes('JSON') && !error.message.includes('Insufficient')) {
              throw super.createLLMError(error, 'Invalid response format', 'INVALID_RESPONSE', false);
            }

            // Check if this is a 429 error and extract retry delay
            if ((error as any).status === 429 && (error as any).errorText) {
              const retryDelayMs = this.extractRetryDelay((error as any).errorText);
              
              // If retryDelay is null (>= 2 minutes), give up immediately
              if (retryDelayMs === null) {
                throw super.createLLMError(error, 'Rate limit exceeded - retry delay too long', 'CONNECTION_ERROR', false);
              }

              // Use the extracted retry delay from the API
              const seconds = Math.ceil(retryDelayMs / 1000);
              const logger = getLogger();
              logger.info({ attemptNumber: error.attemptNumber, retryDelay: seconds }, `Attempt ${error.attemptNumber} failed with HTTP 429, retrying in ${seconds}s (as specified by API)...`);
              await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            } else {
              // Use exponential backoff for other errors (handled by minTimeout/maxTimeout/factor)
              const backoffSeconds = Math.pow(2, error.attemptNumber - 1);
              const logger = getLogger();
              logger.info({ attemptNumber: error.attemptNumber, retryDelay: backoffSeconds }, `Attempt ${error.attemptNumber} failed, retrying in ${backoffSeconds}s...`);
            }
          }
        },
        minTimeout: 1000, // 1 second minimum
        maxTimeout: 120000, // 2 minutes maximum
        factor: 2 // Exponential backoff factor
      }
    ).catch((error) => {
      // Handle final error after all retries exhausted
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw super.createLLMError(error, 'Request timeout', 'TIMEOUT', false);
      }
      throw super.createLLMError(ensureError(error), 'Max retries exceeded', 'CONNECTION_ERROR', false);
    });
  }
}