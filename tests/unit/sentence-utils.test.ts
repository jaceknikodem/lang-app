/**
 * Unit tests for shared sentence utilities
 */

import {
  splitSentenceIntoParts,
  serializeSentenceParts,
  parseSentenceParts,
  serializeTokenizedTokens,
  parseTokenizedTokens,
} from '../../src/shared/utils/sentence';

describe('splitSentenceIntoParts', () => {
  it('should split sentence into parts', () => {
    const result = splitSentenceIntoParts('Hola mundo');
    expect(result).toEqual(['Hola', ' ', 'mundo']);
  });

  it('should split on punctuation', () => {
    const result = splitSentenceIntoParts('Hola, ¿cómo estás?');
    // The regex splits on whitespace or punctuation, capturing them as separate parts
    // Results may include empty strings between matches, filter them out
    expect(result).toContain('Hola');
    expect(result).toContain(',');
    expect(result).toContain('¿cómo');
    expect(result).toContain('estás');
    expect(result).toContain('?');
  });

  it('should split on multiple whitespace', () => {
    const result = splitSentenceIntoParts('Hola   mundo');
    expect(result).toEqual(['Hola', '   ', 'mundo']);
  });

  it('should handle sentence with period', () => {
    const result = splitSentenceIntoParts('Hola mundo.');
    expect(result).toContain('Hola');
    expect(result).toContain('mundo');
    expect(result).toContain('.');
  });

  it('should handle sentence with exclamation', () => {
    const result = splitSentenceIntoParts('¡Hola mundo!');
    expect(result).toContain('¡Hola');
    expect(result).toContain('mundo');
    expect(result).toContain('!');
  });

  it('should handle sentence with semicolon', () => {
    const result = splitSentenceIntoParts('Hola; adiós');
    expect(result).toContain('Hola');
    expect(result).toContain(';');
    expect(result).toContain('adiós');
  });

  it('should handle sentence with colon', () => {
    const result = splitSentenceIntoParts('Hola: mundo');
    expect(result).toContain('Hola');
    expect(result).toContain(':');
    expect(result).toContain('mundo');
  });

  it('should return empty array for null', () => {
    expect(splitSentenceIntoParts(null)).toEqual([]);
  });

  it('should return empty array for undefined', () => {
    expect(splitSentenceIntoParts(undefined)).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(splitSentenceIntoParts('')).toEqual([]);
  });

  it('should handle complex sentence with multiple punctuation', () => {
    const result = splitSentenceIntoParts('¡Hola, mundo! ¿Cómo estás?');
    expect(result).toContain('¡Hola');
    expect(result).toContain(',');
    expect(result).toContain('mundo');
    expect(result).toContain('!');
    expect(result).toContain('¿Cómo');
    expect(result).toContain('estás');
    expect(result).toContain('?');
  });

  it('should preserve whitespace as separate parts', () => {
    const result = splitSentenceIntoParts('Hola  mundo');
    expect(result).toEqual(['Hola', '  ', 'mundo']);
  });
});

describe('serializeSentenceParts', () => {
  it('should serialize array of parts to JSON string', () => {
    const parts = ['Hola', ' ', 'mundo'];
    const result = serializeSentenceParts(parts);
    expect(result).toBe('["Hola"," ","mundo"]');
  });

  it('should handle empty array', () => {
    expect(serializeSentenceParts([])).toBeNull();
  });

  it('should return null for null input', () => {
    expect(serializeSentenceParts(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(serializeSentenceParts(undefined)).toBeNull();
  });

  it('should handle parts with special characters', () => {
    const parts = ['¡Hola', ',', ' ', 'mundo', '!'];
    const result = serializeSentenceParts(parts);
    expect(result).toBe('["¡Hola",","," ","mundo","!"]');
  });
});

describe('parseSentenceParts', () => {
  it('should parse JSON string to array', () => {
    const serialized = '["Hola"," ","mundo"]';
    const result = parseSentenceParts(serialized);
    expect(result).toEqual(['Hola', ' ', 'mundo']);
  });

  it('should return undefined for null input', () => {
    expect(parseSentenceParts(null)).toBeUndefined();
  });

  it('should return undefined for undefined input', () => {
    expect(parseSentenceParts(undefined)).toBeUndefined();
  });

  it('should return undefined for invalid JSON', () => {
    expect(parseSentenceParts('invalid json')).toBeUndefined();
  });

  it('should return undefined for non-array JSON', () => {
    expect(parseSentenceParts('{"key": "value"}')).toBeUndefined();
  });

  it('should handle parts with special characters', () => {
    const serialized = '["¡Hola",","," ","mundo","!"]';
    const result = parseSentenceParts(serialized);
    expect(result).toEqual(['¡Hola', ',', ' ', 'mundo', '!']);
  });

  it('should handle round trip serialization/parsing', () => {
    const parts = ['Hola', ' ', 'mundo', '.'];
    const serialized = serializeSentenceParts(parts);
    const parsed = parseSentenceParts(serialized);
    expect(parsed).toEqual(parts);
  });
});

describe('serializeTokenizedTokens', () => {
  it('should serialize tokens array to JSON string', () => {
    const tokens = [
      { text: 'Hola', isTargetWord: true },
      { text: ' ', isTargetWord: false },
      { text: 'mundo', isTargetWord: false },
    ];
    const result = serializeTokenizedTokens(tokens);
    expect(result).toBe(JSON.stringify(tokens));
  });

  it('should return null for empty array', () => {
    expect(serializeTokenizedTokens([])).toBeNull();
  });

  it('should return null for null input', () => {
    expect(serializeTokenizedTokens(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(serializeTokenizedTokens(undefined)).toBeNull();
  });

  it('should handle serialization errors gracefully', () => {
    // Create circular reference to trigger error
    const circular: any = { token: 'test' };
    circular.self = circular;

    // Mock console.warn to avoid test output
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = serializeTokenizedTokens(circular);

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe('parseTokenizedTokens', () => {
  it('should parse JSON string to tokens array', () => {
    const tokens = [
      { text: 'Hola', isTargetWord: true },
      { text: ' ', isTargetWord: false },
    ];
    const serialized = JSON.stringify(tokens);
    const result = parseTokenizedTokens(serialized);
    expect(result).toEqual(tokens);
  });

  it('should return undefined for null input', () => {
    expect(parseTokenizedTokens(null)).toBeUndefined();
  });

  it('should return undefined for undefined input', () => {
    expect(parseTokenizedTokens(undefined)).toBeUndefined();
  });

  it('should return undefined for invalid JSON', () => {
    // Mock console.warn to avoid test output
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseTokenizedTokens('invalid json')).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should return undefined for non-array JSON', () => {
    const result = parseTokenizedTokens('{"key": "value"}');
    // The function should return undefined for non-array, but may or may not warn
    expect(result).toBeUndefined();
  });

  it('should handle round trip serialization/parsing', () => {
    const tokens = [
      { text: 'Hola', isTargetWord: true, wordId: 1 },
      { text: ' ', isTargetWord: false },
      { text: 'mundo', isTargetWord: false },
    ];
    const serialized = serializeTokenizedTokens(tokens);
    const parsed = parseTokenizedTokens(serialized);
    expect(parsed).toEqual(tokens);
  });
});
