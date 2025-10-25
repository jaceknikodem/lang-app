# Application Lifecycle Management

This module provides comprehensive application lifecycle management including startup/shutdown handling, data backup/restore, and update management.

## Features

### Lifecycle Manager

- **Startup Procedures**: Ensures required directories exist, checks for recovery scenarios
- **Graceful Shutdown**: Creates backups and properly closes resources
- **Data Backup**: Creates timestamped backups of database and audio files
- **Data Restore**: Restores from backup with user confirmation
- **Backup Cleanup**: Automatically removes old backups (30-day retention)

### Update Manager

- **Update Checking**: Checks for new versions (configurable intervals)
- **Update Notifications**: User-friendly update dialogs
- **Release Notes**: Display what's new in updates
- **Update Reminders**: Persistent reminders for available updates
- **Version Comparison**: Semantic version comparison

## Usage

### In Main Process

```typescript
import { LifecycleManager, UpdateManager } from './lifecycle/index.js';

// Initialize lifecycle manager
const lifecycleManager = new LifecycleManager({
  databaseLayer: databaseInstance,
  userDataPath: app.getPath('userData'),
  backupRetentionDays: 30
});

// Initialize update manager
const updateManager = new UpdateManager({
  checkOnStartup: true,
  checkIntervalHours: 24,
  autoDownload: false
});

// Handle startup
await lifecycleManager.handleStartup();
await updateManager.initialize();

// Handle shutdown
await lifecycleManager.handleShutdown();
updateManager.cleanup();
```

### In Renderer Process

```typescript
// Create backup
const backupPath = await window.electronAPI.lifecycle.createBackup();

// Check for updates
const hasUpdates = await window.electronAPI.lifecycle.checkForUpdates();

// Get app version
const version = await window.electronAPI.lifecycle.getAppVersion();
```

## Configuration

### Lifecycle Manager Config

- `databaseLayer`: Reference to the database layer instance
- `userDataPath`: Path to user data directory
- `backupRetentionDays`: Number of days to keep backups (default: 30)

### Update Manager Config

- `checkOnStartup`: Whether to check for updates on app startup
- `checkIntervalHours`: Hours between automatic update checks
- `updateServerUrl`: URL for update server (optional)
- `autoDownload`: Whether to automatically download updates

## File Structure

### Backups

Backups are stored in `{userDataPath}/backups/backup-{timestamp}/`:
- `language_learning.db` - Database backup
- `audio/` - Audio files backup
- `metadata.json` - Backup metadata

### Update Reminders

Update reminders are stored in `{userDataPath}/update-reminder.json`

## Security Considerations

- All backup operations are local-only
- Update checks can be configured to use custom servers
- No automatic installation of updates (user confirmation required)
- Backup restoration requires user confirmation

## Error Handling

- Graceful degradation when backup/restore fails
- Non-blocking update checks
- Comprehensive error logging
- User-friendly error messages

## Future Enhancements

- Encrypted backups
- Incremental backups
- Cloud backup integration (optional)
- Automatic update installation (with user consent)
- Backup compression