/**
 * ClawSQL CLI - Docker Files Manager
 *
 * Manages extraction and versioning of bundled Docker configuration files.
 * This enables `npm install -g clawsql` to work without cloning the repo.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getSettings } from '../../config/settings.js';

/**
 * Get the ClawSQL home directory (~/.clawsql/)
 */
export function getClawSQLHome(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.clawsql');
}

/**
 * Get the docker files directory (~/.clawsql/docker/)
 */
export function getDockerFilesDir(): string {
  return path.join(getClawSQLHome(), 'docker');
}

/**
 * Get the version file path
 */
function getVersionFilePath(): string {
  return path.join(getDockerFilesDir(), '.version');
}

/**
 * Check if Docker files need to be extracted
 */
export function needsExtraction(): boolean {
  const dockerDir = getDockerFilesDir();
  const versionFile = getVersionFilePath();

  // Check if directory exists
  if (!fs.existsSync(dockerDir)) {
    return true;
  }

  // Check if version file exists
  if (!fs.existsSync(versionFile)) {
    return true;
  }

  // Compare versions
  try {
    const storedVersion = fs.readFileSync(versionFile, 'utf-8').trim();
    const currentVersion = getSettings().appVersion;
    return storedVersion !== currentVersion;
  } catch {
    return true;
  }
}

/**
 * Recursively copy a directory
 */
function copyDirRecursive(src: string, dest: string): void {
  // Create destination directory
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Get the bundled docker files path (from npm package)
 */
function getBundledDockerPath(): string {
  // When running from npm install, files are relative to dist/cli/utils/
  return path.join(__dirname, '..', '..', '..', 'docker');
}

/**
 * Get the bundled docker-compose files path
 */
function getBundledDockerComposePath(): string {
  // docker-compose.yml is at the root of the npm package
  return path.join(__dirname, '..', '..', '..');
}

/**
 * Fix docker-compose paths for extracted files
 *
 * When running from npm install, the docker/ directory is flattened.
 * The original docker-compose.yml has paths like:
 *   - dockerfile: docker/Dockerfile.node
 *   - ./docker/orchestrator/orchestrator.conf.json
 *
 * After extraction, these need to be:
 *   - dockerfile: Dockerfile.node
 *   - ./orchestrator/orchestrator.conf.json
 */
function fixDockerComposePaths(filePath: string): void {
  let content = fs.readFileSync(filePath, 'utf-8');

  // Fix dockerfile path: "dockerfile: docker/Dockerfile.node" -> "dockerfile: Dockerfile.node"
  content = content.replace(/dockerfile: docker\//g, 'dockerfile: ');

  // Fix volume paths: "./docker/orchestrator/..." -> "./orchestrator/..."
  content = content.replace(/\.\/docker\//g, './');

  // Fix entrypoint path for openclaw: "./docker/openclaw/entrypoint.sh" -> "./openclaw/entrypoint.sh"
  content = content.replace(/\.\/docker\/openclaw\/entrypoint\.sh/g, './openclaw/entrypoint.sh');

  fs.writeFileSync(filePath, content);
}

/**
 * Extract Docker files from npm package to ~/.clawsql/docker/
 */
export async function ensureDockerFiles(): Promise<string> {
  const dockerDir = getDockerFilesDir();

  // Check if extraction is needed
  if (!needsExtraction()) {
    return dockerDir;
  }

  console.log('Extracting Docker configuration files...');

  // Create directory structure
  if (!fs.existsSync(dockerDir)) {
    fs.mkdirSync(dockerDir, { recursive: true });
  }

  // Get bundled paths
  const bundledDockerPath = getBundledDockerPath();
  const bundledRootPath = getBundledDockerComposePath();

  // Check if bundled files exist
  if (!fs.existsSync(bundledDockerPath)) {
    throw new Error(
      'Docker configuration files not found. ' +
      'Please ensure clawsql is installed correctly.'
    );
  }

  // Copy docker/ directory
  copyDirRecursive(bundledDockerPath, dockerDir);

  // Copy docker-compose.yml files and fix paths
  const composeFiles = ['docker-compose.yml', 'docker-compose.demo.yml'];
  for (const file of composeFiles) {
    const srcPath = path.join(bundledRootPath, file);
    const destPath = path.join(dockerDir, file);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      // Fix paths for npm installation
      fixDockerComposePaths(destPath);
    }
  }

  // Copy init/ directory (MySQL init scripts)
  const bundledInitPath = path.join(bundledRootPath, 'init');
  const destInitPath = path.join(dockerDir, 'init');
  if (fs.existsSync(bundledInitPath)) {
    copyDirRecursive(bundledInitPath, destInitPath);
  }

  // Copy package.json for Docker build
  const packageJsonSrc = path.join(bundledRootPath, 'package.json');
  if (fs.existsSync(packageJsonSrc)) {
    fs.copyFileSync(packageJsonSrc, path.join(dockerDir, 'package.json'));
  }

  // Copy package-lock.json if available
  const packageLockSrc = path.join(bundledRootPath, 'package-lock.json');
  if (fs.existsSync(packageLockSrc)) {
    fs.copyFileSync(packageLockSrc, path.join(dockerDir, 'package-lock.json'));
  }

  // Copy dist/ directory for Docker build (the application code)
  const distSrc = path.join(bundledRootPath, 'dist');
  const distDest = path.join(dockerDir, 'dist');
  if (fs.existsSync(distSrc)) {
    copyDirRecursive(distSrc, distDest);
  }

  // Write version file
  const version = getSettings().appVersion;
  fs.writeFileSync(getVersionFilePath(), version);

  console.log(`Docker files extracted to: ${dockerDir}`);

  return dockerDir;
}

/**
 * Get docker-compose.yml path
 */
export function getDockerComposePath(): string {
  return path.join(getDockerFilesDir(), 'docker-compose.yml');
}

/**
 * Get docker-compose.demo.yml path
 */
export function getDockerComposeDemoPath(): string {
  return path.join(getDockerFilesDir(), 'docker-compose.demo.yml');
}

/**
 * Get .env.example path
 */
export function getEnvExamplePath(): string {
  const bundledRootPath = getBundledDockerComposePath();
  return path.join(bundledRootPath, '.env.example');
}

/**
 * Ensure .env file exists in the docker directory
 */
export async function ensureEnvFile(): Promise<string> {
  const dockerDir = getDockerFilesDir();
  const envPath = path.join(dockerDir, '.env');
  const envExamplePath = path.join(dockerDir, '.env.example');

  if (!fs.existsSync(envPath)) {
    // Try to copy from example
    if (fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
    } else {
      // Create minimal .env
      const minimalEnv = `# ClawSQL Configuration
# Generated by ClawSQL CLI

API_TOKEN_SECRET=change-me-in-production
MYSQL_ADMIN_USER=clawsql
MYSQL_ADMIN_PASSWORD=clawsql_password
MYSQL_REPLICATION_USER=repl
MYSQL_REPLICATION_PASSWORD=repl_password
`;
      fs.writeFileSync(envPath, minimalEnv);
    }
  }

  return envPath;
}