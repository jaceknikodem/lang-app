/**
 * Simple routing utility for managing application navigation
 */

export type AppMode = 'topic-selection' | 'word-selection' | 'learning' | 'quiz' | 'progress' | 'settings';

export interface RouteState {
  mode: AppMode;
  data?: any;
}

export class Router {
  private currentRoute: RouteState = { mode: 'topic-selection' };
  private listeners: Set<(route: RouteState) => void> = new Set();

  getCurrentRoute(): RouteState {
    return { ...this.currentRoute };
  }

  navigateTo(mode: AppMode, data?: any): void {
    const newRoute: RouteState = { mode, data };
    this.currentRoute = newRoute;
    this.notifyListeners();
  }

  subscribe(listener: (route: RouteState) => void): () => void {
    this.listeners.add(listener);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.getCurrentRoute());
      } catch (error) {
        console.error('Router listener error:', error);
      }
    });
  }

  // Navigation helpers
  goToTopicSelection(): void {
    this.navigateTo('topic-selection');
  }

  goToWordSelection(topic?: string): void {
    this.navigateTo('word-selection', { topic });
  }

  goToLearning(specificWords?: any[]): void {
    this.navigateTo('learning', specificWords ? { specificWords } : undefined);
  }

  goToQuiz(specificWords?: any[], direction: 'foreign-to-english' | 'english-to-foreign' = 'foreign-to-english'): void {
    const data: any = { direction };
    if (specificWords) {
      data.specificWords = specificWords;
    }
    this.navigateTo('quiz', data);
  }

  goToProgress(): void {
    this.navigateTo('progress');
  }

  goToSettings(): void {
    this.navigateTo('settings');
  }

  // Check current mode
  isCurrentMode(mode: AppMode): boolean {
    return this.currentRoute.mode === mode;
  }

  // Get route data
  getRouteData<T = any>(): T | undefined {
    return this.currentRoute.data;
  }
}

// Global router instance
export const router = new Router();