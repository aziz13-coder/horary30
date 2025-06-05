const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Fix: Proper development mode detection
const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV === 'true';
const isElectron = process.env.ELECTRON === 'true';

// Keep a global reference of the window object
let mainWindow;
let backendProcess = null;
const BACKEND_PORT = 5000;

console.log('Environment:', { isDev, isElectron, NODE_ENV: process.env.NODE_ENV });

// Check if backend is running
function checkBackendHealth() {
  return new Promise((resolve) => {
    const http = require('http');
    const options = {
      hostname: 'localhost',
      port: BACKEND_PORT,
      path: '/api/health',
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => resolve(false));
    req.end();
  });
}

// Start backend server
async function startBackend() {
  if (isDev) {
    console.log('Development mode: Checking if backend is already running...');
    
    // In development, check if backend is already running
    const isRunning = await checkBackendHealth();
    if (isRunning) {
      console.log('Backend is already running');
      return true;
    }
    
    console.log('Backend not running. Please start manually with: npm run dev:backend');
    
    // Show a dialog asking user to start backend
    const result = await dialog.showMessageBox(null, {
      type: 'warning',
      buttons: ['Continue Anyway', 'Exit'],
      defaultId: 0,
      title: 'Backend Not Running',
      message: 'The backend server is not running.',
      detail: 'Please start the backend server with "npm run dev:backend" in a separate terminal, or click "Continue Anyway" to use demo mode.'
    });
    
    if (result.response === 1) {
      app.quit();
      return false;
    }
    
    return true; // Continue with demo mode
  }

  try {
    // In production, backend is bundled in resources/backend/
    const backendPath = path.join(process.resourcesPath, 'backend');
    const backendExecutable = process.platform === 'win32' ? 'app.exe' : 'app';
    const backendBinary = path.join(backendPath, backendExecutable);

    if (!fs.existsSync(backendBinary)) {
      console.error('Backend binary not found:', backendBinary);
      throw new Error(`Backend not found at ${backendBinary}`);
    }

    console.log('Starting backend:', backendBinary);
    
    backendProcess = spawn(backendBinary, [], {
      cwd: backendPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    backendProcess.stdout.on('data', (data) => {
      console.log('Backend:', data.toString());
    });

    backendProcess.stderr.on('data', (data) => {
      console.error('Backend Error:', data.toString());
    });

    backendProcess.on('close', (code) => {
      console.log(`Backend process exited with code ${code}`);
      backendProcess = null;
    });

    // Wait for backend to be ready
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const isHealthy = await checkBackendHealth();
      if (isHealthy) {
        console.log('Backend is ready');
        return true;
      }
      attempts++;
      console.log(`Waiting for backend... (${attempts}/${maxAttempts})`);
    }

    throw new Error('Backend failed to start within timeout');

  } catch (error) {
    console.error('Failed to start backend:', error);
    
    dialog.showErrorBox(
      'Backend Error',
      `Failed to start the horary calculation engine:\n\n${error.message}\n\nThe application will close.`
    );
    
    app.quit();
    return false;
  }
}

// Stop backend server
function stopBackend() {
  if (backendProcess) {
    console.log('Stopping backend process...');
    backendProcess.kill();
    backendProcess = null;
  }
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'default',
    show: false, // Don't show until ready
    backgroundColor: '#1a1a1a'
  });

  // Load the app
  if (isDev) {
    console.log('Loading development URL: http://localhost:3000');
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    console.log('Loading production file:', path.join(__dirname, '../dist/index.html'));
    const indexPath = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      console.error('Production build not found at:', indexPath);
      dialog.showErrorBox('Build Error', 'Production build not found. Please run: npm run build');
      app.quit();
      return;
    }
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    mainWindow.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Security: Prevent navigation to external websites
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    
    if (parsedUrl.origin !== 'http://localhost:3000' && !navigationUrl.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });

  // Handle page load errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Page failed to load:', errorCode, errorDescription, validatedURL);
    
    if (isDev && validatedURL.includes('localhost:3000')) {
      dialog.showErrorBox(
        'Development Server Error',
        'Could not connect to the development server at localhost:3000.\n\nPlease make sure the Vite dev server is running with: npm run dev'
      );
    }
  });
}

// IPC handlers
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-app-path', () => {
  return app.getAppPath();
});

ipcMain.handle('show-message-box', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result;
});

ipcMain.handle('show-error-box', (event, title, content) => {
  dialog.showErrorBox(title, content);
});

ipcMain.handle('check-backend-health', async () => {
  return await checkBackendHealth();
});

ipcMain.handle('get-backend-url', () => {
  return `http://localhost:${BACKEND_PORT}`;
});

// App event handlers
app.whenReady().then(async () => {
  console.log('Enhanced Horary Master starting...');
  console.log('App is ready, starting backend...');
  
  // Start backend first
  const backendStarted = await startBackend();
  
  if (backendStarted || isDev) {
    console.log('Creating window...');
    createWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend();
});

// Handle certificate errors (for development)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (navigationEvent, navigationUrl) => {
    navigationEvent.preventDefault();
    shell.openExternal(navigationUrl);
  });
});

// Prevent dropping files
app.on('web-contents-created', (event, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    // Disable webviews
    event.preventDefault();
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  dialog.showErrorBox('Unexpected Error', `An unexpected error occurred: ${error.message}`);
});

console.log('Enhanced Horary Master - Electron main process initialized');