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
console.log('[build-worker] Bundling with esbuild...');
execSync([
  'npx esbuild worker/server.js',
  '--bundle',
  '--platform=node',
  '--target=node20',
  '--outfile=worker/dist/server.js',
  '--external:onnxruntime-node',  // native .node binding
  '--external:node-unrar-js',     // native .node binding (wasm)
  '--external:@aws-sdk/*',        // optional, not needed
].join(' '), { cwd: ROOT, stdio: 'inherit' });

// 2. Copy native modules that were externalized
const NATIVE_MODULES = ['onnxruntime-node', 'node-unrar-js'];
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
