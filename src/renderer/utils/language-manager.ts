/**
 * Language management utilities for loading and managing current language
 */

import { sessionManager } from './session-manager.js';

/**
 * Load the current language from the database
 * @param defaultLanguage Default language if loading fails (default: 'spanish')
 * @returns The current language
 */
export async function loadCurrentLanguage(defaultLanguage: string = 'spanish'): Promise<string> {
  try {
    const language = await window.electronAPI.database.getCurrentLanguage();
    return language || defaultLanguage;
  } catch (error) {
    console.error('Failed to load current language:', error);
    return defaultLanguage;
  }
}

/**
 * Load lemmatization model for a language (non-blocking)
 * @param language The language to load the model for
 */
export async function loadLemmatizationModel(language: string): Promise<void> {
  try {
    await window.electronAPI.lemmatization.loadModel(language);
  } catch (error) {
    console.warn(`[Lemmatization] Failed to load model for ${language} (non-critical):`, error);
  }
}

/**
 * Load current language and set it in session manager
 * @param defaultLanguage Default language if loading fails (default: 'spanish')
 * @param loadLemmatization Whether to load lemmatization model (default: true)
 * @returns The current language
 */
export async function loadCurrentLanguageWithSession(
  defaultLanguage: string = 'spanish',
  loadLemmatization: boolean = true
): Promise<string> {
  const language = await loadCurrentLanguage(defaultLanguage);
  const languageToUse = language || defaultLanguage;
  
  sessionManager.setActiveLanguage(languageToUse);
  
  if (loadLemmatization) {
    // Load lemmatization model asynchronously (non-blocking)
    void loadLemmatizationModel(languageToUse);
  }
  
  return languageToUse;
}

/**
 * Change the current language
 * @param newLanguage The new language to set
 * @param onLanguageChanged Optional callback to call after language is changed
 * @returns Promise that resolves when language change is complete
 */
export async function changeLanguage(
  newLanguage: string,
  onLanguageChanged?: (language: string) => Promise<void> | void
): Promise<void> {
  if (!newLanguage) {
    throw new Error('Language cannot be empty');
  }

  try {
    await window.electronAPI.database.setCurrentLanguage(newLanguage);
    sessionManager.setActiveLanguage(newLanguage);
    
    // Load lemmatization model for the new language (async, non-blocking)
    void loadLemmatizationModel(newLanguage);
    
    // Call optional callback
    if (onLanguageChanged) {
      await onLanguageChanged(newLanguage);
    }
  } catch (error) {
    console.error('Failed to change language:', error);
    throw error;
  }
}

/**
 * Capitalize the first letter of a language name
 * @param language The language string
 * @returns Capitalized language string
 */
export function capitalizeLanguage(language: string): string {
  return language.charAt(0).toUpperCase() + language.slice(1);
}

/**
 * Get flag emoji for a language
 * @param language The language code
 * @returns Flag emoji or default globe emoji
 */
export function getLanguageFlag(language: string): string {
  const flags: Record<string, string> = {
    'italian': '🇮🇹',
    'spanish': '🇪🇸',
    'portuguese': '🇵🇹',
    'polish': '🇵🇱',
    'indonesian': '🇮🇩'
  };
  return flags[language] || '🌐';
}

/**
 * Get list of supported languages
 * @returns Array of supported language codes
 */
export function getSupportedLanguages(): string[] {
  return ['italian', 'spanish', 'portuguese', 'polish', 'indonesian'];
}

