import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const isElectron = process.env.ELECTRON === 'true' || mode === 'electron';
  const isDev = command === 'serve';
  
  console.log('Vite config:', { isElectron, isDev, mode, command });
  
  return {
    plugins: [react()],
    
    // Use relative paths for Electron compatibility
    base: isElectron ? './' : '/',
    
    server: {
      port: 3000,
      open: !isElectron, // Don't auto-open browser in Electron mode
      cors: true,
      strictPort: true,
      host: 'localhost', // Changed from 0.0.0.0 to localhost for security
    },
    
    build: {
      outDir: 'dist',
      sourcemap: isDev,
      minify: !isDev,
      
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html')
        },
        
        output: {
          // Optimize chunk splitting
          manualChunks: !isElectron ? {
            'vendor': ['react', 'react-dom'],
            'icons': ['lucide-react']
          } : undefined
        }
      },
      
      // Target modern environments
      target: isElectron ? 'esnext' : 'es2015',
      
      assetsDir: 'assets',
      chunkSizeWarningLimit: 1000,
    },
    
    // Environment variables for the app
    define: {
      global: 'globalThis',
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.1.0'),
      __IS_ELECTRON__: JSON.stringify(isElectron),
      __IS_DEV__: JSON.stringify(isDev),
      'process.env.ELECTRON': JSON.stringify(process.env.ELECTRON || 'false'),
    },
    
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@components': resolve(__dirname, 'src/components'),
        '@utils': resolve(__dirname, 'src/utils'),
        '@assets': resolve(__dirname, 'src/assets'),
      }
    },
    
    // Optimization
    optimizeDeps: {
      include: ['react', 'react-dom', 'lucide-react'],
      // Force pre-bundling of CJS dependencies
      force: isDev
    },
    
    // CSS configuration - simplified
    css: {
      devSourcemap: isDev
    },
    
    // Preview configuration
    preview: {
      port: 4173,
      strictPort: true,
      host: 'localhost'
    },
    
    // Electron-specific handling
    ...(isElectron && {
      // Additional optimizations for Electron
      build: {
        target: 'esnext',
        minify: false, // Easier debugging in Electron
        sourcemap: true,
        rollupOptions: {
          output: {
            // Single chunk for Electron for easier loading
            manualChunks: undefined,
            inlineDynamicImports: true
          }
        }
      }
    })
  }
})