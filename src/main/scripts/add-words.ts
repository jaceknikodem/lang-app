import { SQLiteDatabaseLayer } from '../database/database-layer.js';
import { ContentGenerator } from '../llm/content-generator.js';
import { AudioService } from '../audio/audio-service.js';
import { LLMFactory } from '../llm/llm-factory.js';
import { WordGenerationRunner } from '../jobs/word-generation-runner.js';
import { appConfig } from '../../shared/config/index.js';
import type { LLMProvider } from '../llm/llm-factory.js';
import os from 'os';
import { join } from 'path';

const DB_PATH = join(
  os.homedir(),
  'Library',
  'Application Support',
  'KotobaAI',
  'language_learning.db'
);
const POLL_INTERVAL_MS = 1000;

async function main() {
  const rawWords = process.argv[2];
  const topic = process.argv[3];

  if (!rawWords) {
    console.error('Usage: add-words "word1,word2,word3" [topic]');
    process.exit(1);
  }

  const words = rawWords
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

  if (words.length === 0) {
    console.error('No words provided.');
    process.exit(1);
  }

  const db = new SQLiteDatabaseLayer({ databasePath: DB_PATH, enableWAL: true, timeout: 5000 });
  await db.initialize();

  const storedProvider = await db.getSetting('llm_provider');
  const provider: LLMProvider =
    storedProvider === 'gemini' || storedProvider === 'ollama' || storedProvider === 'mlx-lm'
      ? (storedProvider as LLMProvider)
      : 'ollama';

  let geminiApiKey = '';
  let mlxLmBaseUrl: string | undefined;
  if (provider === 'gemini') {
    geminiApiKey = (await db.getSetting('gemini_api_key')) || '';
  } else if (provider === 'mlx-lm') {
    mlxLmBaseUrl = (await db.getSetting('mlx_lm_base_url')) || undefined;
  }

  const llmClient =
    provider === 'gemini'
      ? LLMFactory.createGeminiClient(geminiApiKey)
      : provider === 'mlx-lm'
        ? LLMFactory.createMlxLmClient(mlxLmBaseUrl ? { baseUrl: mlxLmBaseUrl } : undefined)
        : LLMFactory.createOllamaClient();
  llmClient.setDatabaseLayer(db);

  const language = appConfig.defaultLanguage;
  const contentGenerator = new ContentGenerator(llmClient, {
    llmProvider: provider,
    geminiApiKey,
    mlxLmBaseUrl,
    defaultLanguage: language,
  });
  await contentGenerator.initialize();

  console.log(`Provider: ${provider} | Language: ${language}`);
  console.log(`Words: ${words.join(', ')}`);
  if (topic) console.log(`Topic: ${topic}`);
  console.log('');
  process.stdout.write('Translating... ');

  const translated = await llmClient.translateWords(words, language);
  console.log('done');

  const existingWords = await db.checkWordsExist(
    language,
    translated.map((w) => w.word)
  );

  let added = 0;
  for (const word of translated) {
    if (existingWords.has(word.word.toLowerCase())) {
      console.log(`  skip  ${word.word} (already exists)`);
      continue;
    }
    const wordId = await db.insertWord({
      word: word.word,
      language,
      translation: word.translation,
      topic,
      addedVia: 'manual',
    });
    await db.enqueueWordGeneration(wordId, language, topic, 4);
    console.log(`  added ${word.word} — ${word.translation}`);
    added++;
  }

  if (added === 0) {
    console.log('\nAll words already exist, nothing to process.');
    await db.close();
    return;
  }

  console.log(`\nQueued ${added} word(s) for generation. Running...\n`);

  const audioService = new AudioService(undefined, db);
  const runner = new WordGenerationRunner({
    database: db,
    contentGenerator,
    audioService,
    pollIntervalMs: POLL_INTERVAL_MS,
    onWordUpdated: ({ wordId, processingStatus }) => {
      process.stdout.write(`\r  word #${wordId} → ${processingStatus}          `);
    },
  });

  runner.start();

  await new Promise<void>((resolve) => {
    const check = async () => {
      try {
        const summary = await db.getWordGenerationQueueSummary(language);
        if (summary.queued === 0 && summary.processing === 0) {
          resolve();
        } else {
          process.stdout.write(
            `\r  queued: ${summary.queued}, processing: ${summary.processing}          `
          );
          setTimeout(check, POLL_INTERVAL_MS);
        }
      } catch {
        setTimeout(check, POLL_INTERVAL_MS);
      }
    };
    setTimeout(check, POLL_INTERVAL_MS);
  });

  await runner.stop();
  console.log('\n\nDone!');
  await db.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
