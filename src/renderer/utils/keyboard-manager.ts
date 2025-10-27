/**
 * Centralized keyboard binding manager for the language learning app
 * Provides consistent keyboard shortcuts across all components
 */

export interface KeyBinding {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  description: string;
  action: () => void | Promise<void>;
  context?: string; // Optional context for conditional bindings
}

export class KeyboardManager {
  private bindings: Map<string, KeyBinding> = new Map();
  private isEnabled = true;
  private currentContext: string | null = null;

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    document.addEventListener('keydown', this.handleKeyDown);
  }

  /**
   * Register a keyboard binding
   */
  register(binding: KeyBinding): () => void {
    const key = this.getBindingKey(binding);
    this.bindings.set(key, binding);

    // Return unregister function
    return () => {
      this.bindings.delete(key);
    };
  }

  /**
   * Set the current context for conditional bindings
   */
  setContext(context: string | null): void {
    this.currentContext = context;
  }

  /**
   * Enable/disable keyboard handling
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * Get all active bindings for current context
   */
  getActiveBindings(): KeyBinding[] {
    return Array.from(this.bindings.values()).filter(binding => 
      !binding.context || binding.context === this.currentContext
    );
  }

  /**
   * Clear all bindings
   */
  clear(): void {
    this.bindings.clear();
  }

  /**
   * Destroy the keyboard manager
   */
  destroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
    this.bindings.clear();
  }

  private getBindingKey(binding: KeyBinding): string {
    const modifiers = [];
    if (binding.ctrlKey) modifiers.push('ctrl');
    if (binding.altKey) modifiers.push('alt');
    if (binding.shiftKey) modifiers.push('shift');
    if (binding.metaKey) modifiers.push('meta');
    
    const key = binding.key.toLowerCase();
    return [...modifiers, key].join('+');
  }

  private async handleKeyDown(event: KeyboardEvent): Promise<void> {
    if (!this.isEnabled) return;

    // Don't handle keys when user is typing in input fields
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const key = this.getBindingKey({
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      description: '',
      action: () => {}
    });

    const binding = this.bindings.get(key);
    if (binding && (!binding.context || binding.context === this.currentContext)) {
      event.preventDefault();
      event.stopPropagation();
      
      try {
        await binding.action();
      } catch (error) {
        console.error('Keyboard binding error:', error);
      }
    }
  }
}

// Global keyboard manager instance
export const keyboardManager = new KeyboardManager();

/**
 * Hook for components to easily register keyboard bindings
 */
export function useKeyboardBindings(bindings: KeyBinding[]): () => void {
  const unregisterFunctions = bindings.map(binding => keyboardManager.register(binding));
  
  // Return cleanup function
  return () => {
    unregisterFunctions.forEach(unregister => unregister());
  };
}

/**
 * Common keyboard shortcuts used across the app
 */
export const CommonKeys = {
  ENTER: 'Enter',
  ESCAPE: 'Escape',
  SPACE: ' ',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  TAB: 'Tab',
  BACKSPACE: 'Backspace',
  DELETE: 'Delete',
  HOME: 'Home',
  END: 'End',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown'
} as const;

/**
 * Predefined keyboard shortcuts for common actions
 */
export const GlobalShortcuts = {
  // Navigation
  LEARN: { key: '1', ctrlKey: true, description: 'Go to Learn mode' },
  REVIEW: { key: '2', ctrlKey: true, description: 'Go to Review mode' },
  QUIZ: { key: '3', ctrlKey: true, description: 'Go to Quiz mode' },
  PROGRESS: { key: '4', ctrlKey: true, description: 'Go to Progress' },
  SETTINGS: { key: '5', ctrlKey: true, description: 'Go to Settings' },
  
  // Audio
  PLAY_AUDIO: { key: CommonKeys.SPACE, description: 'Play/Stop audio' },
  REPLAY_AUDIO: { key: 'r', description: 'Replay audio' },
  
  // Learning actions
  NEXT: { key: CommonKeys.ARROW_RIGHT, description: 'Next item' },
  PREVIOUS: { key: CommonKeys.ARROW_LEFT, description: 'Previous item' },
  MARK_KNOWN: { key: 'k', description: 'Mark word as known' },
  MARK_IGNORED: { key: 'i', description: 'Mark word as ignored' },
  REMOVE_SENTENCE: { key: CommonKeys.DELETE, description: 'Remove current sentence' },
  REMOVE_SENTENCE_BACKSPACE: { key: CommonKeys.BACKSPACE, description: 'Remove current sentence' },
  REVEAL_ANSWER: { key: CommonKeys.ENTER, description: 'Reveal answer/Continue' },
  
  // Quiz actions
  ANSWER_1: { key: '1', description: 'Select first answer' },
  ANSWER_2: { key: '2', description: 'Select second answer' },
  ANSWER_3: { key: '3', description: 'Select third answer' },
  ANSWER_4: { key: '4', description: 'Select fourth answer' },
  
  // SRS difficulty ratings
  SRS_FAIL: { key: '1', description: 'Rate as Failed' },
  SRS_HARD: { key: '2', description: 'Rate as Hard' },
  SRS_GOOD: { key: '3', description: 'Rate as Good' },
  SRS_EASY: { key: '4', description: 'Rate as Easy' },
  
  // General
  ESCAPE: { key: CommonKeys.ESCAPE, description: 'Cancel/Go back' },
  TOGGLE_AUDIO_ONLY: { key: 'a', description: 'Toggle audio-only mode' },
  RECORD_PRONUNCIATION: { key: 'm', description: 'Record pronunciation' }
} as const;
