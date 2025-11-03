/**
 * Unit tests for LLM utility functions
 */

import { cleanLLMResponse } from '../../src/main/llm/utils';

describe('cleanLLMResponse', () => {
  it('should handle clean JSON without any formatting', () => {
    const input = '[{"word": "hola", "translation": "hello"}]';
    expect(cleanLLMResponse(input)).toBe('[{"word": "hola", "translation": "hello"}]');
  });

  it('should remove markdown code blocks with json tag', () => {
    const input = '```json\n[{"word": "hola", "translation": "hello"}]\n```';
    expect(cleanLLMResponse(input)).toBe('[{"word": "hola", "translation": "hello"}]');
  });

  it('should remove markdown code blocks with json tag (case insensitive)', () => {
    const input = '```JSON\n[{"word": "hola", "translation": "hello"}]\n```';
    expect(cleanLLMResponse(input)).toBe('[{"word": "hola", "translation": "hello"}]');
  });

  it('should remove markdown code blocks without json tag', () => {
    const input = '```\n[{"word": "hola", "translation": "hello"}]\n```';
    expect(cleanLLMResponse(input)).toBe('[{"word": "hola", "translation": "hello"}]');
  });

  it('should handle code blocks with extra whitespace', () => {
    const input = '```json   \n[{"word": "hola"}]\n   ```';
    expect(cleanLLMResponse(input)).toBe('[{"word": "hola"}]');
  });

  it('should remove common LLM prefixes', () => {
    const inputs = [
      'Here\'s [{"word": "hola", "translation": "hello"}]',
      'Here is [{"word": "hola", "translation": "hello"}]',
      'The [{"word": "hola", "translation": "hello"}]',
      'Response: [{"word": "hola", "translation": "hello"}]',
      'JSON: [{"word": "hola", "translation": "hello"}]'
    ];

    inputs.forEach(input => {
      expect(cleanLLMResponse(input)).toBe('[{"word": "hola", "translation": "hello"}]');
    });
  });

  it('should remove prefixes with case insensitive matching', () => {
    const input = 'HERE\'S [{"word": "hola", "translation": "hello"}]';
    expect(cleanLLMResponse(input)).toBe('[{"word": "hola", "translation": "hello"}]');
  });

  it('should remove text before the first JSON bracket', () => {
    const input = 'Sure! Here is the response you requested: [{"word": "hola", "translation": "hello"}]';
    expect(cleanLLMResponse(input)).toBe('[{"word": "hola", "translation": "hello"}]');
  });

  it('should remove text after the last JSON bracket', () => {
    const input = '[{"word": "hola", "translation": "hello"}] I hope this helps!';
    expect(cleanLLMResponse(input)).toBe('[{"word": "hola", "translation": "hello"}]');
  });

  it('should handle both text before and after JSON', () => {
    const input = 'Here is the result: [{"word": "hola", "translation": "hello"}] Thanks!';
    expect(cleanLLMResponse(input)).toBe('[{"word": "hola", "translation": "hello"}]');
  });

  it('should handle objects with closing braces', () => {
    const input = 'Response: {"word": "hola", "translation": "hello"} Done!';
    expect(cleanLLMResponse(input)).toBe('{"word": "hola", "translation": "hello"}');
  });

  it('should trim whitespace at start and end', () => {
    const input = '   [{"word": "hola", "translation": "hello"}]   ';
    expect(cleanLLMResponse(input)).toBe('[{"word": "hola", "translation": "hello"}]');
  });

  it('should handle empty strings', () => {
    expect(cleanLLMResponse('')).toBe('');
  });

  it('should handle strings with only whitespace', () => {
    expect(cleanLLMResponse('   \n\t   ')).toBe('');
  });

  it('should handle complex nested JSON', () => {
    const input = '```json\n[{"word": "hola", "translation": "hello", "examples": [{"sentence": "test"}]}]\n```';
    const result = cleanLLMResponse(input);
    expect(result).toContain('"word": "hola"');
    expect(result).toContain('"examples"');
    expect(result.startsWith('[')).toBe(true);
    expect(result.endsWith(']')).toBe(true);
  });

  it('should handle multiple JSON objects in array', () => {
    const input = 'Here are the words: [{"word": "hola"}, {"word": "casa"}, {"word": "perro"}] Done!';
    expect(cleanLLMResponse(input)).toBe('[{"word": "hola"}, {"word": "casa"}, {"word": "perro"}]');
  });

  it('should handle text with both [ and { brackets correctly', () => {
    const input = 'Response: [{"word": "test"}] End';
    const result = cleanLLMResponse(input);
    expect(result).toBe('[{"word": "test"}]');
  });

  it('should preserve the JSON structure exactly', () => {
    const input = '[{"word": "hola", "translation": "hello", "frequency": 1}]';
    const result = cleanLLMResponse(input);
    expect(result).toBe('[{"word": "hola", "translation": "hello", "frequency": 1}]');
  });

  it('should handle markdown with multiple code blocks', () => {
    // Should only keep the first valid JSON block
    const input = '```json\n[{"word": "hola"}]\n```\n```json\n[{"word": "casa"}]\n```';
    const result = cleanLLMResponse(input);
    expect(result).toContain('"word": "hola"');
  });

  it('should handle response with explanatory text in middle', () => {
    const input = '[{"word": "hola"}]\nNote: This is a common word.\n[{"word": "casa"}]';
    // Should extract from first [ to last ]
    const result = cleanLLMResponse(input);
    expect(result).toContain('"word": "hola"');
    expect(result).toContain('"word": "casa"');
  });
});
