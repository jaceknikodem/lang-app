/**
 * Key/value application settings.
 */

import { BaseRepository } from './base-repository.js';

export class SettingsRepository extends BaseRepository {
  async getSetting(key: string): Promise<string | null> {
    return this.query(`Failed to get setting`, (db) => {
      const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
      const row = stmt.get(key) as any;

      return row ? row.value : null;
    });
  }
  async setSetting(key: string, value: string): Promise<void> {
    this.query(`Failed to set setting`, (db) => {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);

      stmt.run(key, value);
    });
  }
  async getCurrentLanguage(): Promise<string> {
    const language = await this.getSetting('current_language');
    return language || 'spanish'; // Default fallback
  }
  async setCurrentLanguage(language: string): Promise<void> {
    await this.setSetting('current_language', language);
  }
  async getCurrentTheme(): Promise<string> {
    const theme = await this.getSetting('current_theme');
    return theme || 'general';
  }
  async setCurrentTheme(theme: string): Promise<void> {
    await this.setSetting('current_theme', theme);
  }
}
