/**
 * Electron main process entry point
 */

// Suppress macOS CoreText font warnings (e.g., ".HiraKakuInterface-W5", ".HiraKakuInterface-W7" not found)
// Must be set before Electron is imported
if (process.platform === 'darwin') {
  process.env.OS_ACTIVITY_MODE = 'disable';
}

import { app, BrowserWindow, session, systemPreferences } from 'electron';
import * as path from 'path';
import { setupIPCHandlers, cleanupIPCHandlers } from './ipc/index.js';
import { createDatabase, SQLiteDatabaseLayer } from './database/index.js';
import { LLMClient, ContentGenerator, LLMFactory, LLMProvider } from './llm/index.js';
import { AudioService } from './audio/audio-service.js';
import { SRSService } from './srs/srs-service.js';
import { LifecycleManager, UpdateManager } from './lifecycle/index.js';
import { LLM_CONFIG } from '../shared/constants/index.js';
import { serviceConfig, testingConfig, env, appConfig } from '../shared/config/index.js';
import { WordGenerationRunner } from './jobs/word-generation-runner.js';
import { IPC_CHANNELS } from '../shared/types/ipc.js';
import { LemmatizationService } from './lemmatization/index.js';
import { ScoringService, ProficiencyService } from './scoring/index.js';
import { setupScoringHandlers, setupProficiencyHandlers } from './ipc/ipc-handlers.js';
import { ServiceManager } from './services/index.js';
import { initializeLogger, getLogger } from './utils/logger.js';
import { Logger } from '../shared/utils/logger.js';

let mainWindow: BrowserWindow;
let logger: Logger | undefined;
let databaseLayer: SQLiteDatabaseLayer | undefined;
let llmClient: LLMClient | undefined;
let contentGenerator: ContentGenerator | undefined;
let audioService: AudioService | undefined;
let srsService: SRSService | undefined;
let lifecycleManager: LifecycleManager | undefined;
let updateManager: UpdateManager | undefined;
let wordGenerationRunner: WordGenerationRunner | undefined;
let lemmatizationService: LemmatizationService | undefined;
let scoringService: ScoringService | undefined;
let proficiencyService: ProficiencyService | undefined;
let serviceManager: ServiceManager | undefined;

const forceLocalServices = testingConfig.e2eForceLocalServices;

