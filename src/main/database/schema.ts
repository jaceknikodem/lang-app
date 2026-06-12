import Database from 'better-sqlite3';

function addColumnIfNotExists(
  db: Database.Database,
  table: string,
  column: string,
  type: string
): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (e) {
    if (!(e instanceof Error && e.message.includes('duplicate column'))) throw e;
  }
}

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      language TEXT NOT NULL,
      translation TEXT NOT NULL,
      strength INTEGER DEFAULT 0,
      known BOOLEAN DEFAULT FALSE,
      ignored BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_studied DATETIME,
      interval_days INTEGER DEFAULT 1,
      ease_factor REAL DEFAULT 2.5,
      last_review DATETIME,
      next_due DATETIME,
      fsrs_difficulty REAL DEFAULT 5.0,
      fsrs_stability REAL DEFAULT 1.0,
      fsrs_lapses INTEGER DEFAULT 0,
      fsrs_last_rating INTEGER,
      processing_status TEXT DEFAULT 'ready',
      sentence_count INTEGER DEFAULT 0,
      grammar_explanation_count INTEGER DEFAULT 0,
      topic TEXT,
      added_via TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      language TEXT NOT NULL,
      sentence TEXT NOT NULL,
      translation TEXT NOT NULL,
      audio_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_shown DATETIME,
      context_before TEXT,
      context_after TEXT,
      context_before_translation TEXT,
      context_after_translation TEXT,
      sentence_parts TEXT,
      sentence_generation_model TEXT,
      audio_generation_service TEXT,
      audio_generation_model TEXT,
      audio_generation_voice_id TEXT,
      sentence_tokens TEXT,
      play_count INTEGER DEFAULT 0,
      ignored BOOLEAN DEFAULT FALSE,
      before_sentence_audio_path TEXT,
      after_sentence_audio_path TEXT,
      pronunciation TEXT,
      context_before_pronunciation TEXT,
      context_after_pronunciation TEXT
    )
  `);

  addColumnIfNotExists(db, 'sentences', 'before_sentence_audio_path', 'TEXT');
  addColumnIfNotExists(db, 'sentences', 'after_sentence_audio_path', 'TEXT');
  addColumnIfNotExists(db, 'sentences', 'pronunciation', 'TEXT');
  addColumnIfNotExists(db, 'sentences', 'context_before_pronunciation', 'TEXT');
  addColumnIfNotExists(db, 'sentences', 'context_after_pronunciation', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      words_studied INTEGER DEFAULT 0,
      when_studied DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('current_language', 'spanish')`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dict (
      word TEXT,
      pos TEXT,
      glosses TEXT,
      lang TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS word_generation_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id INTEGER NOT NULL UNIQUE REFERENCES words(id) ON DELETE CASCADE,
      language TEXT NOT NULL,
      topic TEXT,
      desired_sentence_count INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sentence_words (
      sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
      word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      PRIMARY KEY (sentence_id, word_id)
    )
  `);

  // Stores lemmas for all tokens in a sentence, even for words not yet in the words table,
  // so new words can be retroactively linked to existing sentences on insertion.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sentence_lemmas (
      sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
      lemma TEXT NOT NULL,
      PRIMARY KEY (sentence_id, lemma)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dialogue_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
      variant_sentence TEXT NOT NULL,
      variant_translation TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      continuation_text TEXT,
      continuation_translation TEXT,
      continuation_audio TEXT,
      variant_pronunciation TEXT
    )
  `);

  addColumnIfNotExists(db, 'dialogue_variants', 'variant_pronunciation', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pronunciation_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
      similarity_score REAL NOT NULL,
      expected_text TEXT NOT NULL,
      transcribed_text TEXT NOT NULL,
      audio_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS grammar_explanations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
      explanation TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS srs_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES learning_sessions(id),
      recall_rating INTEGER,  -- 0=failed, 1=hard, 2=good, 3=easy
      strength_delta INTEGER,  -- change in strength
      language TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,  -- 'learning', 'quiz', 'dialog', 'flow'
      language TEXT NOT NULL,
      started_at DATETIME NOT NULL,
      ended_at DATETIME,
      duration_seconds INTEGER,
      word_count INTEGER DEFAULT 0,
      sentence_count INTEGER DEFAULT 0,
      audio_played_count INTEGER DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audio_playback_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES learning_sessions(id),
      sentence_id INTEGER REFERENCES sentences(id) ON DELETE SET NULL,
      audio_path TEXT NOT NULL,
      language TEXT NOT NULL,
      mode TEXT NOT NULL,
      playback_speed REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dialog_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES learning_sessions(id),
      correction_text TEXT NOT NULL,
      language TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS neglected_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      language TEXT NOT NULL,
      topic TEXT,
      translation TEXT,
      session_id INTEGER REFERENCES learning_sessions(id),
      ignored_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      frequency_position INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dictionary_hover_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      language TEXT NOT NULL,
      sentence_id INTEGER REFERENCES sentences(id) ON DELETE SET NULL,
      session_id INTEGER REFERENCES learning_sessions(id),
      hover_duration_ms INTEGER NOT NULL,
      dictionary_key TEXT,
      found_in_dict BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS read_aloud_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_text TEXT NOT NULL,
      language TEXT NOT NULL,
      audio_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(raw_text, language)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_words_strength ON words(strength)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_words_last_studied ON words(last_studied)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_words_known_ignored ON words(known, ignored)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_words_next_due ON words(next_due)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_words_srs_review ON words(next_due, strength)`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_words_fsrs_state ON words(fsrs_stability, fsrs_difficulty)`
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_words_language_topic ON words(language, topic)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sentences_word_id ON sentences(word_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_progress_when_studied ON progress(when_studied)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_word_lang ON dict(word, lang)`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_word_generation_queue_status ON word_generation_queue(status, updated_at)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sentence_words_sentence_id ON sentence_words(sentence_id)`
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sentence_words_word_id ON sentence_words(word_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sentence_lemmas_lemma ON sentence_lemmas(lemma)`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sentence_lemmas_sentence_id ON sentence_lemmas(sentence_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dialogue_variants_sentence_id ON dialogue_variants(sentence_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dialogue_variants_created_at ON dialogue_variants(created_at)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_pronunciation_attempts_sentence_id ON pronunciation_attempts(sentence_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_pronunciation_attempts_created_at ON pronunciation_attempts(created_at)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_grammar_explanations_word_id ON grammar_explanations(word_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_grammar_explanations_sentence_id ON grammar_explanations(sentence_id)`
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_srs_adjustments_word_id ON srs_adjustments(word_id)`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_srs_adjustments_session_id ON srs_adjustments(session_id)`
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_srs_adjustments_language ON srs_adjustments(language)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_learning_sessions_mode ON learning_sessions(mode)`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_learning_sessions_started_at ON learning_sessions(started_at)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_audio_playback_events_sentence_id ON audio_playback_events(sentence_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_audio_playback_events_session_id ON audio_playback_events(session_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_neglected_words_word_lang ON neglected_words(word, language)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dialog_corrections_sentence_id ON dialog_corrections(sentence_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dialog_corrections_session_id ON dialog_corrections(session_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dialog_corrections_language ON dialog_corrections(language)`
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_neglected_words_topic ON neglected_words(topic)`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_neglected_words_session_id ON neglected_words(session_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dictionary_hover_events_word_lang ON dictionary_hover_events(word, language)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dictionary_hover_events_sentence_id ON dictionary_hover_events(sentence_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dictionary_hover_events_session_id ON dictionary_hover_events(session_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_dictionary_hover_events_created_at ON dictionary_hover_events(created_at)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_read_aloud_cache_text_lang ON read_aloud_cache(raw_text, language)`
  );
}
