const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App information
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  
  // Backend communication
  checkBackendHealth: () => ipcRenderer.invoke('check-backend-health'),
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  
  // Dialog methods
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  showErrorBox: (title, content) => ipcRenderer.invoke('show-error-box', title, content),
  
  // Platform detection
  platform: process.platform,
  isProduction: process.env.NODE_ENV === 'production',
  
  // Version information for UI
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});

// Enhanced Horary Master specific utilities
contextBridge.exposeInMainWorld('horaryAPI', {
  // Application metadata
  appName: 'Enhanced Horary Master',
  appVersion: '1.1.0',
  
  // License information (will be populated by license system)
  license: {
    isValid: false,
    expiryDate: null,
    licensedTo: null,
    features: []
  },
  
  // Feature flags for the application
  features: {
    enhancedEngine: true,
    traditionalAnalysis: true,
    solarConditions: true,
    moonVoidAnalysis: true,
    timezoneSupport: true,
    multiLanguage: false // Future feature
  },
  
  // Error handling utilities
  handleError: (error, context = 'Unknown') => {
    console.error(`[${context}] Error:`, error);
    return {
      type: 'error',
      message: error.message || 'An unknown error occurred',
      context: context,
      timestamp: new Date().toISOString()
    };
  },
  
  // Local storage wrapper for settings
  settings: {
    get: (key, defaultValue = null) => {
      try {
        const value = localStorage.getItem(`horary_${key}`);
        return value ? JSON.parse(value) : defaultValue;
      } catch {
        return defaultValue;
      }
    },
    
    set: (key, value) => {
      try {
        localStorage.setItem(`horary_${key}`, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    
    remove: (key) => {
      try {
        localStorage.removeItem(`horary_${key}`);
        return true;
      } catch {
        return false;
      }
    }
  }
});

// Security: Log any attempts to access Node.js APIs from renderer
if (process.env.NODE_ENV === 'development') {
  window.addEventListener('DOMContentLoaded', () => {
    console.log('Enhanced Horary Master - Preload script loaded');
    console.log('Platform:', process.platform);
    console.log('Electron version:', process.versions.electron);
    console.log('Node version:', process.versions.node);
  });
}

// Prevent the renderer from accessing Node.js APIs directly
delete window.require;
delete window.exports;
delete window.module;

console.log('Enhanced Horary Master - Preload context bridge established');