async function initializeServices(): Promise<void> {
  // Initialize logger first - must be done before any other services that might log
  logger = await initializeLogger();

  try {
    // Initialize database layer first
    databaseLayer = createDatabase();

    // Initialize database
    await databaseLayer.initialize();
    logger.info('Database initialized successfully');

    // Initialize and start ServiceManager (manages external services like whisper-server and stanza-service)
    // This must be done before LemmatizationService initialization, as it sets environment variables
    serviceManager = new ServiceManager({
      enabled: serviceConfig.manageServices,
    });
    await serviceManager.start();
    logger.info('ServiceManager initialized successfully');

    // Initialize lifecycle manager with database reference
    lifecycleManager = new LifecycleManager({
      databaseLayer: databaseLayer,
      userDataPath: app.getPath('userData'),
      backupRetentionDays: 30,
    });

    // Defer lifecycle startup procedures to background - don't block app startup
    // These checks (backup recovery, cleanup) can run after the UI is shown
    setImmediate(async () => {
      try {
        await lifecycleManager!.handleStartup();
        logger!.info('Lifecycle manager initialized successfully');
      } catch (error) {
        logger!.warn({ error }, 'Lifecycle manager initialization failed (non-critical)');
      }
    });

    // Initialize update manager (checks deferred by UpdateManager itself)
    updateManager = new UpdateManager({
      checkOnStartup: true,
      checkIntervalHours: 24,
      autoDownload: false,
    });

    // Initialize update manager in background (non-blocking)
    setImmediate(async () => {
      try {
        await updateManager!.initialize();
        await updateManager!.checkUpdateReminders();
      } catch (error) {
        logger!.warn({ error }, 'Update manager initialization failed (non-critical)');
      }
    });

    // Process frequently looked-up words from dictionary hovers (async, non-blocking)
    setImmediate(async () => {
      try {
        const currentLanguage = await databaseLayer!.getCurrentLanguage();
        logger!.info('Processing frequently looked-up words from dictionary hovers...');
        const wordsAdded = await databaseLayer!.processFrequentlyLookedUpWords(currentLanguage);
        if (wordsAdded > 0) {
          logger!.info(`Added ${wordsAdded} words from dictionary hovers`);
        } else {
          logger!.info('No new words to add from dictionary hovers');
        }
      } catch (error) {
        logger!.warn({ error }, 'Failed to process dictionary hovers (non-critical)');
      }
    });

    // Determine initial LLM provider from persisted settings
    let initialProvider: LLMProvider = 'ollama';
    if (!forceLocalServices) {
      try {
        const storedProvider = await databaseLayer.getSetting('llm_provider');
        if (storedProvider === 'gemini' || storedProvider === 'ollama') {
          initialProvider = storedProvider as LLMProvider;
        }
      } catch {
        logger.warn('Could not read llm_provider setting, defaulting to ollama');
      }
    } else {
      try {
        await databaseLayer.setSetting('llm_provider', 'ollama');
      } catch (e) {
        logger.warn({ error: e }, 'Failed to persist forced ollama provider for tests');
      }
    }

    // Get Gemini API key if needed
    let geminiApiKey = '';
    if (!forceLocalServices) {
      try {
        const storedKey = await databaseLayer.getSetting('gemini_api_key');
        geminiApiKey = storedKey || '';
      } catch {
        logger.warn('Could not read gemini_api_key setting');
      }
    }

    // Initialize LLM client based on persisted provider
    if (!forceLocalServices && initialProvider === 'gemini') {
      llmClient = LLMFactory.createGeminiClient(geminiApiKey);
    } else {
      llmClient = LLMFactory.createOllamaClient(
        forceLocalServices
          ? {
              model: LLM_CONFIG.DEFAULT_MODEL,
              wordGenerationModel: LLM_CONFIG.DEFAULT_WORD_GENERATION_MODEL,
              sentenceGenerationModel: LLM_CONFIG.DEFAULT_SENTENCE_GENERATION_MODEL,
            }
          : undefined
      );

      if (forceLocalServices) {
        llmClient.setModel(LLM_CONFIG.DEFAULT_MODEL);
        llmClient.setWordGenerationModel(LLM_CONFIG.DEFAULT_WORD_GENERATION_MODEL);
        llmClient.setSentenceGenerationModel(LLM_CONFIG.DEFAULT_SENTENCE_GENERATION_MODEL);
      }
    }

    // Inject database layer into LLM client for duplicate checking
    llmClient.setDatabaseLayer(databaseLayer);

    // Initialize lemmatization service (needed for ContentGenerator)
    lemmatizationService = new LemmatizationService({
      serverUrl: serviceConfig.lemmatization.serverUrl,
      database: databaseLayer,
    });
    logger.info('Lemmatization service initialized successfully');

    // Initialize content generator with LLM client and provider config
    contentGenerator = new ContentGenerator(llmClient, {
      llmProvider: forceLocalServices ? 'ollama' : initialProvider,
      geminiApiKey: forceLocalServices ? '' : geminiApiKey,
      lemmatizationService: lemmatizationService,
    });

    // Initialize the content generator (including frequency word manager)
    await contentGenerator.initialize();

    // Initialize audio service with database reference
    audioService = new AudioService(undefined, databaseLayer);

    // Speech recognition is only initialized in quiz mode, not at app startup

    // Initialize SRS service
    srsService = new SRSService(databaseLayer);
    logger.info('SRS service initialized successfully');

    wordGenerationRunner = new WordGenerationRunner({
      database: databaseLayer,
      contentGenerator,
      audioService,
      lemmatizationService,
      desiredSentenceCount: 3,
      onWordUpdated: (update) => {
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send(IPC_CHANNELS.JOBS.WORD_UPDATED, update);
        });
      },
    });

    // Initialize scoring service
    scoringService = new ScoringService(databaseLayer);

    // Initialize proficiency service
    proficiencyService = new ProficiencyService(databaseLayer);

    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize services');
    throw error;
  }
}

async function setupSecurity(): Promise<void> {
  // Block external requests except to localhost (for Ollama) and Gemini API
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);

    // Allow devtools:// protocol in development (needed for DevTools)
    if (url.protocol === 'devtools:' || url.hostname === 'devtools') {
      callback({ cancel: false });
      return;
    }

    // Allow localhost requests (for Ollama)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      callback({ cancel: false });
      return;
    }

    // Allow Gemini API requests unless tests force local-only services
    if (!forceLocalServices && url.hostname === 'generativelanguage.googleapis.com') {
      callback({ cancel: false });
      return;
    }

    // Allow file:// and data: protocols for local resources
    if (url.protocol === 'file:' || url.protocol === 'data:') {
      callback({ cancel: false });
      return;
    }

    // Block all other external requests
    const logger = getLogger();
    logger.warn({ url: details.url }, 'Blocked external request');
    callback({ cancel: true });
  });

  // Request microphone permissions on macOS
  if (process.platform === 'darwin') {
    try {
      const microphoneAccess = systemPreferences.getMediaAccessStatus('microphone');

      const logger = getLogger();
      if (microphoneAccess === 'not-determined') {
        logger.info('Requesting microphone access...');
        const granted = await systemPreferences.askForMediaAccess('microphone');
        if (granted) {
          logger.info('Microphone access granted');
        } else {
          logger.warn('Microphone access denied');
        }
      } else if (microphoneAccess === 'granted') {
        logger.info('Microphone access already granted');
      } else {
        logger.warn('Microphone access denied');
      }
    } catch (error) {
      const logger = getLogger();
      logger.warn({ error }, 'Could not request microphone permissions');
    }
  }
}

