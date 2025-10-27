const transliterationMap: Record<string, string> = {
  '\u0105': 'a', // ą
  '\u0107': 'c', // ć
  '\u0119': 'e', // ę
  '\u0142': 'l', // ł
  '\u0144': 'n', // ń
  '\u00F3': 'o', // ó
  '\u015B': 's', // ś
  '\u017A': 'z', // ź
  '\u017C': 'z', // ż
  '\u00E1': 'a', // á
  '\u00E9': 'e', // é
  '\u00ED': 'i', // í
  '\u00F1': 'n', // ñ
  '\u00FA': 'u', // ú
  '\u00FC': 'u', // ü
  '\u00E0': 'a', // à
  '\u00E2': 'a', // â
  '\u00E3': 'a', // ã
  '\u00EA': 'e', // ê
  '\u00F4': 'o', // ô
  '\u00F5': 'o', // õ
  '\u00E6': 'ae', // æ
  '\u0153': 'oe', // œ
  '\u00E7': 'c', // ç
  '\u00E8': 'e', // è
  '\u00EB': 'e', // ë
  '\u00EE': 'i', // î
  '\u00EF': 'i', // ï
  '\u00F9': 'u', // ù
  '\u00FB': 'u', // û
  '\u00FF': 'y', // ÿ
  '\u00F8': 'o', // ø
  '\u0111': 'd', // đ
  '\u0127': 'h', // ħ
  '\u0131': 'i', // ı (dotless i)
  '\u014B': 'n', // ŋ
  '\u00F0': 'd', // ð
  '\u00FE': 'th', // þ
  '\u0192': 'f', // ƒ
  '\u00DF': 'ss' // ß
};

/**
 * Convert arbitrary text into a filesystem-safe, human recognizable filename.
 * - Lowercases everything
 * - Normalizes unicode accents to their ASCII equivalents
 * - Replaces whitespace with underscores
 * - Restricts to alphanumeric characters and underscores
 * @param text The raw input text
 * @param maxLength Optional maximum length for the sanitized filename (default 100)
 */
export function sanitizeFilename(text: string, maxLength = 100): string {
  if (!text) {
    return '';
  }

  const normalized = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  const asciiOnly = normalized.replace(/[^\x00-\x7F]/g, (char) => transliterationMap[char] || '');

  return asciiOnly
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, maxLength);
}
