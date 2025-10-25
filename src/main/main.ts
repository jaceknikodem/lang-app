/**
 * Electron main process entry point
 */

import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'path';
import { setupIPCHandlers, cleanupIPCHandlers } from './ipc/index.js';
import { SQLiteDatabaseLayer } from './database/database-layer.js';
import { OllamaClient } from './llm/ollama-client.js';
import { AudioService } from './audio/audio-service.js';

let mainWindow: BrowserWindow;
let databaseLayer: SQLiteDatabaseLayer;
let llmClient: OllamaClient;
let audioService: AudioService;

async function initializeServices(): Promise<void> {
  try {
    // Initialize database layer
    databaseLayer = new SQLiteDatabaseLayer({
      databasePath: path.join(app.getPath('userData'), 'language_learning.db'),
      enableWAL: true,
      timeout: 5000
    });
    await databaseLayer.initialize();

    // Initialize LLM client
    llmClient = new OllamaClient();

    // Initialize audio service
    audioService = new AudioService();

    console.log('All services initialized successfully');
  } catch (error) {
    console.error('Failed to initialize services:', error);
    throw error;
  }
}

function setupSecurity(): void {
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
}

function createWindow(): void {
  // Create the browser window with enhanced security
  mainWindow = new BrowserWindow({
    height: 800,
    width: 1200,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    },
    titleBarStyle: 'hiddenInset',
    show: false,
    icon: path.join(__dirname, '../../build/icon.png') // Add app icon if available
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null as any;
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  try {
    // Set up security policies
    setupSecurity();

    // Initialize all services
    await initializeServices();

    // Set up IPC handlers with initialized services
    setupIPCHandlers(databaseLayer, llmClient, audioService);

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
  // Clean up services before quitting
  if (databaseLayer) {
    await databaseLayer.close();
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app termination
app.on('before-quit', async (event) => {
  if (databaseLayer) {
    event.preventDefault();
    try {
      // Clean up IPC handlers
      cleanupIPCHandlers();
      
      // Close database connection
      await databaseLayer.close();
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