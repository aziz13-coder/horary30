#!/usr/bin/env node

/**
 * Enhanced Horary Master - Build Script
 * 
 * This script builds the complete Electron application including:
 * - Frontend React app
 * - Backend Python API as executable
 * - License system integration
 * - Platform-specific packaging
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');

const platform = os.platform();
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';

console.log(`🚀 Building Enhanced Horary Master for ${platform}...`);

class BuildManager {
  constructor() {
    this.buildSteps = [];
    this.errors = [];
    this.startTime = Date.now();
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = {
      'info': '📋',
      'success': '✅',
      'error': '❌',
      'warning': '⚠️',
      'build': '🔨'
    }[type] || 'ℹ️';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async runCommand(command, cwd = process.cwd(), description = '') {
    return new Promise((resolve, reject) => {
      this.log(`${description || command}`, 'build');
      
      const child = spawn(command, { 
        shell: true, 
        cwd,
        stdio: ['inherit', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data;
        process.stdout.write(data);
      });

      child.stderr?.on('data', (data) => {
        stderr += data;
        process.stderr.write(data);
      });

      child.on('close', (code) => {
        if (code === 0) {
          this.log(`${description || command} completed successfully`, 'success');
          resolve({ stdout, stderr, code });
        } else {
          const error = `Command failed with code ${code}: ${command}`;
          this.log(error, 'error');
          this.errors.push(error);
          reject(new Error(error));
        }
      });

      child.on('error', (error) => {
        this.log(`Command error: ${error.message}`, 'error');
        this.errors.push(error.message);
        reject(error);
      });
    });
  }

  checkRequirements() {
    this.log('Checking build requirements...', 'info');
    
    const requirements = [
      { command: 'node --version', name: 'Node.js' },
      { command: 'npm --version', name: 'npm' },
      { command: 'python --version', name: 'Python' }
    ];

    for (const req of requirements) {
      try {
        const result = execSync(req.command, { encoding: 'utf8' });
        this.log(`${req.name}: ${result.trim()}`, 'success');
      } catch (error) {
        this.log(`${req.name} not found or not working`, 'error');
        this.errors.push(`${req.name} requirement not met`);
      }
    }

    if (this.errors.length > 0) {
      throw new Error('Build requirements not met');
    }
  }

  async cleanBuildDirectories() {
    this.log('Cleaning build directories...', 'info');
    
    const dirsToClean = [
      'dist',
      'dist-electron',
      '../backend/dist',
      '../backend/build'
    ];

    for (const dir of dirsToClean) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          this.log(`Cleaned ${dir}`, 'success');
        }
      } catch (error) {
        this.log(`Failed to clean ${dir}: ${error.message}`, 'warning');
      }
    }
  }

  async installDependencies() {
    this.log('Installing frontend dependencies...', 'info');
    await this.runCommand('npm ci', process.cwd(), 'Frontend dependency installation');

    this.log('Installing backend dependencies...', 'info');
    await this.runCommand('pip install -r requirements.txt', '../backend', 'Backend dependency installation');
    
    // Install PyInstaller if not present
    try {
      execSync('pyinstaller --version', { encoding: 'utf8' });
      this.log('PyInstaller already installed', 'success');
    } catch {
      this.log('Installing PyInstaller...', 'info');
      await this.runCommand('pip install pyinstaller', '../backend', 'PyInstaller installation');
    }
  }

  async buildBackend() {
    this.log('Building backend executable...', 'build');

    const backendDir = path.resolve('../backend');
    const distDir = path.join(backendDir, 'dist');

    // Ensure dist directory exists
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    // PyInstaller command for different platforms
    const enginePath = path.join(backendDir, 'horary_engine.py');
    const mathPath = path.join(backendDir, '_horary_math.py');
    const licensePath = path.join(backendDir, 'license_manager.py');
    const sep = isWindows ? ';' : ':';

    const pyinstallerCmd = [
      'pyinstaller',
      '--onefile',
      '--distpath', 'dist',
      '--workpath', 'build',
      '--specpath', 'build',
      '--name', isWindows ? 'app' : 'app',
      '--hidden-import', 'flask',
      '--hidden-import', 'flask_cors',
      '--hidden-import', 'geopy',
      '--hidden-import', 'timezonefinder',
      '--hidden-import', 'swisseph',
      '--add-data', `"${enginePath}"${sep}.`,
      '--add-data', `"${mathPath}"${sep}.`,
      '--add-data', `"${licensePath}"${sep}.`,
      'app.py'
    ].join(' ');

    await this.runCommand(pyinstallerCmd, backendDir, 'Backend executable creation');

    // Copy additional files
    const filesToCopy = [
      'public_key.pem',
      'horary_engine.py',
      '_horary_math.py',
      'license_manager.py'
    ];

    for (const file of filesToCopy) {
      const src = path.join(backendDir, file);
      const dest = path.join(distDir, file);
      
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        this.log(`Copied ${file} to dist`, 'success');
      } else {
        this.log(`Warning: ${file} not found`, 'warning');
      }
    }

    this.log('Backend build completed', 'success');
  }

  async buildFrontend() {
    this.log('Building frontend...', 'build');
    
    // Set environment for Electron build
    process.env.ELECTRON = 'true';
    
    await this.runCommand('npm run build', process.cwd(), 'Frontend build');
    this.log('Frontend build completed', 'success');
  }

  async packageElectron() {
    this.log('Packaging Electron application...', 'build');

    const platformTargets = {
      'win32': 'npm run electron:dist -- --win',
      'darwin': 'npm run electron:dist -- --mac',
      'linux': 'npm run electron:dist -- --linux'
    };

    const command = platformTargets[platform] || 'npm run electron:dist';
    
    await this.runCommand(command, process.cwd(), 'Electron packaging');
    this.log('Electron packaging completed', 'success');
  }

  async generateLicenseKeys() {
    this.log('Generating license system keys...', 'info');

    const backendDir = path.resolve('../backend');
    const keysExist = fs.existsSync(path.join(backendDir, 'private_key.pem')) && 
                     fs.existsSync(path.join(backendDir, 'public_key.pem'));

    if (!keysExist) {
      this.log('License keys not found, generating new ones...', 'warning');
      await this.runCommand(
        'python license_generator.py --generate-keys',
        backendDir,
        'License key generation'
      );
    } else {
      this.log('License keys already exist', 'success');
    }
  }

  async createTrialLicense() {
    this.log('Creating trial license...', 'info');

    const backendDir = path.resolve('../backend');
    const trialLicenseCmd = [
      'python license_generator.py',
      '--trial-license "Trial User" "trial@example.com"',
      '--days 30',
      '--output ../frontend/trial_license.json'
    ].join(' ');

    try {
      await this.runCommand(trialLicenseCmd, backendDir, 'Trial license creation');
    } catch (error) {
      this.log('Trial license creation failed (optional)', 'warning');
    }
  }

  async validateBuild() {
    this.log('Validating build...', 'info');

    const requiredFiles = [
      'dist/index.html',
      '../backend/dist/app' + (isWindows ? '.exe' : ''),
      '../backend/public_key.pem'
    ];

    let validationPassed = true;

    for (const file of requiredFiles) {
      if (fs.existsSync(file)) {
        this.log(`✓ Found ${file}`, 'success');
      } else {
        this.log(`✗ Missing ${file}`, 'error');
        validationPassed = false;
      }
    }

    if (!validationPassed) {
      throw new Error('Build validation failed - missing required files');
    }

    this.log('Build validation passed', 'success');
  }

  async showBuildSummary() {
    const buildTime = ((Date.now() - this.startTime) / 1000).toFixed(2);
    
    this.log(`\n🎉 Build completed in ${buildTime} seconds!`, 'success');
    
    if (this.errors.length > 0) {
      this.log('\n⚠️  Build completed with warnings:', 'warning');
      this.errors.forEach(error => this.log(`  - ${error}`, 'warning'));
    }

    this.log('\n📦 Build artifacts:', 'info');
    this.log('  - Frontend: ./dist/', 'info');
    this.log('  - Backend: ../backend/dist/', 'info');
    this.log('  - Electron packages: ./dist-electron/', 'info');
    
    this.log('\n🚀 Next steps:', 'info');
    this.log('  1. Test the application: npm run electron:dev', 'info');
    this.log('  2. Create licenses: cd ../backend && python license_generator.py --help', 'info');
    this.log('  3. Distribute: Copy files from dist-electron/', 'info');
  }

  async build() {
    try {
      this.log('Starting Enhanced Horary Master build process...', 'info');
      
      this.checkRequirements();
      await this.cleanBuildDirectories();
      await this.installDependencies();
      await this.generateLicenseKeys();
      await this.buildBackend();
      await this.buildFrontend();
      await this.packageElectron();
      await this.createTrialLicense();
      await this.validateBuild();
      await this.showBuildSummary();
      
    } catch (error) {
      this.log(`Build failed: ${error.message}`, 'error');
      process.exit(1);
    }
  }
}

// CLI handling
const args = process.argv.slice(2);
const buildManager = new BuildManager();

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Enhanced Horary Master Build Script

Usage: node scripts/build.js [options]

Options:
  --help, -h          Show this help message
  --backend-only      Build only the backend
  --frontend-only     Build only the frontend
  --package-only      Package Electron app (requires existing builds)
  --clean             Clean build directories only
  --validate          Validate existing build

Examples:
  node scripts/build.js                 # Full build
  node scripts/build.js --backend-only  # Backend only
  node scripts/build.js --clean         # Clean only
  `);
  process.exit(0);
}

// Handle specific build steps
(async () => {
  if (args.includes('--clean')) {
    await buildManager.cleanBuildDirectories();
  } else if (args.includes('--backend-only')) {
    buildManager.checkRequirements();
    await buildManager.generateLicenseKeys();
    await buildManager.buildBackend();
  } else if (args.includes('--frontend-only')) {
    buildManager.checkRequirements();
    await buildManager.buildFrontend();
  } else if (args.includes('--package-only')) {
    await buildManager.packageElectron();
  } else if (args.includes('--validate')) {
    await buildManager.validateBuild();
  } else {
    await buildManager.build();
  }
})();