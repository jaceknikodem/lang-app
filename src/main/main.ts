/**
 * Electron main process entry point
 */

import { app, BrowserWindow, session, systemPreferences } from 'electron';
import * as path from 'path';
import { setupIPCHandlers, cleanupIPCHandlers } from './ipc/index.js';
import { createDatabase, SQLiteDatabaseLayer } from './database/index.js';
import { LLMClient, ContentGenerator, LLMFactory, LLMProvider } from './llm/index.js';
import { AudioService } from './audio/audio-service.js';
import { SRSService } from './srs/srs-service.js';
import { LifecycleManager, UpdateManager } from './lifecycle/index.js';
import { LLM_CONFIG } from '../shared/constants/index.js';
import { WordGenerationRunner } from './jobs/word-generation-runner.js';
import { IPC_CHANNELS } from '../shared/types/ipc.js';
import { LemmatizationService } from './lemmatization/index.js';
import { ScoringService } from './scoring/index.js';
import { setupScoringHandlers } from './ipc/ipc-handlers.js';

let mainWindow: BrowserWindow;
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

const forceLocalServices = process.env.E2E_FORCE_LOCAL_SERVICES === '1';

async function initializeServices(): Promise<void> {
  try {
    // Initialize database layer first
    databaseLayer = createDatabase();

    // Initialize database
    await databaseLayer.initialize();
    console.log('Database initialized successfully');

    // Initialize lifecycle manager with database reference
    lifecycleManager = new LifecycleManager({
      databaseLayer: databaseLayer,
      userDataPath: app.getPath('userData'),
      backupRetentionDays: 30
    });

    // Defer lifecycle startup procedures to background - don't block app startup
    // These checks (backup recovery, cleanup) can run after the UI is shown
    setImmediate(async () => {
      try {
        await lifecycleManager!.handleStartup();
        console.log('Lifecycle manager initialized successfully');
      } catch (error) {
        console.warn('Lifecycle manager initialization failed (non-critical):', error);
      }
    });

    // Initialize update manager (checks deferred by UpdateManager itself)
    updateManager = new UpdateManager({
      checkOnStartup: true,
      checkIntervalHours: 24,
      autoDownload: false
    });

    // Initialize update manager in background (non-blocking)
    setImmediate(async () => {
      try {
        await updateManager!.initialize();
        await updateManager!.checkUpdateReminders();
      } catch (error) {
        console.warn('Update manager initialization failed (non-critical):', error);
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
      } catch (e) {
        console.warn('Could not read llm_provider setting, defaulting to ollama');
      }
    } else {
      try {
        await databaseLayer.setSetting('llm_provider', 'ollama');
      } catch (e) {
        console.warn('Failed to persist forced ollama provider for tests:', e);
      }
    }

    // Get Gemini API key if needed
    let geminiApiKey = '';
    if (!forceLocalServices) {
      try {
        const storedKey = await databaseLayer.getSetting('gemini_api_key');
        geminiApiKey = storedKey || '';
      } catch (e) {
        console.warn('Could not read gemini_api_key setting');
      }
    }

    // Initialize LLM client based on persisted provider
    if (!forceLocalServices && initialProvider === 'gemini') {
      llmClient = LLMFactory.createGeminiClient(geminiApiKey);
    } else {
      llmClient = LLMFactory.createOllamaClient(
        forceLocalServices ? {
          model: LLM_CONFIG.DEFAULT_MODEL,
          wordGenerationModel: LLM_CONFIG.DEFAULT_WORD_GENERATION_MODEL,
          sentenceGenerationModel: LLM_CONFIG.DEFAULT_SENTENCE_GENERATION_MODEL
        } : undefined
      );

      if (forceLocalServices) {
        llmClient.setModel(LLM_CONFIG.DEFAULT_MODEL);
        llmClient.setWordGenerationModel(LLM_CONFIG.DEFAULT_WORD_GENERATION_MODEL);
        llmClient.setSentenceGenerationModel(LLM_CONFIG.DEFAULT_SENTENCE_GENERATION_MODEL);
      }
    }
    
    // Inject database layer into LLM client for duplicate checking
    llmClient.setDatabaseLayer(databaseLayer);
    
    // Initialize content generator with LLM client and provider config
    contentGenerator = new ContentGenerator(llmClient, {
      llmProvider: forceLocalServices ? 'ollama' : initialProvider,
      geminiApiKey: forceLocalServices ? '' : geminiApiKey
    });
    
    // Initialize the content generator (including frequency word manager)
    await contentGenerator.initialize();

    // Initialize audio service with database reference
    audioService = new AudioService(undefined, databaseLayer);
    
    // Speech recognition is only initialized in quiz mode, not at app startup

    // Initialize SRS service
    srsService = new SRSService(databaseLayer);
    console.log('SRS service initialized successfully');

    // Initialize lemmatization service first (before WordGenerationRunner)
    lemmatizationService = new LemmatizationService({
      serverUrl: process.env.LEMMATIZATION_SERVER_URL || 'http://127.0.0.1:8888'
    });
    console.log('Lemmatization service initialized successfully');

    wordGenerationRunner = new WordGenerationRunner({
      database: databaseLayer,
      contentGenerator,
      audioService,
      lemmatizationService,
      desiredSentenceCount: 3,
      onWordUpdated: update => {
        BrowserWindow.getAllWindows().forEach(window => {
          window.webContents.send(IPC_CHANNELS.JOBS.WORD_UPDATED, update);
        });
      }
    });

    // Initialize scoring service
    scoringService = new ScoringService(databaseLayer);

    console.log('All services initialized successfully');
  } catch (error) {
    console.error('Failed to initialize services:', error);
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
    console.warn('Blocked external request:', details.url);
    callback({ cancel: true });
  });

  // Request microphone permissions on macOS
  if (process.platform === 'darwin') {
    try {
      const microphoneAccess = systemPreferences.getMediaAccessStatus('microphone');
      
      if (microphoneAccess === 'not-determined') {
        console.log('Requesting microphone access...');
        const granted = await systemPreferences.askForMediaAccess('microphone');
        if (granted) {
          console.log('Microphone access granted');
        } else {
          console.warn('Microphone access denied');
        }
      } else if (microphoneAccess === 'granted') {
        console.log('Microphone access already granted');
      } else {
        console.warn('Microphone access denied');
      }
    } catch (error) {
      console.warn('Could not request microphone permissions:', error);
    }
  }
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, '../preload/preload.js');
  console.log('Preload script path:', preloadPath);
  console.log('Preload script exists:', require('fs').existsSync(preloadPath));
  
  // Create the browser window with enhanced security
  mainWindow = new BrowserWindow({
    height: 800,
    width: 800,
    title: 'KotobaAI',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    },
    // titleBarStyle: 'hiddenInset', // Commented out to allow window dragging
    show: process.env.NODE_ENV !== 'test', // Don't show window in test mode
    icon: path.join(__dirname, '../../build/icon.png') // Add app icon if available
  });

  // Load the app
  mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready to prevent visual flash (unless in test mode)
  mainWindow.once('ready-to-show', () => {
    if (process.env.NODE_ENV !== 'test') {
      mainWindow.show();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null as any;
  });
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

    // Create the main window early - show UI while services initialize
    // This provides better perceived performance
    createWindow();

    // Initialize all services (some operations deferred to background)
    await initializeServices();

    // Set up IPC handlers with initialized services
    setupIPCHandlers(databaseLayer!, llmClient!, contentGenerator!, audioService!, srsService!, lifecycleManager!, updateManager!, wordGenerationRunner, lemmatizationService);

    // Set up scoring handlers (called separately since scoring service is optional during IPC setup)
    if (scoringService) {
      setupScoringHandlers(scoringService);
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
    console.log('IPC handlers initialized successfully');

    app.on('activate', async () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
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
          console.warn('Error stopping recording during before-quit:', error);
        }
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
      console.error('Error during cleanup:', error);
      app.quit();
    }
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    // Prevent opening new windows
    console.warn('Blocked attempt to open new window:', url);
    return { action: 'deny' };
  });

  // Prevent navigation to external URLs
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    // Only allow navigation within the app
    if (parsedUrl.origin !== 'file://') {
      console.warn('Blocked navigation to external URL:', navigationUrl);
      event.preventDefault();
    }
  });
});

// Security: Disable web security warnings in development
if (process.env.NODE_ENV === 'development') {
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
}
