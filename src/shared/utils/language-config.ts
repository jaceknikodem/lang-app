/**
 * Language configuration utilities
 * Provides helper functions to access language metadata from config
 */

import { languagesConfig, appConfig } from '../config/index.js';

export interface LanguageConfig {
  code: string;
  name: string;
  displayName: string;
  tatoebaCode: string;
  lemmatizationCode: string;
  speechRecognitionCode: string;
  elevenlabsVoiceIds: string[];
  elevenlabsModel?: string;
  audioGeneratorVoice: string;
}

// Cache for language lookups
let languagesCache: LanguageConfig[] | null = null;
let languagesByNameCache: Map<string, LanguageConfig> | null = null;
let languagesByCodeCache: Map<string, LanguageConfig> | null = null;

/**
 * Get all language configurations
 */
function getLanguages(): LanguageConfig[] {
  if (languagesCache === null) {
    // In renderer (browser), languagesConfig might not be available
    // Return empty array as fallback
    try {
      languagesCache = languagesConfig || [];
    } catch {
      languagesCache = [];
    }
  }
  return languagesCache;
}

/**
 * Build lookup caches
 */
function buildCaches(): void {
  if (languagesByNameCache !== null && languagesByCodeCache !== null) {
    return;
  }

  const languages = getLanguages();
  languagesByNameCache = new Map();
  languagesByCodeCache = new Map();

  for (const lang of languages) {
    languagesByNameCache.set(lang.name.toLowerCase(), lang);
    languagesByCodeCache.set(lang.code.toLowerCase(), lang);
    // Also map display name for convenience
    languagesByNameCache.set(lang.displayName.toLowerCase(), lang);
  }
}

/**
 * Get language configuration by code (e.g., "es", "it")
 */
export function getLanguageConfig(code: string): LanguageConfig | null {
  buildCaches();
  return languagesByCodeCache?.get(code.toLowerCase()) || null;
}

/**
 * Get language configuration by name (e.g., "spanish", "italian")
 */
export function getLanguageConfigByName(name: string): LanguageConfig | null {
  buildCaches();
  return languagesByNameCache?.get(name.toLowerCase()) || null;
}

/**
 * Get all supported language names
 */
export function getSupportedLanguages(): string[] {
  return getLanguages().map((lang) => lang.name);
}

/**
 * Get all supported language codes
 */
export function getSupportedLanguageCodes(): string[] {
  return getLanguages().map((lang) => lang.code);
}

/**
 * Get display name for a language by name or code
 */
export function getLanguageDisplayName(nameOrCode: string): string {
  const lang = getLanguageConfigByName(nameOrCode) || getLanguageConfig(nameOrCode);
  return lang?.displayName || nameOrCode;
}

/**
 * Get 2-letter code for a language by name
 */
export function getLanguageCode(name: string): string | null {
  const lang = getLanguageConfigByName(name);
  return lang?.code || null;
}

/**
 * Get full language name from code
 */
export function getLanguageName(code: string): string | null {
  const lang = getLanguageConfig(code);
  return lang?.name || null;
}

/**
 * Get Tatoeba code for a language
 */
export function getTatoebaCode(nameOrCode: string): string | null {
  const lang = getLanguageConfigByName(nameOrCode) || getLanguageConfig(nameOrCode);
  return lang?.tatoebaCode || null;
}

/**
 * Get lemmatization code for a language
 */
export function getLemmatizationCode(nameOrCode: string): string | null {
  const lang = getLanguageConfigByName(nameOrCode) || getLanguageConfig(nameOrCode);
  return lang?.lemmatizationCode || null;
}

/**
 * Get speech recognition code for a language
 */
export function getSpeechRecognitionCode(nameOrCode: string): string | null {
  const lang = getLanguageConfigByName(nameOrCode) || getLanguageConfig(nameOrCode);
  return lang?.speechRecognitionCode || null;
}

/**
 * Get ElevenLabs voice IDs for a language
 */
export function getElevenlabsVoiceIds(nameOrCode: string): string[] {
  const lang = getLanguageConfigByName(nameOrCode) || getLanguageConfig(nameOrCode);
  return lang?.elevenlabsVoiceIds || [];
}

/**
 * Get ElevenLabs model for a language
 */
export function getElevenlabsModel(nameOrCode: string): string | null {
  const lang = getLanguageConfigByName(nameOrCode) || getLanguageConfig(nameOrCode);
  return lang?.elevenlabsModel || null;
}

/**
 * Get audio generator voice for a language
 */
export function getAudioGeneratorVoice(nameOrCode: string): string | null {
  const lang = getLanguageConfigByName(nameOrCode) || getLanguageConfig(nameOrCode);
  return lang?.audioGeneratorVoice || null;
}

/**
 * Get default language configuration
 * Uses app.defaultLanguage from config to find the matching language config
 */
export function getDefaultLanguage(): LanguageConfig | null {
  try {
    const defaultLanguageName = appConfig?.defaultLanguage;
    if (defaultLanguageName) {
      return getLanguageConfigByName(defaultLanguageName);
    }
  } catch {
    // Fallback if config not available
  }
  // Fallback to first language if no default specified
  const languages = getLanguages();
  return languages.length > 0 ? languages[0] : null;
}

/**
 * Check if a language is supported
 */
export function isLanguageSupported(nameOrCode: string): boolean {
  return getLanguageConfigByName(nameOrCode) !== null || getLanguageConfig(nameOrCode) !== null;
}