function createWindow(): void {
  const logger = getLogger();
  const preloadPath = path.join(__dirname, '../preload/preload.js');
  logger.debug(
    { preloadPath, exists: require('fs').existsSync(preloadPath) },
    'Preload script path'
  );

  // Create the browser window with enhanced security
  mainWindow = new BrowserWindow({
    height: 700,
    width: 910,
    title: 'KotobaAI',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
    // titleBarStyle: 'hiddenInset', // Commented out to allow window dragging
    show: env !== 'test', // Don't show window in test mode
    icon: path.join(__dirname, '../../build/icon.png'), // Add app icon if available
  });

  // Load the app
  mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  // Open DevTools if configured to do so
  if (appConfig.openDevtools) {
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready to prevent visual flash (unless in test mode)
  mainWindow.once('ready-to-show', () => {
    if (env !== 'test') {
      mainWindow.show();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null as any;
  });
}

// Suppress macOS CoreText font warnings before app initialization
// Must be called before app.whenReady()
if (process.platform === 'darwin') {
  // Set environment variable to suppress CoreText warnings
  // This must be set before any Electron processes spawn
  process.env.OS_ACTIVITY_MODE = 'disable';
}

// Set app name and dock icon
app.setName('KotobaAI');
if (process.platform === 'darwin') {
  const iconPath = path.join(__dirname, '../../../build/icon.png');
  if (require('fs').existsSync(iconPath)) {
    app.dock?.setIcon(iconPath);
  }
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  try {
    // Set up security policies
    await setupSecurity();

    // Initialize all services (some operations deferred to background)
    // Logger is initialized first within initializeServices()
    await initializeServices();

    // Set up IPC handlers with initialized services BEFORE creating window
    // This ensures handlers are registered before renderer process tries to use them
    setupIPCHandlers(
      databaseLayer!,
      llmClient!,
      contentGenerator!,
      audioService!,
      srsService!,
      lifecycleManager!,
      updateManager!,
      wordGenerationRunner,
      lemmatizationService
    );

    // Create the main window after services and handlers are initialized
    // This prevents "No handler registered" errors
    createWindow();

    // Set up scoring handlers (called separately since scoring service is optional during IPC setup)
    if (scoringService) {
      logger!.info('Setting up scoring handlers...');
      setupScoringHandlers(scoringService);
      logger!.info('Scoring handlers setup complete');
    } else {
      logger!.warn('Warning: scoringService is undefined, scoring handlers not registered');
    }

    // Set up proficiency handlers
    if (proficiencyService) {
      logger!.info('Setting up proficiency handlers...');
      setupProficiencyHandlers(proficiencyService);
      logger!.info('Proficiency handlers setup complete');
    } else {
      logger!.warn('Warning: proficiencyService is undefined, proficiency handlers not registered');
    }

    wordGenerationRunner?.start();

    // Initialize scoring service (used on-demand via IPC handlers)
    if (scoringService) {
      scoringService.start();
    }

    // Keep llmClient reference updated when provider switches
    const originalSwitchProvider = contentGenerator!.switchProvider.bind(contentGenerator!);
    contentGenerator!.switchProvider = (provider: LLMProvider, geminiApiKey?: string) => {
      originalSwitchProvider(provider, geminiApiKey);
      llmClient = contentGenerator!.getCurrentClient();
    };
    logger!.info('IPC handlers initialized successfully');

    app.on('activate', async () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    // Use getLogger() as fallback in case initializeServices() failed before logger was initialized
    const errorLogger = logger || getLogger();
    errorLogger.error({ error }, 'Failed to initialize application');
    app.quit();
  }
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', async () => {
  // Handle graceful shutdown
  if (lifecycleManager) {
    await lifecycleManager.handleShutdown();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app termination
app.on('before-quit', async (event) => {
  if (lifecycleManager && !(lifecycleManager as any)['isShuttingDown']) {
    event.preventDefault();
    try {
      // Stop word generation runner FIRST (before database is closed)
      await wordGenerationRunner?.stop();

      // Stop scoring service
      if (scoringService) {
        scoringService.stop();
      }

      // Stop audio service
      if (audioService) {
        audioService.stopAudio();
        try {
          const isRecording = await audioService.isRecording();
          if (isRecording) {
            await audioService.stopRecording();
          }
        } catch (error) {
          const logger = getLogger();
          logger.warn({ error }, 'Error stopping recording during before-quit');
        }
      }

      // Stop managed services
      if (serviceManager) {
        await serviceManager.stop();
      }

      // Clean up update manager
      if (updateManager) {
        updateManager.cleanup();
      }

      // Clean up IPC handlers
      cleanupIPCHandlers();

      // Handle graceful shutdown (includes database closure) - sets isShuttingDown flag
      await lifecycleManager.handleShutdown();

      app.quit();
    } catch (error) {
      const logger = getLogger();
      logger.error({ error }, 'Error during cleanup');
      app.quit();
    }
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    // Prevent opening new windows
    const logger = getLogger();
    logger.warn({ url }, 'Blocked attempt to open new window');
    return { action: 'deny' };
  });

  // Prevent navigation to external URLs
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const logger = getLogger();

    // Only allow navigation within the app
    if (parsedUrl.origin !== 'file://') {
      logger.warn({ navigationUrl }, 'Blocked navigation to external URL');
      event.preventDefault();
    }
  });
});

// Security: Disable web security warnings in development
if (env === 'development') {
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
}
