import { readFileSync } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { SQLiteDatabaseLayer } from '../database/database-layer.js';
import { ContentGenerator } from '../llm/content-generator.js';
import { AudioService } from '../audio/audio-service.js';
import { LLMFactory } from '../llm/llm-factory.js';
import { WordGenerationRunner } from '../jobs/word-generation-runner.js';
import { appConfig } from '../../shared/config/index.js';
import type { LLMProvider } from '../llm/llm-factory.js';
import os from 'os';

const DB_PATH = join(
  os.homedir(),
  'Library',
  'Application Support',
  'KotobaAI',
  'language_learning.db'
);
const WORDS_PER_TOPIC = 5;
const TOPIC_COUNT = 20;
const POLL_INTERVAL_MS = 1000;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
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

  const audioService = new AudioService(undefined, db);

  const theme = (await db.getCurrentTheme()) || 'general';
  const topicsFile = join(__dirname, '..', '..', '..', 'topics', `${theme}.txt`);
  const fallbackFile = join(__dirname, '..', '..', '..', 'topics', 'general.txt');
  const resolvedFile = existsSync(topicsFile) ? topicsFile : fallbackFile;

  const allTopics = readFileSync(resolvedFile, 'utf8')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
  const topics = shuffle(allTopics).slice(0, TOPIC_COUNT);

  console.log(`Provider: ${provider} | Language: ${language} | Theme: ${theme}`);
  console.log(`Seeding ${TOPIC_COUNT} topics × ${WORDS_PER_TOPIC} words...\n`);

  let seeded = 0;
  for (const topic of topics) {
    process.stdout.write(`  [${topic}]... `);
    try {
      const words = await contentGenerator.generateTopicVocabulary(
        topic,
        language,
        WORDS_PER_TOPIC,
        db
      );

      const existingWords = await db.checkWordsExist(
        language,
        words.map((w) => w.word)
      );

      let added = 0;
      for (const word of words) {
        if (existingWords.has(word.word.toLowerCase())) continue;
        const wordId = await db.insertWord({
          word: word.word,
          language,
          translation: word.translation,
          topic,
          addedVia: 'auto',
        });
        await db.enqueueWordGeneration(wordId, language, topic, 4);
        added++;
        seeded++;
      }
      console.log(`${added} new words`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (seeded === 0) {
    console.log('\nAll words already exist, nothing to process.');
    await db.close();
    return;
  }

  console.log(`\nQueued ${seeded} words for generation. Running...\n`);

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
