/**
 * Service Manager - Manages whisper-server and stanza-service.py as child processes
 */

import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { serviceConfig } from '../../shared/config/index.js';

export interface ManagedService {
  name: string;
  port: number;
  url: string;
  process: ChildProcess | null;
  restartCount: number;
}

export interface ServiceManagerConfig {
  enabled?: boolean;
  whisperModelPath?: string;
  whisperPort?: number;
  lemmatizationPort?: number;
  maxRestarts?: number;
}

export class ServiceManager {
  private whisperService: ManagedService | null = null;
  private lemmatizationService: ManagedService | null = null;
  private enabled: boolean;
  private whisperModelPath: string;
  private whisperPort: number;
  private lemmatizationPort: number;
  private maxRestarts: number;
  private isShuttingDown: boolean = false;

  constructor(config: ServiceManagerConfig = {}) {
    this.enabled = config.enabled ?? serviceConfig.manageServices;
    
    // Resolve model path - try multiple locations
    if (config.whisperModelPath) {
      this.whisperModelPath = config.whisperModelPath;
    } else {
      // Use userData directory (consistent with other app data)
      // This works in both development and production
      const modelsDir = path.join(app.getPath('userData'), 'models');
      
      // Ensure models directory exists
      if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
      }
      
      // Auto-detect available Whisper model with preference for larger/better models
      this.whisperModelPath = this.findWhisperModel(modelsDir);
    }
    
