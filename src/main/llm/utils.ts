/**
 * Utility functions for LLM clients
 */

/**
 * Clean LLM response text by removing markdown formatting, prefixes, and extra text
 * @param rawResponse The raw response text from the LLM
 * @returns Cleaned response text containing only JSON
 */
export function cleanLLMResponse(rawResponse: string): string {
  let cleanResponse = rawResponse.trim();

  // Remove markdown code blocks if present
  cleanResponse = cleanResponse.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/i, '');

  // Remove common LLM prefixes
  cleanResponse = cleanResponse.replace(/^(Here's|Here is|The|Response:|JSON:)\s*/i, '');

  // Remove any text before the first [ or {
  const jsonStart = cleanResponse.search(/[\[{]/);
  if (jsonStart > 0) {
    cleanResponse = cleanResponse.substring(jsonStart);
  }

  // Remove any text after the last ] or }
  const jsonEnd = Math.max(
    cleanResponse.lastIndexOf(']'),
    cleanResponse.lastIndexOf('}')
  );
  if (jsonEnd >= 0 && jsonEnd < cleanResponse.length - 1) {
    cleanResponse = cleanResponse.substring(0, jsonEnd + 1);
  }

  return cleanResponse;
}

