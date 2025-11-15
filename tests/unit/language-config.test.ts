/**
 * Unit tests for language configuration utilities
 */

// Mock the config module before importing language-config
const mockLanguagesConfig = [
  {
    code: 'es',
    name: 'spanish',
    displayName: 'Spanish',
    tatoebaCode: 'spa',
    lemmatizationCode: 'es',
    speechRecognitionCode: 'es',
    elevenlabsVoiceIds: ['voice1', 'voice2'],
    audioGeneratorVoice: 'Eddy (Spanish (Mexico))',
  },
  {
    code: 'it',
    name: 'italian',
    displayName: 'Italian',
    tatoebaCode: 'ita',
    lemmatizationCode: 'it',
    speechRecognitionCode: 'it',
    elevenlabsVoiceIds: ['voice3'],
    audioGeneratorVoice: 'Alice',
  },
  {
    code: 'pt',
    name: 'portuguese',
    displayName: 'Portuguese',
    tatoebaCode: 'por',
    lemmatizationCode: 'pt',
    speechRecognitionCode: 'pt',
    elevenlabsVoiceIds: [],
    audioGeneratorVoice: 'Luciana',
  },
];

const mockAppConfig = {
  defaultLanguage: 'spanish',
};

jest.mock('../../src/shared/config/index.js', () => ({
  languagesConfig: mockLanguagesConfig,
  appConfig: mockAppConfig,
}));

import {
  getLanguageConfig,
  getLanguageConfigByName,
  getSupportedLanguages,
  getSupportedLanguageCodes,
  getLanguageDisplayName,
  getLanguageCode,
  getLanguageName,
  getTatoebaCode,
  getLemmatizationCode,
  getSpeechRecognitionCode,
  getElevenlabsVoiceIds,
  getAudioGeneratorVoice,
  getDefaultLanguage,
  isLanguageSupported,
} from '../../src/shared/utils/language-config.js';

describe('getLanguageConfig', () => {
  it('should return language config by code', () => {
    const result = getLanguageConfig('es');
    expect(result).not.toBeNull();
    expect(result?.code).toBe('es');
    expect(result?.name).toBe('spanish');
  });

  it('should be case-insensitive', () => {
    const result1 = getLanguageConfig('ES');
    const result2 = getLanguageConfig('Es');
    const result3 = getLanguageConfig('es');

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result3).not.toBeNull();
    expect(result1?.code).toBe('es');
  });

  it('should return null for invalid code', () => {
    const result = getLanguageConfig('xx');
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = getLanguageConfig('');
    expect(result).toBeNull();
  });
});

describe('getLanguageConfigByName', () => {
  it('should return language config by name', () => {
    const result = getLanguageConfigByName('spanish');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('spanish');
    expect(result?.code).toBe('es');
  });

  it('should return language config by display name', () => {
    const result = getLanguageConfigByName('Spanish');
    expect(result).not.toBeNull();
    expect(result?.displayName).toBe('Spanish');
  });

  it('should be case-insensitive', () => {
    const result1 = getLanguageConfigByName('SPANISH');
    const result2 = getLanguageConfigByName('Spanish');
    const result3 = getLanguageConfigByName('spanish');

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result3).not.toBeNull();
    expect(result1?.name).toBe('spanish');
  });

  it('should return null for invalid name', () => {
    const result = getLanguageConfigByName('nonexistent');
    expect(result).toBeNull();
  });
});

describe('getSupportedLanguages', () => {
  it('should return array of language names', () => {
    const result = getSupportedLanguages();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain('spanish');
    expect(result).toContain('italian');
    expect(result).toContain('portuguese');
  });

  it('should return all language names', () => {
    const result = getSupportedLanguages();
    expect(result).toHaveLength(3);
  });
});

describe('getSupportedLanguageCodes', () => {
  it('should return array of language codes', () => {
    const result = getSupportedLanguageCodes();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain('es');
    expect(result).toContain('it');
    expect(result).toContain('pt');
  });

  it('should return all language codes', () => {
    const result = getSupportedLanguageCodes();
    expect(result).toHaveLength(3);
  });
});

describe('getLanguageDisplayName', () => {
  it('should return display name by language name', () => {
    const result = getLanguageDisplayName('spanish');
    expect(result).toBe('Spanish');
  });

  it('should return display name by language code', () => {
    const result = getLanguageDisplayName('es');
    expect(result).toBe('Spanish');
  });

  it('should return display name by display name', () => {
    const result = getLanguageDisplayName('Spanish');
    expect(result).toBe('Spanish');
  });

  it('should be case-insensitive', () => {
    expect(getLanguageDisplayName('SPANISH')).toBe('Spanish');
    expect(getLanguageDisplayName('ES')).toBe('Spanish');
  });

  it('should return input as fallback for invalid language', () => {
    const result = getLanguageDisplayName('nonexistent');
    expect(result).toBe('nonexistent');
  });
});

describe('getLanguageCode', () => {
  it('should return code for valid language name', () => {
    const result = getLanguageCode('spanish');
    expect(result).toBe('es');
  });

  it('should be case-insensitive', () => {
    expect(getLanguageCode('SPANISH')).toBe('es');
    expect(getLanguageCode('Spanish')).toBe('es');
  });

  it('should return null for invalid name', () => {
    const result = getLanguageCode('nonexistent');
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = getLanguageCode('');
    expect(result).toBeNull();
  });
});

