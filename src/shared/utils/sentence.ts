/**
 * Shared helpers for working with sentences.
 */

const SPLIT_REGEX = /(\s+|[.,!?;:])/;

/**
 * Split a sentence into its component parts (words, whitespace, punctuation).
 * Mirrors the behaviour used by the renderer so stored data stays consistent.
 */
export function splitSentenceIntoParts(sentence: string | null | undefined): string[] {
  if (!sentence) {
    return [];
  }

  return sentence.split(SPLIT_REGEX);
}

/**
 * Serialize sentence parts for storage.
 */
export function serializeSentenceParts(parts: string[] | null | undefined): string | null {
  if (!parts || parts.length === 0) {
    return null;
  }

  return JSON.stringify(parts);
}

/**
 * Parse stored sentence parts JSON.
 */
export function parseSentenceParts(serialized: string | null | undefined): string[] | undefined {
  if (!serialized) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch (error) {
    console.warn('Failed to parse sentence parts JSON:', error);
    return undefined;
  }
}

/**
 * Serialize tokenized tokens for storage in database.
 */
export function serializeTokenizedTokens(tokens: any[] | null | undefined): string | null {
  if (!tokens || tokens.length === 0) {
    return null;
  }

  try {
    return JSON.stringify(tokens);
  } catch (error) {
    console.warn('Failed to serialize tokenized tokens:', error);
    return null;
  }
}

/**
 * Parse stored tokenized tokens JSON.
 */
export function parseTokenizedTokens(serialized: string | null | undefined): any[] | undefined {
  if (!serialized) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch (error) {
    console.warn('Failed to parse tokenized tokens JSON:', error);
    return undefined;
  }
}

