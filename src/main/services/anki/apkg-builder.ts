/**
 * Minimal Anki `.apkg` builder.
 *
 * Produces the legacy Anki package format (schema 11): a zip containing a
 * `collection.anki2` SQLite database, a `media` JSON manifest, and the media
 * blobs stored under numeric filenames. This format is importable by both Anki
 * desktop and AnkiDroid/AnkiMobile.
 *
 * The structure mirrors the output of genanki (the reference Python library) so
 * that the generated decks behave identically on import.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import JSZip from 'jszip';

const FIELD_SEPARATOR = '';

/** A single note (one card, single-template model). */
export interface AnkiNote {
  /** Field values, in model field order. */
  fields: string[];
  /**
   * Stable identifier used to derive the note GUID so that re-importing an
   * updated deck overwrites the existing note instead of duplicating it.
   */
  guidSeed: string;
}

/** A media file to bundle into the package. */
export interface AnkiMedia {
  /** Filename referenced from card fields, e.g. via `[sound:name.mp3]`. */
  filename: string;
  data: Buffer;
}

export interface ApkgModel {
  id: number;
  name: string;
  fields: string[];
  css: string;
  /** Question template (front). */
  qfmt: string;
  /** Answer template (back). */
  afmt: string;
  /** Field ordinals whose presence is required for the card to be generated. */
  requiredFieldOrds: number[];
}

export interface BuildApkgOptions {
  deckId: number;
  deckName: string;
  model: ApkgModel;
  notes: AnkiNote[];
  media: AnkiMedia[];
}

