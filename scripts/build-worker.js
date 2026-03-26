/**
 * Build the worker into a self-contained directory:
 *   worker/dist/server.js       — esbuild bundle (all JS deps inlined)
 *   worker/dist/node_modules/   — native-only modules that can't be bundled
 *   worker/dist/models/         — ONNX model files (copied separately via extraResources)
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'worker', 'dist');

// Clean
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

// 1. Bundle with esbuild — only externalize native modules with .node bindings
console.log('[build-worker] Bundling with esbuild (minified)...');
execSync([
  'npx esbuild worker/server.js',
  '--bundle',
  '--platform=node',
  '--target=node20',
  '--outfile=worker/dist/server.js',
  '--minify',                     // Protect IP: minify variable names + whitespace
  '--legal-comments=none',        // Strip all comments
  '--external:onnxruntime-node',  // native .node binding
  '--external:node-unrar-js',     // native .node binding (wasm)
  '--external:sharp',             // native libvips binding
  '--external:@aws-sdk/*',        // optional, not needed
].join(' '), { cwd: ROOT, stdio: 'inherit' });

// 2. Copy native modules that were externalized
const NATIVE_MODULES = ['onnxruntime-node', 'node-unrar-js', 'sharp'];
const distModules = path.join(DIST, 'node_modules');
fs.mkdirSync(distModules, { recursive: true });

for (const mod of NATIVE_MODULES) {
  const src = path.join(ROOT, 'node_modules', mod);
  if (!fs.existsSync(src)) {
    console.warn(`[build-worker] WARN: ${mod} not found, skipping`);
    continue;
  }
  const dest = path.join(distModules, mod);
  console.log(`[build-worker] Copying native module: ${mod}`);
  copyDirSync(src, dest);
}

// Also copy onnxruntime-common (peer dep of onnxruntime-node)
const ortCommon = path.join(ROOT, 'node_modules', 'onnxruntime-common');
if (fs.existsSync(ortCommon)) {
  console.log('[build-worker] Copying onnxruntime-common');
  copyDirSync(ortCommon, path.join(distModules, 'onnxruntime-common'));
}

// Copy @img/sharp-* platform binaries (sharp's native libvips)
const imgDir = path.join(ROOT, 'node_modules', '@img');
if (fs.existsSync(imgDir)) {
  const imgDest = path.join(distModules, '@img');
  fs.mkdirSync(imgDest, { recursive: true });
  for (const entry of fs.readdirSync(imgDir)) {
    if (entry.startsWith('sharp-')) {
      console.log(`[build-worker] Copying @img/${entry}`);
      copyDirSync(path.join(imgDir, entry), path.join(imgDest, entry));
    }
  }
}

// Copy sharp's runtime dependencies (detect-libc, semver, @img/colour)
for (const dep of ['detect-libc', 'semver', '@img/colour']) {
  // Check in sharp's own node_modules first, then root
  const inSharp = path.join(ROOT, 'node_modules', 'sharp', 'node_modules', dep);
  const inRoot = path.join(ROOT, 'node_modules', dep);
  const src = fs.existsSync(inSharp) ? inSharp : fs.existsSync(inRoot) ? inRoot : null;
  if (src) {
    console.log(`[build-worker] Copying sharp dep: ${dep}`);
    copyDirSync(src, path.join(distModules, dep));
  }
}

// Copy sharp's colour profiles (required at runtime)
const sharpVendor = path.join(ROOT, 'node_modules', 'sharp', 'vendor');
if (fs.existsSync(sharpVendor)) {
  console.log('[build-worker] Copying sharp/vendor');
  copyDirSync(sharpVendor, path.join(distModules, 'sharp', 'vendor'));
}

console.log('[build-worker] Done!');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      // Skip test/doc directories to reduce size
      if (['test', 'tests', 'docs', '.github', 'example', 'examples'].includes(entry.name)) continue;
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
