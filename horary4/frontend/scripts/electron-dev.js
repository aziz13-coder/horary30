#!/usr/bin/env node

/**
 * Enhanced Horary Master - Electron Development Script
 * 
 * This script manages the development environment for the Electron app:
 * - Starts the Vite dev server
 * - Waits for it to be ready
 * - Starts the Electron app
 * - Handles graceful shutdown
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const net = require('net');

const DEV_SERVER_PORT = parseInt(process.env.VITE_DEV_PORT, 10) || 3000;

async function findAvailablePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findAvailablePort(port + 1));
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      const available = server.address().port;
      server.close(() => resolve(available));
    });
    server.listen(port, '127.0.0.1');
  });
}

class ElectronDevManager {
  constructor() {
    this.viteProcess = null;
    this.electronProcess = null;
    this.isShuttingDown = false;
    this.devServerUrl = `http://localhost:${DEV_SERVER_PORT}`;
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = {
      'info': '📋',
      'success': '✅',
      'error': '❌',
      'warning': '⚠️',
      'vite': '⚡',
      'electron': '🔌'
    }[type] || 'ℹ️';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async checkServerReady(url, maxAttempts = 30, interval = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          const req = http.get(url, (res) => {
            if (res.statusCode === 200) {
              resolve();
            } else {
              reject(new Error(`Server returned ${res.statusCode}`));
            }
          });
          
          req.on('error', reject);
          req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
          });
        });
        
        this.log('Vite dev server is ready!', 'success');
        return true;
        
      } catch (error) {
        this.log(`Waiting for dev server... (${attempt}/${maxAttempts})`, 'vite');
        
        if (attempt === maxAttempts) {
          throw new Error(`Dev server not ready after ${maxAttempts} attempts`);
        }
        
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
  }

  async startViteServer() {
    this.log('Starting Vite development server...', 'vite');

    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const frontendDir = path.join(__dirname, '..');

    const port = await findAvailablePort(DEV_SERVER_PORT);
    this.devServerUrl = `http://localhost:${port}`;

    if (port !== DEV_SERVER_PORT) {
      this.log(`Port ${DEV_SERVER_PORT} in use, using ${port} instead`, 'warning');
    }

    this.viteProcess = spawn(npmCmd, ['run', 'dev', '--', '--port', String(port)], {
      cwd: frontendDir,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
      shell: true
    });

    this.viteProcess.stdout.on('data', (data) => {
      const output = data.toString();
      // Filter out some verbose Vite output
      if (output.includes('Local:') || output.includes('ready in') || output.includes('hmr update')) {
        process.stdout.write(`⚡ ${output}`);
      }
    });

    this.viteProcess.stderr.on('data', (data) => {
      process.stderr.write(`⚡ ${data}`);
    });

    this.viteProcess.on('close', (code) => {
      if (!this.isShuttingDown) {
        this.log(`Vite process exited with code ${code}`, code === 0 ? 'info' : 'error');
      }
    });

    this.viteProcess.on('error', (error) => {
      this.log(`Vite process error: ${error.message}`, 'error');
    });

    // Wait for the server to be ready
    await this.checkServerReady(this.devServerUrl);
  }

  async startElectron() {
    this.log('Starting Electron application...', 'electron');
    
    const electronPath = path.join(__dirname, '../node_modules/.bin/electron' + (process.platform === 'win32' ? '.cmd' : ''));
    
    this.electronProcess = spawn(electronPath, ['.'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ELECTRON_ENABLE_LOGGING: '1'
      },
      shell: true
    });

    this.electronProcess.stdout.on('data', (data) => {
      process.stdout.write(`🔌 ${data}`);
    });

    this.electronProcess.stderr.on('data', (data) => {
      process.stderr.write(`🔌 ${data}`);
    });

    this.electronProcess.on('close', (code) => {
      if (!this.isShuttingDown) {
        this.log(`Electron process exited with code ${code}`, 'electron');
        this.shutdown();
      }
    });

    this.electronProcess.on('error', (error) => {
      this.log(`Electron process error: ${error.message}`, 'error');
    });
  }

  async shutdown() {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    this.log('Shutting down development environment...', 'info');

    // Kill Electron first (gentler shutdown)
    if (this.electronProcess && !this.electronProcess.killed) {
      this.log('Stopping Electron...', 'electron');
      this.electronProcess.kill('SIGTERM');
      
      // Force kill after 5 seconds if needed
      setTimeout(() => {
        if (!this.electronProcess.killed) {
          this.electronProcess.kill('SIGKILL');
        }
      }, 5000);
    }

    // Kill Vite server
    if (this.viteProcess && !this.viteProcess.killed) {
      this.log('Stopping Vite dev server...', 'vite');
      this.viteProcess.kill('SIGTERM');
      
      // Force kill after 3 seconds if needed
      setTimeout(() => {
        if (!this.viteProcess.killed) {
          this.viteProcess.kill('SIGKILL');
        }
      }, 3000);
    }

    // Exit after a short delay
    setTimeout(() => {
      this.log('Development environment stopped', 'success');
      process.exit(0);
    }, 1000);
  }

  setupSignalHandlers() {
    // Handle Ctrl+C and other termination signals
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach(signal => {
      process.on(signal, () => {
        this.log(`Received ${signal}, shutting down...`, 'warning');
        this.shutdown();
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.log(`Uncaught exception: ${error.message}`, 'error');
      this.shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.log(`Unhandled rejection at ${promise}: ${reason}`, 'error');
      this.shutdown();
    });
  }

  async start() {
    try {
      this.log('Starting Enhanced Horary Master development environment...', 'info');
      
      this.setupSignalHandlers();
      
      // Start Vite dev server and wait for it to be ready
      await this.startViteServer();
      
      // Start Electron
      await this.startElectron();
      
      this.log('Development environment started successfully!', 'success');
      this.log(`Frontend: ${this.devServerUrl}`, 'info');
      this.log('Press Ctrl+C to stop', 'info');
      
    } catch (error) {
      this.log(`Failed to start development environment: ${error.message}`, 'error');
      this.shutdown();
      process.exit(1);
    }
  }
}

// Command line options
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Enhanced Horary Master - Electron Development Script

Usage: node scripts/electron-dev.js [options]

Options:
  --help, -h          Show this help message

This script:
1. Starts the Vite development server
2. Waits for it to be ready
3. Launches the Electron application
4. Handles graceful shutdown

Environment Variables:
  VITE_DEV_PORT       Preferred port for Vite dev server (default: 3000).
                      If the port is in use, the next free port is selected.
  ELECTRON_LOG_LEVEL  Electron logging level (default: info)

Examples:
  node scripts/electron-dev.js
  VITE_DEV_PORT=3001 node scripts/electron-dev.js
  `);
  process.exit(0);
}

// Start the development environment
const devManager = new ElectronDevManager();
devManager.start();