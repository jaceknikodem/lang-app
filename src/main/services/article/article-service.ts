/**
 * Fetches a web article and extracts its readable text.
 *
 * Strategy: try a plain HTTP fetch first (fast, reliable, works for
 * server-rendered pages and avoids the client-side navigation blocks that
 * hidden BrowserWindows hit on some sites). If that yields too little text -
 * typical of JavaScript-rendered SPAs - fall back to loading the page in a
 * hidden, sandboxed BrowserWindow and reading the live DOM.
 */

import { BrowserWindow } from 'electron';
import axios from 'axios';
import { getLogger } from '../../utils/logger.js';

/** Cap the text we hand to the LLM so prompts stay bounded. */
const MAX_TEXT_LENGTH = 8000;
/** Below this, assume the HTTP fetch missed JS-rendered content. */
const MIN_USABLE_LENGTH = 600;
const LOAD_TIMEOUT_MS = 20000;

// A desktop browser UA; some sites reject the default Electron/axios agents.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface ArticleContent {
  title: string;
  text: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Strip an HTML document down to visible text. */
function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';

  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|template|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, text };
}

async function fetchViaHttp(url: string): Promise<ArticleContent> {
  const response = await axios.get<string>(url, {
    timeout: LOAD_TIMEOUT_MS,
    responseType: 'text',
    maxRedirects: 5,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': '*',
    },
  });
  return htmlToText(String(response.data));
}

// Runs in the page context to pull visible article text out of the rendered DOM.
const EXTRACT_SCRIPT = `(() => {
  const clone = document.body.cloneNode(true);
  clone
    .querySelectorAll('script, style, noscript, nav, header, footer, aside, form, iframe')
    .forEach((el) => el.remove());
  const text = (clone.innerText || '')
    .replace(/[ \\t]+/g, ' ')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim();
  return { title: document.title || '', text };
})()`;

async function fetchViaBrowser(url: string): Promise<ArticleContent> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setUserAgent(USER_AGENT);

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Timed out loading article')), LOAD_TIMEOUT_MS)
  );

  try {
    await Promise.race([win.loadURL(url), timeout]);
    return (await Promise.race([
      win.webContents.executeJavaScript(EXTRACT_SCRIPT, true),
      timeout,
    ])) as ArticleContent;
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

export async function extractArticleText(url: string): Promise<ArticleContent> {
  const logger = getLogger();

  let result: ArticleContent = { title: '', text: '' };
  try {
    result = await fetchViaHttp(url);
    logger.info({ url, via: 'http', textLength: result.text.length }, 'Fetched article');
  } catch (error) {
    logger.warn({ url, error }, 'HTTP article fetch failed, will try browser');
  }

  // Thin result usually means a JS-rendered page; render it in a real browser.
  if (result.text.length < MIN_USABLE_LENGTH) {
    try {
      const rendered = await fetchViaBrowser(url);
      if (rendered.text.length > result.text.length) {
        result = rendered;
        logger.info({ url, via: 'browser', textLength: result.text.length }, 'Rendered article');
      }
    } catch (error) {
      logger.warn({ url, error }, 'Browser article fetch failed');
    }
  }

  const text = result.text.slice(0, MAX_TEXT_LENGTH);
  if (!text.trim()) {
    throw new Error('Could not read any text from that URL (it may require login or block access)');
  }
  return { title: result.title, text };
}
