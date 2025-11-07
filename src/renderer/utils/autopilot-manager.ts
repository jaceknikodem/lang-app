/**
 * Autopilot manager for automatic navigation based on scoring
 * Handles interval management and event listener orchestration
 */

export interface AutopilotCallbacks {
  onCheck: (initialTakeover: boolean) => Promise<void>;
}

export interface AutopilotConfig {
  checkIntervalMs: number;
}

const DEFAULT_CONFIG: AutopilotConfig = {
  checkIntervalMs: 30000, // 30 seconds
};

export class AutopilotManager {
  private intervalId: number | null = null;
  private checkTriggerHandler?: () => void;
  private callbacks: AutopilotCallbacks;
  private config: AutopilotConfig;
  private enabled = false;

  constructor(callbacks: AutopilotCallbacks, config: AutopilotConfig = DEFAULT_CONFIG) {
    this.callbacks = callbacks;
    this.config = config;
  }

  /**
   * Start autopilot
   */
  start(initialTakeover: boolean = true): void {
    // Stop existing intervals if any
    this.stop();

    this.enabled = true;

    // Check scores immediately - take over control on first run
    void this.callbacks.onCheck(initialTakeover);

    // Set up event listeners for specific actions
    this.checkTriggerHandler = () => {
      if (this.enabled) {
        void this.callbacks.onCheck(false);
      }
    };
    window.addEventListener('autopilot-check-trigger', this.checkTriggerHandler);

    // Set up interval for checking scores periodically
    this.intervalId = window.setInterval(() => {
      void this.callbacks.onCheck(false);
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop autopilot
   */
  stop(): void {
    this.enabled = false;

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Remove event listener
    if (this.checkTriggerHandler) {
      window.removeEventListener('autopilot-check-trigger', this.checkTriggerHandler);
      this.checkTriggerHandler = undefined;
    }
  }

  /**
   * Check if autopilot is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get transition message text for a mode
   */
  static getTransitionMessage(mode: 'learning' | 'quiz' | 'dialog' | 'flow'): string {
    switch (mode) {
      case 'learning':
        return "Let's review some words";
      case 'quiz':
        return "Let's quiz some words";
      case 'dialog':
        return "Let's practice speaking";
      case 'flow':
        return "Let's get into the flow";
      default:
        return '';
    }
  }
}
