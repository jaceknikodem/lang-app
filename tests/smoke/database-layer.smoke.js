/**
 * Runtime smoke test for the SQLite database layer.
 *
 * Exercises every repository behind SQLiteDatabaseLayer against an in-memory
 * database, including the two cross-repository seams (sentence -> word and
 * word -> srs) that a plain typecheck cannot prove are wired up.
 *
 * This lives outside the jest suite on purpose: better-sqlite3 is a native
 * module built against Electron's ABI, so it cannot be loaded by jest running
 * on system Node. Run it with:
 *
 *   npm run build:main && npm run test:db-smoke
 */

const { SQLiteDatabaseLayer } = require('../../dist/main/main/database/database-layer.js');

(async () => {
  const db = new SQLiteDatabaseLayer({ databasePath: ':memory:', enableWAL: false, timeout: 1000 });
  let pass = 0,
    fail = 0;
  // Evaluate eagerly: later steps (notably resetLanguageProgress) mutate the
  // very rows these assertions look at.
  const ok = async (name, fn) => {
    try {
      const r = await fn();
      if (r === false) {
        console.log('  FAIL', name);
        fail++;
      } else {
        pass++;
      }
    } catch (e) {
      console.log('  ERROR', name, '->', e.message);
      fail++;
    }
  };

  await db.initialize();

  // --- words
  const wordId = await db.insertWord({
    word: 'ねこ',
    language: 'ja',
    translation: 'cat',
    strength: 10,
  });
  await ok('insertWord returns id', () => wordId > 0);
  await ok('getWordById round-trips', async () => (await db.getWordById(wordId)).word === 'ねこ');
  await ok('getAllWords', async () => (await db.getAllWords('ja')).length === 1);
  await ok('checkWordsExist', async () => (await db.checkWordsExist('ja', ['ねこ'])).has('ねこ'));

  // --- sentences (crosses sentence -> word repository seam)
  const sId = await db.insertSentence(
    wordId,
    'ねこがいる',
    'There is a cat',
    'ja/word_1/sentence_1.mp3'
  );
  await ok('insertSentence returns id', () => sId > 0);
  await ok(
    'getSentenceById',
    async () => (await db.getSentenceById(sId)).sentence === 'ねこがいる'
  );
  await ok('getSentencesByWord', async () => (await db.getSentencesByWord(wordId)).length === 1);

  // --- audio repository
  await db.updateSentenceAudioPath(sId, 'ja/word_1/sentence_1.mp3', 'voice-x');
  await db.updateBeforeSentenceAudioPath(sId, 'ja/word_1/before_1.mp3');
  await ok('audio path written', async () =>
    (await db.getSentenceById(sId)).audioPath.endsWith('sentence_1.mp3')
  );

  // --- dialogue repository + the de-N+1'd flow query
  const v1 = await db.insertDialogueVariant(sId, 'ねこだ', "It's a cat");
  await db.updateDialogueVariantContinuation(v1, 'そうだね', 'Right', 'ja/word_1/cont_1.mp3');
  await db.insertDialogueVariant(sId, 'ねこかな', 'A cat?');
  await ok('variant count', async () => (await db.getDialogueVariantCount(sId)) === 2);
  const flow = await db.getFlowSentences('ja');
  await ok('getFlowSentences returns the sentence', () => flow.length === 1);
  await ok('getFlowSentences groups variant audio', () => flow[0].continuationAudios.length === 1);
  await ok(
    'getFlowSentences english path derived',
    () => flow[0].englishAudioPath === 'ja/word_1/english_sentence_1.mp3'
  );

  // --- settings repository
  await db.setCurrentLanguage('ja');
  await ok('settings round-trip', async () => (await db.getCurrentLanguage()) === 'ja');

  // --- srs repository (crosses word -> srs seam via getWordsToStudy)
  await db.updateWordSRS(wordId, 50, 3, 2.5, new Date(Date.now() - 86400000));
  await ok('words due', async () => (await db.getWordsDueCount('ja')) === 1);
  await ok(
    'getWordsToStudy crosses word->srs',
    async () => (await db.getWordsToStudy(5, 'ja')).length >= 1
  );

  // --- generation queue
  await db.enqueueWordGeneration(wordId, 'ja');
  await ok(
    'queued job visible',
    async () => (await db.getNextWordGenerationJob()).wordId === wordId
  );
  await ok(
    'processing status set',
    async () => (await db.getWordProcessingInfo(wordId)).processingStatus === 'queued'
  );

  // --- stats / tracking / dictionary
  await ok(
    'getStudyStats',
    async () => typeof (await db.getStudyStats('ja')).totalWords === 'number'
  );
  await ok('getLanguageStats', async () => Array.isArray(await db.getLanguageStats()));
  await ok(
    'getStartupStats',
    async () => typeof (await db.getStartupStats('ja')).timesPlayed === 'number'
  );
  const sess = await db.createLearningSession({ mode: 'flow', language: 'ja' });
  await ok('learning session', async () => (await db.getLearningSession(sess)).mode === 'flow');
  await db.recordPronunciationAttempt(sId, 0.9, 'ねこがいる', 'ねこがいる');
  await ok(
    'pronunciation history',
    async () => (await db.getPronunciationHistory(sId)).length === 1
  );
  await ok(
    'zipf frequencies',
    async () => typeof (await db.getZipfFrequencies(['ねこ'], 'ja')) === 'object'
  );
  await ok('read-aloud cache', async () => {
    await db.insertReadAloudCache('hello', 'ja', 'p.mp3');
    return (await db.getReadAloudCache('hello', 'ja')).audioPath === 'p.mp3';
  });

  // --- maintenance
  await db.resetLanguageProgress('ja');
  await ok('reset clears due count', async () => (await db.getWordsDueCount('ja')) === 0);

  await db.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
