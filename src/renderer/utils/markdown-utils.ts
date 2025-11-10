/**
 * Markdown rendering utilities
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Convert markdown to HTML using marked library
 * Supports full markdown syntax including headers, lists, code blocks, etc.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return '';

  // Configure marked options for safe rendering
  marked.setOptions({
    breaks: true, // Convert \n to <br>
    gfm: true, // GitHub Flavored Markdown
  });

  try {
    // marked.parse() returns a string of HTML
    const html = marked.parse(markdown) as string;
    // Sanitize HTML to prevent XSS attacks
    return DOMPurify.sanitize(html);
  } catch (error) {
    console.error('Markdown parsing error:', error);
    // Fallback: return escaped text if parsing fails
    return markdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
