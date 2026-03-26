/**
 * Obfuscate electron/ JS files for IP protection.
 * Run BEFORE electron-builder packages the app.
 * Creates obfuscated copies in electron/dist/ which electron-builder uses.
 */
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const ELECTRON_DIR = path.resolve(__dirname, '..', 'electron');
const FILES = ['main.js', 'preload.js', 'worker-manager.js'];

const OBFUSCATION_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,           // Don't rename Node.js globals
  selfDefending: false,           // Can break in strict mode
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  target: 'node',                 // Important: Node.js target
};

console.log('[obfuscate] Obfuscating electron files for production...');

for (const file of FILES) {
  const srcPath = path.join(ELECTRON_DIR, file);
  if (!fs.existsSync(srcPath)) {
    console.warn(`[obfuscate] SKIP: ${file} not found`);
    continue;
  }

  const source = fs.readFileSync(srcPath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(source, OBFUSCATION_OPTIONS);

  // Overwrite in place (electron-builder reads from electron/)
  // We'll restore from git after build if needed
  fs.writeFileSync(srcPath, result.getObfuscatedCode(), 'utf8');
  console.log(`[obfuscate] ${file}: ${source.length} → ${result.getObfuscatedCode().length} bytes`);
}

console.log('[obfuscate] Done!');
