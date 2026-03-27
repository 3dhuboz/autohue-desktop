const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const Jimp = require('jimp');
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; console.warn('[config] sharp not available — using Jimp for resizing'); }
const archiver = require('archiver');
const crypto = require('crypto');
const unzipper = require('unzipper');
const { createExtractorFromFile } = require('node-unrar-js');
const ort = require('onnxruntime-node');

const app = express();
const PORT = process.env.PORT || process.env.WORKER_PORT || 3001;

// Use STORAGE_ROOT env var for persistent volume (Railway), falls back to project dir
const STORAGE_ROOT = process.env.STORAGE_ROOT || __dirname;
const UPLOAD_DIR = path.join(STORAGE_ROOT, 'uploads');
const OUTPUT_DIR = path.join(STORAGE_ROOT, 'output');
const THUMB_DIR = path.join(STORAGE_ROOT, 'thumbs');

[UPLOAD_DIR, OUTPUT_DIR, THUMB_DIR].forEach(dir => fs.mkdirSync(dir, { recursive: true }));
console.log(`[storage] Root: ${STORAGE_ROOT} (${process.env.STORAGE_ROOT ? 'persistent volume' : 'local filesystem'})`);

const sessions = {};

app.use(express.static(path.join(__dirname, 'public')));
app.use('/thumbs', express.static(THUMB_DIR));
app.use(express.json());

// ═══════════════════════════════════════════════════════════════════════════
// CAR COLOR DETECTION ENGINE v8
// Two-stage vehicle isolation: SSD-MobileNet (bbox) + SegFormer (pixel mask)
// Pipeline: detect car → Nyckel‖SegFormer (parallel) → extract pure pixels → smart merge
// Speed opts: 256px seg input, pre-alloc buffers, single-pass extract+mask, parallel Nyckel
// Fallback: multi-region sampling + HSV env filtering if SegFormer unavailable
// ═══════════════════════════════════════════════════════════════════════════

// ─── Vision API (OpenRouter — multi-key rotation) ───
let OPENROUTER_KEYS = [];
let VISION_MODEL = process.env.VISION_MODEL || 'google/gemini-2.0-flash-001';
let keyIndex = 0;
const keyBackoff = new Map(); // key → timestamp when it can be used again

// Load keys from env (comma-separated) or keyfile
if (process.env.OPENROUTER_KEY) {
    OPENROUTER_KEYS = process.env.OPENROUTER_KEY.split(',').map(k => k.trim()).filter(Boolean);
}
if (OPENROUTER_KEYS.length === 0) {
    try {
        const keyFile = path.join(STORAGE_ROOT, '.openrouter-keys');
        if (fs.existsSync(keyFile)) {
            OPENROUTER_KEYS = fs.readFileSync(keyFile, 'utf8').trim().split('\n').map(k => k.trim()).filter(Boolean);
        }
    } catch {}
}
// Fallback: single key file
if (OPENROUTER_KEYS.length === 0) {
    try {
        const keyFile = path.join(STORAGE_ROOT, '.openrouter-key');
        if (fs.existsSync(keyFile)) {
            const k = fs.readFileSync(keyFile, 'utf8').trim();
            if (k) OPENROUTER_KEYS = [k];
        }
    } catch {}
}

console.log(`[config] OpenRouter keys: ${OPENROUTER_KEYS.length}`);

// Round-robin key selection with rate-limit skip
function getNextKey() {
    if (OPENROUTER_KEYS.length === 0) return null;
    const now = Date.now();
    // Try each key, skip any in backoff
    for (let i = 0; i < OPENROUTER_KEYS.length; i++) {
        const idx = (keyIndex + i) % OPENROUTER_KEYS.length;
        const key = OPENROUTER_KEYS[idx];
        const backoffUntil = keyBackoff.get(key) || 0;
        if (now >= backoffUntil) {
            keyIndex = (idx + 1) % OPENROUTER_KEYS.length;
            return key;
        }
    }
    // All keys in backoff — return the one with shortest wait
    let bestKey = OPENROUTER_KEYS[0];
    let bestTime = Infinity;
    for (const key of OPENROUTER_KEYS) {
        const t = keyBackoff.get(key) || 0;
        if (t < bestTime) { bestTime = t; bestKey = key; }
    }
    return bestKey;
}

function markKeyRateLimited(key) {
    // Back off this key for 10 seconds
    keyBackoff.set(key, Date.now() + 10000);
    const available = OPENROUTER_KEYS.filter(k => (keyBackoff.get(k) || 0) <= Date.now()).length;
    console.log(`[openrouter] Key ...${key.slice(-6)} rate-limited, ${available}/${OPENROUTER_KEYS.length} keys available`);
}

// Legacy: also check claude keyfile for backward compat
let CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';
if (!CLAUDE_API_KEY) {
    try {
        const keyFile = path.join(STORAGE_ROOT, '.claude-key');
        if (fs.existsSync(keyFile)) CLAUDE_API_KEY = fs.readFileSync(keyFile, 'utf8').trim();
    } catch { /* ignore */ }
}

function getActiveEngine() {
    if (OPENROUTER_KEYS.length > 0) return 'openrouter';
    if (CLAUDE_API_KEY) return 'claude';
    return 'local';
}

console.log(`[config] Engine: ${getActiveEngine()}`);

// Listen for runtime updates from main process
process.on('message', (msg) => {
    if (!msg) return;
    if (msg.type === 'set-openrouter-keys' && msg.keys) {
        OPENROUTER_KEYS = Array.isArray(msg.keys) ? msg.keys : [msg.keys];
        console.log(`[config] OpenRouter keys updated: ${OPENROUTER_KEYS.length}`);
    }
    if (msg.type === 'set-openrouter-key' && msg.key) {
        // Legacy single-key support
        if (!OPENROUTER_KEYS.includes(msg.key)) OPENROUTER_KEYS.push(msg.key);
        console.log(`[config] OpenRouter keys: ${OPENROUTER_KEYS.length}`);
    }
    if (msg.type === 'set-vision-model' && msg.model) {
        VISION_MODEL = msg.model;
        console.log('[config] Vision model: ' + msg.model);
    }
    if (msg.type === 'set-claude-key' && msg.key) {
        CLAUDE_API_KEY = msg.key;
    }
});

const VALID_COLORS = new Set(['red','blue','green','yellow','orange','purple','pink','brown','black','white','silver-grey']);

// Runtime string decode (IP protection)
const _k = Buffer.from('614837236d4b392470    4c3221785234'.replace(/\s/g,''), 'hex');
function _d(h){const b=Buffer.from(h,'hex');for(let i=0;i<b.length;i++)b[i]^=_k[i%_k.length];return b.toString('utf8');}

async function classifyWithClaude(imageBuffer) {
    if (!CLAUDE_API_KEY) return null;
    try {
        const base64 = imageBuffer.toString('base64');
        const mediaType = 'image/jpeg';

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5-20250514',
                max_tokens: 30,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: { type: 'base64', media_type: mediaType, data: base64 },
                        },
                        {
                            type: 'text',
                            text: _d('362056574d224a04042457013a1d703867676224056d0413235e4e0a725b0768434b086b54451922124219201b172d5f4a0e275c0419221255103b474125585702394a541f3e460e1c2055066845420e225743503c5a4e0c3d0b410b656a39027a653c6c60743417675b68060a4d1f5141502f5353583f55186855464d3854451c201248167240092d17451f2a5441503f47530a3d410f2c52474d29400403215d4a1d72d6e1dc174504255d0419381240163614072754561e6b766a3c15124e16725d153b17530c225750502f5d4d17201a417a1e03240c776b22091240143e14032954480a3956511e28124414375904264350576b5e56113f410d58365d133c1b031e204008503840401b3914123d45450c285c08502e53530a3b51133b1b030b275843036012430d3b58052159441e6719570029515519265b133b19035e62196d37027d733d72470c275c46416b51450a291e011c274715641742032f1956152a5e441b265d0e26440d4d7f100427245b551d7257003a4403042519571d2359445833460468155405224d41526c5c4e0c721612215b550839144302294b0356727b0f244e031e2a4004523f5b4d0e37464c2f4546146919421f3e12401b26410024174e083f58481c2551010b3b58172d450c0a395c5d503c534816261a417d1e032924196a3f18124d1d26141629454e4d2c4b45033f1d45112040413c454a0e20195d1f39124816265b413b565a04255e045235574d143d43436858514d695b561f3b5c0358b0b4f568434b02385c04113e57011a33570a2f454c18255d0850225d5558265c046854421f651912596c6644193e1b153d45521824505715635158193c145c681541013e5c065e6c6044083e4d413f5e57056b766a3c15124e163714162745474d2d4b4b1d7612531d3618412a5b56086719430229574f54724d04245b4c1a67194b022d5c461d7e14113d4553012e150400255c4a5472561327404d416b5b48112f590d58255c083c520f4d3850480629400c1f205118'),
                        },
                    ],
                }],
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error(`[claude] API error ${res.status}: ${errText.slice(0, 200)}`);
            return null;
        }

        const data = await res.json();
        const rawAnswer = (data.content?.[0]?.text || '').trim().toLowerCase().replace(/[^a-z-]/g, '');

        // Map common variations
        const colorMap = {
            'silver': 'silver-grey', 'grey': 'silver-grey', 'gray': 'silver-grey',
            'silvergrey': 'silver-grey', 'silvergray': 'silver-grey',
            'maroon': 'red', 'burgundy': 'red', 'crimson': 'red',
            'navy': 'blue', 'teal': 'blue', 'cyan': 'blue', 'turquoise': 'blue',
            'gold': 'yellow', 'cream': 'white', 'ivory': 'white', 'beige': 'white',
            'olive': 'green', 'lime': 'green', 'magenta': 'pink', 'tan': 'brown',
        };
        const mapped = colorMap[rawAnswer] || rawAnswer;

        if (VALID_COLORS.has(mapped)) {
            console.log(`  [claude] Vision result: ${mapped} (raw: "${rawAnswer}")`);
            return { category: mapped, confidence: 0.95, method: 'claude-vision' };
        }

        console.warn(`  [claude] Unrecognized color: "${rawAnswer}" → falling back`);
        return null;
    } catch (err) {
        console.error(`[claude] Vision classify failed: ${err.message}`);
        return null;
    }
}

// ─── Batch classify multiple images in ONE API call (3-4x faster) ───
const BATCH_SIZE = 6; // 6 images per API call — sweet spot for throughput vs latency

async function classifyBatchWithClaude(imageBuffers) {
    if (!CLAUDE_API_KEY || imageBuffers.length === 0) return null;
    try {
        // Build content array: image1, image2, ..., imageN, text prompt
        const content = [];
        for (let i = 0; i < imageBuffers.length; i++) {
            content.push({
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: imageBuffers[i].toString('base64') },
            });
        }
        content.push({
            type: 'text',
            text: `There are ${imageBuffers.length} motorsport/drag racing photos above (numbered 1 to ${imageBuffers.length}). For EACH photo, identify the BODY/PAINT color of the main car/vehicle. Reply with EXACTLY ${imageBuffers.length} lines. Each line = just ONE color word from: red, blue, green, yellow, orange, purple, pink, brown, black, white, silver-grey. RULES: 1) IGNORE smoke, dirt, grass, sky — only the car body paint. 2) Dark charcoal, gunmetal, dark grey = "silver-grey" NOT "blue". 3) Only say "blue" for clearly bright/vivid blue paint. 4) Teal/turquoise/cyan = "blue". 5) White cars in smoke = "white" not "silver-grey".`,
        });

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5-20250514',
                max_tokens: 100,
                messages: [{ role: 'user', content }],
            }),
            signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error(`[claude-batch] API error ${res.status}: ${errText.slice(0, 200)}`);
            return null;
        }

        const data = await res.json();
        const rawText = (data.content?.[0]?.text || '').trim();
        const lines = rawText.split(/\n/).map(l => l.trim().toLowerCase().replace(/[^a-z-]/g, '').replace(/^\d+\.?\s*/, ''));

        const colorMap = {
            'silver': 'silver-grey', 'grey': 'silver-grey', 'gray': 'silver-grey',
            'silvergrey': 'silver-grey', 'silvergray': 'silver-grey',
            'maroon': 'red', 'burgundy': 'red', 'crimson': 'red',
            'navy': 'blue', 'teal': 'blue', 'cyan': 'blue', 'turquoise': 'blue',
            'gold': 'yellow', 'cream': 'white', 'ivory': 'white', 'beige': 'white',
            'olive': 'green', 'lime': 'green', 'magenta': 'pink', 'tan': 'brown',
        };

        const results = [];
        for (let i = 0; i < imageBuffers.length; i++) {
            const raw = lines[i] || '';
            const mapped = colorMap[raw] || raw;
            if (VALID_COLORS.has(mapped)) {
                results.push({ category: mapped, confidence: 0.95, method: 'claude-vision-batch' });
            } else {
                results.push(null); // fallback for this image
            }
        }

        const validCount = results.filter(r => r !== null).length;
        console.log(`  [claude-batch] ${validCount}/${imageBuffers.length} classified: ${results.map(r => r?.category || '?').join(', ')}`);
        return results;
    } catch (err) {
        console.error(`[claude-batch] Failed: ${err.message}`);
        return null;
    }
}

// ─── Prepare image buffer for Claude (shared by single + batch) ───
async function prepareImageForApi(imagePath) {
    // ALWAYS resize to 800px max — sending full-res 5-8MB photos is the #1 speed killer
    // 800px is more than enough for color classification, and produces ~50-80KB JPEGs
    // This alone cuts payload from ~40MB to ~600KB per batch of 10
    if (sharp) {
        return sharp(imagePath).resize(800, null, { withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    }
    const img = await Jimp.read(imagePath);
    return img.clone().resize(Math.min(800, img.getWidth()), Jimp.AUTO).quality(75).getBufferAsync(Jimp.MIME_JPEG);
}

// ─── Gemini 2.5 Flash batch classifier (PRIMARY — fastest) ───
const GEMINI_BATCH_SIZE = 15; // Gemini handles up to 50 images per call; 15 is the throughput sweet spot
const CLAUDE_BATCH_SIZE = 6;  // Claude works best with smaller batches

const _CP = '27274503280a7a6c50215d5517204711274557422f4b45176c40401b3b5a0668474b023f5604112e5d571d7e14082c524d19225f5d50385a4458107b251118732c027770502f5d4d1720140e2e1757052e194911255c011b33464e3e524b042855415e6c717331067d22097b194d025e4a1f3e57010c3b460468444e02205c08502e4753163d4115685f42172e1504143941555472550f2c1751082d554113385b4e16211483c8a3030b245a51036c5d4f58265c04685640193e5848503c534816261402275b4c1f65197318254644583155133b174a036b4a491f275701192051413b434a0127190607245b551d701a4107594f146b4a45096c1052113e42043a1a441f2e4006502a5d53583357153d564f4d265c5011205e481b7247082441461f645e5615351251193b5a15661777082a550b043940500d3d5d122d1840142a57044d6c104314275143661771083b555d503b5b55107271390974772112194b1e291242173e5b136847461f6b554d1e291e01113c140e3a53461f651961112f5a01143b5a04685a561e3f1946156c7d6f3d72430e3a53030b3956494a6c40441c7e1403244246416b5e5615295c0d582b510d245854416b565611225544547244143a474f086719541922590d5830460e3f590f4d29554513271e010f3a5d152d1b031e225552153e1f460a374d';

const COLOR_MAP = {
    'silver': 'silver-grey', 'grey': 'silver-grey', 'gray': 'silver-grey',
    'silvergrey': 'silver-grey', 'silvergray': 'silver-grey',
    'maroon': 'red', 'burgundy': 'red', 'crimson': 'red',
    'navy': 'blue', 'teal': 'blue', 'cyan': 'blue', 'turquoise': 'blue',
    'gold': 'yellow', 'cream': 'white', 'ivory': 'white', 'beige': 'white',
    'olive': 'green', 'lime': 'green', 'magenta': 'pink', 'tan': 'brown',
};

function parseColorLines(rawText, expectedCount) {
    const lines = rawText.split(/\n/).map(l => l.trim().toLowerCase().replace(/[^a-z-]/g, '').replace(/^\d+\.?\s*/, ''));
    const results = [];
    for (let i = 0; i < expectedCount; i++) {
        const raw = lines[i] || '';
        const mapped = COLOR_MAP[raw] || raw;
        if (VALID_COLORS.has(mapped)) {
            results.push({ category: mapped, confidence: 0.95 });
        } else {
            results.push(null);
        }
    }
    return results;
}

// ─── OpenRouter single-image classifier (1 image per call = maximum accuracy) ───
const OPENROUTER_BATCH_SIZE = 10; // 10 images per batch cycle (mix of batch calls + parallel)

async function classifyBatchWithOpenRouter(imageBuffers) {
    if (OPENROUTER_KEYS.length === 0 || imageBuffers.length === 0) return null;

    // Split into mini-batches of 3 images each, run 3 mini-batches in parallel
    // 3 images per API call = model can easily track order
    // 3 parallel calls = 9 images per cycle per worker
    const MINI_BATCH = 3;
    const chunks = [];
    for (let i = 0; i < imageBuffers.length; i += MINI_BATCH) {
        chunks.push(imageBuffers.slice(i, i + MINI_BATCH));
    }

    // Run all chunks in parallel
    const chunkResults = await Promise.all(chunks.map(chunk => classifyMiniBatch(chunk)));

    // Flatten results back to match input order
    const results = chunkResults.flat();
    const validCount = results.filter(r => r !== null).length;
    console.log(`  [vision] ${validCount}/${imageBuffers.length}: ${results.map(r => r?.category || '?').join(', ')}`);
    return results;
}

async function classifyMiniBatch(imageBuffers, retries = 3) {
    if (OPENROUTER_KEYS.length === 0 || imageBuffers.length === 0) return imageBuffers.map(() => null);

    // Single image? Use simple prompt
    if (imageBuffers.length === 1) {
        const result = await classifySingleImage(imageBuffers[0]);
        return [result];
    }

    for (let attempt = 0; attempt < retries; attempt++) {
    const apiKey = getNextKey();
    if (!apiKey) return imageBuffers.map(() => null);
    try {
        const content = [];
        for (let i = 0; i < imageBuffers.length; i++) {
            content.push({ type: 'text', text: `Photo ${i + 1}:` });
            content.push({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${imageBuffers[i].toString('base64')}` },
            });
        }
        content.push({
            type: 'text',
            text: `${imageBuffers.length} photos above. For each, reply with the car's BODY PAINT color. ${imageBuffers.length} lines, one word each from: red, blue, green, yellow, orange, purple, pink, brown, black, white, silver-grey. IGNORE backgrounds. Dark charcoal/gunmetal = silver-grey. Gold/bronze = yellow.`,
        });

        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://autohue.app',
                'X-Title': 'AutoHue',
            },
            body: JSON.stringify({
                model: VISION_MODEL,
                max_tokens: 50,
                temperature: 0,
                messages: [{ role: 'user', content }],
            }),
            signal: AbortSignal.timeout(20000),
        });

        if (!res.ok) {
            if (res.status === 429) {
                markKeyRateLimited(apiKey);
                if (attempt < retries - 1) continue; // try next key immediately
            }
            console.warn(`[vision] Mini-batch failed (${res.status}), trying individually`);
            return Promise.all(imageBuffers.map(buf => classifySingleImage(buf).catch(() => null)));
        }

        const data = await res.json();
        const rawText = (data.choices?.[0]?.message?.content || '').trim();
        const results = parseColorLines(rawText, imageBuffers.length);
        results.forEach(r => { if (r) r.method = 'openrouter'; });
        return results;
    } catch (err) {
        if (attempt < retries - 1) continue;
        return Promise.all(imageBuffers.map(buf => classifySingleImage(buf).catch(() => null)));
    }
    }
    return imageBuffers.map(() => null);
}

async function classifySingleImage(imageBuffer, retries = 3) {
    if (OPENROUTER_KEYS.length === 0) return null;
    for (let attempt = 0; attempt < retries; attempt++) {
    const apiKey = getNextKey();
    if (!apiKey) return null;
    try {
        const content = [
            {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` },
            },
            {
                type: 'text',
                text: 'What is the BODY/PAINT color of the main car/vehicle in this photo? Reply with ONLY one word from: red, blue, green, yellow, orange, purple, pink, brown, black, white, silver-grey. RULES: Focus ONLY on the car body paint. IGNORE smoke, asphalt, sky, grass, barriers. Dark charcoal/gunmetal = silver-grey. Gold/bronze metallic = yellow.',
            },
        ];

        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://autohue.app',
                'X-Title': 'AutoHue',
            },
            body: JSON.stringify({
                model: VISION_MODEL,
                max_tokens: 20,
                temperature: 0,
                messages: [{ role: 'user', content }],
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            // Rate limited — mark key and try next immediately
            if (res.status === 429) {
                markKeyRateLimited(apiKey);
                if (attempt < retries - 1) continue; // try next key
            }
            console.error(`[vision] API ${res.status}: ${errText.slice(0, 100)}`);
            return null;
        }

        const data = await res.json();
        const rawText = (data.choices?.[0]?.message?.content || '').trim().toLowerCase().replace(/[^a-z-]/g, '');
        const mapped = COLOR_MAP[rawText] || rawText;
        if (VALID_COLORS.has(mapped)) {
            return { category: mapped, confidence: 0.95, method: 'openrouter' };
        }
        console.warn(`[vision] Unrecognized: "${rawText}"`);
        return null;
    } catch (err) {
        if (attempt < retries - 1) {
            const wait = (attempt + 1) * 2000;
            console.warn(`[vision] Error: ${err.message}. Retry ${attempt + 2}/${retries} in ${wait/1000}s`);
            await new Promise(r => setTimeout(r, wait));
            continue;
        }
        console.error(`[vision] Failed after ${retries} attempts: ${err.message}`);
        return null;
    }
    } // end retry loop
    return null;
}

// ─── Unified batch dispatch ───
function getVisionBatchSize() {
    const engine = getActiveEngine();
    if (engine === 'openrouter') return OPENROUTER_BATCH_SIZE;
    if (engine === 'claude') return CLAUDE_BATCH_SIZE;
    return 1;
}

async function classifyBatchVision(imageBuffers) {
    const engine = getActiveEngine();
    if (engine === 'openrouter') return classifyBatchWithOpenRouter(imageBuffers);
    if (engine === 'claude') return classifyBatchWithClaude(imageBuffers);
    return null;
}

// ─── Nyckel API configuration (from environment variables) ───
const NYCKEL_CLIENT_ID = process.env.NYCKEL_CLIENT_ID || '';
const NYCKEL_CLIENT_SECRET = process.env.NYCKEL_CLIENT_SECRET || '';
const NYCKEL_FUNCTION_ID = process.env.NYCKEL_FUNCTION_ID || 'colors-identifier';
if (!NYCKEL_CLIENT_ID || !NYCKEL_CLIENT_SECRET) {
    console.warn('[config] NYCKEL_CLIENT_ID / NYCKEL_CLIENT_SECRET not set — Nyckel API disabled, using local LAB-only classification');
}
let nyckelToken = null;
let nyckelTokenExpiry = 0;

async function getNyckelToken() {
    if (!NYCKEL_CLIENT_ID || !NYCKEL_CLIENT_SECRET) return null;
    // Return cached token if still valid (with 5 min buffer)
    if (nyckelToken && Date.now() < nyckelTokenExpiry - 300000) {
        return nyckelToken;
    }
    try {
        const res = await fetch('https://www.nyckel.com/connect/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=client_credentials&client_id=${NYCKEL_CLIENT_ID}&client_secret=${NYCKEL_CLIENT_SECRET}`,
            signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (data.access_token) {
            nyckelToken = data.access_token;
            nyckelTokenExpiry = Date.now() + (data.expires_in * 1000);
            return nyckelToken;
        }
        console.error('Nyckel token error:', data);
        return null;
    } catch (err) {
        console.error('Nyckel token fetch failed:', err.message);
        return null;
    }
}

// Map Nyckel color labels to our folder categories
const NYCKEL_LABEL_MAP = {
    'red': 'red', 'Red': 'red',
    'blue': 'blue', 'Blue': 'blue',
    'green': 'green', 'Green': 'green',
    'yellow': 'yellow', 'Yellow': 'yellow',
    'orange': 'orange', 'Orange': 'orange',
    'purple': 'purple', 'Purple': 'purple',
    'pink': 'pink', 'Pink': 'pink',
    'brown': 'brown', 'Brown': 'brown',
    'black': 'black', 'Black': 'black',
    'white': 'white', 'White': 'white',
    'grey': 'silver-grey', 'Grey': 'silver-grey',
    'gray': 'silver-grey', 'Gray': 'silver-grey',
    'silver': 'silver-grey', 'Silver': 'silver-grey',
    'beige': 'brown', 'Beige': 'brown',
    'gold': 'yellow', 'Gold': 'yellow',
    'maroon': 'red', 'Maroon': 'red',
    'navy': 'blue', 'Navy': 'blue',
    'teal': 'blue', 'Teal': 'blue',
    'cyan': 'blue', 'Cyan': 'blue',
    'magenta': 'pink', 'Magenta': 'pink',
    'olive': 'green', 'Olive': 'green',
    'tan': 'brown', 'Tan': 'brown',
    'cream': 'white', 'Cream': 'white',
    'ivory': 'white', 'Ivory': 'white',
    'burgundy': 'red', 'Burgundy': 'red',
};

async function classifyWithNyckel(imageBuffer) {
    const token = await getNyckelToken();
    if (!token) return null;

    try {
        const b64 = 'data:image/jpeg;base64,' + imageBuffer.toString('base64');
        const res = await fetch(`https://www.nyckel.com/v1/functions/${NYCKEL_FUNCTION_ID}/invoke`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: b64 }),
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (data.labelName) {
            const mapped = NYCKEL_LABEL_MAP[data.labelName] || NYCKEL_LABEL_MAP[data.labelName.toLowerCase()] || data.labelName.toLowerCase();
            return {
                category: mapped,
                nyckelLabel: data.labelName,
                confidence: data.confidence,
                labelId: data.labelId
            };
        }
        return null;
    } catch (err) {
        console.error('Nyckel invoke failed:', err.message);
        return null;
    }
}

// ─── ONNX Models: load once at startup ───
const SSD_MODEL_PATH = path.join(__dirname, 'models', 'ssd_mobilenet_v1_12.onnx');
const SEGFORMER_MODEL_PATH = path.join(__dirname, 'models', 'transformers-cache', 'Xenova',
    'segformer-b0-finetuned-cityscapes-768-768', 'onnx', 'model_quantized.onnx');
let onnxSession = null;      // SSD-MobileNet for bounding box detection
let segformerSession = null;  // SegFormer for pixel-level vehicle segmentation

// COCO class IDs for vehicles (SSD-MobileNet)
const VEHICLE_CLASSES = [3, 4, 6, 8]; // car, motorcycle, bus, truck
// Cityscapes class IDs for vehicles (SegFormer)
const SEGFORMER_VEHICLE_CLASSES = new Set([13, 14, 15, 17]); // car, truck, bus, motorcycle

// SegFormer preprocessing constants (ImageNet normalization)
const SEG_MEAN = [0.485, 0.456, 0.406];
const SEG_STD = [0.229, 0.224, 0.225];
const SEG_SIZE = 384; // 384 balances accuracy and speed (was 256, ~2x slower but much better masks)
// Pre-allocate reusable input buffer (avoids 1.77MB allocation per image)
let segInputBuffer = null;

async function loadModel() {
    // Load SSD-MobileNet (bounding box detection)
    try {
        onnxSession = await ort.InferenceSession.create(SSD_MODEL_PATH, {
            executionProviders: ['cpu'],
        });
        console.log('ONNX SSD-MobileNet loaded successfully');
    } catch (err) {
        console.error('Failed to load SSD-MobileNet:', err.message);
    }

    // Load SegFormer (pixel-level vehicle segmentation)
    try {
        if (fs.existsSync(SEGFORMER_MODEL_PATH)) {
            segformerSession = await ort.InferenceSession.create(SEGFORMER_MODEL_PATH, {
                executionProviders: ['cpu'],
            });
            console.log('SegFormer segmentation model loaded successfully');
        } else {
            console.warn('SegFormer model not found at:', SEGFORMER_MODEL_PATH);
        }
    } catch (err) {
        console.error('Failed to load SegFormer:', err.message);
        console.error('Falling back to bounding-box + environment filtering');
    }
}

// ─── Run SSD-MobileNet to detect car bounding boxes ───
async function detectCars(image) {
    if (!onnxSession) return null;

    // Prepare input tensor: [1, 300, 300, 3] as uint8
    const resized = image.clone().resize(300, 300);
    const inputData = new Uint8Array(1 * 300 * 300 * 3);
    let i = 0;
    resized.scan(0, 0, 300, 300, function(x, y, idx) {
        inputData[i++] = this.bitmap.data[idx];     // R
        inputData[i++] = this.bitmap.data[idx + 1]; // G
        inputData[i++] = this.bitmap.data[idx + 2]; // B
    });

    const inputTensor = new ort.Tensor('uint8', inputData, [1, 300, 300, 3]);

    try {
        const results = await onnxSession.run({ images: inputTensor });

        const numDetections = results['num_detections'].data[0];
        const boxes = results['detection_boxes'].data;     // [N, 4]: top, left, bottom, right (0-1)
        const scores = results['detection_scores'].data;
        const classes = results['detection_classes'].data;

        // Find the best vehicle detection
        let bestBox = null, bestScore = 0;
        for (let d = 0; d < numDetections; d++) {
            const classId = Math.round(classes[d]);
            const score = scores[d];
            if (VEHICLE_CLASSES.includes(classId) && score > 0.45 && score > bestScore) {
                // Minimum bounding box size check (50x50 pixels in original image)
                const bboxW = (boxes[d * 4 + 3] - boxes[d * 4 + 1]) * image.getWidth();
                const bboxH = (boxes[d * 4 + 2] - boxes[d * 4]) * image.getHeight();
                if (bboxW < 50 || bboxH < 50) continue; // reject hallucinated tiny detections
                bestScore = score;
                bestBox = {
                    top: boxes[d * 4],
                    left: boxes[d * 4 + 1],
                    bottom: boxes[d * 4 + 2],
                    right: boxes[d * 4 + 3],
                    score, classId
                };
            }
        }

        return bestBox;
    } catch (err) {
        console.error('ONNX inference error:', err.message);
        return null;
    }
}

// ─── Run SegFormer to get pixel-level vehicle mask ───
// Input: a cropped image (Jimp) containing the car region
// Output: { mask: boolean[], width, height, vehiclePixelCount, totalPixels }
// mask[y * width + x] === true means that pixel belongs to a vehicle
async function segmentVehicle(croppedImage) {
    if (!segformerSession) return null;

    try {
        const resized = croppedImage.clone().resize(SEG_SIZE, SEG_SIZE);

        // Reuse pre-allocated buffer (avoids GC pressure)
        if (!segInputBuffer) segInputBuffer = new Float32Array(1 * 3 * SEG_SIZE * SEG_SIZE);
        const inputData = segInputBuffer;
        const channelSize = SEG_SIZE * SEG_SIZE;

        resized.scan(0, 0, SEG_SIZE, SEG_SIZE, function(x, y, idx) {
            const pixelIdx = y * SEG_SIZE + x;
            const r = this.bitmap.data[idx] / 255.0;
            const g = this.bitmap.data[idx + 1] / 255.0;
            const b = this.bitmap.data[idx + 2] / 255.0;
            // NCHW: channel 0 = R, channel 1 = G, channel 2 = B
            inputData[0 * channelSize + pixelIdx] = (r - SEG_MEAN[0]) / SEG_STD[0];
            inputData[1 * channelSize + pixelIdx] = (g - SEG_MEAN[1]) / SEG_STD[1];
            inputData[2 * channelSize + pixelIdx] = (b - SEG_MEAN[2]) / SEG_STD[2];
        });

        const inputTensor = new ort.Tensor('float32', inputData, [1, 3, SEG_SIZE, SEG_SIZE]);

        // Run inference — SegFormer outputs logits [1, 19, H, W]
        const feeds = {};
        const inputNames = segformerSession.inputNames;
        feeds[inputNames[0]] = inputTensor;
        const results = await segformerSession.run(feeds);

        // Get the output tensor (logits)
        const outputNames = segformerSession.outputNames;
        const logits = results[outputNames[0]];
        const logitsData = logits.data;
        const [, numClasses, outH, outW] = logits.dims;

        // Argmax across classes for each pixel to get class labels
        const mask = new Uint8Array(outH * outW); // typed array is faster than generic Array
        let vehiclePixelCount = 0;

        for (let y = 0; y < outH; y++) {
            for (let x = 0; x < outW; x++) {
                let maxVal = -Infinity, maxClass = 0;
                for (let c = 0; c < numClasses; c++) {
                    const val = logitsData[c * outH * outW + y * outW + x];
                    if (val > maxVal) { maxVal = val; maxClass = c; }
                }
                const isVehicle = SEGFORMER_VEHICLE_CLASSES.has(maxClass) ? 1 : 0;
                mask[y * outW + x] = isVehicle;
                if (isVehicle) vehiclePixelCount++;
            }
        }

        // ── Morphological cleanup: erode 1px then dilate 2px ──
        // Erode: remove isolated noise pixels at mask edges (3x3 kernel, all neighbors must be set)
        const eroded = new Uint8Array(outH * outW);
        for (let y = 1; y < outH - 1; y++) {
            for (let x = 1; x < outW - 1; x++) {
                // Pixel survives erosion only if all 4-connected neighbors are also vehicle
                if (mask[y * outW + x] &&
                    mask[(y-1) * outW + x] && mask[(y+1) * outW + x] &&
                    mask[y * outW + (x-1)] && mask[y * outW + (x+1)]) {
                    eroded[y * outW + x] = 1;
                }
            }
        }

        // Dilate 2x: fill small holes in vehicle mask (3x3 kernel, any neighbor set)
        let dilated = new Uint8Array(eroded);
        for (let pass = 0; pass < 2; pass++) {
            const src = pass === 0 ? eroded : dilated;
            const dst = new Uint8Array(outH * outW);
            for (let y = 1; y < outH - 1; y++) {
                for (let x = 1; x < outW - 1; x++) {
                    if (src[y * outW + x] ||
                        src[(y-1) * outW + x] || src[(y+1) * outW + x] ||
                        src[y * outW + (x-1)] || src[y * outW + (x+1)]) {
                        dst[y * outW + x] = 1;
                    }
                }
            }
            dilated = dst;
        }

        // Recount vehicle pixels after morphological cleanup
        let cleanedVehicleCount = 0;
        for (let i = 0; i < dilated.length; i++) {
            if (dilated[i]) cleanedVehicleCount++;
        }

        return { mask: dilated, width: outW, height: outH, vehiclePixelCount: cleanedVehicleCount, totalPixels: outH * outW };
    } catch (err) {
        console.error('SegFormer inference error:', err.message);
        return null;
    }
}

// ─── Single-pass: extract vehicle pixels + create masked Nyckel crop simultaneously ───
// Combines two full-image scans into one for ~2x speedup on this step
async function extractAndMask(carCrop, segResult) {
    // Downsample for pixel extraction (150px wide is plenty for color clustering)
    const smallCrop = carCrop.clone().resize(Math.min(150, carCrop.getWidth()), Jimp.AUTO);
    const sw = smallCrop.getWidth(), sh = smallCrop.getHeight();
    const scaleX = segResult.width / sw;
    const scaleY = segResult.height / sh;

    const vehiclePixels = [];
    const maskW = segResult.width, maskData = segResult.mask;

    // Pass 1 (small image): extract vehicle pixel colors for LAB
    smallCrop.scan(0, 0, sw, sh, function(x, y, idx) {
        const r = this.bitmap.data[idx], g = this.bitmap.data[idx + 1], b = this.bitmap.data[idx + 2];
        const brightness = (r + g + b) / 3;
        // Chroma-aware exception: vivid dark/bright colors are vehicle paint, not shadows/highlights
        const hsv = rgbToHsv(r, g, b);
        if (hsv.s <= 30) {
            // Low saturation: apply strict brightness cutoffs
            if (brightness > 253 || brightness < 2) return;
        }
        // High saturation pixels pass through regardless of brightness (vivid paint)
        const mx = Math.min(Math.floor(x * scaleX), segResult.width - 1);
        const my = Math.min(Math.floor(y * scaleY), segResult.height - 1);
        if (maskData[my * maskW + mx]) vehiclePixels.push([r, g, b]);
    });

    // Pass 2 (Nyckel-sized image): gray out background — resize first to minimize work
    const nyckelImg = carCrop.clone().resize(300, Jimp.AUTO).quality(80);
    const nw = nyckelImg.getWidth(), nh = nyckelImg.getHeight();
    const nScaleX = segResult.width / nw;
    const nScaleY = segResult.height / nh;

    nyckelImg.scan(0, 0, nw, nh, function(x, y, idx) {
        const mx = Math.min(Math.floor(x * nScaleX), segResult.width - 1);
        const my = Math.min(Math.floor(y * nScaleY), segResult.height - 1);
        if (!maskData[my * maskW + mx]) {
            this.bitmap.data[idx] = 128;
            this.bitmap.data[idx + 1] = 128;
            this.bitmap.data[idx + 2] = 128;
        }
    });
    const nyckelBuffer = await nyckelImg.getBufferAsync(Jimp.MIME_JPEG);

    return { vehiclePixels, nyckelBuffer };
}

// ─── RGB → XYZ → LAB conversion (D65 illuminant) ───
function rgbToLab(r, g, b) {
    // sRGB to linear
    let rl = r / 255, gl = g / 255, bl = b / 255;
    rl = rl > 0.04045 ? Math.pow((rl + 0.055) / 1.055, 2.4) : rl / 12.92;
    gl = gl > 0.04045 ? Math.pow((gl + 0.055) / 1.055, 2.4) : gl / 12.92;
    bl = bl > 0.04045 ? Math.pow((bl + 0.055) / 1.055, 2.4) : bl / 12.92;

    // Linear RGB → XYZ (D65)
    let x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
    let y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.00000;
    let z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;

    const f = v => v > 0.008856 ? Math.pow(v, 1/3) : (7.787 * v) + 16/116;
    x = f(x); y = f(y); z = f(z);

    return {
        L: (116 * y) - 16,
        a: 500 * (x - y),
        b: 200 * (y - z)
    };
}

// ─── Delta-E 2000 (CIEDE2000) — perceptual color difference ───
function deltaE2000(lab1, lab2) {
    const { L: L1, a: a1, b: b1 } = lab1;
    const { L: L2, a: a2, b: b2 } = lab2;
    const rad = Math.PI / 180, deg = 180 / Math.PI;

    const C1 = Math.sqrt(a1*a1 + b1*b1);
    const C2 = Math.sqrt(a2*a2 + b2*b2);
    const mC = (C1 + C2) / 2;
    const mC7 = Math.pow(mC, 7);
    const G = 0.5 * (1 - Math.sqrt(mC7 / (mC7 + Math.pow(25, 7))));

    const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
    const C1p = Math.sqrt(a1p*a1p + b1*b1);
    const C2p = Math.sqrt(a2p*a2p + b2*b2);

    let h1p = Math.atan2(b1, a1p) * deg; if (h1p < 0) h1p += 360;
    let h2p = Math.atan2(b2, a2p) * deg; if (h2p < 0) h2p += 360;

    const dLp = L2 - L1;
    const dCp = C2p - C1p;

    let dhp;
    if (C1p * C2p === 0) dhp = 0;
    else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
    else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
    else dhp = h2p - h1p + 360;

    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2);

    const mLp = (L1 + L2) / 2;
    const mCp = (C1p + C2p) / 2;

    let mhp;
    if (C1p * C2p === 0) mhp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) mhp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) mhp = (h1p + h2p + 360) / 2;
    else mhp = (h1p + h2p - 360) / 2;

    const T = 1
        - 0.17 * Math.cos((mhp - 30) * rad)
        + 0.24 * Math.cos(2 * mhp * rad)
        + 0.32 * Math.cos((3 * mhp + 6) * rad)
        - 0.20 * Math.cos((4 * mhp - 63) * rad);

    const SL = 1 + 0.015 * Math.pow(mLp - 50, 2) / Math.sqrt(20 + Math.pow(mLp - 50, 2));
    const SC = 1 + 0.045 * mCp;
    const SH = 1 + 0.015 * mCp * T;

    const mCp7 = Math.pow(mCp, 7);
    const RT = -2 * Math.sqrt(mCp7 / (mCp7 + Math.pow(25, 7)))
        * Math.sin(60 * rad * Math.exp(-Math.pow((mhp - 275) / 25, 2)));

    return Math.sqrt(
        Math.pow(dLp / SL, 2) +
        Math.pow(dCp / SC, 2) +
        Math.pow(dHp / SH, 2) +
        RT * (dCp / SC) * (dHp / SH)
    );
}

// ─── Reference car color palette (RGB + pre-computed LAB) ───
// ONLY visible, clearly-identifiable colors. NO dark/shadow variants.
// Dark pixels are handled by the chroma gate below, not by palette matching.
const CAR_COLORS_RGB = {
    'red': [
        [255,0,0],[220,30,30],[200,20,20],[240,40,40],[210,35,35],
        [180,20,20],[190,40,40],[170,25,25],[200,50,50],[185,30,30],
        [150,10,10],[140,20,15],[160,30,25],[145,15,12],[135,25,20],
        [130,0,0],[120,15,10],[110,10,5],[170,40,35],[155,25,20],
        // Darker reds, maroon-reds
        [200,30,30],[180,20,20],[170,25,40],[220,50,50],[190,35,35],
    ],
    'blue': [
        [0,0,180],[30,60,200],[0,100,255],[50,80,180],[0,50,150],
        [20,40,120],[0,70,200],[70,100,210],[25,55,170],[10,30,100],
        [0,0,120],[0,60,180],[40,70,160],[0,80,190],[60,90,200],
        // Teal / cyan (bright)
        [0,160,180],[0,180,200],[0,140,160],[20,170,190],[0,150,170],
        [0,200,220],[30,190,210],[0,130,150],[10,175,195],[0,120,140],
        // Dark teal / dark cyan (smoky/shadowed drift cars)
        [0,80,90],[0,100,110],[20,90,100],[0,70,80],[10,85,95],
        [0,60,70],[15,75,85],[0,110,125],[5,95,105],[0,65,75],
        // Turquoise / mint (like teal S14, HSV)
        [100,200,200],[80,180,185],[120,210,210],[90,190,195],[110,205,205],
        [70,170,175],[60,160,165],[130,215,215],[85,185,190],[75,175,180],
        // Medium blues
        [0,100,180],[0,80,160],[30,60,120],
    ],
    'green': [
        [0,130,0],[30,150,50],[0,180,80],[50,160,50],[0,100,0],
        [20,120,40],[0,160,60],[40,140,30],[80,170,80],[10,90,10],
        [0,180,160],[0,160,140],[20,170,150],[0,150,130],[30,190,170],
        // Lime / yellow-greens
        [140,200,0],[120,180,0],[160,220,30],[100,170,0],[150,210,20],
        // Olive / khaki / army green (muted yellow-greens)
        [140,145,80],[130,135,70],[150,155,90],[120,125,60],[160,160,100],
        [145,150,85],[135,140,75],[125,130,65],[155,155,95],[115,120,55],
        // Dark olive / military green (shadowed conditions)
        [90,95,45],[80,85,35],[100,105,55],[85,90,40],[95,100,50],
        [75,80,30],[105,110,60],[110,115,65],[70,75,25],[88,92,42],
        // Olive/army green (CRITICAL gap)
        [100,110,40],[110,100,50],[90,95,45],[120,115,55],[85,90,40],
    ],
    'yellow': [
        [255,220,0],[230,200,0],[255,200,50],[200,180,0],[240,210,30],
        [220,190,10],[250,230,50],[210,185,20],[180,160,0],[255,240,80],
        // Warm yellows / gold
        [200,170,30],[190,160,20],[210,180,40],[180,150,10],[220,195,50],
        // Cream/pale yellow
        [255,250,180],[255,245,160],[245,235,140],[240,230,170],
        // Gold/mustard
        [220,200,50],[200,180,40],
    ],
    'orange': [
        [255,140,0],[240,120,20],[255,165,0],[220,100,10],[200,90,0],
        [230,110,15],[245,130,30],[210,95,5],[255,150,40],[190,80,0],
        // Burnt orange, rust
        [200,100,30],[180,80,20],[190,90,25],[170,75,30],[210,110,40],
    ],
    'purple': [
        [100,0,150],[130,20,180],[80,0,120],[150,50,200],[60,0,100],
        [110,30,160],[90,10,140],[140,40,190],[70,0,110],[120,20,170],
        // Blue-purples / violet
        [90,30,190],[100,40,200],[80,25,170],[110,50,210],[85,20,160],
        [120,60,200],[130,70,210],[95,35,180],[105,45,195],[115,55,205],
        // Deep/vivid purple (like the purple Chevelle/ute)
        [100,20,160],[90,15,150],[80,10,140],[110,25,170],[120,30,180],
        [85,0,135],[75,0,125],[105,15,155],[95,10,145],[115,20,165],
        [70,20,130],[80,30,150],[90,35,160],[75,15,120],[65,10,110],
        // DARK purple (smoky conditions, shadows, rear views)
        [50,0,80],[45,5,75],[55,10,85],[40,0,65],[60,15,90],
        [35,0,55],[48,8,72],[52,12,82],[42,3,68],[58,10,88],
        [55,20,90],[50,15,80],[45,10,70],[60,25,95],[40,5,60],
        [65,15,100],[70,10,105],[55,5,85],[50,10,75],[45,0,65],
    ],
    'pink': [
        [255,105,180],[255,130,170],[240,100,150],[220,80,130],[255,150,200],
        [230,120,160],[250,90,140],[210,70,120],[255,170,210],[240,110,165],
        // Pale/blush pink
        [255,180,200],[250,170,190],[240,160,175],[230,150,165],
    ],
    'brown': [
        [120,70,30],[100,55,20],[140,80,40],[85,45,15],[110,65,25],
        [130,75,35],[95,50,18],[150,90,50],[80,40,10],[115,60,28],
        // Tan/bronze (must be clearly brown, not warm-white)
        [160,110,55],[140,95,45],[120,80,35],[150,105,50],[135,90,40],
        // Dark rust brown
        [100,50,30],[90,45,25],[110,55,25],[95,48,20],
        // Chocolate brown
        [80,50,25],[70,40,20],[90,55,30],[75,45,22],[85,48,28],
    ],
    'black': [
        [5,5,5],[10,10,10],[15,15,15],[20,20,20],[25,25,25],
        [30,30,30],[35,35,35],[28,28,30],[22,22,24],[18,18,20],
        // Dark with very slight tint (still black cars)
        [30,28,28],[28,30,30],[30,30,32],[25,25,28],[32,30,30],
        [35,33,33],[33,35,35],[35,35,38],[40,40,40],[38,38,40],
    ],
    'white': [
        [255,255,255],[250,250,250],[248,248,248],[245,245,245],[252,252,252],
        [240,238,235],[242,240,238],[238,236,232],[245,243,240],[235,233,230],
        [225,225,225],[220,220,220],[215,215,218],[210,210,212],[218,218,220],
        [205,205,208],[212,212,215],[222,222,225],[208,208,210],[215,214,216],
        [230,232,238],[228,230,235],[232,234,240],[226,228,232],[235,237,242],
        // Warm-tinted whites (dusty track, warm sunlight, motorsport conditions)
        [240,235,220],[235,230,215],[245,240,225],[230,225,210],[238,233,218],
        [242,237,222],[232,227,212],[248,243,228],[228,223,208],[236,231,216],
        [220,215,200],[215,210,195],[225,220,205],[210,205,190],[218,213,198],
        [222,217,202],[212,207,192],[228,223,208],[208,203,188],[216,211,196],
        // Cream whites (very common on white cars in warm light)
        [240,235,225],[235,228,218],[245,238,228],[230,222,212],[238,230,220],
        [225,218,208],[220,213,203],[232,225,215],[215,208,198],[228,221,211],
        // Cool whites (overcast, shade)
        [230,235,240],[225,230,238],[235,238,242],[220,225,232],[228,232,238],
    ],
    'silver-grey': [
        [150,150,155],[160,160,165],[170,170,172],[140,140,145],[155,155,158],
        [165,165,168],[175,175,178],[145,145,148],[180,180,182],[135,135,138],
        [100,100,105],[110,110,115],[120,120,125],[105,105,110],[115,115,118],
        [170,172,178],[165,168,175],[175,178,182],[160,163,170],[180,182,188],
        [190,190,192],[195,195,198],[185,185,188],[192,192,195],[188,188,190],
        // Metallic silver (slight blue shift)
        [170,175,185],[160,165,175],[180,185,195],
        // Gun metal grey
        [80,80,85],[90,90,95],
        // Warm silver (dusty/warm conditions, very common at motorsport events)
        [180,175,165],[175,170,160],[185,180,170],[170,165,155],[190,185,175],
        [195,190,180],[200,195,185],[165,160,150],[188,183,173],[172,167,157],
        [160,155,145],[155,150,140],[165,160,148],[150,145,135],[168,163,152],
        // Warm medium grey
        [140,135,125],[135,130,120],[145,140,130],[130,125,115],[148,143,133],
    ],
};

// Pre-compute LAB values for the reference palette
const CAR_COLORS_LAB = {};
for (const [category, rgbSamples] of Object.entries(CAR_COLORS_RGB)) {
    CAR_COLORS_LAB[category] = rgbSamples.map(([r, g, b]) => rgbToLab(r, g, b));
}

// ─── Classify an RGB color with chroma gate ───
// KEY INSIGHT: Dark, desaturated pixels are shadows/undercarriage, NOT car paint.
// They must be classified by lightness (black/grey), not by faint hue tint.
function classifyColorLab(r, g, b) {
    const lab = rgbToLab(r, g, b);
    const chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);

    // CHROMA GATE: Only force achromatic match for truly grey/desaturated pixels.
    // More permissive: dark purple (L~25, C~12) now passes through instead of being forced to black.
    // If chroma > 15, NEVER treat as shadow regardless of lightness.
    const isLikelyShadow = chroma <= 15 && ((lab.L < 20 && chroma < 6) || (lab.L < 12 && chroma < 10));

    let bestCategory = 'unknown';
    let bestDist = Infinity;

    for (const [category, labSamples] of Object.entries(CAR_COLORS_LAB)) {
        // If this is a shadow pixel, only match against achromatic palettes
        if (isLikelyShadow && category !== 'black' && category !== 'silver-grey' && category !== 'white') {
            continue;
        }
        for (const ref of labSamples) {
            const d = deltaE2000(lab, ref);
            if (d < bestDist) {
                bestDist = d;
                bestCategory = category;
            }
        }
    }

    return { category: bestCategory, distance: bestDist };
}

// ─── Median-cut color quantization (faster + more accurate than k-means) ───
function medianCut(pixels, maxColors) {
    if (pixels.length === 0) return [];

    function getRange(bucket) {
        let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
        for (const [r, g, b] of bucket) {
            if (r < minR) minR = r; if (r > maxR) maxR = r;
            if (g < minG) minG = g; if (g > maxG) maxG = g;
            if (b < minB) minB = b; if (b > maxB) maxB = b;
        }
        return { rRange: maxR - minR, gRange: maxG - minG, bRange: maxB - minB };
    }

    function average(bucket) {
        let sr = 0, sg = 0, sb = 0;
        for (const [r, g, b] of bucket) { sr += r; sg += g; sb += b; }
        const n = bucket.length;
        return [Math.round(sr/n), Math.round(sg/n), Math.round(sb/n)];
    }

    let buckets = [pixels.slice()];

    while (buckets.length < maxColors) {
        // Find bucket with largest color range
        let maxRange = -1, splitIdx = 0;
        for (let i = 0; i < buckets.length; i++) {
            if (buckets[i].length < 5) continue; // minimum cluster size: reject tiny clusters
            const { rRange, gRange, bRange } = getRange(buckets[i]);
            const range = Math.max(rRange, gRange, bRange);
            if (range > maxRange) { maxRange = range; splitIdx = i; }
        }
        if (maxRange <= 0) break;

        const bucket = buckets[splitIdx];
        const { rRange, gRange, bRange } = getRange(bucket);

        // Sort by the channel with the widest range
        let channel;
        if (rRange >= gRange && rRange >= bRange) channel = 0;
        else if (gRange >= rRange && gRange >= bRange) channel = 1;
        else channel = 2;

        bucket.sort((a, b) => a[channel] - b[channel]);
        const mid = Math.floor(bucket.length / 2);

        buckets.splice(splitIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
    }

    let result = buckets
        .filter(b => b.length >= 5) // reject clusters with fewer than 5 pixels
        .map(b => ({ rgb: average(b), count: b.length, pct: b.length / pixels.length }))
        .sort((a, b) => b.count - a.count);

    // Merge clusters within Delta-E 8 of each other
    const merged = [];
    const used = new Set();
    for (let i = 0; i < result.length; i++) {
        if (used.has(i)) continue;
        let mergedCluster = { rgb: [...result[i].rgb], count: result[i].count };
        const lab_i = rgbToLab(result[i].rgb[0], result[i].rgb[1], result[i].rgb[2]);
        for (let j = i + 1; j < result.length; j++) {
            if (used.has(j)) continue;
            const lab_j = rgbToLab(result[j].rgb[0], result[j].rgb[1], result[j].rgb[2]);
            if (deltaE2000(lab_i, lab_j) < 8) {
                // Weighted average merge
                const totalCount = mergedCluster.count + result[j].count;
                mergedCluster.rgb = mergedCluster.rgb.map((v, k) =>
                    Math.round((v * mergedCluster.count + result[j].rgb[k] * result[j].count) / totalCount)
                );
                mergedCluster.count = totalCount;
                used.add(j);
            }
        }
        mergedCluster.pct = mergedCluster.count / pixels.length;
        merged.push(mergedCluster);
    }

    return merged.sort((a, b) => b.count - a.count);
}

// ─── Get LAB chroma (colorfulness) of an RGB value ───
function getChroma(r, g, b) {
    const lab = rgbToLab(r, g, b);
    return Math.sqrt(lab.a * lab.a + lab.b * lab.b);
}

// ─── RGB → HSV conversion ───
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0, s = max === 0 ? 0 : d / max, v = max;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s: s * 100, v: v * 100 };
}

// ─── Environment pixel detector ───
// Identifies pixels that are likely background (grass, sky, road, dirt, smoke, haze)
// rather than car paint. Tuned for drag strip / motorsport photography conditions.
// Returns a tag string if the pixel is environment, or null if it could be car paint.
function detectEnvironmentPixel(r, g, b) {
    const hsv = rgbToHsv(r, g, b);
    const lab = rgbToLab(r, g, b);
    const chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);

    // ── Tire smoke / burnout haze ──
    // Smoke is typically bright, desaturated, slightly warm grey-white
    // Very common in drag photography — must filter aggressively
    if (chroma < 8 && lab.L > 60 && lab.L < 95) {
        return 'smoke';
    }
    // Dense smoke (darker, still desaturated)
    if (chroma < 5 && lab.L > 40 && lab.L < 65) {
        return 'smoke';
    }

    // ── Green grass/foliage ──
    // BUT exclude vivid greens that could be car paint (high saturation + high value)
    if (hsv.h >= 60 && hsv.h <= 170 && hsv.s > 20 && hsv.v > 15 && hsv.v < 85) {
        if (hsv.s < 70 && hsv.v < 70) return 'grass';
        if (hsv.s > 25 && hsv.s < 55 && hsv.v > 40 && hsv.v < 80) return 'grass';
    }

    // ── Blue sky ── (expanded hue range to catch cyan-ish and purple-ish sky)
    if (hsv.h >= 170 && hsv.h <= 260 && hsv.s > 10 && hsv.s < 55 && hsv.v > 55) {
        return 'sky';
    }

    // ── Grey asphalt / drag strip surface ──
    // Drag strips have very dark, uniform asphalt — often with rubber marks
    if (chroma < 6 && lab.L > 10 && lab.L < 55) {
        return 'road';
    }

    // ── Brown dirt / track shoulder ──
    if (hsv.h >= 15 && hsv.h <= 50 && hsv.s > 15 && hsv.s < 55 && hsv.v > 15 && hsv.v < 55) {
        return 'dirt';
    }

    // ── Concrete barriers / walls (light grey, very low chroma) ──
    if (chroma < 4 && lab.L > 55 && lab.L < 80) {
        return 'barrier';
    }

    // ── Flame detection (burnout flames, exhaust fire) ──
    if (hsv.h >= 5 && hsv.h <= 40 && hsv.s > 70 && hsv.v > 70) {
        return 'flame';
    }

    // ── Burnout smoke (dark, orange-brown tinted) ──
    if (chroma < 12 && lab.L >= 20 && lab.L <= 50 && hsv.h >= 15 && hsv.h <= 55) {
        return 'smoke';
    }

    // ── Track rubber (very dark, low-chroma = track surface rubber marks) ──
    if (chroma < 5 && lab.L < 12) {
        return 'road';
    }

    // ── Chrome/glass reflections (bright achromatic) ──
    if (lab.L > 85 && chroma < 5) {
        return 'reflection';
    }

    return null;
}

// ─── Extract pixels from a crop region, with environment filtering ───
function extractFilteredPixels(image, cx, cy, cw, ch, filterEnvironment) {
    const crop = image.clone().crop(
        Math.max(0, cx), Math.max(0, cy),
        Math.min(cw, image.getWidth() - Math.max(0, cx)),
        Math.min(ch, image.getHeight() - Math.max(0, cy))
    );
    const resized = crop.resize(Math.min(150, crop.getWidth()), Jimp.AUTO);
    const rw = resized.getWidth(), rh = resized.getHeight();

    const carPixels = [];
    const envPixels = [];
    let envCounts = { grass: 0, sky: 0, road: 0, dirt: 0, smoke: 0, barrier: 0 };

    resized.scan(0, 0, rw, rh, function(x, y, idx) {
        const r = this.bitmap.data[idx], g = this.bitmap.data[idx+1], b = this.bitmap.data[idx+2];
        const brightness = (r + g + b) / 3;
        // Skip pure black/white (overexposed/underexposed)
        // Chroma-aware exception: vivid dark/bright colors are vehicle paint
        const hsv = rgbToHsv(r, g, b);
        if (hsv.s <= 30) {
            if (brightness > 253 || brightness < 2) return;
        }

        if (filterEnvironment) {
            const envType = detectEnvironmentPixel(r, g, b);
            if (envType) {
                envPixels.push([r, g, b]);
                envCounts[envType] = (envCounts[envType] || 0) + 1;
                return;
            }
        }
        carPixels.push([r, g, b]);
    });

    return { carPixels, envPixels, envCounts };
}

// ─── Run LAB color classification on a set of pixels ───
// Shared logic used by both segmented and fallback paths
function classifyPixelsLAB(pixels) {
    if (pixels.length < 30) return null;

    const clusters = medianCut(pixels, 16);
    const allClusters = clusters.map(c => {
        const { category, distance } = classifyColorLab(c.rgb[0], c.rgb[1], c.rgb[2]);
        const chroma = getChroma(c.rgb[0], c.rgb[1], c.rgb[2]);
        const envTag = detectEnvironmentPixel(c.rgb[0], c.rgb[1], c.rgb[2]);
        return { ...c, category, distance, chroma, isEnvRemnant: !!envTag };
    });

    const scored = allClusters.map(c => {
        let score = c.pct * 100;

        // Size bonuses — larger clusters are more likely to be the car body
        if (c.pct > 0.08) score *= 1.3;
        if (c.pct > 0.18) score *= 1.4;
        if (c.pct > 0.30) score *= 1.5;

        // Palette match quality — how close to a known car color
        if (c.distance < 8) score *= 3.0;
        else if (c.distance < 15) score *= 2.5;
        else if (c.distance < 22) score *= 1.8;
        else if (c.distance < 30) score *= 1.0;
        else score *= 0.3;

        // Chroma bonus — car paint is typically vivid and saturated
        // This is critical for separating car colors from smoke/haze/shadows
        if (c.chroma > 40) score *= 1.6;
        else if (c.chroma > 30) score *= 1.4;
        else if (c.chroma > 20) score *= 1.2;
        else if (c.chroma > 10) score *= 1.0;
        else score *= 0.7; // very desaturated — likely smoke/shadow/road

        // Environment remnant penalty (smoke, grass, sky, road)
        if (c.isEnvRemnant) score *= 0.10;

        // High-confidence bonus for close match + decent coverage
        if (c.distance < 12 && c.pct > 0.06) score *= 1.5;

        return { ...c, score };
    }).sort((a, b) => b.score - a.score);

    const winner = scored[0];
    const top5 = scored.slice(0, Math.min(5, scored.length));
    const agreeing = top5.filter(c => c.category === winner.category).length;
    const hex = `#${winner.rgb.map(c => Math.max(0,Math.min(255,c)).toString(16).padStart(2,'0')).join('')}`;
    const winnerCategoryPct = scored.filter(c => c.category === winner.category).reduce((sum, c) => sum + c.pct, 0);

    return {
        rgb: winner.rgb, category: winner.category, hex, distance: winner.distance,
        chroma: winner.chroma, pct: winner.pct, agreeing, top5Count: top5.length,
        winnerCategoryPct, allScored: scored
    };
}

// ─── Analyze the hero car color in an image ───
// Pipeline v8: Two-stage vehicle isolation
//   Stage 1: SSD-MobileNet → bounding box detection
//   Stage 2: SegFormer → pixel-level vehicle segmentation (which pixels ARE the car)
//   Stage 3: Extract ONLY vehicle pixels → zero background contamination
//   Stage 4: Nyckel on masked crop + LAB on pure vehicle pixels → smart merge
async function analyzeImageColor(imagePath) {
    try {
        // ═══ FAST PATH: Claude Vision (Pro/Unlimited tiers) ═══
        // For single-image calls (non-batch). Batch mode bypasses this entirely.
        if (CLAUDE_API_KEY && !imagePath._batchResult) {
            try {
                const jpegBuffer = await prepareImageForApi(imagePath);
                const claudeResult = await classifyWithClaude(jpegBuffer);
                if (claudeResult) {
                    return {
                        rgb: [128, 128, 128],
                        category: claudeResult.category,
                        hex: '#808080',
                        confidence: 'high',
                        aiDetected: true,
                        segmented: false,
                        method: claudeResult.method || 'claude-vision',
                    };
                }
                console.log('  [claude] Vision failed, falling back to local pipeline');
            } catch (err) {
                console.warn('  [claude] Vision error, falling back:', err.message);
            }
        }

        // ═══ LOCAL PIPELINE: SSD-MobileNet + SegFormer + LAB (fallback) ═══
        const image = await Jimp.read(imagePath);
        const w = image.getWidth(), h = image.getHeight();

        // ── Stage 1: Detect car bounding box with SSD-MobileNet ──
        const carBox = await detectCars(image);
        const aiDetected = carBox && carBox.score > 0.45;

        // ── Stage 2: Crop bounding box region ──
        let carCrop;
        if (aiDetected) {
            const cx = Math.max(0, Math.round(carBox.left * w));
            const cy = Math.max(0, Math.round(carBox.top * h));
            const cw = Math.max(10, Math.min(Math.round((carBox.right - carBox.left) * w), w - cx));
            const ch = Math.max(10, Math.min(Math.round((carBox.bottom - carBox.top) * h), h - cy));
            carCrop = image.clone().crop(cx, cy, cw, ch);
            console.log(`  [stage1] SSD-MobileNet detected vehicle (score=${carBox.score.toFixed(2)}) → ${cw}x${ch} crop`);
        } else {
            // No detection → center crop (loose, segmentation will tighten it)
            const cx = Math.round(w * 0.10), cy = Math.round(h * 0.10);
            const cw = Math.round(w * 0.80), ch = Math.round(h * 0.80);
            carCrop = image.clone().crop(cx, cy, Math.min(cw, w - cx), Math.min(ch, h - cy));
            console.log(`  [stage1] No detection → center 80% crop`);
        }

        // ── Stage 3: Start Nyckel early (on raw crop) in parallel with SegFormer ──
        // This saves ~1-2s by overlapping network latency with segmentation inference
        const rawNyckelCrop = carCrop.clone().resize(300, Jimp.AUTO).quality(80);
        const rawNyckelBuffer = await rawNyckelCrop.getBufferAsync(Jimp.MIME_JPEG);
        const nyckelPromise = classifyWithNyckel(rawNyckelBuffer); // fires NOW, runs in background

        // ── Stage 4: SegFormer pixel-level vehicle segmentation (runs while Nyckel is in-flight) ──
        const segResult = await segmentVehicle(carCrop);
        let vehiclePixels = [];
        let segmentationUsed = false;

        if (segResult && segResult.vehiclePixelCount > 0) {
            const vehiclePct = Math.round(segResult.vehiclePixelCount / segResult.totalPixels * 100);
            console.log(`  [stage2] SegFormer: ${vehiclePct}% of crop is vehicle (${segResult.vehiclePixelCount}/${segResult.totalPixels} pixels)`);

            if (vehiclePct > 5) {
                segmentationUsed = true;
                // Single-pass: extract vehicle pixels + build masked Nyckel crop
                const extracted = await extractAndMask(carCrop, segResult);
                vehiclePixels = extracted.vehiclePixels;
                // If we got a good mask, re-send masked version to Nyckel for better accuracy
                // (the early raw Nyckel call is our fallback/speed optimization)
                console.log(`  [stage2] Extracted ${vehiclePixels.length} pure vehicle pixels (zero background)`);
            } else {
                console.log(`  [stage2] SegFormer found too little vehicle area (${vehiclePct}%), falling back`);
            }
        } else {
            console.log(`  [stage2] SegFormer unavailable or found no vehicles, falling back`);
        }

        // ── Fallback: multi-region sampling + env filtering (if segmentation failed) ──
        if (!segmentationUsed) {
            if (aiDetected) {
                const boxH = carBox.bottom - carBox.top;
                const boxW = carBox.right - carBox.left;
                const regions = [
                    { top: carBox.top + boxH * 0.10, bottom: carBox.top + boxH * 0.30,
                      left: carBox.left + boxW * 0.20, right: carBox.right - boxW * 0.20, weight: 1.0 },
                    { top: carBox.top + boxH * 0.25, bottom: carBox.top + boxH * 0.55,
                      left: carBox.left + boxW * 0.15, right: carBox.right - boxW * 0.15, weight: 2.0 },
                    { top: carBox.top + boxH * 0.50, bottom: carBox.top + boxH * 0.65,
                      left: carBox.left + boxW * 0.20, right: carBox.right - boxW * 0.20, weight: 0.8 }
                ];
                for (const region of regions) {
                    const cx = Math.max(0, Math.round(region.left * w));
                    const cy = Math.max(0, Math.round(region.top * h));
                    const cw = Math.max(10, Math.round((region.right - region.left) * w));
                    const ch = Math.max(10, Math.round((region.bottom - region.top) * h));
                    const { carPixels } = extractFilteredPixels(image, cx, cy, cw, ch, true);
                    const dupeCount = Math.round(region.weight);
                    for (let d = 0; d < dupeCount; d++) vehiclePixels.push(...carPixels);
                }
            } else {
                const cx = Math.round(w * 0.22), cy = Math.round(h * 0.30);
                const cw = Math.round(w * 0.56), ch = Math.round(h * 0.40);
                const { carPixels } = extractFilteredPixels(image, cx, cy, cw, ch, true);
                vehiclePixels = carPixels;
            }
            console.log(`  [fallback] Env-filtered ${vehiclePixels.length} pixels`);
        }

        // ── Stage 5: LAB classification (sync) + await Nyckel (already in-flight) ──
        const labResult = classifyPixelsLAB(vehiclePixels);

        if (labResult) {
            console.log(`  [lab] Winner: ${labResult.category} (deltaE=${labResult.distance.toFixed(1)}, ${Math.round(labResult.winnerCategoryPct*100)}% coverage, ${labResult.agreeing}/${labResult.top5Count} agree, chroma=${labResult.chroma.toFixed(0)})${segmentationUsed ? ' [segmented]' : ''}`);
        }

        const nyckelResult = await nyckelPromise;

        // ── Stage 5: Smart merge — Nyckel + LAB cross-validation ──
        const ACHROMATIC = new Set(['black', 'white', 'silver-grey']);
        const CHROMATIC = new Set(['red','blue','green','yellow','orange','purple','pink','brown']);
        const ENV_COLORS = new Set(['green', 'blue', 'brown']);

        if (nyckelResult && nyckelResult.confidence > 0.5) {
            const nyckelCategory = nyckelResult.category;
            const nyckelConf = nyckelResult.confidence;

            if (labResult && labResult.allScored) {
                const labWinner = labResult.category;
                const achromaticPct = labResult.allScored.filter(c => ACHROMATIC.has(c.category)).reduce((sum, c) => sum + c.pct, 0);
                const nyckelColorPct = labResult.allScored.filter(c => c.category === nyckelCategory).reduce((sum, c) => sum + c.pct, 0);
                const labWinnerPct = labResult.winnerCategoryPct;

                console.log(`  [merge] Nyckel=${nyckelCategory}(${Math.round(nyckelConf*100)}%) LAB=${labWinner}(${Math.round(labWinnerPct*100)}%) achro=${Math.round(achromaticPct*100)}% nyckelColor=${Math.round(nyckelColorPct*100)}%${segmentationUsed ? ' [SEG]' : ''}`);

                // CASE A: Both agree → highest confidence
                if (nyckelCategory === labWinner) {
                    console.log(`  [merge] AGREE: both say ${nyckelCategory}`);
                    return {
                        rgb: labResult.rgb, category: nyckelCategory, hex: labResult.hex,
                        confidence: 'high', nyckelLabel: nyckelResult.nyckelLabel,
                        nyckelConfidence: Math.round(nyckelConf * 100),
                        aiDetected, segmented: segmentationUsed, method: 'consensus'
                    };
                }

                // If segmentation was used, LAB data is PURE vehicle pixels — trust it more
                const labTrustBoost = segmentationUsed ? 0.15 : 0;

                // CASE B: Nyckel=CHROMATIC, LAB=ACHROMATIC
                if (CHROMATIC.has(nyckelCategory) && ACHROMATIC.has(labWinner)) {
                    if (achromaticPct > (0.35 - labTrustBoost) && nyckelColorPct < (0.25 + labTrustBoost)) {
                        console.log(`  [merge] OVERRIDE→LAB: ${labWinner} (${Math.round(achromaticPct*100)}% achromatic)`);
                        return {
                            rgb: labResult.rgb, category: labWinner, hex: labResult.hex,
                            confidence: labResult.distance < 18 ? 'high' : 'medium',
                            nyckelLabel: nyckelResult.nyckelLabel, nyckelOverridden: true,
                            deltaE: Math.round(labResult.distance * 10) / 10,
                            aiDetected, segmented: segmentationUsed, method: 'lab-override'
                        };
                    }
                    if (labResult.agreeing >= 3 && labResult.distance < 18) {
                        console.log(`  [merge] OVERRIDE→LAB (strong): ${labResult.agreeing} agree on ${labWinner}`);
                        return {
                            rgb: labResult.rgb, category: labWinner, hex: labResult.hex,
                            confidence: 'high', nyckelLabel: nyckelResult.nyckelLabel, nyckelOverridden: true,
                            deltaE: Math.round(labResult.distance * 10) / 10,
                            aiDetected, segmented: segmentationUsed, method: 'lab-override'
                        };
                    }
                }

                // CASE C: Nyckel says environment color but LAB disagrees
                if (ENV_COLORS.has(nyckelCategory) && nyckelCategory !== labWinner) {
                    const threshold = segmentationUsed ? 0.30 : 0.40;
                    if (nyckelColorPct < threshold && labWinnerPct > nyckelColorPct) {
                        console.log(`  [merge] ENV_SKEPTIC: Nyckel=${nyckelCategory}(${Math.round(nyckelColorPct*100)}%) → LAB=${labWinner}(${Math.round(labWinnerPct*100)}%)`);
                        return {
                            rgb: labResult.rgb, category: labWinner, hex: labResult.hex,
                            confidence: labResult.distance < 20 ? 'high' : 'medium',
                            nyckelLabel: nyckelResult.nyckelLabel, nyckelOverridden: true,
                            deltaE: Math.round(labResult.distance * 10) / 10,
                            aiDetected, segmented: segmentationUsed, method: 'lab-env-override'
                        };
                    }
                }

                // CASE D: Nyckel=ACHROMATIC, LAB=CHROMATIC
                if (ACHROMATIC.has(nyckelCategory) && CHROMATIC.has(labWinner)) {
                    const chromaticClusters = labResult.allScored.filter(c =>
                        CHROMATIC.has(c.category) && c.chroma > 8 && c.distance < 35 && c.pct > 0.03
                    );
                    if (chromaticClusters.length > 0) {
                        const bestChromatic = chromaticClusters.sort((a, b) => {
                            const sA = a.chroma * 2 + a.pct * 100 + (35 - a.distance);
                            const sB = b.chroma * 2 + b.pct * 100 + (35 - b.distance);
                            return sB - sA;
                        })[0];
                        const chromaticPct = chromaticClusters.filter(c => c.category === bestChromatic.category).reduce((sum, c) => sum + c.pct, 0);
                        if (chromaticPct > 0.05 || bestChromatic.chroma > 20) {
                            const hex = `#${bestChromatic.rgb.map(c => Math.max(0,Math.min(255,c)).toString(16).padStart(2,'0')).join('')}`;
                            console.log(`  [merge] OVERRIDE→CHROMATIC: ${bestChromatic.category} (${Math.round(chromaticPct*100)}%)`);
                            return {
                                rgb: bestChromatic.rgb, category: bestChromatic.category, hex,
                                confidence: bestChromatic.distance < 20 ? 'high' : 'medium',
                                deltaE: Math.round(bestChromatic.distance * 10) / 10,
                                nyckelLabel: nyckelResult.nyckelLabel, nyckelOverridden: true,
                                chromaticPct: Math.round(chromaticPct * 100),
                                aiDetected, segmented: segmentationUsed, method: 'lab-chromatic-override'
                            };
                        }
                    }
                    console.log(`  [merge] ACHROMATIC confirmed → ${nyckelCategory}`);
                    return {
                        rgb: labResult.rgb, category: nyckelCategory, hex: labResult.hex,
                        confidence: nyckelConf > 0.7 ? 'high' : 'medium',
                        nyckelLabel: nyckelResult.nyckelLabel, nyckelConfidence: Math.round(nyckelConf * 100),
                        aiDetected, segmented: segmentationUsed, method: 'nyckel'
                    };
                }

                // CASE E: Both chromatic but disagree
                if (CHROMATIC.has(nyckelCategory) && CHROMATIC.has(labWinner) && nyckelCategory !== labWinner) {
                    // With segmentation, LAB is more trustworthy
                    if (segmentationUsed && labWinnerPct > 0.30 && labResult.distance < 22) {
                        console.log(`  [merge] LAB_WINS (segmented): ${labWinner}(${Math.round(labWinnerPct*100)}%)`);
                        return {
                            rgb: labResult.rgb, category: labWinner, hex: labResult.hex,
                            confidence: 'high', nyckelLabel: nyckelResult.nyckelLabel, nyckelOverridden: true,
                            deltaE: Math.round(labResult.distance * 10) / 10,
                            aiDetected, segmented: segmentationUsed, method: 'lab-seg-override'
                        };
                    }
                    if (nyckelConf > 0.65 && nyckelColorPct > 0.10) {
                        console.log(`  [merge] NYCKEL_WINS: ${nyckelCategory}(${Math.round(nyckelConf*100)}%)`);
                        return {
                            rgb: labResult.rgb, category: nyckelCategory, hex: labResult.hex,
                            confidence: 'high', nyckelLabel: nyckelResult.nyckelLabel,
                            nyckelConfidence: Math.round(nyckelConf * 100),
                            aiDetected, segmented: segmentationUsed, method: 'nyckel'
                        };
                    }
                    if (labWinnerPct > 0.40 && labResult.distance < 20) {
                        console.log(`  [merge] LAB_WINS: ${labWinner}(${Math.round(labWinnerPct*100)}%)`);
                        return {
                            rgb: labResult.rgb, category: labWinner, hex: labResult.hex,
                            confidence: 'high', nyckelLabel: nyckelResult.nyckelLabel, nyckelOverridden: true,
                            deltaE: Math.round(labResult.distance * 10) / 10,
                            aiDetected, segmented: segmentationUsed, method: 'lab-override'
                        };
                    }
                    if (nyckelConf > 0.45) {
                        console.log(`  [merge] TIEBREAK→NYCKEL: ${nyckelCategory}(${Math.round(nyckelConf*100)}%)`);
                        return {
                            rgb: labResult.rgb, category: nyckelCategory, hex: labResult.hex,
                            confidence: 'medium', nyckelLabel: nyckelResult.nyckelLabel,
                            nyckelConfidence: Math.round(nyckelConf * 100),
                            aiDetected, segmented: segmentationUsed, method: 'nyckel-tiebreak'
                        };
                    }
                }

                // CASE F: All methods disagree and no case matched — route to please-double-check
                if (nyckelCategory !== labWinner && labResult.distance > 24) {
                    console.log(`  [merge] DISAGREE: Nyckel=${nyckelCategory} LAB=${labWinner} dE=${labResult.distance.toFixed(1)} → please-double-check`);
                    return {
                        rgb: labResult.rgb, category: labResult.category, hex: labResult.hex,
                        confidence: 'very-low', nyckelLabel: nyckelResult.nyckelLabel,
                        deltaE: Math.round(labResult.distance * 10) / 10,
                        aiDetected, segmented: segmentationUsed, method: 'disagreement'
                    };
                }
            }

            // Nyckel available but no LAB → trust Nyckel
            if (!labResult) {
                return {
                    rgb: [0,0,0], category: nyckelCategory, hex: '#000000',
                    confidence: nyckelConf > 0.7 ? 'high' : nyckelConf > 0.4 ? 'medium' : 'low',
                    nyckelLabel: nyckelResult.nyckelLabel, nyckelConfidence: Math.round(nyckelConf * 100),
                    aiDetected, segmented: segmentationUsed, method: 'nyckel-only'
                };
            }
        }

        // ── Stage 6: Nyckel unavailable — LAB is the primary classification engine ──
        if (!labResult) {
            // Not enough valid pixels to classify — likely a heavily obscured image
            return { rgb: [128,128,128], category: 'unknown', hex: '#808080', confidence: 'none', method: 'none' };
        }

        // Confidence scoring: recalibrated Delta-E thresholds
        let confidence;
        if (labResult.distance < 10) confidence = 'high';
        else if (labResult.distance < 16) confidence = 'medium';
        else if (labResult.distance < 24) confidence = 'low';
        else confidence = 'very-low'; // route to please-double-check

        // Boost confidence with supporting signals
        if (confidence === 'medium' && (labResult.agreeing >= 2 || labResult.pct > 0.12)) confidence = 'high';
        if (confidence === 'medium' && segmentationUsed) confidence = 'high';
        if (confidence === 'medium' && aiDetected) confidence = 'high';
        if (confidence === 'low' && labResult.chroma > 30 && labResult.distance < 20) confidence = 'medium';

        console.log(`  [result] LOCAL-LAB: ${labResult.category} (conf=${confidence}, dE=${labResult.distance.toFixed(1)}, chroma=${labResult.chroma.toFixed(0)}, ${Math.round(labResult.winnerCategoryPct*100)}% coverage)`);

        return {
            rgb: labResult.rgb, category: labResult.category, hex: labResult.hex,
            confidence, regionsAgreeing: labResult.agreeing, totalRegions: labResult.top5Count,
            deltaE: Math.round(labResult.distance * 10) / 10,
            aiDetected, segmented: segmentationUsed, method: 'local-lab'
        };

    } catch (err) {
        console.error(`Error analyzing ${imagePath}:`, err.message, err.stack);
        return { rgb: [0,0,0], category: 'unknown', hex: '#000000', confidence: 'none' };
    }
}

// ─── Generate a small thumbnail for live preview (sharp if available, Jimp fallback) ───
async function generateThumb(imagePath, sessionId, filename) {
    try {
        const thumbDir = path.join(THUMB_DIR, sessionId);
        fs.mkdirSync(thumbDir, { recursive: true });
        const thumbPath = path.join(thumbDir, filename.replace(/\.[^.]+$/, '.jpg'));
        if (sharp) {
            await sharp(imagePath)
                .resize(120, null, { withoutEnlargement: true })
                .jpeg({ quality: 70 })
                .toFile(thumbPath);
        } else {
            const image = await Jimp.read(imagePath);
            await image.resize(120, Jimp.AUTO).quality(70).writeAsync(thumbPath);
        }
        return `/thumbs/${sessionId}/${path.basename(thumbPath)}`;
    } catch (err) {
        console.error(`[thumb] Failed for ${filename}:`, err.message);
        return null;
    }
}

// ─── Count images in ZIP without extracting (fast pre-scan) ───
async function countZipImages(archivePath) {
    // Use yauzl to read the central directory (instant, even for huge ZIPs)
    const yauzl = require('yauzl');
    return new Promise((resolve, reject) => {
        yauzl.open(archivePath, { lazyEntries: true }, (err, zipFile) => {
            if (err) return reject(err);
            let count = 0;
            zipFile.readEntry();
            zipFile.on('entry', (entry) => {
                const fileName = path.basename(entry.fileName);
                if (/\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(fileName) && !fileName.startsWith('.') && !fileName.startsWith('__')) {
                    count++;
                }
                zipFile.readEntry();
            });
            zipFile.on('end', () => resolve(count));
            zipFile.on('error', reject);
        });
    });
}

// ─── Extract images from ZIP archive ───
async function extractZip(archivePath, destDir, session) {
    let count = 0;
    await new Promise((resolve, reject) => {
        fs.createReadStream(archivePath)
            .pipe(unzipper.Parse())
            .on('entry', (entry) => {
                const fileName = path.basename(entry.path);
                if (/\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(fileName) && !fileName.startsWith('.') && !fileName.startsWith('__')) {
                    count++;
                    session.currentFile = `Extracting: ${fileName} (${count}${session.total > 0 ? '/' + session.total : ''})`;

                    // Handle duplicate names
                    let destName = fileName;
                    let c = 1;
                    while (fs.existsSync(path.join(destDir, destName))) {
                        const ext = path.extname(fileName);
                        destName = `${path.basename(fileName, ext)}_${c}${ext}`;
                        c++;
                    }
                    entry.pipe(fs.createWriteStream(path.join(destDir, destName)));
                } else {
                    entry.autodrain();
                }
            })
            .on('close', resolve)
            .on('error', reject);
    });
    return count;
}

// ─── Extract images from RAR archive ───
async function extractRar(archivePath, destDir, session) {
    let count = 0;
    try {
        const extractor = await createExtractorFromFile({ filepath: archivePath });
        const list = extractor.extract();
        const files = [...list.files];
        for (const file of files) {
            if (file.fileHeader.flags.directory) continue;
            const fileName = path.basename(file.fileHeader.name);
            if (/\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(fileName) && !fileName.startsWith('.')) {
                if (file.extraction) {
                    count++;
                    session.currentFile = `Extracting: ${fileName} (${count} found)`;
                    let destName = fileName;
                    let c = 1;
                    while (fs.existsSync(path.join(destDir, destName))) {
                        const ext = path.extname(fileName);
                        destName = `${path.basename(fileName, ext)}_${c}${ext}`;
                        c++;
                    }
                    fs.writeFileSync(path.join(destDir, destName), Buffer.from(file.extraction));
                }
            }
        }
    } catch (err) {
        console.error('RAR extraction error:', err.message);
    }
    return count;
}

// ─── Collect image files from a directory ───
function collectImageFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => !f.startsWith('.') && !f.startsWith('__') && /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(f))
        .map(f => path.join(dir, f));
}

// ─── Process a list of image files for a session (used by both directory and archive paths) ───
async function processSessionFiles(sessionId, files) {
    const session = sessions[sessionId];
    if (!session) return;

    const outputDir = path.join(OUTPUT_DIR, sessionId);
    fs.mkdirSync(outputDir, { recursive: true });

    session.results = [];
    session.colorCounts = {};
    let completedCount = 0;

    async function waitIfPaused() {
        while (session.status === 'paused') {
            await new Promise(r => setTimeout(r, 250));
        }
        if (session.status === 'cancelled') throw new Error('CANCELLED');
    }

    async function processOneImage(filePath, index) {
        await waitIfPaused();
        const file = path.basename(filePath);

        const colorInfo = await analyzeImageColor(filePath);
        const thumbUrl = await generateThumb(filePath, sessionId, `${index}_${file}`);

        const needsReview = colorInfo.category === 'unknown' || colorInfo.confidence === 'none' || colorInfo.confidence === 'very-low';
        const folderName = needsReview ? 'please-double-check' : colorInfo.category;

        const colorFolder = path.join(outputDir, folderName);
        fs.mkdirSync(colorFolder, { recursive: true });
        let destName = file;
        let counter = 1;
        while (fs.existsSync(path.join(colorFolder, destName))) {
            const ext = path.extname(file);
            destName = `${path.basename(file, ext)}_${counter}${ext}`;
            counter++;
        }
        fs.copyFileSync(filePath, path.join(colorFolder, destName));

        completedCount++;
        session.colorCounts[folderName] = (session.colorCounts[folderName] || 0) + 1;
        session.currentFile = file;
        session.processed = completedCount;

        session.results.push({
            filename: file, color: folderName, hex: colorInfo.hex, rgb: colorInfo.rgb,
            thumb: thumbUrl, confidence: colorInfo.confidence || 'unknown',
            regions: colorInfo.regionsAgreeing ? `${colorInfo.regionsAgreeing}/${colorInfo.totalRegions}` : null,
            needsReview, originalColor: needsReview ? colorInfo.category : null,
            status: needsReview ? 'Needs Review' : 'Success'
        });

        if (completedCount % 10 === 0) {
            console.log(`[${sessionId}] Processed ${completedCount}/${files.length}`);
        }
    }

    // Concurrent processing — 3 parallel workers
    const CONCURRENCY = 3;
    let fileIdx = 0;
    let cancelled = false;

    const workers = Array.from({ length: CONCURRENCY }, async (_, wIdx) => {
        while (fileIdx < files.length && !cancelled) {
            const idx = fileIdx++;
            if (idx >= files.length) break;
            try {
                await processOneImage(files[idx], idx);
            } catch (err) {
                if (err.message === 'CANCELLED') { cancelled = true; return; }
                console.error(`[${sessionId}][w${wIdx}] Failed: ${err.message}`);
                completedCount++;
                session.processed = completedCount;
            }
        }
    });

    try {
        console.log(`[${sessionId}] Processing ${files.length} images (${CONCURRENCY}x concurrent)`);
        await Promise.all(workers);
        if (!cancelled) {
            session.status = 'completed';
            session.currentFile = '';
            console.log(`[${sessionId}] Complete! ${files.length} images sorted.`);
        } else {
            session.currentFile = '';
            console.log(`[${sessionId}] Cancelled after ${completedCount}/${files.length} images.`);
        }
    } catch (err) {
        session.currentFile = '';
        console.log(`[${sessionId}] Error: ${err.message}`);
    }
}

// ─── Process all images in a session (directory-based upload) ───
async function processSession(sessionId) {
    const session = sessions[sessionId];
    if (!session) return;

    const uploadDir = path.join(UPLOAD_DIR, sessionId);
    const extractDir = path.join(uploadDir, '_extracted');
    const outputDir = path.join(OUTPUT_DIR, sessionId);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });

    // Phase 1: Extract archives
    const archiveFiles = fs.readdirSync(uploadDir).filter(f => /\.(zip|rar)$/i.test(f));
    if (archiveFiles.length > 0) {
        session.status = 'extracting';
        session.currentFile = 'Starting extraction...';
        console.log(`[${sessionId}] Extracting ${archiveFiles.length} archive(s)...`);
        for (const archive of archiveFiles) {
            const archivePath = path.join(uploadDir, archive);
            try {
                if (/\.zip$/i.test(archive)) {
                    await extractZip(archivePath, extractDir, session);
                } else if (/\.rar$/i.test(archive)) {
                    await extractRar(archivePath, extractDir, session);
                }
                console.log(`[${sessionId}] Extracted: ${archive}`);
            } catch (err) {
                console.error(`[${sessionId}] Failed to extract ${archive}:`, err.message);
            }
        }
    }

    // Phase 2: Collect all image files
    const files = [
        ...collectImageFiles(uploadDir),
        ...collectImageFiles(extractDir)
    ];

    console.log(`[${sessionId}] Found ${files.length} images to process`);

    if (files.length === 0) {
        session.status = 'completed';
        session.total = 0;
        session.processed = 0;
        session.currentFile = '';
        session.results = [];
        return;
    }

    session.total = files.length;
    session.status = 'processing';
    session.results = [];
    session.colorCounts = {};

    // Phase 3: Process images sequentially (ONNX uses internal threading — JS parallelism causes contention)
    console.log(`[${sessionId}] Processing ${files.length} images`);
    let completedCount = 0;

    // Wait while paused, abort if cancelled
    async function waitIfPaused() {
        while (session.status === 'paused') {
            await new Promise(r => setTimeout(r, 250));
        }
        if (session.status === 'cancelled') throw new Error('CANCELLED');
    }

    async function processOneImage(filePath, index) {
        await waitIfPaused();
        const file = path.basename(filePath);

        const colorInfo = await analyzeImageColor(filePath);
        const thumbUrl = await generateThumb(filePath, sessionId, `${index}_${file}`);

        const needsReview = colorInfo.category === 'unknown' || colorInfo.confidence === 'none' || colorInfo.confidence === 'very-low';
        const folderName = needsReview ? 'please-double-check' : colorInfo.category;

        // Copy to color folder
        const colorFolder = path.join(outputDir, folderName);
        fs.mkdirSync(colorFolder, { recursive: true });
        let destName = file;
        let counter = 1;
        while (fs.existsSync(path.join(colorFolder, destName))) {
            const ext = path.extname(file);
            destName = `${path.basename(file, ext)}_${counter}${ext}`;
            counter++;
        }
        fs.copyFileSync(filePath, path.join(colorFolder, destName));

        // Update session state (synchronized via single-threaded Node.js event loop)
        completedCount++;
        session.colorCounts[folderName] = (session.colorCounts[folderName] || 0) + 1;
        session.currentFile = file;
        session.processed = completedCount;

        session.results.push({
            filename: file,
            color: folderName,
            hex: colorInfo.hex,
            rgb: colorInfo.rgb,
            thumb: thumbUrl,
            confidence: colorInfo.confidence || 'unknown',
            regions: colorInfo.regionsAgreeing ? `${colorInfo.regionsAgreeing}/${colorInfo.totalRegions}` : null,
            needsReview,
            originalColor: needsReview ? colorInfo.category : null,
            status: needsReview ? 'Needs Review' : 'Success'
        });

        if (needsReview) {
            console.log(`[${sessionId}] Review needed: ${file} → ${colorInfo.category} (confidence: ${colorInfo.confidence})`);
        }

        if (completedCount % 10 === 0) {
            console.log(`[${sessionId}] Processed ${completedCount}/${files.length}`);
        }
    }

    try {
        for (let i = 0; i < files.length; i++) {
            await processOneImage(files[i], i);
        }
        session.status = 'completed';
        session.currentFile = '';
        console.log(`[${sessionId}] Complete! ${files.length} images sorted.`);
    } catch (err) {
        if (err.message === 'CANCELLED') {
            session.currentFile = '';
            console.log(`[${sessionId}] Cancelled after ${completedCount}/${files.length} images.`);
        } else {
            throw err;
        }
    }
}

// ─── Upload endpoint ───
app.post('/upload', (req, res) => {
    const sessionId = crypto.randomUUID();

    const sessionStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(UPLOAD_DIR, sessionId);
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            cb(null, file.originalname);
        }
    });

    const sessionUpload = multer({
        storage: sessionStorage,
        limits: { fileSize: 2 * 1024 * 1024 * 1024 },
        fileFilter: (req, file, cb) => {
            const allowed = /jpeg|jpg|png|gif|bmp|webp|zip|rar/;
            cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
        }
    }).array('files', 7000);

    sessionUpload(req, res, (err) => {
        if (err) {
            console.error('Upload error:', err.message);
            return res.status(400).json({ error: err.message });
        }
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No valid image or archive files uploaded' });
        }

        console.log(`[${sessionId}] Upload received: ${req.files.length} file(s)`);
        req.files.forEach(f => console.log(`  - ${f.originalname} (${(f.size / 1024).toFixed(0)} KB)`));

        sessions[sessionId] = {
            status: 'queued',
            total: 0,
            processed: 0,
            currentFile: 'Starting...',
            results: [],
            colorCounts: {}
        };

        // Start processing (non-blocking)
        processSession(sessionId).catch(err => {
            console.error(`[${sessionId}] Processing error:`, err);
            sessions[sessionId].status = 'error';
            sessions[sessionId].error = err.message;
        });

        res.json({
            session_id: sessionId,
            message: 'Processing started',
            total_images: req.files.length
        });
    });
});

// ─── Sort-local endpoint (process images from a local directory) ───
app.post('/sort-local', async (req, res) => {
    const { inputPath, outputPath, maxImages } = req.body;

    if (!inputPath) {
        return res.status(400).json({ error: 'inputPath is required' });
    }

    // Validate inputPath exists
    let stat;
    try {
        stat = fs.statSync(inputPath);
    } catch (err) {
        return res.status(400).json({ error: `inputPath not accessible: ${err.message}` });
    }

    const sessionId = crypto.randomUUID();
    const sessionUploadDir = path.join(UPLOAD_DIR, sessionId);
    fs.mkdirSync(sessionUploadDir, { recursive: true });

    // Clean up old upload directories to prevent disk waste
    try {
        const allUploads = fs.readdirSync(UPLOAD_DIR).filter(d => d !== sessionId);
        for (const old of allUploads) {
            try { fs.rmSync(path.join(UPLOAD_DIR, old), { recursive: true, force: true }); } catch {}
        }
        if (allUploads.length > 0) console.log(`[cleanup] Removed ${allUploads.length} old upload dirs`);
    } catch {}

    // If inputPath is an archive file (ZIP/RAR), extract directly from original location
    // No copying or symlinking — the worker reads the archive in-place
    const isArchiveFile = stat.isFile() && /\.(zip|rar)$/i.test(inputPath);
    if (isArchiveFile) {
        const sizeMB = (stat.size / 1024 / 1024).toFixed(0);
        console.log(`[${sessionId}] sort-local: archive file detected → ${path.basename(inputPath)} (${sizeMB}MB)`);

        const session = {
            id: sessionId, status: 'extracting', total_images: 0,
            total: 0, processed: 0, results: [], startedAt: new Date().toISOString(),
            currentFile: `Extracting ${path.basename(inputPath)} (${sizeMB}MB)...`,
        };
        sessions[sessionId] = session;

        // Extract directly from the original archive path into the session extract dir
        const extractDir = path.join(sessionUploadDir, '_extracted');
        fs.mkdirSync(extractDir, { recursive: true });

        // ── TWO-PHASE: Extract ALL first, THEN classify in bulk ──
        // Phase 1: Full extraction (shows progress to user)
        // Phase 2: Bulk classification with all API keys at max throughput
        (async () => {
            try {
                const outputDir = path.join(OUTPUT_DIR, sessionId);
                fs.mkdirSync(outputDir, { recursive: true });

                let extractedCount = 0;
                let processedCount = 0;
                session.results = [];
                session.colorCounts = {};

                // ── PHASE 1: Extract all images ──
                session.status = 'extracting';

                // Pre-scan: count total images in archive FAST
                if (/\.zip$/i.test(inputPath)) {
                    try {
                        session.currentFile = 'Scanning archive...';
                        const totalCount = await countZipImages(inputPath);
                        session.total = totalCount;
                        session.total_images = totalCount;
                        console.log(`[${sessionId}] Pre-scan: ${totalCount} images in archive`);
                    } catch (err) {
                        console.warn(`[${sessionId}] Pre-scan failed: ${err.message}`);
                    }
                }

                // Extract everything
                if (/\.zip$/i.test(inputPath)) {
                    await new Promise((resolve, reject) => {
                        fs.createReadStream(inputPath)
                            .pipe(unzipper.Parse())
                            .on('entry', (entry) => {
                                const fileName = path.basename(entry.path);
                                if (/\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(fileName) && !fileName.startsWith('.') && !fileName.startsWith('__')) {
                                    extractedCount++;
                                    let destName = fileName;
                                    let c = 1;
                                    while (fs.existsSync(path.join(extractDir, destName))) {
                                        const ext = path.extname(fileName);
                                        destName = `${path.basename(fileName, ext)}_${c}${ext}`;
                                        c++;
                                    }
                                    const destPath = path.join(extractDir, destName);
                                    entry.pipe(fs.createWriteStream(destPath));
                                    session.extracted = extractedCount;
                                    session.currentFile = `Extracting: ${destName} (${extractedCount}/${session.total || '?'})`;
                                } else {
                                    entry.autodrain();
                                }
                            })
                            .on('close', resolve)
                            .on('error', reject);
                    });
                } else if (/\.rar$/i.test(inputPath)) {
                    await extractRar(inputPath, extractDir, session);
                }

                // Collect all extracted files
                const allFiles = collectImageFiles(extractDir);
                session.total = allFiles.length;
                session.total_images = allFiles.length;
                console.log(`[${sessionId}] Extraction complete: ${allFiles.length} images`);

                // ── PHASE 2: Classify all images at max speed ──
                session.status = 'processing';
                session.currentFile = 'Starting classification...';
                const pendingFiles = [...allFiles];
                console.log(`[${sessionId}] Classification started — ${allFiles.length} images, ${OPENROUTER_KEYS.length} keys`);
                // Debug log to file
                const debugLog = path.join(STORAGE_ROOT, 'phase2-debug.log');
                fs.appendFileSync(debugLog, `${new Date().toISOString()} PHASE2 START: ${allFiles.length} images, ${OPENROUTER_KEYS.length} keys, engine: ${getActiveEngine()}\n`);

                async function waitIfPaused() {
                    while (session.status === 'paused') {
                        await new Promise(r => setTimeout(r, 250));
                    }
                    if (session.status === 'cancelled') throw new Error('CANCELLED');
                }

                // ── BATCH + CONCURRENT PROCESSING ──
                // Gemini: 3 workers × 15 images = 45 images per cycle
                // Claude: 3 workers × 6 images = 18 images per cycle
                const BATCH_CONCURRENCY = 3;
                const activeBatchSize = getVisionBatchSize();
                const activeEngine = getActiveEngine();
                console.log(`[${sessionId}] Engine: ${activeEngine}, batch: ${activeBatchSize}, concurrency: ${BATCH_CONCURRENCY}`);
                let cancelled = false;
                const preReadCache = new Map();

                function grabBatch(maxSize) {
                    // Enforce daily quota limit
                    if (session.maxImages && processedCount >= session.maxImages) {
                        console.log(`[${sessionId}] Daily quota reached (${session.maxImages} images). Stopping.`);
                        return [];
                    }
                    const remaining = session.maxImages ? session.maxImages - processedCount : Infinity;
                    const limit = Math.min(maxSize, remaining);
                    const batch = [];
                    while (batch.length < limit && pendingFiles.length > 0) {
                        batch.push(pendingFiles.shift());
                    }
                    return batch;
                }

                function preReadAhead(count) {
                    const upcoming = pendingFiles.slice(0, count);
                    for (const fp of upcoming) {
                        if (!preReadCache.has(fp)) {
                            preReadCache.set(fp, prepareImageForApi(fp).catch(() => null));
                        }
                    }
                }

                async function processBatch(batchFiles, workerIdx) {
                    if (batchFiles.length === 0) return;
                    await waitIfPaused();
                    if (cancelled || session.status === 'cancelled') { cancelled = true; return; }

                    // Pre-read next batch while we process this one
                    preReadAhead(activeBatchSize * BATCH_CONCURRENCY);

                    // Prepare all images — use pre-read cache if available
                    const buffers = await Promise.all(
                        batchFiles.map(fp => {
                            const cached = preReadCache.get(fp);
                            if (cached) { preReadCache.delete(fp); return cached; }
                            return prepareImageForApi(fp).catch(() => null);
                        })
                    );
                    const validIndices = buffers.map((b, i) => b ? i : -1).filter(i => i >= 0);
                    const validBuffers = validIndices.map(i => buffers[i]);

                    // Batch classify with active vision engine (Gemini/Claude/local)
                    let batchResults = null;
                    if (activeEngine !== 'local' && validBuffers.length > 0) {
                        batchResults = await classifyBatchVision(validBuffers);
                    }

                    // Process each file in the batch — FAST PATH when API succeeds
                    for (let bi = 0; bi < batchFiles.length; bi++) {
                        if (cancelled || session.status === 'cancelled') { cancelled = true; return; }
                        const filePath = batchFiles[bi];
                        const file = path.basename(filePath);

                        try {
                            let colorInfo;
                            const validIdx = validIndices.indexOf(bi);
                            if (batchResults && validIdx >= 0 && batchResults[validIdx]) {
                                // FAST PATH: API already classified — skip local pipeline entirely
                                colorInfo = {
                                    rgb: [128, 128, 128],
                                    category: batchResults[validIdx].category,
                                    hex: '#808080',
                                    confidence: 'high',
                                    method: batchResults[validIdx].method || activeEngine + '-batch',
                                };
                            } else {
                                // SLOW PATH: fallback to local analysis
                                colorInfo = await analyzeImageColor(filePath);
                            }

                            const needsReview = colorInfo.category === 'unknown' || colorInfo.confidence === 'none' || colorInfo.confidence === 'very-low';
                            const folderName = needsReview ? 'please-double-check' : colorInfo.category;

                            // Copy file (non-blocking)
                            const colorFolder = path.join(outputDir, folderName);
                            fs.mkdirSync(colorFolder, { recursive: true });
                            let destName = file;
                            let counter = 1;
                            while (fs.existsSync(path.join(colorFolder, destName))) {
                                const ext = path.extname(file);
                                destName = `${path.basename(file, ext)}_${counter}${ext}`;
                                counter++;
                            }
                            // Use async copy — don't block the pipeline
                            const copyPromise = fsPromises.copyFile(filePath, path.join(colorFolder, destName)).catch(() => {
                                // Fallback to sync if async fails
                                try { fs.copyFileSync(filePath, path.join(colorFolder, destName)); } catch {}
                            });

                            // Generate thumb in background — don't wait
                            const thumbName = `${processedCount}_${file}`;
                            const thumbPromise = generateThumb(filePath, sessionId, thumbName);

                            processedCount++;
                            session.colorCounts[folderName] = (session.colorCounts[folderName] || 0) + 1;
                            session.currentFile = file;
                            session.processed = processedCount;

                            // Push result immediately (thumb will update async)
                            const resultIdx = session.results.length;
                            session.results.push({
                                filename: file, color: folderName, hex: colorInfo.hex, rgb: colorInfo.rgb,
                                thumb: null, confidence: colorInfo.confidence || 'unknown',
                                method: colorInfo.method,
                                needsReview, status: needsReview ? 'Needs Review' : 'Success'
                            });

                            // Update thumb when ready (non-blocking)
                            thumbPromise.then(url => { session.results[resultIdx].thumb = url; }).catch(() => {});
                            // Ensure copy finishes before moving on
                            await copyPromise;
                        } catch (err) {
                            console.error(`[${sessionId}][w${workerIdx}] Failed ${file}: ${err.message}`);
                            processedCount++;
                            session.processed = processedCount;
                        }
                    }

                    if (processedCount % 8 === 0) {
                        console.log(`[${sessionId}] Processed ${processedCount}/${extractedCount} (${pendingFiles.length} queued, batch mode)`);
                    }
                }

                // Run N concurrent batch workers with stall detection
                let lastProgressAt = Date.now();
                let lastProgressCount = 0;
                const STALL_TIMEOUT_MS = 30000; // 30s with no progress = stalled

                const workers = Array.from({ length: BATCH_CONCURRENCY }, async (_, workerIdx) => {
                    while (pendingFiles.length > 0) {
                        if (cancelled || session.status === 'cancelled') { cancelled = true; return; }

                        // Stall detection
                        if (pendingFiles.length === 0) {
                            if (processedCount > lastProgressCount) {
                                lastProgressCount = processedCount;
                                lastProgressAt = Date.now();
                            }
                            if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
                                console.log(`[${sessionId}][w${workerIdx}] Stall detected — no progress for ${STALL_TIMEOUT_MS/1000}s. Breaking.`);
                                return;
                            }
                            await new Promise(r => setTimeout(r, 200));
                            continue;
                        }

                        if (pendingFiles.length === 0) {
                            await new Promise(r => setTimeout(r, 200));
                            continue;
                        }

                        const batch = grabBatch(activeBatchSize);
                        if (batch.length === 0) {
                            // Quota reached or no files — break if extraction done
                            return; // All files processed

                        }

                        lastProgressAt = Date.now();
                        try {
                            await processBatch(batch, workerIdx);
                            lastProgressCount = processedCount;
                        } catch (err) {
                            if (err.message === 'CANCELLED') { cancelled = true; return; }
                            console.error(`[${sessionId}][w${workerIdx}] Batch error: ${err.message}`);
                        }
                    }
                });

                await Promise.all(workers);

                session.status = 'completed';
                session.currentFile = '';
                session.engine = activeEngine;
                console.log(`[${sessionId}] Pipeline complete! ${processedCount} images sorted into ${Object.keys(session.colorCounts).length} colors (engine: ${activeEngine}).`);
            } catch (err) {
                if (err.message === 'CANCELLED') {
                    session.currentFile = '';
                    console.log(`[${sessionId}] Cancelled.`);
                } else {
                    console.error(`[${sessionId}] Archive processing error:`, err.message);
                    fs.appendFileSync(path.join(STORAGE_ROOT, 'phase2-debug.log'), `${new Date().toISOString()} ERROR: ${err.message}\n${err.stack}\n`);
                    session.status = 'error';
                    session.error = err.message;
                }
            }
        })();

        return res.json({ session_id: sessionId, total_images: 0, status: 'extracting' });
    }

    // inputPath is a directory — collect files recursively
    if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'inputPath must be a directory or archive file (ZIP/RAR)' });
    }

    // Recursively collect all image and archive files from inputPath
    function collectFilesRecursive(dir) {
        const results = [];
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name.startsWith('__')) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...collectFilesRecursive(fullPath));
            } else if (/\.(jpg|jpeg|png|webp|bmp|gif|zip|rar)$/i.test(entry.name)) {
                results.push(fullPath);
            }
        }
        return results;
    }

    const sourceFiles = collectFilesRecursive(inputPath);
    if (sourceFiles.length === 0) {
        return res.status(400).json({ error: 'No supported image or archive files found in inputPath' });
    }

    // Copy files into session upload dir so processSession can find them
    // Use unique names to avoid collisions from recursive collection
    const usedNames = new Set();
    for (const srcFile of sourceFiles) {
        let destName = path.basename(srcFile);
        let counter = 1;
        while (usedNames.has(destName.toLowerCase())) {
            const ext = path.extname(destName);
            destName = `${path.basename(srcFile, ext)}_${counter}${ext}`;
            counter++;
        }
        usedNames.add(destName.toLowerCase());
        fs.copyFileSync(srcFile, path.join(sessionUploadDir, destName));
    }

    console.log(`[${sessionId}] sort-local: ${sourceFiles.length} file(s) from ${inputPath}`);

    sessions[sessionId] = {
        status: 'queued',
        total: 0,
        processed: 0,
        currentFile: 'Starting...',
        results: [],
        colorCounts: {},
        inputPath,
        outputPath: outputPath || null,
        maxImages: maxImages || null, // Daily quota limit from license
    };

    // Start processing (non-blocking), reusing the same pipeline as /upload
    processSession(sessionId).then(() => {
        // If outputPath specified, copy sorted output there after processing completes
        if (outputPath) {
            const sessionOutputDir = path.join(OUTPUT_DIR, sessionId);
            try {
                fs.cpSync(sessionOutputDir, outputPath, { recursive: true });
                console.log(`[${sessionId}] sort-local: output copied to ${outputPath}`);
            } catch (err) {
                console.error(`[${sessionId}] sort-local: failed to copy output to ${outputPath}:`, err.message);
            }
        }
    }).catch(err => {
        console.error(`[${sessionId}] Processing error:`, err);
        sessions[sessionId].status = 'error';
        sessions[sessionId].error = err.message;
    });

    res.json({
        session_id: sessionId,
        message: 'Processing started',
        total_images: sourceFiles.length
    });
});

// ─── Pause / Resume / Cancel endpoints ───
app.post('/pause/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'processing') {
        session.status = 'paused';
        console.log(`[${req.params.sessionId}] Paused at ${session.processed}/${session.total}`);
        return res.json({ success: true, status: 'paused' });
    }
    res.json({ success: false, status: session.status, message: 'Can only pause a processing session' });
});

app.post('/resume/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'paused') {
        session.status = 'processing';
        console.log(`[${req.params.sessionId}] Resumed at ${session.processed}/${session.total}`);
        return res.json({ success: true, status: 'processing' });
    }
    res.json({ success: false, status: session.status, message: 'Can only resume a paused session' });
});

app.post('/cancel/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'processing' || session.status === 'paused') {
        session.status = 'cancelled';
        console.log(`[${req.params.sessionId}] Cancelled at ${session.processed}/${session.total}`);
        return res.json({ success: true, status: 'cancelled' });
    }
    res.json({ success: false, status: session.status, message: 'Can only cancel an active session' });
});

// ─── Status endpoint (returns live progress + recent results) ───
app.get('/status/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Send last N results for live feed (only new ones the client hasn't seen)
    const since = parseInt(req.query.since) || 0;
    const newResults = session.results.slice(since);

    res.json({
        status: session.status,
        processed: session.processed,
        total: session.total,
        extracted: session.extracted || session.processed,
        current_file: session.currentFile,
        color_counts: session.colorCounts || {},
        new_results: newResults,
        results_offset: since,
        error: session.error || null
    });
});

// ─── Download endpoint — pre-build ZIP to disk, then serve ───
app.get('/download/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = sessions[sessionId];

    const outputDir = path.join(OUTPUT_DIR, sessionId);
    if (!fs.existsSync(outputDir)) {
        return res.status(400).json({ error: 'Session output not found' });
    }
    if (session && session.status !== 'completed' && session.status !== 'cancelled') {
        return res.status(400).json({ error: 'Session still processing' });
    }

    const zipFilename = `car_photos_${sessionId}.zip`;
    const zipPath = path.join(OUTPUT_DIR, zipFilename);

    try {
        // Build ZIP to disk first (if not already built)
        if (!fs.existsSync(zipPath)) {
            console.log(`[download] Building ZIP: ${zipFilename}`);
            await new Promise((resolve, reject) => {
                const output = fs.createWriteStream(zipPath);
                const archive = archiver('zip', { zlib: { level: 1 } });
                output.on('close', resolve);
                archive.on('error', reject);
                archive.pipe(output);
                archive.directory(outputDir, false);
                archive.finalize();
            });
            console.log(`[download] ZIP ready: ${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`);
        }

        // Serve the completed file
        const stat = fs.statSync(zipPath);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
        fs.createReadStream(zipPath).pipe(res);
    } catch (err) {
        console.error(`[download] Failed: ${err.message}`);
        // Clean up partial ZIP
        try { fs.unlinkSync(zipPath); } catch {}
        if (!res.headersSent) res.status(500).json({ error: 'Failed to create ZIP' });
    }
});

// ─── Browse a color folder's images ───
app.get('/browse/:sessionId/:folder', (req, res) => {
    const sessionId = path.basename(req.params.sessionId);
    const folder = path.basename(req.params.folder);

    const folderPath = path.join(OUTPUT_DIR, sessionId, folder);
    if (!fs.existsSync(folderPath)) {
        return res.json({ files: [], folder });
    }

    const files = fs.readdirSync(folderPath)
        .filter(f => /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(f))
        .map(f => ({
            name: f,
            url: `/output/${sessionId}/${folder}/${encodeURIComponent(f)}`,
            size: fs.statSync(path.join(folderPath, f)).size
        }));

    res.json({ files, folder, count: files.length });
});

// ─── List all color folders for a session ───
app.get('/folders/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;

    const outputDir = path.join(OUTPUT_DIR, sessionId);
    if (!fs.existsSync(outputDir)) return res.json({ folders: [] });

    const folders = fs.readdirSync(outputDir)
        .filter(f => fs.statSync(path.join(outputDir, f)).isDirectory())
        .map(f => {
            const files = fs.readdirSync(path.join(outputDir, f))
                .filter(fi => /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(fi));
            return { name: f, count: files.length };
        })
        .filter(f => f.count > 0)
        .sort((a, b) => b.count - a.count);

    res.json({ folders });
});

// ─── Move a file from one color folder to another ───
app.post('/reassign', (req, res) => {
    const { sessionId, filename, fromFolder, toFolder } = req.body;
    if (!sessionId || !filename || !fromFolder || !toFolder) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    // Sanitize all path components to prevent directory traversal
    const safeSession = path.basename(sessionId);
    const safeFilename = path.basename(filename);
    const safeFrom = path.basename(fromFolder);
    const safeTo = path.basename(toFolder);
    const srcPath = path.join(OUTPUT_DIR, safeSession, safeFrom, safeFilename);
    if (!fs.existsSync(srcPath)) {
        return res.status(404).json({ error: 'Source file not found' });
    }

    const destDir = path.join(OUTPUT_DIR, safeSession, safeTo);
    fs.mkdirSync(destDir, { recursive: true });

    // Handle duplicate names in destination
    let destName = safeFilename;
    let counter = 1;
    while (fs.existsSync(path.join(destDir, destName))) {
        const ext = path.extname(safeFilename);
        destName = `${path.basename(safeFilename, ext)}_${counter}${ext}`;
        counter++;
    }

    fs.renameSync(srcPath, path.join(destDir, destName));

    // Update in-memory session color counts if available
    const session = sessions[safeSession];
    if (session) {
        if (session.colorCounts[safeFrom]) {
            session.colorCounts[safeFrom]--;
            if (session.colorCounts[safeFrom] <= 0) delete session.colorCounts[safeFrom];
        }
        session.colorCounts[safeTo] = (session.colorCounts[safeTo] || 0) + 1;
    }

    // Clean up empty source folder
    const srcDir = path.join(OUTPUT_DIR, safeSession, safeFrom);
    const remaining = fs.readdirSync(srcDir).filter(f => /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(f));
    if (remaining.length === 0) {
        fs.rmSync(srcDir, { recursive: true, force: true });
    }

    console.log(`[${safeSession}] Reassigned: ${safeFilename} from ${safeFrom}/ → ${safeTo}/`);

    res.json({ success: true, filename: destName, from: safeFrom, to: safeTo });
});

// ─── Cleanup endpoint (delete session files) ───
app.delete('/cleanup/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const uploadDir = path.join(UPLOAD_DIR, sessionId);
    const outputDir = path.join(OUTPUT_DIR, sessionId);
    const thumbDir = path.join(THUMB_DIR, sessionId);

    let cleaned = 0;
    [uploadDir, outputDir, thumbDir].forEach(dir => {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            cleaned++;
        }
    });

    // Remove from in-memory sessions
    delete sessions[sessionId];

    console.log(`[${sessionId}] Cleanup: removed ${cleaned} directories`);
    res.json({ success: true, cleaned });
});

// ─── Health / diagnostics endpoint ───
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        engine: 'v8',
        ssdMobilenet: onnxSession ? 'loaded' : 'NOT loaded',
        segformer: segformerSession ? 'loaded' : 'NOT loaded (fallback to env filtering)',
        ssdModelPath: SSD_MODEL_PATH,
        ssdModelExists: fs.existsSync(SSD_MODEL_PATH),
        segModelPath: SEGFORMER_MODEL_PATH,
        segModelExists: fs.existsSync(SEGFORMER_MODEL_PATH),
        visionEngine: getActiveEngine(),
        apiKey: OPENROUTER_KEYS.length > 0 ? 'set' : (CLAUDE_API_KEY ? 'set' : 'not set'),
        batchSize: getVisionBatchSize(),
        pipeline: getActiveEngine() !== 'local'
            ? 'AI Vision Pro (PRIMARY) → local LAB (fallback)'
            : segformerSession
                ? 'SSD bbox → SegFormer pixel mask → pure vehicle pixels → Nyckel+LAB → merge'
                : 'SSD bbox → multi-region crop → env filter → Nyckel+LAB → merge',
        storageRoot: STORAGE_ROOT,
        storagePersistent: !!process.env.STORAGE_ROOT,
        uptime: Math.round(process.uptime()) + 's',
        nyckelConfigured: !!(NYCKEL_CLIENT_ID && NYCKEL_CLIENT_SECRET),
        activeSessions: Object.keys(sessions).length,
    });
});

// ─── Test OpenRouter connectivity ───
app.post('/test-openrouter', express.json(), async (req, res) => {
    const key = req.body?.key || getNextKey();
    if (!key) return res.json({ success: false, error: 'No API key provided' });
    try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`,
                'HTTP-Referer': 'https://autohue.app',
                'X-Title': 'AutoHue',
            },
            body: JSON.stringify({
                model: VISION_MODEL,
                max_tokens: 5,
                messages: [{ role: 'user', content: 'Say OK' }],
            }),
            signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) {
            const t = await r.text();
            return res.json({ success: false, error: `${r.status}: ${t.slice(0, 100)}` });
        }
        const d = await r.json();
        const reply = d.choices?.[0]?.message?.content || '';
        res.json({ success: true, reply });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ─── Serve output images for browsing ───
app.use('/output', express.static(OUTPUT_DIR));

// ─── Start server immediately, load AI model in background ───
app.listen(PORT, '127.0.0.1', () => {
    console.log(`Car Photo Color Sorter running at http://localhost:${PORT}`);
    loadModel().then(() => {
        console.log(`ONNX model: ${onnxSession ? 'loaded' : 'NOT loaded (fallback mode)'}`);
    });
});