    this.whisperPort = config.whisperPort || serviceConfig.whisper.port;
    this.lemmatizationPort = config.lemmatizationPort || serviceConfig.lemmatization.port;
    this.maxRestarts = config.maxRestarts || serviceConfig.maxRestarts;
  }

  /**
   * Find the best available Whisper model in the models directory
   * Prioritizes larger/better models, falls back to any .bin file
   */
  private findWhisperModel(modelsDir: string): string {
    // Preference order: larger/better models first, then fallback to any .bin file
    const preferredModels = [
      'ggml-large-v3-turbo-q8_0.bin',
      'ggml-large-v3-turbo.bin',
      'ggml-large-v3.bin',
      'ggml-large-v2.bin',
      'ggml-large.bin',
      'ggml-medium.bin',
      'ggml-base.bin',
      'ggml-small.bin',
      'ggml-tiny.bin'
    ];

    // First, try preferred models in order
    for (const modelName of preferredModels) {
      const modelPath = path.join(modelsDir, modelName);
      if (fs.existsSync(modelPath)) {
        console.log(`[ServiceManager] Found Whisper model: ${modelName}`);
        return modelPath;
      }
    }

    // If no preferred model found, look for any .bin file in the directory
    try {
      const files = fs.readdirSync(modelsDir);
      for (const file of files) {
        if (file.endsWith('.bin') && file.startsWith('ggml')) {
          const modelPath = path.join(modelsDir, file);
          console.log(`[ServiceManager] Found Whisper model: ${file}`);
          return modelPath;
        }
      }
    } catch (error) {
      // Directory read failed, will fall through to default
    }

    // Fallback to default if nothing found
    const defaultModel = path.join(modelsDir, 'ggml-small.bin');
    console.log(`[ServiceManager] No Whisper model found, will use default path: ${defaultModel}`);
    return defaultModel;
  }

  /**
   * Find an available port starting from the given port
   */
  private async findAvailablePort(startPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      
      server.listen(startPort, () => {
        const port = (server.address() as net.AddressInfo)?.port;
        server.close(() => {
          if (port) {
            resolve(port);
          } else {
            reject(new Error('Could not determine port'));
          }
        });
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Port is in use, try next port
          this.findAvailablePort(startPort + 1)
            .then(resolve)
            .catch(reject);
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Check if a port is already in use
   */
  private async isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, () => {
        server.close(() => {
          resolve(false); // Port is available
        });
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true); // Port is in use
        } else {
          resolve(false); // Other error, assume available
        }
      });
    });
  }

  /**
   * Start whisper-server
   */
  private async startWhisperService(): Promise<void> {
    if (!this.enabled || this.isShuttingDown) {
      return;
    }

    try {
      // Check if port is already in use
      const portInUse = await this.isPortInUse(this.whisperPort);
      let actualPort = this.whisperPort;
      
      if (portInUse) {
        console.log(`[ServiceManager] Whisper port ${this.whisperPort} is in use, finding available port...`);
        actualPort = await this.findAvailablePort(this.whisperPort);
        console.log(`[ServiceManager] Using Whisper port ${actualPort} instead`);
      }

      const url = `http://127.0.0.1:${actualPort}`;
      
      // Check if model file exists
      const modelPath = this.whisperModelPath;
      if (!fs.existsSync(modelPath)) {
        console.warn(`[ServiceManager] Whisper model not found at ${modelPath}`);
        console.warn(`[ServiceManager] Please download a Whisper model to: ${path.dirname(modelPath)}`);
        console.warn(`[ServiceManager] Supported models: ggml-*.bin files (e.g., ggml-small.bin, ggml-large-v3-turbo-q8_0.bin)`);
        console.warn(`[ServiceManager] Skipping Whisper server start`);
        return;
      }
      
      console.log(`[ServiceManager] Using Whisper model: ${path.basename(modelPath)}`);

      // Spawn whisper-server
      console.log(`[ServiceManager] Starting whisper-server on port ${actualPort}...`);
      const whisperProcess = spawn('whisper-server', [
        '--model', modelPath,
        '--threads', '8',
        '--port', actualPort.toString()
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
      });

      this.whisperService = {
        name: 'whisper-server',
        port: actualPort,
        url,
        process: whisperProcess,
        restartCount: 0
      };

      // Set environment variable so other services can use it
      process.env.WHISPER_SERVER_URL = url;

      // Handle stdout/stderr
      whisperProcess.stdout?.on('data', (data) => {
        console.log(`[Whisper] ${data.toString().trim()}`);
      });

      whisperProcess.stderr?.on('data', (data) => {
        console.error(`[Whisper] ${data.toString().trim()}`);
      });

      // Handle process exit
      whisperProcess.on('exit', (code, signal) => {
        if (this.isShuttingDown) {
          return;
        }

        console.warn(`[ServiceManager] whisper-server exited with code ${code} and signal ${signal}`);
        
        if (this.whisperService && this.whisperService.restartCount < this.maxRestarts) {
          this.whisperService.restartCount++;
          console.log(`[ServiceManager] Restarting whisper-server (attempt ${this.whisperService.restartCount}/${this.maxRestarts})...`);
          
          // Wait a bit before restarting
          setTimeout(() => {
            this.startWhisperService().catch(err => {
              console.error('[ServiceManager] Failed to restart whisper-server:', err);
            });
          }, 2000);
        } else {
          console.error('[ServiceManager] Max restart attempts reached for whisper-server, giving up');
          this.whisperService = null;
        }
      });

      // Wait a bit to see if process starts successfully
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify process is still running
      if (whisperProcess.killed || whisperProcess.exitCode !== null) {
        throw new Error('Whisper server process died immediately');
      }

      console.log(`[ServiceManager] whisper-server started successfully on ${url}`);
    } catch (error) {
      console.error('[ServiceManager] Failed to start whisper-server:', error);
      this.whisperService = null;
    }
  }

  /**
   * Start stanza-service.py
   */
  private async startLemmatizationService(): Promise<void> {
    if (!this.enabled || this.isShuttingDown) {
      return;
    }

    try {
      // Check if port is already in use
      const portInUse = await this.isPortInUse(this.lemmatizationPort);
      let actualPort = this.lemmatizationPort;
      
      if (portInUse) {
        console.log(`[ServiceManager] Lemmatization port ${this.lemmatizationPort} is in use, finding available port...`);
        actualPort = await this.findAvailablePort(this.lemmatizationPort);
        console.log(`[ServiceManager] Using Lemmatization port ${actualPort} instead`);
      }

      const url = `http://127.0.0.1:${actualPort}`;

      // Find Python/uv executable
      // Try multiple path locations for development vs production
      const appPath = app.getAppPath();
      let lemmatizationDir = path.join(appPath, 'src', 'main', 'lemmatization');
      let stanzaServicePath = path.join(lemmatizationDir, 'stanza-service.py');
      
      // If not found, try relative to __dirname (for compiled code)
      // From dist/main/main/services/, go to src/main/lemmatization/
      if (!fs.existsSync(stanzaServicePath)) {
        lemmatizationDir = path.resolve(__dirname, '../../src/main/lemmatization');
        stanzaServicePath = path.join(lemmatizationDir, 'stanza-service.py');
      }
      
      // If still not found, try relative to project root (development mode where __dirname might be different)
      if (!fs.existsSync(stanzaServicePath)) {
        lemmatizationDir = path.resolve(__dirname, '../../../../src/main/lemmatization');
        stanzaServicePath = path.join(lemmatizationDir, 'stanza-service.py');
      }

      if (!fs.existsSync(stanzaServicePath)) {
        console.warn(`[ServiceManager] stanza-service.py not found at ${stanzaServicePath}, skipping lemmatization service start`);
        return;
      }

      // Try to use uv run python, fallback to python3
      let pythonCommand: string;
      let args: string[];

      try {
        // Check if uv is available
        const { execSync } = require('child_process');
        execSync('which uv', { stdio: 'ignore' });
        
        // Use uv to run the service
        pythonCommand = 'uv';
        args = ['run', 'python', stanzaServicePath];
        console.log(`[ServiceManager] Using uv to run stanza-service.py`);
      } catch {
        // Fallback to python3
        pythonCommand = 'python3';
        args = [stanzaServicePath];
        console.log(`[ServiceManager] Using python3 to run stanza-service.py`);
      }

      // Set port via environment variable (stanza-service.py uses uvicorn)
      const env = {
        ...process.env,
        STANZA_PORT: actualPort.toString()
      };

      // Spawn stanza-service
      console.log(`[ServiceManager] Starting stanza-service on port ${actualPort}...`);
      const lemmatizationProcess = spawn(pythonCommand, args, {
        cwd: lemmatizationDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env
      });

      this.lemmatizationService = {
        name: 'stanza-service',
        port: actualPort,
        url,
        process: lemmatizationProcess,
        restartCount: 0
      };

      // Set environment variable so other services can use it
      process.env.LEMMATIZATION_SERVER_URL = url;

      // Handle stdout/stderr
      lemmatizationProcess.stdout?.on('data', (data) => {
        console.log(`[Stanza] ${data.toString().trim()}`);
      });

      lemmatizationProcess.stderr?.on('data', (data) => {
        console.error(`[Stanza] ${data.toString().trim()}`);
      });

      // Handle process exit
      lemmatizationProcess.on('exit', (code, signal) => {
        if (this.isShuttingDown) {
          return;
        }

        console.warn(`[ServiceManager] stanza-service exited with code ${code} and signal ${signal}`);
        
        if (this.lemmatizationService && this.lemmatizationService.restartCount < this.maxRestarts) {
          this.lemmatizationService.restartCount++;
          console.log(`[ServiceManager] Restarting stanza-service (attempt ${this.lemmatizationService.restartCount}/${this.maxRestarts})...`);
          
          // Wait a bit before restarting
          setTimeout(() => {
            this.startLemmatizationService().catch(err => {
              console.error('[ServiceManager] Failed to restart stanza-service:', err);
            });
          }, 2000);
        } else {
          console.error('[ServiceManager] Max restart attempts reached for stanza-service, giving up');
          this.lemmatizationService = null;
        }
      });

      // Wait a bit to see if process starts successfully
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify process is still running
      if (lemmatizationProcess.killed || lemmatizationProcess.exitCode !== null) {
        throw new Error('Lemmatization server process died immediately');
      }

      console.log(`[ServiceManager] stanza-service started successfully on ${url}`);
    } catch (error) {
      console.error('[ServiceManager] Failed to start stanza-service:', error);
      this.lemmatizationService = null;
    }
  }

  /**
   * Start all managed services
   * 
   * This method sets process.env.WHISPER_SERVER_URL and process.env.LEMMATIZATION_SERVER_URL
   * with the actual ports (which may differ from defaults if ports are taken).
   * Other services should read these environment variables to connect to the managed services.
   */
  async start(): Promise<void> {
    if (!this.enabled) {
      console.log('[ServiceManager] Service management is disabled');
      return;
    }

    console.log('[ServiceManager] Starting managed services...');
    this.isShuttingDown = false;

    // Start services in parallel
    // Environment variables are set synchronously during service startup,
    // so they're available immediately for other services to read
    await Promise.all([
      this.startWhisperService(),
      this.startLemmatizationService()
    ]);
  }

  /**
   * Stop all managed services
   */
  async stop(): Promise<void> {
    console.log('[ServiceManager] Stopping managed services...');
    this.isShuttingDown = true;

    const stopPromises: Promise<void>[] = [];

    if (this.whisperService?.process) {
      stopPromises.push(
        new Promise<void>((resolve) => {
          const proc = this.whisperService!.process!;
          proc.on('exit', () => resolve());
          proc.kill('SIGTERM');
          
          // Force kill after 5 seconds
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL');
            }
            resolve();
          }, 5000);
        })
      );
    }

    if (this.lemmatizationService?.process) {
      stopPromises.push(
        new Promise<void>((resolve) => {
          const proc = this.lemmatizationService!.process!;
          proc.on('exit', () => resolve());
          proc.kill('SIGTERM');
          
          // Force kill after 5 seconds
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL');
            }
            resolve();
          }, 5000);
        })
      );
    }

    await Promise.all(stopPromises);

    this.whisperService = null;
    this.lemmatizationService = null;

    console.log('[ServiceManager] All managed services stopped');
  }

  /**
   * Get status of managed services
   */
  getStatus(): {
    enabled: boolean;
    whisper: { running: boolean; port?: number; url?: string } | null;
    lemmatization: { running: boolean; port?: number; url?: string } | null;
  } {
    return {
      enabled: this.enabled,
      whisper: this.whisperService ? {
        running: this.whisperService.process !== null && !this.whisperService.process.killed,
        port: this.whisperService.port,
        url: this.whisperService.url
      } : null,
      lemmatization: this.lemmatizationService ? {
        running: this.lemmatizationService.process !== null && !this.lemmatizationService.process.killed,
        port: this.lemmatizationService.port,
        url: this.lemmatizationService.url
      } : null
    };
  }
}

