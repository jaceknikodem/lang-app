/**
 * Unit tests for TTSAudioGenerator path generation logic
 */

import { TTSAudioGenerator } from '../../src/main/audio/audio-generator';
import { join } from 'path';

// Mock Electron app
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/test-app-data'),
  },
}));

describe('TTSAudioGenerator Path Generation', () => {
  let generator: TTSAudioGenerator;
  const audioDir = '/tmp/test-app-data/audio';

  beforeEach(() => {
    generator = new TTSAudioGenerator({
      audioDirectory: audioDir,
    });
    jest.clearAllMocks();
  });

  describe('getAudioPath', () => {
    it('should generate path for word audio', () => {
      const path = (generator as any).getAudioPath('hola', 'spanish', undefined, 1);
      expect(path).toBe(join(audioDir, 'spanish', 'word_1.aiff'));
    });

    it('should generate path for sentence audio', () => {
      const path = (generator as any).getAudioPath('Hola mundo', 'spanish', 'hola', 1, 5);
      expect(path).toBe(join(audioDir, 'spanish', 'word_1', 'sentence_5.aiff'));
    });

    it('should generate path for english sentence audio', () => {
      const path = (generator as any).getAudioPath(
        'Hello world',
        'spanish',
        'english_sentence',
        1,
        5
      );
      expect(path).toBe(join(audioDir, 'spanish', 'word_1', 'english_sentence_5.aiff'));
    });

    it('should generate path for before sentence audio', () => {
      const path = (generator as any).getAudioPath('Hola', 'spanish', 'hola_before_sentence', 1, 5);
      expect(path).toBe(join(audioDir, 'spanish', 'word_1', 'before_sentence_5.aiff'));
    });

    it('should generate path for continuation audio (variant)', () => {
      const path = (generator as any).getAudioPath(
        'Continuation',
        'spanish',
        undefined,
        undefined,
        undefined,
        10
      );
      expect(path).toBe(join(audioDir, 'spanish', 'variant_10.aiff'));
    });

    it('should throw error when wordId is missing for word audio', () => {
      expect(() => {
        (generator as any).getAudioPath('hola', 'spanish', undefined, undefined);
      }).toThrow('Word ID or variant ID is required');
    });

    it('should throw error when wordId is missing for sentence audio', () => {
      expect(() => {
        (generator as any).getAudioPath('Hola mundo', 'spanish', 'hola', undefined, 5);
      }).toThrow('Word ID or variant ID is required');
    });

    it('should handle different languages', () => {
      const languages = ['spanish', 'italian', 'portuguese', 'polish', 'indonesian'];

      languages.forEach((lang) => {
        const path = (generator as any).getAudioPath('test', lang, undefined, 1);
        expect(path).toContain(lang);
      });
    });

    it('should handle numeric wordId and sentenceId', () => {
      const path = (generator as any).getAudioPath('Test', 'spanish', 'test', 123, 456);
      expect(path).toBe(join(audioDir, 'spanish', 'word_123', 'sentence_456.aiff'));
    });

    it('should handle variantId correctly', () => {
      const path = (generator as any).getAudioPath(
        'Continuation',
        'spanish',
        undefined,
        undefined,
        undefined,
        999
      );
      expect(path).toBe(join(audioDir, 'spanish', 'variant_999.aiff'));
    });

    it('should prioritize variantId over wordId', () => {
      const path = (generator as any).getAudioPath(
        'Continuation',
        'spanish',
        undefined,
        1,
        undefined,
        5
      );
      expect(path).toBe(join(audioDir, 'spanish', 'variant_5.aiff'));
    });
  });

  describe('getVoiceForLanguage', () => {
    it('should return correct voice for spanish', () => {
      const voice = (generator as any).getVoiceForLanguage('spanish');
      expect(voice).toBe('Eddy (Spanish (Mexico))');
    });

    it('should return correct voice for italian', () => {
      const voice = (generator as any).getVoiceForLanguage('italian');
      expect(voice).toBe('Alice');
    });

    it('should return correct voice for portuguese', () => {
      const voice = (generator as any).getVoiceForLanguage('portuguese');
      expect(voice).toBe('Luciana');
    });

    it('should return correct voice for polish', () => {
      const voice = (generator as any).getVoiceForLanguage('polish');
      expect(voice).toBe('Zosia');
    });

    it('should return correct voice for indonesian', () => {
      const voice = (generator as any).getVoiceForLanguage('indonesian');
      expect(voice).toBe('Damayanti');
    });

    it('should handle language codes (es, it, pt, pl, id)', () => {
      expect((generator as any).getVoiceForLanguage('es')).toBe('Eddy (Spanish (Mexico))');
      expect((generator as any).getVoiceForLanguage('it')).toBe('Alice');
      expect((generator as any).getVoiceForLanguage('pt')).toBe('Luciana');
      expect((generator as any).getVoiceForLanguage('pl')).toBe('Zosia');
      expect((generator as any).getVoiceForLanguage('id')).toBe('Damayanti');
    });

    it('should return correct voice for english', () => {
      const voice = (generator as any).getVoiceForLanguage('english');
      expect(voice).toBe('Alex');
    });

    it('should handle english language code (en)', () => {
      expect((generator as any).getVoiceForLanguage('en')).toBe('Alex');
    });

    it('should handle case-insensitive language names', () => {
      expect((generator as any).getVoiceForLanguage('SPANISH')).toBe('Eddy (Spanish (Mexico))');
      expect((generator as any).getVoiceForLanguage('Italian')).toBe('Alice');
      expect((generator as any).getVoiceForLanguage('ENGLISH')).toBe('Alex');
    });

    it('should default to english voice for unknown language', () => {
      const voice = (generator as any).getVoiceForLanguage('french');
      expect(voice).toBe('Alex');
    });

    it('should default to english voice for empty string', () => {
      const voice = (generator as any).getVoiceForLanguage('');
      expect(voice).toBe('Alex');
    });
  });
});
