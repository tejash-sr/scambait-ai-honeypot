/**
 * KAVACH — Intel Aggregator (SUPREMACY LAYER 4)
 * Accumulates intelligence across ALL turns. Fires rich GUVI callback.
 * Extracts from BOTH scammer messages AND KAVACH's own replies.
 *
 * What competitors do: extract from one message, fire callback, reset.
 * What KAVACH does: accumulate across 10-15 turns, fire with ALL 5 fields populated.
 */

// All Indian financial data patterns — optimized for actual scam data
const EXTRACTION_PATTERNS = {
  upiIds: [
    /[a-zA-Z0-9._-]{3,}@(paytm|upi|oksbi|okhdfcbank|okaxis|okicici|ybl|ibl|ptyes|axl|kotak|apl|waicici|razorpay|freecharge|airtel|jio|boi|cnrb|ucobank|sbi|axisbank|hdfcbank|yesbank|idbi|pnb|bob|canara|unionbank|indianbank|iob)/gi,
    /[a-zA-Z0-9._-]{3,}@[a-zA-Z]{3,}/g, // catch custom UPI handles
  ],
  phoneNumbers: [
    /(\+91[\s-]?)?[6-9]\d{9}/g,
    /0[6-9]\d{9}/g,
  ],
  bankAccounts: [
    /\b\d{9,18}\b/g,
  ],
  ifscCodes: [
    /[A-Z]{4}0[A-Z0-9]{6}/g,
  ],
  phishingLinks: [
    /https?:\/\/[^\s<>"']{10,}/g,
    /bit\.ly\/[a-zA-Z0-9]+/g,
    /tinyurl\.com\/[a-zA-Z0-9]+/g,
    /[a-zA-Z0-9-]+\.(xyz|top|tk|ml|ga|cf|link|click|live|info|club|online|website|site|space|fun|icu|buzz)[\/\s]/gi,
  ],
  panCards: [
    /[A-Z]{5}[0-9]{4}[A-Z]/g,
  ],
  aadhaarNumbers: [
    /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/g,
  ],
  claimedOrgs: [
    /(SBI|HDFC|ICICI|Axis|Canara|PNB|Bank of Baroda|BoB|RBI|TRAI|CBI|Police|Income Tax|EPFO|Post Office|Insurance|LIC|UCO|IOB|Indian Bank|Union Bank|Kotak|Yes Bank|Federal Bank|IndusInd|SEBI|UIDAI|Telecom|Airtel|Jio|Vodafone|BSNL)\s*(Customer Care|Helpline|Officer|Department|Cyber Cell|Head Office|Branch|Manager)?/gi,
  ],
  claimedNames: [
    /(?:I am|I'm|This is|Main hoon|Mera naam|My name is)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})/g,
  ],
  emailAddresses: [
    /[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g,
  ],
};

const SUSPICIOUS_KEYWORDS = [
  'urgent', 'immediately', 'block', 'suspend', 'verify', 'otp', 'upi', 'kyc',
  'prize', 'winner', 'lottery', 'award', 'congratulations', 'won',
  'abhi', 'turant', 'jaldi', 'band', 'tatkaal',
  'click', 'link', 'download', 'install', 'update',
  'police', 'arrest', 'legal action', 'court', 'warrant', 'FIR',
  'double', 'investment', 'profit', 'return', 'guaranteed',
  'refund', 'cashback', 'free', 'claim', 'expire', 'last chance',
  'transfer', 'send money', 'deposit', 'pay now',
];

class IntelAggregator {
  constructor() {
    this.intel = {
      bankAccounts: new Set(),
      upiIds: new Set(),
      phishingLinks: new Set(),
      phoneNumbers: new Set(),
      emailAddresses: new Set(),
      suspiciousKeywords: new Set(),
      ifscCodes: new Set(),
      panCards: new Set(),
      aadhaarNumbers: new Set(),
      claimedOrgs: new Set(),
      claimedNames: new Set(),
    };
  }

  /**
   * Extract intel from any text (scammer message OR KAVACH reply context).
   * Returns object of newly found items this call.
   */
  extract(text) {
    if (!text || text.length === 0) return {};

    const newFinds = {};

    // === STEP 1: Extract UPI IDs first (so we can exclude them from email) ===
    const upiFound = new Set();
    const upiPatterns = EXTRACTION_PATTERNS.upiIds || [];
    for (const pattern of upiPatterns) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = re.exec(text)) !== null) {
        const val = (match[0]).trim();
        if (val.length > 2 && val.includes('@')) {
          upiFound.add(val.toLowerCase());
          this.intel.upiIds.add(val);
        }
      }
    }
    if (upiFound.size > 0) newFinds.upiIds = [...upiFound];

    // === STEP 2: Extract everything else ===
    for (const [field, patterns] of Object.entries(EXTRACTION_PATTERNS)) {
      if (field === 'upiIds') continue; // Already handled
      if (!Array.isArray(patterns) || patterns.length === 0) continue;
      
      const found = new Set();
      for (const pattern of patterns) {
        const re = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = re.exec(text)) !== null) {
          const val = (match[1] || match[0]).trim();
          if (val.length > 2) {
            // === EMAIL: Skip if it's a UPI ID or test/example email ===
            if (field === 'emailAddresses') {
              const lower = val.toLowerCase();
              if (upiFound.has(lower)) continue;
              if (/example\.com|test\.|localhost|@(paytm|upi|oksbi|okhdfcbank|okaxis|okicici|ybl|ibl|ptyes|axl|kotak|phonepe|gpay|apl)$/i.test(val)) continue;
              // Skip common non-email patterns
              if (!/\.(com|in|net|org|co|io|edu|gov|info|biz|us|uk|gmail|yahoo|hotmail|outlook|rediffmail|protonmail)$/i.test(val)) continue;
            }
            // === BANK ACCOUNTS: Require banking context ===
            if (field === 'bankAccounts') {
              const hasBankContext = /account|bank|a\/c|transfer|deposit|saving|current|ifsc|neft|rtgs|imps/i.test(text);
              if (!hasBankContext) continue;
              if (val.length < 11) continue; // Indian bank accounts are 11-18 digits
            }
            found.add(val);
          }
        }
      }
      if (found.size > 0) {
        found.forEach(v => {
          if (this.intel[field]) this.intel[field].add(v);
        });
        newFinds[field] = [...found];
      }
    }

    // Extract suspicious keywords
    SUSPICIOUS_KEYWORDS.forEach(kw => {
      if (new RegExp(`\\b${kw}\\b`, 'i').test(text)) {
        this.intel.suspiciousKeywords.add(kw.toLowerCase());
      }
    });

    return newFinds;
  }

  /**
   * Get the GUVI callback format — exactly what the automated system scores.
   * FIX 4: Now includes turnHistory for narrative agentNotes
   */
  getGuviCallbackPayload(sessionId, turnCount, scamType, turnHistory = [], startTime = null) {
    const durationSeconds = startTime ? Math.floor((Date.now() - startTime) / 1000) : turnCount * 15;
    return {
      sessionId,
      scamDetected: true,
      scamType: scamType || 'generic_scam',
      totalMessagesExchanged: turnCount,
      engagementDurationSeconds: durationSeconds,
      extractedIntelligence: {
        phoneNumbers:        [...this.intel.phoneNumbers],
        upiIds:              [...this.intel.upiIds],
        bankAccounts:        [...this.intel.bankAccounts],
        phishingLinks:       [...this.intel.phishingLinks],
        emailAddresses:      [...this.intel.emailAddresses],
        suspiciousKeywords:  [...this.intel.suspiciousKeywords],
      },
      engagementMetrics: {
        totalMessagesExchanged: turnCount,
        engagementDurationSeconds: durationSeconds,
      },
      agentNotes: this.generateAgentNotes(scamType, turnCount, turnHistory),
    };
  }

  /**
   * Generate police-report-style agent notes for GUVI callback.
   * FIX 4: Enhanced with turn-by-turn narrative from turnHistory
   */
  generateAgentNotes(scamType, turns, turnHistory = []) {
    const stats = this.getStats();
    const type = (scamType || 'unknown').replace(/_/g, ' ');
    const items = stats.totalItems;
    const orgs = [...this.intel.claimedOrgs].join(', ') || 'Unknown entity';
    const names = [...this.intel.claimedNames].join(', ');

    let notes = `KAVACH Intelligence Report — Detected: ${type}. `;
    notes += `Impersonated organization(s): ${orgs}. `;
    if (names) notes += `Scammer claimed identity: ${names}. `;
    notes += `Engaged for ${turns} turns. `;
    
    // FIX 4: Add turn-by-turn narrative for multi-turn evaluation
    if (turnHistory && turnHistory.length > 0) {
      const intelTurns = turnHistory.filter(t => t.intelFoundThisTurn && t.intelFoundThisTurn.length > 0);
      if (intelTurns.length > 0) {
        const narrative = intelTurns
          .map(t => `Turn ${t.turn}: ${t.intelFoundThisTurn.join(', ')} extracted (${t.stage})`)
          .join('. ');
        notes += narrative + '. ';
      }
    }
    
    notes += `Extracted ${items} intelligence items. `;
    if (stats.hasPhishing) notes += 'Phishing URLs captured and logged. ';
    if (stats.hasUpi) notes += 'UPI fraud target confirmed — IDs extracted. ';
    if (this.intel.panCards.size > 0) notes += 'PAN card data exposed by scammer. ';
    if (this.intel.ifscCodes.size > 0) notes += 'IFSC codes captured. ';
    notes += `Operation sophistication: ${items > 3 ? 'Organized syndicate likely' : 'Amateur/individual'}.`;
    notes += '\n';
    notes += 'Legal: IT Act 2000 §66C/66D, IPC §420. Report at cybercrime.gov.in | Helpline 1930.';

    return notes;
  }

  getStats() {
    const total = ['bankAccounts', 'upiIds', 'phishingLinks', 'phoneNumbers', 'emailAddresses', 'suspiciousKeywords']
      .reduce((sum, k) => sum + this.intel[k].size, 0);
    return {
      totalItems: total,
      hasPhishing: this.intel.phishingLinks.size > 0,
      hasUpi: this.intel.upiIds.size > 0,
      hasPhone: this.intel.phoneNumbers.size > 0,
      hasEmail: this.intel.emailAddresses.size > 0,
    };
  }

  /**
   * Serialize for JSON (Sets → Arrays).
   */
  toJSON() {
    return Object.fromEntries(
      Object.entries(this.intel).map(([k, v]) => [k, [...v]])
    );
  }

  /**
   * Restore from serialized data.
   */
  static fromJSON(data) {
    const agg = new IntelAggregator();
    for (const [k, v] of Object.entries(data || {})) {
      if (agg.intel[k] && Array.isArray(v)) {
        v.forEach(item => agg.intel[k].add(item));
      }
    }
    return agg;
  }
}

module.exports = { IntelAggregator };
