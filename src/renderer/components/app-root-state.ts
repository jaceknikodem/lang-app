/**
 * Consolidated state interfaces for AppRoot component
 */

import type { ProficiencyLevel } from './language-proficiency-selector.js';

export interface LanguageDataState {
  currentLanguage: string;
  showProficiencySelector: boolean;
  currentProficiencyLevel: ProficiencyLevel | null;
  hasExistingWords: boolean | null;
  hasFlowSentences: boolean;
  wordCategoryStats: { known: number; strong: number; weak: number; new: number } | null;
}

export interface UIState {
  isLoading: boolean;
  transitionMessage: string | null;
  autopilotEnabled: boolean;
  autoplayAudioEnabled: boolean;
}

export const createInitialLanguageDataState = (): LanguageDataState => ({
  currentLanguage: '',
  showProficiencySelector: false,
  currentProficiencyLevel: null,
  hasExistingWords: null,
  hasFlowSentences: false,
  wordCategoryStats: null,
});

export const createInitialUIState = (): UIState => ({
  isLoading: true,
  transitionMessage: null,
  autopilotEnabled: false,
  autoplayAudioEnabled: false,
});
