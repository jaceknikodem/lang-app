/**
 * Exports a language's sentences (with audio) to an Anki `.apkg` deck.
 */

import { promises as fsPromises } from 'fs';
import { extname } from 'path';
import { createHash } from 'crypto';
import { SQLiteDatabaseLayer } from '../../database/database-layer.js';
import { AudioService } from '../../audio/audio-service.js';
import { getLogger } from '../../utils/logger.js';
import { buildApkg, AnkiMedia, AnkiNote, ApkgModel } from './apkg-builder.js';
import { getTokensWithBasicForm } from '../../lemmatization/japanese-tokenizer.js';

export interface AnkiExportResult {
  data: Buffer;
  cardCount: number;
  mediaCount: number;
  deckName: string;
}

const MODEL_ID = 1758600000001; // Fixed id so re-imports reuse the same note type.

const MODEL_CSS = `
.card {
  font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
  font-size: 22px;
  text-align: center;
  color: #1c1c1e;
  background-color: #ffffff;
}
.sentence { font-size: 26px; margin: 12px 0; }
.sentence .kw { color: #2563eb; font-weight: 700; }
.reading { color: #6b6b6b; font-size: 18px; margin-top: 8px; }
.translation { margin-top: 8px; }
.word { color: #888; font-size: 16px; margin-top: 12px; }
hr#answer { margin: 18px 0; }
`;

/** HTML-escape a field value so it renders literally inside templates. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escape the sentence and wrap the key word in a highlight span.
 * For Japanese, uses kuromoji basic_form so conjugated verbs are matched.
 * Falls back to exact string match for other languages.
 */
async function highlightWordInSentence(
  sentence: string,
  word: string,
  language: string
): Promise<string> {
  if (language === 'japanese') {
    try {
      const tokens = await getTokensWithBasicForm(sentence);
      return tokens
        .map((t) => {
          const escaped = escapeHtml(t.surface);
          if (t.basicForm && (t.surface === word || t.basicForm === word)) {
            return `<span class="kw">${escaped}</span>`;
          }
          return escaped;
        })
        .join('');
    } catch {
      // fall through to simple match below
    }
  }

  const escaped = escapeHtml(sentence);
  const escapedWord = escapeHtml(word);
  if (!escapedWord || !escaped.includes(escapedWord)) {
    return escaped;
  }
  return escaped.split(escapedWord).join(`<span class="kw">${escapedWord}</span>`);
}

function capitalize(language: string): string {
  return language.charAt(0).toUpperCase() + language.slice(1);
}

/** Stable positive 31-bit id derived from a string, for deck identifiers. */
function stableId(seed: string): number {
  const digest = createHash('sha256').update(seed).digest();
  return digest.readUInt32BE(0) & 0x7fffffff;
}

export async function exportLanguageToApkg(
  databaseLayer: SQLiteDatabaseLayer,
  language: string,
  theme = 'general'
): Promise<AnkiExportResult> {
  const logger = getLogger();
  const rows = await databaseLayer.getSentencesForExport(language);

  const deckName =
    theme && theme !== 'general'
      ? `Kotoba::${capitalize(language)}::${capitalize(theme)}`
      : `Kotoba::${capitalize(language)}`;
  const model: ApkgModel = {
    id: MODEL_ID,
    name: 'Kotoba Sentence',
    fields: ['Sentence', 'Translation', 'Reading', 'Audio', 'Word'],
    css: MODEL_CSS,
    qfmt:
      '{{Audio}}<div class="sentence">{{Sentence}}</div>' +
      '{{#Reading}}<div class="reading">{{Reading}}</div>{{/Reading}}',
    afmt:
      '{{FrontSide}}\n<hr id=answer>\n<div class="translation">{{Translation}}</div>' +
      '{{#Word}}<div class="word">{{Word}}</div>{{/Word}}',
    requiredFieldOrds: [0],
  };

  const notes: AnkiNote[] = [];
  const media: AnkiMedia[] = [];

  for (const row of rows) {
    // Skip sentences without playable audio.
    if (!row.audioPath) {
      continue;
    }

    let audioField = '';
    try {
      const absolutePath = AudioService.resolveAudioPath(row.audioPath);
      const data = await fsPromises.readFile(absolutePath);
      const ext = extname(row.audioPath) || '.mp3';
      const filename = `kotoba_${language}_${row.sentenceId}${ext}`;
      media.push({ filename, data });
      audioField = `[sound:${filename}]`;
    } catch (error) {
      // Audio path recorded but file missing: skip this sentence.
      logger.warn(
        { error, audioPath: row.audioPath, sentenceId: row.sentenceId },
        'Skipping sentence with missing audio file during Anki export'
      );
      continue;
    }

    // No scheduling: Anki owns its review state. Seeding it from the app would
    // overwrite Anki's progress on every re-import.
    notes.push({
      guidSeed: `kotoba:${language}:sentence:${row.sentenceId}`,
      fields: [
        await highlightWordInSentence(row.sentence, row.word, language),
        escapeHtml(row.translation),
        escapeHtml(row.pronunciation ?? ''),
        audioField,
        escapeHtml(`${row.word} — ${row.wordTranslation}`),
      ],
    });
  }

  // Shuffle so sentences for the same word aren't reviewed back-to-back.
  // (New-card order follows the note order via the card `due` field.)
  for (let i = notes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [notes[i], notes[j]] = [notes[j], notes[i]];
  }

  const data = await buildApkg({
    deckId: stableId(deckName),
    deckName,
    model,
    notes,
    media,
  });

  logger.info(
    { language, cardCount: notes.length, mediaCount: media.length },
    'Built Anki export package'
  );

  return { data, cardCount: notes.length, mediaCount: media.length, deckName };
}
