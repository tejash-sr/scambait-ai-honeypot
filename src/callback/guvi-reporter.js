/**
 * KAVACH — GUVI Callback Reporter (NATIONAL SPOTLIGHT LAYER 6)
 * Fires to GUVI automated evaluation endpoint with accumulated intel.
 *
 * Rules:
 * 1. Only fires when intel is meaningful (min 2 items OR turn >= 5)
 * 2. Fires again at session end with FULL accumulated intel
 * 3. agentNotes reads like a police report with turn-by-turn narrative (FIX 4)
 * 4. NEVER blocks the main response — non-blocking fire-and-forget
 */

const GUVI_CALLBACK_URL = 'https://hackathon.guvi.in/api/updateHoneyPotFinalResult';

/**
 * Fire GUVI callback with accumulated intelligence.
 * Non-blocking — failures never affect the main response.
 *
 * @param {string} sessionId - Session identifier
 * @param {IntelAggregator} intelAggregator - Accumulated intelligence
 * @param {number} turnCount - Current turn number
 * @param {string} scamType - Classified scam type
 * @param {Array} turnHistory - FIX 4: Detailed turn history for narrative agentNotes
 * @param {number} startTime - Session start time in ms
 */
async function fireGuviCallback(sessionId, intelAggregator, turnCount, scamType, turnHistory = [], startTime = null) {
  const payload = intelAggregator.getGuviCallbackPayload(sessionId, turnCount, scamType, turnHistory, startTime);

  // Ensure emailAddresses is always present
  if (!payload.extractedIntelligence.emailAddresses) {
    payload.extractedIntelligence.emailAddresses = [];
  }

  // Only fire if we have something meaningful
  const hasIntel = payload.extractedIntelligence.upiIds.length > 0
    || payload.extractedIntelligence.phoneNumbers.length > 0
    || payload.extractedIntelligence.phishingLinks.length > 0
    || payload.extractedIntelligence.bankAccounts.length > 0
    || payload.extractedIntelligence.emailAddresses.length > 0;

  if (!hasIntel && turnCount < 5) return; // Don't fire empty callbacks early

  try {
    // Use native fetch (Node 18+)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    await fetch(GUVI_CALLBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
  } catch (e) {
    // Non-blocking — callback failure NEVER breaks the main response
    console.error('GUVI callback failed (non-critical):', e.message);
  }
}

module.exports = { fireGuviCallback };
