# Build Configuration

This directory contains build assets and configuration for distributing the Local Language Learning app.

## Files

- `icon.icns` - macOS application icon (512x512 recommended)
- `icon.ico` - Windows application icon (256x256 recommended)  
- `icon.png` - Linux application icon (512x512 recommended)
- `entitlements.mac.plist` - macOS code signing entitlements

## Building for Distribution

### Prerequisites

1. **For macOS code signing and notarization:**
   - Apple Developer account
   - Valid Developer ID Application certificate
   - Set environment variables:
     ```bash
     export APPLE_ID="your-apple-id@example.com"
     export APPLE_ID_PASSWORD="app-specific-password"
     export APPLE_TEAM_ID="your-team-id"
     ```

2. **For Windows code signing:**
   - Valid code signing certificate
   - Set environment variables for certificate details

### Build Commands

```bash
# Build for current platform
npm run dist

# Build for specific platforms
npm run dist:mac
npm run dist:win
npm run dist:linux

# Build for all platforms
npm run dist:all

# Create unpacked directory (for testing)
npm run pack
```

### Distribution Files

Built applications will be created in the `release/` directory:

- **macOS**: `.dmg` installer and `.zip` archive
- **Windows**: `.exe` installer and portable `.exe`
- **Linux**: `.AppImage` and `.deb` package

## Icon Requirements

Replace the placeholder icon files with actual application icons:

- **macOS**: 512x512 PNG converted to .icns format
- **Windows**: 256x256 PNG converted to .ico format
- **Linux**: 512x512 PNG file

Use tools like `iconutil` (macOS) or online converters to create proper icon formats.

## Code Signing

### macOS
The app is configured for automatic code signing and notarization when proper certificates and environment variables are set.

### Windows
Add Windows code signing configuration to package.json build section when certificate is available.

## Security

The macOS entitlements file includes minimal required permissions:
- JIT compilation for Electron
- Network access for local Ollama instance
- File system access for data storage
- No microphone or camera access (privacy-focused)