describe('getLanguageName', () => {
  it('should return name for valid code', () => {
    const result = getLanguageName('es');
    expect(result).toBe('spanish');
  });

  it('should be case-insensitive', () => {
    expect(getLanguageName('ES')).toBe('spanish');
    expect(getLanguageName('Es')).toBe('spanish');
  });

  it('should return null for invalid code', () => {
    const result = getLanguageName('xx');
    expect(result).toBeNull();
  });
});

describe('getTatoebaCode', () => {
  it('should return Tatoeba code by name', () => {
    const result = getTatoebaCode('spanish');
    expect(result).toBe('spa');
  });

  it('should return Tatoeba code by code', () => {
    const result = getTatoebaCode('es');
    expect(result).toBe('spa');
  });

  it('should be case-insensitive', () => {
    expect(getTatoebaCode('SPANISH')).toBe('spa');
    expect(getTatoebaCode('ES')).toBe('spa');
  });

  it('should return null for invalid language', () => {
    const result = getTatoebaCode('nonexistent');
    expect(result).toBeNull();
  });
});

describe('getLemmatizationCode', () => {
  it('should return lemmatization code by name', () => {
    const result = getLemmatizationCode('spanish');
    expect(result).toBe('es');
  });

  it('should return lemmatization code by code', () => {
    const result = getLemmatizationCode('es');
    expect(result).toBe('es');
  });

  it('should be case-insensitive', () => {
    expect(getLemmatizationCode('ITALIAN')).toBe('it');
    expect(getLemmatizationCode('IT')).toBe('it');
  });

  it('should return null for invalid language', () => {
    const result = getLemmatizationCode('nonexistent');
    expect(result).toBeNull();
  });
});

describe('getSpeechRecognitionCode', () => {
  it('should return speech recognition code by name', () => {
    const result = getSpeechRecognitionCode('spanish');
    expect(result).toBe('es');
  });

  it('should return speech recognition code by code', () => {
    const result = getSpeechRecognitionCode('es');
    expect(result).toBe('es');
  });

  it('should be case-insensitive', () => {
    expect(getSpeechRecognitionCode('PORTUGUESE')).toBe('pt');
    expect(getSpeechRecognitionCode('PT')).toBe('pt');
  });

  it('should return null for invalid language', () => {
    const result = getSpeechRecognitionCode('nonexistent');
    expect(result).toBeNull();
  });
});

describe('getElevenlabsVoiceIds', () => {
  it('should return voice IDs array by name', () => {
    const result = getElevenlabsVoiceIds('spanish');
    expect(result).toEqual(['voice1', 'voice2']);
  });

  it('should return voice IDs array by code', () => {
    const result = getElevenlabsVoiceIds('es');
    expect(result).toEqual(['voice1', 'voice2']);
  });

  it('should return empty array for language with no voices', () => {
    const result = getElevenlabsVoiceIds('portuguese');
    expect(result).toEqual([]);
  });

  it('should return empty array for invalid language', () => {
    const result = getElevenlabsVoiceIds('nonexistent');
    expect(result).toEqual([]);
  });

  it('should be case-insensitive', () => {
    expect(getElevenlabsVoiceIds('SPANISH')).toEqual(['voice1', 'voice2']);
    expect(getElevenlabsVoiceIds('ES')).toEqual(['voice1', 'voice2']);
  });
});

describe('getAudioGeneratorVoice', () => {
  it('should return audio generator voice by name', () => {
    const result = getAudioGeneratorVoice('spanish');
    expect(result).toBe('Eddy (Spanish (Mexico))');
  });

  it('should return audio generator voice by code', () => {
    const result = getAudioGeneratorVoice('es');
    expect(result).toBe('Eddy (Spanish (Mexico))');
  });

  it('should be case-insensitive', () => {
    expect(getAudioGeneratorVoice('ITALIAN')).toBe('Alice');
    expect(getAudioGeneratorVoice('IT')).toBe('Alice');
  });

  it('should return null for invalid language', () => {
    const result = getAudioGeneratorVoice('nonexistent');
    expect(result).toBeNull();
  });
});

describe('getDefaultLanguage', () => {
  it('should return default language from config', () => {
    const result = getDefaultLanguage();
    expect(result).not.toBeNull();
    expect(result?.name).toBe('spanish');
  });

  it('should return language matching defaultLanguage in appConfig', () => {
    const result = getDefaultLanguage();
    expect(result?.name).toBe(mockAppConfig.defaultLanguage);
  });
});

describe('isLanguageSupported', () => {
  it('should return true for valid language name', () => {
    expect(isLanguageSupported('spanish')).toBe(true);
    expect(isLanguageSupported('italian')).toBe(true);
  });

  it('should return true for valid language code', () => {
    expect(isLanguageSupported('es')).toBe(true);
    expect(isLanguageSupported('it')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isLanguageSupported('SPANISH')).toBe(true);
    expect(isLanguageSupported('ES')).toBe(true);
    expect(isLanguageSupported('Spanish')).toBe(true);
  });

  it('should return false for invalid language', () => {
    expect(isLanguageSupported('nonexistent')).toBe(false);
    expect(isLanguageSupported('xx')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isLanguageSupported('')).toBe(false);
  });
});
