# ScamBait — an AI honeypot that turns scam calls into evidence

> ScamBait pretends to be the victim. It keeps the scammer talking in their own language, and quietly collects the UPI IDs, phone numbers, bank accounts and phishing links they reveal, ready for a police complaint.

**Built solo** for the **HCL GUVI India AI Impact Buildathon 2026** (Bharat Mandapam, New Delhi), submitted as **KAVACH** (Hindi for "shield"), the name still used inside the code · Node.js on Vercel · **146 automated tests, all passing, no API keys needed to run them**

---

## The problem

- **Indians lost ₹22,845 crore to cyber fraud in 2024**, across more than 36 lakh reported incidents, roughly three times the year before ([Government of India, Lok Sabha reply, July 2025](https://inc42.com/buzz/indians-lost-inr-22845-cr-to-cyber-fraud-in-2024-govt)).
- Speed of reporting matters: the government's fraud-reporting system saved over ₹5,489 crore in 2024 by acting on details victims reported. But victims usually report *after* the money is gone, from memory.
- Blocking a scam message protects one person once. It tells the police nothing about who is behind it.

**ScamBait flips this around:** instead of ending the conversation, it keeps the scammer engaged and makes them hand over the identifiers that banks and police can act on.

## What it does

A scam message comes in. ScamBait:

1. **Detects the language and script** (10 Indian languages plus English, including Hinglish) in milliseconds with Unicode rules, with no AI call.
2. **Classifies the scam** into 9 types (bank, KYC, UPI, OTP, lottery, job, phishing, investment, crypto), plus the pressure tactics being used (urgency, authority).
3. **Picks a believable persona** suited to that scam, for example *Savitri Devi, 67, from Bhopal* for bank and OTP fraud, and replies as her: confused, cooperative, slow.
4. **Stalls on purpose** over 10–15 turns, asking the questions that make scammers reveal where the money should go.
5. **Extracts and accumulates intelligence** across the whole conversation: UPI IDs, phone numbers, bank accounts and IFSC codes, phishing links, email addresses and PAN numbers.
6. **Builds a SHIELD case report** for every conversation (case ID, timestamped transcript and extracted identifiers), with guidance for filing at cybercrime.gov.in or the 1930 helpline.

```
Scammer:  "Aapka SBI account aaj band ho jayega. OTP abhi share karo."
ScamBait: "Arrey, kaun bol raha hai? Mera SBI ka account toh theek tha kal... kya hua exactly?"
```

## Why it matters

- **It wastes the scammer's time.** Every minute spent on ScamBait is a minute not spent on a real victim.
- **It turns an attempt into evidence.** Payment identifiers are what's needed to trace and freeze the accounts that receive stolen money.
- **It is built for India.** It answers in the scammer's own language and script, with Indian personas, where English-only tools fail.

## Key design decisions

| Decision | Why |
|---|---|
| **The endpoint never fails.** Groq (Llama 3.3 70B) first, then a 3-model Gemini Flash cascade, then Claude Haiku (optional), then a pool of **601 hand-written persona replies** | A honeypot that errors out mid-conversation tips off the scammer. If every AI provider is down or out of quota, the conversation still continues. |
| **Rules first, AI second.** Language detection and scam classification are deterministic (no model call) | Fast replies, no quota spent on the easy parts, and the same input always gives the same result. |
| **The AI never decides what counts as evidence.** Extraction is deterministic, with validation | See *How I used AI* below. Evidence that may reach the police has to be checkable. |
| **Every reply is checked before it is sent.** A response guard blocks "as an AI…" giveaways, character breaks and over-long replies | One robotic sentence ends the conversation. |
| **Each persona stays in character.** An identity-lock prompt fixes their age, city, bank and way of speaking | A persona that drifts over 15 turns sounds fake. |

## How I used AI, and where it was wrong

I built ScamBait alone, using **ChatGPT** as a pair programmer for research, design options and first drafts of code. I made the design decisions, tested every part and integrated it.

**Where it was wrong:** during intelligence extraction, the AI was good at spotting that a conversation was a scam, but its reading of the *details* wasn't reliable. Pulling a number out of a message doesn't make it a bank account. I caught this by comparing the extracted entities against the original scammer messages and the formats they should have. The fix is now in [`src/extraction/intel-extractor.js`](src/extraction/intel-extractor.js):

- A number is accepted as a bank account **only if the message has banking context** (account, IFSC, NEFT, RTGS, IMPS…) **and it is 11–18 digits long**.
- UPI IDs are matched against known bank handle suffixes, and email addresses that are really UPI IDs are filtered out.
- Tests cover UPI IDs, phone numbers, phishing URLs, PAN numbers and accumulation across turns.

**The lesson:** an AI's output is never ground truth, especially in security. AI drafts; deterministic checks decide.

## Run it

```bash
npm install
npm test                 # 146 tests, runs offline, no API keys needed
cp .env.example .env     # add a free GROQ_API_KEY (Gemini and Claude keys are optional)
npm start                # local server via vercel dev
```

```bash
curl -X POST http://localhost:3000/api/honeypot \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"sessionId":"session-1","message":{"sender":"scammer","text":"Aapka SBI account block hoga. OTP batao.","timestamp":1},"conversationHistory":[]}'
```

<details>
<summary>Example response</summary>

```json
{
  "status": "success",
  "sessionId": "session-1",
  "reply": "Arrey, kaun bol raha hai? Mera SBI ka account toh theek tha...",
  "kavach": {
    "scam": { "detected": true, "type": "bank_fraud", "confidence": 0.92, "tactics": ["urgency", "authority"] },
    "agent": { "persona": "Savitri Devi, 67, Bhopal", "emotion": "MEDIUM", "stage": "GREETING", "turn": 1, "responseTier": 1 },
    "language": { "detected": "hinglish", "mirrored": "hinglish" },
    "intel": { "phoneNumbers": [], "upiIds": [], "phishingLinks": [] },
    "shield": { "caseId": "KAVACH-2026-ION-1" }
  }
}
```
</details>

| Endpoint | Purpose |
|---|---|
| `POST /api/honeypot` | Send a scammer message, get the persona's reply and the extracted intelligence |
| `GET /api/shield-report?caseId=…` | SHIELD case report for one conversation |
| `GET /api/metrics` | Totals across sessions |
| `GET /api/health` | Health check |

## Personas

| Persona | Age | City | Language | Used for |
|---|---|---|---|---|
| Savitri Devi | 67 | Bhopal | Hindi / Hinglish | Bank, KYC and OTP fraud |
| Lakshmi Venkat | 48 | Coimbatore | Tamil | UPI and lottery scams |
| Ravi Kumar | 23 | Hyderabad | Hinglish / Telugu | Job scams |
| Suresh Patel | 52 | Surat | Gujarati | Crypto and investment fraud |
| Subhash Ghosh | 70 | Kolkata | Bengali | Bank and KYC fraud |
| Anjali Mehta | 35 | Mumbai | English | Phishing |

**Languages:** Hindi, Marathi, Bengali, Gujarati, Punjabi, Kannada, Malayalam, Odia, Tamil, Telugu, English, plus Hinglish (Hindi written in Latin script).

## How it works

```
scammer message
   │
   ├─ language + script detection      (Unicode rules)
   ├─ scam type + tactics              (9-type classifier)
   ├─ persona selection                (6 personas)
   ├─ prompt: identity lock + stalling stage
   │
   ├─ reply chain: Groq → Gemini ×3 → Claude (optional) → 601 hand-written replies
   ├─ response guard                   (AI giveaways, character breaks, length)
   │
   ├─ intelligence extraction + accumulation across turns
   └─ SHIELD case report  +  buildathon scoring callback
```

## Tests

`npm test` runs **146 tests in 28 groups**: language detection, scam classification, persona selection, intelligence extraction (including stress tests), the response guard, session storage, SHIELD reports, cross-language and end-to-end pipelines, the fallback chain, anti-repetition, error recovery and callback format.

## Project layout

```
api/
  honeypot.js            main endpoint: the full pipeline
  shield-report.js       case reports
  metrics.js, health.js
src/
  language/              script detection, mirroring, persona filler words
  detection/             scam classifier
  persona/               the 6 personas
  agent/                 identity-lock prompt, stalling stages, AI reply chain
  fallback/              601 hand-written replies
  validation/            response guard
  extraction/            deterministic intelligence extraction
  intelligence/          accumulation across turns
  evidence/              SHIELD case reports
  callback/              buildathon scoring callback
tests/kavach-tests.js    146 tests
```

**Stack:** Node.js 18+ · Vercel serverless functions · Groq (Llama 3.3 70B) · Google Gemini Flash · Anthropic Claude (optional)

## Legal context

Scams like these fall under the IT Act 2000 (Sections 66C and 66D) and cheating under Section 318 of the Bharatiya Nyaya Sanhita (formerly IPC Section 420). Report at **cybercrime.gov.in** or call the National Cyber Crime Helpline **1930**.
