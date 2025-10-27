/**
 * Electron main process entry point
 */

import { app, BrowserWindow, ipcMain, session, systemPreferences } from 'electron';
import * as path from 'path';
import { setupIPCHandlers, cleanupIPCHandlers } from './ipc/index.js';
import { SQLiteDatabaseLayer } from './database/database-layer.js';
import { OllamaClient, ContentGenerator } from './llm/index.js';
import { AudioService } from './audio/audio-service.js';
import { LifecycleManager, UpdateManager } from './lifecycle/index.js';

let mainWindow: BrowserWindow;
let databaseLayer: SQLiteDatabaseLayer | undefined;
let llmClient: OllamaClient | undefined;
let contentGenerator: ContentGenerator | undefined;
let audioService: AudioService | undefined;
let lifecycleManager: LifecycleManager | undefined;
let updateManager: UpdateManager | undefined;

async function initializeServices(): Promise<void> {
  try {
    // Initialize database layer first
    databaseLayer = new SQLiteDatabaseLayer({
      databasePath: path.join(app.getPath('userData'), 'language_learning.db'),
      enableWAL: true,
      timeout: 5000
    });

    // Initialize database
    await databaseLayer.initialize();
    console.log('Database initialized successfully');

    // Initialize lifecycle manager with database reference
    lifecycleManager = new LifecycleManager({
      databaseLayer: databaseLayer,
      userDataPath: app.getPath('userData'),
      backupRetentionDays: 30
    });

    // Handle startup procedures
    await lifecycleManager.handleStartup();
    console.log('Lifecycle manager initialized successfully');

    // Initialize update manager
    updateManager = new UpdateManager({
      checkOnStartup: true,
      checkIntervalHours: 24,
      autoDownload: false
    });

    // Initialize LLM client
    llmClient = new OllamaClient();
    
    // Inject database layer into LLM client for duplicate checking
    llmClient.setDatabaseLayer(databaseLayer);
    
    // Initialize content generator with LLM client
    contentGenerator = new ContentGenerator(llmClient);
    
    // Initialize the content generator (including frequency word manager)
    await contentGenerator.initialize();

    // Initialize audio service with database reference
    audioService = new AudioService(undefined, databaseLayer);
    
    // Initialize speech recognition
    try {
      await audioService.initializeSpeechRecognition();
      console.log('Speech recognition initialized successfully');
    } catch (error) {
      console.warn('Speech recognition initialization failed:', error);
      // Don't fail the entire app startup if speech recognition fails
    }

    // Initialize update manager
    await updateManager.initialize();

    // Check for update reminders
    await updateManager.checkUpdateReminders();

    console.log('All services initialized successfully');
  } catch (error) {
    console.error('Failed to initialize services:', error);
    throw error;
  }
}

async function setupSecurity(): Promise<void> {
  // Block external requests except to localhost (for Ollama)
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);

    // Allow localhost requests (for Ollama)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
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
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
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

    // Initialize all services
    await initializeServices();

    // Set up IPC handlers with initialized services
    setupIPCHandlers(databaseLayer!, llmClient!, contentGenerator!, audioService!, lifecycleManager!, updateManager!);
    console.log('IPC handlers initialized successfully');

    // Create the main window
    createWindow();

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
      // Clean up IPC handlers
      cleanupIPCHandlers();

      // Clean up update manager
      if (updateManager) {
        updateManager.cleanup();
      }

      // Handle graceful shutdown (includes database closure)
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