const ANKI_SCHEMA = `
CREATE TABLE col (
  id integer primary key, crt integer not null, mod integer not null,
  scm integer not null, ver integer not null, dty integer not null,
  usn integer not null, ls integer not null, conf text not null,
  models text not null, decks text not null, dconf text not null, tags text not null
);
CREATE TABLE notes (
  id integer primary key, guid text not null, mid integer not null,
  mod integer not null, usn integer not null, tags text not null,
  flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null
);
CREATE TABLE cards (
  id integer primary key, nid integer not null, did integer not null,
  ord integer not null, mod integer not null, usn integer not null,
  type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null,
  lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null
);
CREATE TABLE revlog (
  id integer primary key, cid integer not null, usn integer not null,
  ease integer not null, ivl integer not null, lastIvl integer not null,
  factor integer not null, time integer not null, type integer not null
);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

const BASE91_TABLE =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';

/** Derive a deterministic Anki-style GUID from a stable seed. */
function guidFromSeed(seed: string): string {
  // 64-bit value from a hash, encoded in base91 like genanki's guid scheme.
  const hash = createHash('sha256').update(seed).digest();
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value = (value << 8n) | BigInt(hash[i]);
  }
  if (value === 0n) {
    return BASE91_TABLE[0];
  }
  const chars: string[] = [];
  const base = BigInt(BASE91_TABLE.length);
  while (value > 0n) {
    chars.push(BASE91_TABLE[Number(value % base)]);
    value /= base;
  }
  return chars.reverse().join('');
}

/** Strip HTML tags and sound/image markup to produce the sort/checksum field. */
function stripFormatting(field: string): string {
  return field
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Anki field checksum: first 8 hex digits of the SHA1 of the first field. */
function fieldChecksum(firstField: string): number {
  const digest = createHash('sha1').update(stripFormatting(firstField)).digest('hex');
  return parseInt(digest.slice(0, 8), 16);
}

function buildModelsJson(model: ApkgModel): string {
  const models = {
    [model.id]: {
      id: String(model.id),
      name: model.name,
      type: 0,
      mod: 0,
      usn: 0,
      sortf: 0,
      did: null,
      tmpls: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: model.qfmt,
          afmt: model.afmt,
          bqfmt: '',
          bafmt: '',
          did: null,
        },
      ],
      flds: model.fields.map((name, ord) => ({
        name,
        ord,
        sticky: false,
        rtl: false,
        font: 'Arial',
        size: 20,
        media: [],
      })),
      css: model.css,
      latexPre:
        '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n' +
        '\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n' +
        '\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
      latexPost: '\\end{document}',
      req: [[0, 'any', model.requiredFieldOrds]],
      tags: [],
      vers: [],
    },
  };
  return JSON.stringify(models);
}

function buildDecksJson(deckId: number, deckName: string): string {
  const deckDefaults = {
    collapsed: false,
    conf: 1,
    desc: '',
    dyn: 0,
    extendNew: 0,
    extendRev: 50,
    lrnToday: [0, 0],
    newToday: [0, 0],
    revToday: [0, 0],
    timeToday: [0, 0],
    usn: -1,
  };
  const decks = {
    '1': { ...deckDefaults, id: 1, mod: 0, name: 'Default', usn: 0 },
    [deckId]: { ...deckDefaults, id: deckId, mod: 0, name: deckName },
  };
  return JSON.stringify(decks);
}

function buildConfJson(modelId: number): string {
  return JSON.stringify({
    nextPos: 1,
    estTimes: true,
    activeDecks: [1],
    sortType: 'noteFld',
    timeLim: 0,
    sortBackwards: false,
    addToCur: true,
    curDeck: 1,
    newBury: true,
    newSpread: 0,
    dueCounts: true,
    curModel: String(modelId),
    collapseTime: 1200,
  });
}

const DCONF_JSON = JSON.stringify({
  '1': {
    id: 1,
    mod: 0,
    name: 'Default',
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: {
      bury: true,
      delays: [1, 10],
      initialFactor: 2500,
      ints: [1, 4, 7],
      order: 1,
      perDay: 20,
      separate: true,
    },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    dyn: false,
  },
});

/** Build a `.apkg` file as a Buffer. */
export async function buildApkg(options: BuildApkgOptions): Promise<Buffer> {
  const { deckId, deckName, model, notes, media } = options;

  const workDir = mkdtempSync(join(tmpdir(), 'kotoba-apkg-'));
  const dbPath = join(workDir, 'collection.anki2');
  const db = new Database(dbPath);

  try {
    db.pragma('journal_mode = DELETE');
    db.exec(ANKI_SCHEMA);

    const nowSec = Math.floor(Date.now() / 1000);
    const nowMs = Date.now();

    db.prepare(
      `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
       VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')`
    ).run(
      nowSec,
      nowMs,
      nowMs,
      buildConfJson(model.id),
      buildModelsJson(model),
      buildDecksJson(deckId, deckName),
      DCONF_JSON
    );

    const insertNote = db.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (?, ?, ?, ?, -1, '', ?, ?, ?, 0, '')`
    );
    const insertCard = db.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')`
    );

    // Allocate unique, monotonically increasing ids for notes and cards.
    let nextId = nowMs;
    const insertAll = db.transaction(() => {
      notes.forEach((note, index) => {
        const noteId = nextId++;
        const cardId = nextId++;
        const flds = note.fields.join(FIELD_SEPARATOR);
        const sfld = stripFormatting(note.fields[0] ?? '');
        insertNote.run(
          noteId,
          guidFromSeed(note.guidSeed),
          model.id,
          nowSec,
          flds,
          sfld,
          fieldChecksum(note.fields[0] ?? '')
        );
        // `due` orders new cards; keep the source order stable.
        insertCard.run(cardId, noteId, deckId, nowSec, index + 1);
      });
    });
    insertAll();
    db.close();

    const zip = new JSZip();
    zip.file('collection.anki2', readFileSync(dbPath));

    const mediaManifest: Record<string, string> = {};
    media.forEach((file, index) => {
      mediaManifest[String(index)] = file.filename;
      zip.file(String(index), file.data);
    });
    zip.file('media', JSON.stringify(mediaManifest));

    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } finally {
    if (db.open) {
      db.close();
    }
    rmSync(workDir, { recursive: true, force: true });
  }
}
