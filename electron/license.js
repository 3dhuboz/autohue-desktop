const crypto = require('crypto');
const os = require('os');

// License tier definitions
// Pricing: Trial=free, Starter=$29/mo, Pro=$79/mo, Business=$149/mo
// AI cost per image: ~$0.003 (Gemini 2.0 Flash via OpenRouter)
const TIERS = {
  TRL: { name: 'Trial', dailyLimit: 25, label: 'trial', price: 0 },
  STR: { name: 'Starter', dailyLimit: 150, label: 'starter', price: 29 },
  PRO: { name: 'Pro', dailyLimit: 500, label: 'pro', price: 79 },
  BIZ: { name: 'Business', dailyLimit: 2000, label: 'business', price: 149 },
  // Legacy tiers (backward compat)
  HOB: { name: 'Starter', dailyLimit: 150, label: 'starter', price: 29 },
  UNL: { name: 'Business', dailyLimit: 2000, label: 'business', price: 149 },
};

// Grace period: 7 days offline before requiring re-validation
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

// License validation API endpoint (configure for your domain)
const VALIDATION_API = process.env.LICENSE_API_URL || 'https://autohue-api.steve-700.workers.dev/api/license/validate';

class LicenseManager {
  constructor(db) {
    this.db = db;
    this.machineId = this._generateMachineId();
  }

  /** Generate a stable machine identifier from hardware info. */
  _generateMachineId() {
    // Get MAC address of primary network interface
    let mac = 'unknown';
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          mac = iface.mac;
          break;
        }
      }
      if (mac !== 'unknown') break;
    }

    const parts = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || 'unknown',
      mac,
      String(os.totalmem()),
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

    // Check cached subscription status — if cancelled, block immediately
    if (row.subscription_status === 'cancelled') {
      return {
        active: false,
        reason: 'subscription_cancelled',
        tier: row.tier,
        tierName: TIERS[row.tier.toUpperCase().slice(0, 3)]?.name || row.tier,
      };
    }

    // Check grace period (7 days offline tolerance)
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

    // Monthly heartbeat: block if last_validated is older than 30 days and subscription was active
    const MONTHLY_HEARTBEAT_MS = 30 * 24 * 60 * 60 * 1000;
    if (msSinceValidation > MONTHLY_HEARTBEAT_MS && row.subscription_status === 'active') {
      return {
        active: false,
        reason: 'heartbeat_overdue',
        tier: row.tier,
        tierName: TIERS[row.tier.toUpperCase().slice(0, 3)]?.name || row.tier,
        lastValidated: row.last_validated,
        daysOverdue: Math.floor(msSinceValidation / (24 * 60 * 60 * 1000)),
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

    const subscriptionStatus = validationResponse?.subscription_status || 'active';

    this.db.prepare(`
      INSERT OR REPLACE INTO license (id, license_key, tier, daily_limit, machine_id,
        activated_at, expires_at, last_validated, validation_response, subscription_status)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.key,
      parsed.tier,
      parsed.dailyLimit,
      this.machineId,
      now,
      expiresAt,
      now,
      validationResponse ? JSON.stringify(validationResponse) : null,
      subscriptionStatus,
    );

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
      // Try to update existing in_progress record first
      const existing = this.db.prepare('SELECT id FROM processing_history WHERE session_id = ?').get(sessionId);
      if (existing) {
        this.db.prepare(`
          UPDATE processing_history SET image_count = ?, color_counts = ?, status = 'completed', updated_at = datetime('now')
          WHERE session_id = ?
        `).run(imageCount, colorCounts ? JSON.stringify(colorCounts) : null, sessionId);
      } else {
        this.db.prepare(`
          INSERT INTO processing_history (session_id, image_count, color_counts, status)
          VALUES (?, ?, ?, 'completed')
        `).run(sessionId, imageCount, colorCounts ? JSON.stringify(colorCounts) : null);
      }
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
            UPDATE license SET last_validated = ?, validation_response = ?, subscription_status = ?, updated_at = ?
            WHERE id = 1
          `).run(new Date().toISOString(), JSON.stringify(data), data.subscription_status || 'active', new Date().toISOString());
          // Cache Claude API key for Pro/Unlimited tiers
          if (data.claudeApiKey) {
            this._cachedClaudeKey = data.claudeApiKey;
            console.log('[license] Claude Vision API key received (tier eligible)');
          }
          console.log('[license] Re-validated successfully');
          return true;
        } else if (data.error === 'Subscription cancelled') {
          // Server says subscription is cancelled — update local cache
          this.db.prepare(`
            UPDATE license SET subscription_status = 'cancelled', validation_response = ?, updated_at = ?
            WHERE id = 1
          `).run(JSON.stringify(data), new Date().toISOString());
          console.log('[license] Subscription cancelled on server');
          return false;
        }
      }
    } catch (err) {
      console.warn('[license] Re-validation failed (offline):', err.message);
    }
    return false;
  }

  /** Get the cached Claude API key (returned by server for Pro/Unlimited). */
  getClaudeApiKey() {
    if (this._cachedClaudeKey) return this._cachedClaudeKey;
    // Try reading from last validation response
    const row = this.db.prepare('SELECT validation_response FROM license WHERE id = 1').get();
    if (row && row.validation_response) {
      try {
        const data = JSON.parse(row.validation_response);
        if (data.claudeApiKey) {
          this._cachedClaudeKey = data.claudeApiKey;
          return this._cachedClaudeKey;
        }
      } catch {}
    }
    return null;
  }
}

module.exports = { LicenseManager, TIERS };
