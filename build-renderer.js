#!/usr/bin/env node

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

async function buildRenderer() {
  try {
    // Ensure dist/renderer directory exists
    if (!fs.existsSync('dist/renderer')) {
      fs.mkdirSync('dist/renderer', { recursive: true });
    }

    const buildOptions = {
      entryPoints: ['src/renderer/components/app-root.ts'],
      bundle: true,
      outfile: 'dist/renderer/app-bundle.js',
      format: 'esm',
      target: 'es2020',
      platform: 'browser',
      sourcemap: true,
      external: [
        // Node.js-only modules that shouldn't be bundled for renderer
        'convict',
        '@iarna/toml',
        'dotenv',
        'fs',
        'path',
        'stream',
        'util',
        // Config module is Node.js only
        '../config/index.js',
        '../../shared/config/index.js'
      ],
      loader: {
        '.ts': 'ts',
        '.js': 'js'
      },
      tsconfig: 'tsconfig.renderer.json'
    };

    if (isWatch) {
      // Watch mode
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');
      
      // Also watch HTML file
      fs.watchFile('src/renderer/index.html', () => {
        fs.copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
        console.log('HTML file updated');
      });
    } else {
      // Single build
      await esbuild.build(buildOptions);
      console.log('Renderer build complete!');
    }

    // Copy HTML file
    fs.copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
    
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildRenderer();