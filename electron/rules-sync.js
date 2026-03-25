/**
 * Rules Sync: Periodically checks the cloud API for updated learned rules.
 *
 * Flow:
 *   1. On app startup + every 6 hours, GET /api/rules/latest from autohue.app
 *   2. Compare version hash with local — if different, download new rules
 *   3. Push to the local worker via POST /api/learned-rules
 *   4. Worker immediately uses updated parameters for all future sorts
 *
 * This means you (the dev) can:
 *   - Run Accuracy Lab → train → Apply to Worker → commit learned-rules.json
 *   - Deploy to Cloudflare (the API serves the latest rules)
 *   - Every client picks them up within 6 hours — no app update needed
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const RULES_API = process.env.RULES_API_URL || 'https://autohue-rules.steve-700.workers.dev/api/rules/latest';
const SYNC_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const WORKER_URL = 'http://localhost';

class RulesSync {
  constructor(storagePath, workerPort = 3001) {
    this.storagePath = storagePath;
    this.workerPort = workerPort;
    this.localRulesPath = path.join(storagePath, 'learned-rules.json');
    this.localHashPath = path.join(storagePath, 'rules-hash.txt');
    this.timer = null;

    // Ensure storage dir exists
    fs.mkdirSync(storagePath, { recursive: true });
  }

  /** Start periodic sync — checks immediately then every 6 hours */
  start() {
    console.log('[rules-sync] Starting periodic rule sync (every 6h)');
    // Delay first check by 10 seconds to let worker start
    setTimeout(() => this.check(), 10000);
    this.timer = setInterval(() => this.check(), SYNC_INTERVAL);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Check cloud for updated rules */
  async check() {
    try {
      console.log('[rules-sync] Checking for rule updates...');
      const cloudRules = await this._fetchCloudRules();

      if (!cloudRules || !cloudRules.rules) {
        console.log('[rules-sync] No rules available from cloud');
        return;
      }

      // Compare hash
      const cloudHash = cloudRules.hash || this._hash(JSON.stringify(cloudRules.rules));
      const localHash = this._getLocalHash();

      if (cloudHash === localHash) {
        console.log('[rules-sync] Rules are up to date');
        return;
      }

      // New rules available — save locally
      console.log(`[rules-sync] New rules detected (${Object.keys(cloudRules.rules).length} parameters)`);
      fs.writeFileSync(this.localRulesPath, JSON.stringify(cloudRules.rules, null, 2));
      fs.writeFileSync(this.localHashPath, cloudHash);

      // Push to local worker
      await this._pushToWorker(cloudRules.rules);
      console.log('[rules-sync] Rules updated successfully');
    } catch (err) {
      console.warn('[rules-sync] Sync failed (will retry):', err.message);
    }
  }

  /** Fetch rules from cloud API */
  _fetchCloudRules() {
    return new Promise((resolve, reject) => {
      const req = https.get(RULES_API, { timeout: 10000 }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

  /** Push rules to local worker */
  async _pushToWorker(rules) {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const body = JSON.stringify(rules);
      const req = http.request({
        hostname: 'localhost',
        port: this.workerPort,
        path: '/api/learned-rules',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.ok) {
              console.log(`[rules-sync] Pushed ${result.saved} rules to worker`);
              resolve(result);
            } else {
              reject(new Error(result.error || 'Unknown'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', (e) => {
        console.warn('[rules-sync] Worker not reachable:', e.message);
        resolve(null); // Don't fail — worker may not be ready yet
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.write(body);
      req.end();
    });
  }

  /** Simple string hash */
  _hash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  _getLocalHash() {
    try { return fs.readFileSync(this.localHashPath, 'utf8').trim(); }
    catch { return ''; }
  }
}

module.exports = { RulesSync };
