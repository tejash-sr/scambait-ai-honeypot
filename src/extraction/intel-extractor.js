/**
 * KAVACH — Intelligence Extractor
 * Extracts UPI IDs, phone numbers, URLs, bank accounts, PAN, Aadhaar,
 * crypto addresses, names, and organizations from scammer messages.
 */

const PATTERNS = {
  upiIds: /[a-zA-Z0-9._-]+@(paytm|upi|oksbi|okhdfcbank|okaxis|okicici|ybl|ibl|ptyes|axl|kotak|apl|waicici|wahdfcbank|wasbi|waaxis|razorpay|freecharge|airtelpaymentsbank|postbank|pnb|barodampay|federal|rbl|sbi|hdfcbank|icici|axisb|citi|dbs|hsbc|idbi|idfcfirst|imobile|indus|iob|jio|jupiteraxis|kvb|mahb|scbl|slicepay|ubi|uboi|uco|united|yesbankltd|yesbank)/gi,
  phoneNumbers: /(\+91[\s.-]?)?[6-9]\d{9}/g,
  bankAccounts: /\b\d{9,18}\b/g,
  ifscCodes: /[A-Z]{4}0[A-Z0-9]{6}/g,
  phishingUrls: /https?:\/\/[^\s<>"{}|\\^`\[\]]{8,}|bit\.ly\/[^\s]+|tinyurl\.com\/[^\s]+|goo\.gl\/[^\s]+|cutt\.ly\/[^\s]+|rb\.gy\/[^\s]+/gi,
  panNumbers: /[A-Z]{5}[0-9]{4}[A-Z]/g,
  aadhaarNumbers: /\b\d{4}\s\d{4}\s\d{4}\b/g,
  cryptoAddresses: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b|0x[a-fA-F0-9]{40}/g,
  emailAddresses: /[\w.+-]+@[\w.-]+\.(com|in|net|org|co|io|edu|gov|info|biz|gmail|yahoo|hotmail|outlook|rediffmail)/gi,
};

// Organization extraction
const ORG_PATTERN = /(?:from|calling from|I am from|this is|we are|representing)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*(?:\s(?:Bank|Insurance|Department|Ministry|Office|Ltd|Limited|Pvt|Corp))?)/gi;

// Name extraction
const NAME_PATTERN = /(?:my name is|i am|this is|i'm|speaking|mr\.?|ms\.?|mrs\.?|shri|smt\.?)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/gi;

/**
 * Extract all intelligence from a text string.
 * @param {string} text - Text to analyze (scammer message + context)
 * @returns {Object} Extracted intelligence keyed by type
 */
function extractIntelligence(text) {
  if (!text || typeof text !== 'string') return {};

  const result = {};

  // Extract using regex patterns
  for (const [key, pattern] of Object.entries(PATTERNS)) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const matches = [...text.matchAll(regex)];
    if (matches.length > 0) {
      const unique = [...new Set(matches.map(m => m[0].trim()))];

      // Special validation for bank accounts - only include if there's banking context
      if (key === 'bankAccounts') {
        const bankContext = /account|bank|a\/c|transfer|deposit|saving|current|ifsc|neft|rtgs|imps/i;
        if (!bankContext.test(text)) continue;
        // Filter to valid Indian bank account lengths (11-18 digits)
        result[key] = unique.filter(a => a.length >= 11 && a.length <= 18);
        if (result[key].length === 0) delete result[key];
        continue;
      }

      // Special validation for email addresses - skip UPI-like patterns
      if (key === 'emailAddresses') {
        result[key] = unique.filter(e => 
          !/@(paytm|upi|oksbi|okhdfcbank|okaxis|okicici|ybl|ibl|ptyes|axl|kotak|phonepe|gpay)/i.test(e) &&
          !e.includes('example.com') && !e.includes('test')
        );
        if (result[key].length === 0) delete result[key];
        continue;
      }

      result[key] = unique;
    }
  }

  // Extract organizations
  const orgMatches = [...text.matchAll(ORG_PATTERN)];
  if (orgMatches.length > 0) {
    result.organizationsClaimed = [...new Set(orgMatches.map(m => m[1].trim()))];
  }

  // Extract names
  const nameMatches = [...text.matchAll(NAME_PATTERN)];
  if (nameMatches.length > 0) {
    result.namesFound = [...new Set(nameMatches.map(m => m[1].trim()))];
  }

  // Detect OTP requests
  if (/otp|one.time.password/i.test(text) && /share|tell|send|bata|bhej|enter|verify/i.test(text)) {
    result.otpRequests = true;
  }

  // Detect urgency tactics
  const urgencyTactics = [];
  if (/account.*(block|suspend|close|deactivat|freez)/i.test(text)) urgencyTactics.push('account suspension threat');
  if (/urgent|immediately|abhi|turant|jaldi/i.test(text)) urgencyTactics.push('urgency pressure');
  if (/arrest|legal|fir|police|court/i.test(text)) urgencyTactics.push('legal threat');
  if (/expire|last.*chance|final.*warning/i.test(text)) urgencyTactics.push('deadline pressure');
  if (/penalty|fine|charge/i.test(text)) urgencyTactics.push('financial penalty threat');
  if (urgencyTactics.length > 0) {
    result.urgencyTactics = urgencyTactics;
  }

  return result;
}

module.exports = { extractIntelligence, PATTERNS };
