/**
 * Exports a language's sentences (with audio) to an Anki `.apkg` deck.
 */

import { promises as fsPromises } from 'fs';
import { extname } from 'path';
import { createHash } from 'crypto';
import { SQLiteDatabaseLayer } from '../../database/database-layer.js';
import { AudioService } from '../../audio/audio-service.js';
import { getLogger } from '../../utils/logger.js';
import { AnkiExportRow } from '../../../shared/types/core.js';
import { buildApkg, AnkiMedia, AnkiNote, ApkgModel, CardScheduling } from './apkg-builder.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EASE_FACTOR = 1300; // Anki's floor for the ease factor (×1000).

/**
 * Map a word's internal SRS state onto Anki review scheduling. Returns
 * `undefined` for words that have never been studied (imported as new cards).
 */
function schedulingFromRow(row: AnkiExportRow): CardScheduling | undefined {
  if (!row.lastReview || !row.nextDue) {
    return undefined;
  }

  const nextDueMs = Date.parse(row.nextDue);
  if (Number.isNaN(nextDueMs)) {
    return undefined;
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dueDay = Math.round((nextDueMs - startOfToday.getTime()) / DAY_MS);

  const ivl = Math.max(1, Math.round(row.intervalDays ?? 1));
  const factor = Math.max(MIN_EASE_FACTOR, Math.round((row.easeFactor ?? 2.5) * 1000));
  const lapses = Math.max(0, row.lapses ?? 0);
  // `reps` isn't tracked per word; approximate so stats look sane.
  const reps = lapses + 1;

  return { ivl, factor, reps, lapses, dueDay };
}

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
.reading { color: #6b6b6b; font-size: 18px; margin-top: 8px; }
.translation { margin-top: 8px; }
.word { color: #888; font-size: 15px; margin-top: 14px; }
hr#answer { margin: 18px 0; }
`;

/** HTML-escape a field value so it renders literally inside templates. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  language: string
): Promise<AnkiExportResult> {
  const logger = getLogger();
  const rows = await databaseLayer.getSentencesForExport(language);

  const deckName = `Kotoba::${capitalize(language)}`;
  const model: ApkgModel = {
    id: MODEL_ID,
    name: 'Kotoba Sentence',
    fields: ['Sentence', 'Translation', 'Reading', 'Audio', 'Word'],
    css: MODEL_CSS,
    qfmt:
      '{{Audio}}<div class="sentence">{{Sentence}}</div>' +
      '{{#Reading}}<div class="reading">{{Reading}}</div>{{/Reading}}' +
      '{{#Word}}<div class="word">{{Word}}</div>{{/Word}}',
    afmt: '{{FrontSide}}\n<hr id=answer>\n<div class="translation">{{Translation}}</div>',
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

    notes.push({
      guidSeed: `kotoba:${language}:sentence:${row.sentenceId}`,
      fields: [
        escapeHtml(row.sentence),
        escapeHtml(row.translation),
        escapeHtml(row.pronunciation ?? ''),
        audioField,
        escapeHtml(row.word),
      ],
      scheduling: schedulingFromRow(row),
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
