const crypto = require('crypto');
const os = require('os');

// License tier definitions
const TIERS = {
  TRL: { name: 'Trial', dailyLimit: 50, label: 'trial' },
  HOB: { name: 'Hobbyist', dailyLimit: 500, label: 'hobbyist' },
  PRO: { name: 'Pro', dailyLimit: 5000, label: 'pro' },
  UNL: { name: 'Unlimited', dailyLimit: -1, label: 'unlimited' },
};

// Grace period: 7 days offline before requiring re-validation
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

// License validation API endpoint (configure for your domain)
const VALIDATION_API = process.env.LICENSE_API_URL || 'https://autohue.app/api/license/validate';

class LicenseManager {
  constructor(db) {
    this.db = db;
    this.machineId = this._generateMachineId();
  }

  /** Generate a stable machine identifier from hardware info. */
  _generateMachineId() {
    const parts = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || 'unknown',
    ];
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  }

  /** Parse a license key to extract tier prefix. */
  _parseKey(key) {
    // Format: AH-{TIER}-{16 chars}-{4 char check}
    const cleaned = key.trim().toUpperCase().replace(/\s+/g, '');
    const match = cleaned.match(/^AH-(TRL|HOB|PRO|UNL)-([A-Z0-9]{4,})-([A-Z0-9]{4})$/);
    if (!match) return null;

    const tierCode = match[1];
    const tier = TIERS[tierCode];
    if (!tier) return null;

    return {
      key: cleaned,
      tierCode,
      tier: tier.label,
      dailyLimit: tier.dailyLimit,
      tierName: tier.name,
    };
  }

  /** Get current license state. */
  getCurrent() {
    const row = this.db.prepare('SELECT * FROM license WHERE id = 1').get();
    if (!row) {
      return { active: false, reason: 'no_license' };
    }

    // Check trial expiry
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return {
        active: false,
        reason: 'expired',
        tier: row.tier,
        tierName: TIERS[row.tier.toUpperCase().slice(0, 3)]?.name || row.tier,
        expiredAt: row.expires_at,
      };
    }

    // Check grace period
    const lastValidated = new Date(row.last_validated);
    const msSinceValidation = Date.now() - lastValidated.getTime();
    const offlineMode = msSinceValidation > 0; // if any time has passed since last check
    const graceExpired = msSinceValidation > GRACE_PERIOD_MS;

    if (graceExpired) {
      return {
        active: false,
        reason: 'grace_expired',
        tier: row.tier,
        tierName: TIERS[row.tier.toUpperCase().slice(0, 3)]?.name || row.tier,
        lastValidated: row.last_validated,
        daysOverdue: Math.floor(msSinceValidation / (24 * 60 * 60 * 1000)) - 7,
      };
    }

    // Get today's usage
    const todayUsage = this._getTodayUsage();
    const tierDef = Object.values(TIERS).find(t => t.label === row.tier);
    const dailyLimit = tierDef ? tierDef.dailyLimit : row.daily_limit;
    const isUnlimited = dailyLimit === -1;

    return {
      active: true,
      tier: row.tier,
      tierName: tierDef?.name || row.tier,
      dailyLimit,
      isUnlimited,
      todayUsage,
      remaining: isUnlimited ? -1 : Math.max(0, dailyLimit - todayUsage),
      offlineMode: msSinceValidation > 60000, // offline if >1 minute since last validation
      graceDaysLeft: Math.max(0, 7 - Math.floor(msSinceValidation / (24 * 60 * 60 * 1000))),
      licenseKey: row.license_key.slice(0, 12) + '...', // masked
      activatedAt: row.activated_at,
      expiresAt: row.expires_at,
    };
  }

  /** Activate a new license key. */
  async activate(key) {
    const parsed = this._parseKey(key);
    if (!parsed) {
      return { success: false, error: 'Invalid license key format. Expected: AH-XXX-XXXX...-XXXX' };
    }

    // Try online validation
    let validationResponse = null;
    try {
      const res = await fetch(VALIDATION_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: parsed.key,
          machineId: this.machineId,
          appVersion: require('../package.json').version,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        validationResponse = await res.json();
        if (!validationResponse.valid) {
          return { success: false, error: validationResponse.error || 'License key is not valid' };
        }
      }
    } catch (err) {
      // Network error — allow offline activation for non-trial keys
      if (parsed.tierCode === 'TRL') {
        return { success: false, error: 'Internet connection required to activate a trial license' };
      }
      console.warn('[license] Offline activation — skipping online validation');
    }

    // Store license
    const now = new Date().toISOString();
    const expiresAt = parsed.tierCode === 'TRL'
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 day trial
      : (validationResponse?.expiresAt || null);

    this.db.prepare(`
      INSERT OR REPLACE INTO license (id, license_key, tier, daily_limit, machine_id,
        activated_at, expires_at, last_validated, validation_response)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.key,
      parsed.tier,
      parsed.dailyLimit,
      this.machineId,
      now,
      expiresAt,
      now,
      validationResponse ? JSON.stringify(validationResponse) : null,
    );

    // Store embedded Claude API key if provided by server
    if (validationResponse?.claudeApiKey) {
      this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('claude_api_key_embedded', validationResponse.claudeApiKey);
      console.log('[license] Claude Vision API key received from server');
    }

    console.log(`[license] Activated: ${parsed.tierName} (${parsed.key.slice(0, 12)}...)`);

    return {
      success: true,
      tier: parsed.tier,
      tierName: parsed.tierName,
      dailyLimit: parsed.dailyLimit,
      expiresAt,
    };
  }

  /** Check if user can process N images (daily limit). */
  canProcess(count) {
    const license = this.getCurrent();
    if (!license.active) {
      return { allowed: false, reason: license.reason, ...license };
    }

    if (license.isUnlimited) {
      return { allowed: true, remaining: -1 };
    }

    const remaining = license.remaining;
    if (count > remaining) {
      return {
        allowed: false,
        reason: 'daily_limit',
        remaining,
        dailyLimit: license.dailyLimit,
        todayUsage: license.todayUsage,
      };
    }

    return { allowed: true, remaining: remaining - count };
  }

  /** Record processed images in history. */
  recordUsage(sessionId, imageCount, colorCounts) {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO processing_history (session_id, image_count, color_counts, status)
        VALUES (?, ?, ?, 'completed')
      `).run(sessionId, imageCount, colorCounts ? JSON.stringify(colorCounts) : null);

      return { success: true };
    } catch (err) {
      console.error('[license] Failed to record usage:', err.message);
      return { success: false, error: err.message };
    }
  }

  /** Get today's total processed images. */
  _getTodayUsage() {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(image_count), 0) as total
      FROM processing_history
      WHERE date(created_at) = date('now')
    `).get();
    return row.total;
  }

  /** Try to re-validate the license online (called at startup). */
  async tryRevalidate() {
    const row = this.db.prepare('SELECT * FROM license WHERE id = 1').get();
    if (!row) return false;

    try {
      const res = await fetch(VALIDATION_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: row.license_key,
          machineId: this.machineId,
          appVersion: require('../package.json').version,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.valid) {
          this.db.prepare(`
            UPDATE license SET last_validated = ?, validation_response = ?, updated_at = ?
            WHERE id = 1
          `).run(new Date().toISOString(), JSON.stringify(data), new Date().toISOString());

          // Store embedded Claude API key from server (Pro/Unlimited tiers)
          if (data.claudeApiKey) {
            this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('claude_api_key_embedded', data.claudeApiKey);
            console.log('[license] Claude Vision API key received from server');
          }

          console.log('[license] Re-validated successfully');
          return true;
        }
      }
    } catch (err) {
      console.warn('[license] Re-validation failed (offline):', err.message);
    }
    return false;
  }

  /** Get the effective Claude API key (user custom > embedded > null). */
  getClaudeApiKey() {
    const custom = this.db.prepare("SELECT value FROM settings WHERE key = 'claude_api_key_custom'").get();
    if (custom?.value) return custom.value;
    const embedded = this.db.prepare("SELECT value FROM settings WHERE key = 'claude_api_key_embedded'").get();
    return embedded?.value || null;
  }

  /** Set a user-provided Claude API key. Pass empty string to clear. */
  setClaudeApiKey(key) {
    if (key) {
      this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('claude_api_key_custom', key);
    } else {
      this.db.prepare("DELETE FROM settings WHERE key = 'claude_api_key_custom'").run();
    }
  }
}

module.exports = { LicenseManager, TIERS };
