/**
 * KAVACH — Multi-LLM Response Chain (NATIONAL SPOTLIGHT GRADE)
 * ═══════════════════════════════════════════════════════════════════
 * PRIMARY: Groq (llama-3.3-70b) — 200ms latency, 30 RPM free
 * SECONDARY: Gemini Flash — 15 RPM, 1M TPD free (3-model cascade)
 * TERTIARY: Claude Haiku — Paid fallback (ultra-reliable)
 * ULTIMATE: Human Pool — 120+ contextual responses (NEVER fails)
 * ═══════════════════════════════════════════════════════════════════
 * THE ENDPOINT NEVER DIES. EVEN IF ALL 4 LLMs FAIL.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSmartFallback } = require('../fallback/human-pool');

// ══════════════════════════════════════════════════════════════════
// ENV VAR LOADING — Support both process.env and dotenv
// ══════════════════════════════════════════════════════════════════
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }

// Initialize LLM clients
const genAI = process.env.GEMINI_API_KEY 
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) 
  : null;

// ══════════════════════════════════════════════════════════════════
// LLM CONFIGURATION
// ══════════════════════════════════════════════════════════════════

// Groq (PRIMARY) — Fastest, free tier
const GROQ_CONFIG = {
  apiKey: process.env.GROQ_API_KEY,
  model: 'llama-3.3-70b-versatile',
  baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
};

// Gemini cascade (SECONDARY)
const GEMINI_MODELS = [
  'gemini-2.0-flash-lite',      // Fast, efficient
  'gemini-1.5-flash',           // Stable fallback  
  'gemini-1.5-flash-8b',        // Lower quota usage
];

// Claude (TERTIARY) — Ultra-reliable paid
const CLAUDE_CONFIG = {
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-haiku-20241022',
  baseUrl: 'https://api.anthropic.com/v1/messages',
};

// ══════════════════════════════════════════════════════════════════
// STARTUP DIAGNOSTICS — Log which providers are configured
// ══════════════════════════════════════════════════════════════════
console.log('[KAVACH] ═══ LLM Provider Status ═══');
console.log(`[KAVACH] GROQ:    ${GROQ_CONFIG.apiKey ? '✅ KEY SET (' + GROQ_CONFIG.apiKey.substring(0, 8) + '...)' : '❌ NO KEY — set GROQ_API_KEY env var!'}`);
console.log(`[KAVACH] GEMINI:  ${genAI ? '✅ INITIALIZED' : '❌ NO KEY — set GEMINI_API_KEY env var!'}`);
console.log(`[KAVACH] CLAUDE:  ${CLAUDE_CONFIG.apiKey ? '✅ KEY SET' : '⚠️ NO KEY (optional paid fallback)'}`);
console.log('[KAVACH] ═══════════════════════════');

let currentGeminiIndex = 0;
let lastGeminiRateLimit = 0;
let lastGroqRateLimit = 0;

// Get current Gemini model with rotation
function getGeminiModel() {
  if (!genAI) return null;
  if (Date.now() - lastGeminiRateLimit > 60000) {
    currentGeminiIndex = 0;
  }
  return genAI.getGenerativeModel({ model: GEMINI_MODELS[currentGeminiIndex] });
}

function rotateGemini() {
  lastGeminiRateLimit = Date.now();
  currentGeminiIndex = (currentGeminiIndex + 1) % GEMINI_MODELS.length;
  console.log(`[KAVACH] Gemini rate limit. Rotating to: ${GEMINI_MODELS[currentGeminiIndex]}`);
}

// Track which provider was throttled recently
function isGroqThrottled() {
  return Date.now() - lastGroqRateLimit < 30000; // 30s cooldown
}

// ══════════════════════════════════════════════════════════════════
// GROQ CALL — Primary LLM (200ms latency)
// ══════════════════════════════════════════════════════════════════
async function callGroq(systemPrompt, messages, timeout = 5000) {
  if (!GROQ_CONFIG.apiKey || isGroqThrottled()) {
    return { ok: false, skipped: true };
  }

  try {
    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(GROQ_CONFIG.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_CONFIG.model,
        messages: groqMessages,
        max_tokens: 150,
        temperature: 0.9,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 429) {
        lastGroqRateLimit = Date.now();
        console.log('[KAVACH] Groq rate limited. Cooling down 30s.');
        return { ok: false, rateLimited: true };
      }
      return { ok: false, error: `Groq ${response.status}` };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    
    if (!text || text.length < 10) {
      return { ok: false, error: 'Response too short' };
    }

    return { ok: true, text, provider: 'groq' };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { ok: false, timedOut: true };
    }
    return { ok: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// GEMINI CALL — Secondary LLM (3-model cascade)
// ══════════════════════════════════════════════════════════════════
async function callGemini(systemPrompt, messages, timeout = 6000) {
  if (!genAI) return { ok: false, skipped: true };

  for (let attempt = 0; attempt < GEMINI_MODELS.length; attempt++) {
    const model = getGeminiModel();
    if (!model) return { ok: false, error: 'No Gemini model' };

    try {
      const history = [];
      let lastUserMsg = '';
      
      for (let i = 0; i < messages.length - 1; i++) {
        const msg = messages[i];
        if (msg.role === 'user') {
          history.push({ role: 'user', parts: [{ text: msg.content }] });
        } else if (msg.role === 'assistant') {
          history.push({ role: 'model', parts: [{ text: msg.content }] });
        }
      }
      
      lastUserMsg = messages[messages.length - 1]?.content || 'Hello';
      
      const chat = model.startChat({
        history,
        generationConfig: {
          maxOutputTokens: 150,
          temperature: 0.92,
        },
      });
      
      const fullPrompt = systemPrompt + '\n\nScammer says: "' + lastUserMsg + '"\n\nRespond as your persona in THE SAME LANGUAGE as the scammer (1-2 sentences, conversational, DO NOT repeat, DO NOT switch to English if scammer wrote in Hindi/Tamil/Telugu):';
      
      const resultPromise = chat.sendMessage(fullPrompt);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('timeout')), timeout)
      );
      
      const result = await Promise.race([resultPromise, timeoutPromise]);
      const text = result.response.text().trim();
      
      if (!text || text.length < 10) {
        return { ok: false, error: 'Response too short' };
      }
      
      return { ok: true, text, provider: 'gemini', model: GEMINI_MODELS[currentGeminiIndex] };
    } catch (e) {
      const errMsg = e.message || '';
      if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate') || errMsg.includes('exhausted')) {
        rotateGemini();
        continue;
      }
      if (errMsg === 'timeout') {
        return { ok: false, timedOut: true };
      }
      return { ok: false, error: errMsg };
    }
  }

  return { ok: false, error: 'All Gemini models exhausted' };
}

// ══════════════════════════════════════════════════════════════════
// CLAUDE CALL — Tertiary LLM (paid, ultra-reliable)
// ══════════════════════════════════════════════════════════════════
async function callClaude(systemPrompt, messages, timeout = 8000) {
  if (!CLAUDE_CONFIG.apiKey) return { ok: false, skipped: true };

  try {
    const claudeMessages = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    // Ensure first message is user role (Claude requirement)
    if (claudeMessages.length > 0 && claudeMessages[0].role !== 'user') {
      claudeMessages.unshift({ role: 'user', content: 'Hello' });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(CLAUDE_CONFIG.baseUrl, {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_CONFIG.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_CONFIG.model,
        max_tokens: 200,
        temperature: 0.9,
        system: systemPrompt,
        messages: claudeMessages,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.log(`[KAVACH] Claude error ${response.status}: ${errText.slice(0, 100)}`);
      return { ok: false, error: `Claude ${response.status}` };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text?.trim();
    
    if (!text || text.length < 10) {
      return { ok: false, error: 'Response too short' };
    }

    return { ok: true, text, provider: 'claude', model: CLAUDE_CONFIG.model };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { ok: false, timedOut: true };
    }
    return { ok: false, error: e.message };
  }
}

// Legacy compatibility
function rotateModel() {
  rotateGemini();
}

// Track used fallbacks AND LLM responses per session to prevent ALL repetition
const usedResponses = new Map();

// ──────────────────────────────────────────────────
// TIER 2: Pre-computed smart fallbacks with MULTIPLE OPTIONS
// Key format: scamType:stage:language → Array of options
// Each key has 11-15 options for maximum variety, NO repetition
// ──────────────────────────────────────────────────
const SMART_FALLBACKS = {
  // Bank fraud - ENGLISH (PURE english, NO hindi words, complete sentences, 12+ options)
  'bank_fraud:GREETING:english': [
    "Oh my goodness, which bank did you say? I have accounts in so many places, I get confused sometimes.",
    "Wait wait, my account will be blocked? But I just checked yesterday and everything was fine.",
    "Hello? Sorry, who is this calling from? You're saying my bank account has a problem? Which bank exactly?",
    "Oh dear, this sounds very serious! But can you tell me which branch you are calling from? I want to note it down.",
    "Excuse me, did you say account blocked? But I didn't do any transaction today. Are you sure it's my account?",
    "Sorry, I couldn't hear properly. Did you say SBI or ICICI? My hearing is not very good these days.",
    "Oh no, this is very worrying. But first tell me, how did you get my number? Are you really from the bank?",
    "Account compromised? But how is that possible? I only use the ATM near my house and nobody knows my PIN.",
    "Wait, let me sit down first... this is giving me tension. You said my account has some problem?",
    "Hello hello, is this really the bank calling? My son always warns me about fake calls, you know.",
    "This is very sudden! But before we proceed, can you tell me what is your name and designation?",
    "My account is in danger? Oh goodness! But I need to understand properly. What exactly happened?",
  ],
  'bank_fraud:RAPPORT:english': [
    "Hmm okay, but my son always tells me to verify first. Can you give me your employee ID number please?",
    "Yes yes, I understand it's urgent, but what is your name and badge number? I need to write it down.",
    "Before I do anything, can you tell me your supervisor's name? My nephew works in bank, he said always ask.",
    "I want to help but you're going so fast. Can you spell your name for me? And which department are you from?",
    "One moment sir, let me get a pen to write. What did you say your name was? And employee number?",
    "My husband says I should always verify these things. Can you tell me the exact address of your branch?",
    "I'm not understanding fully. Can you explain again what happened to my account? Slowly please.",
    "Hold on, I need to tell my neighbor. She is very smart with these computer things. Can you wait two minutes?",
    "Okay okay, I'm listening. But my daughter-in-law said never give details on phone. How do I know you are real?",
    "Wait, let me call my son also on three-way. He handles all my bank work. What's your direct number?",
  ],
  'bank_fraud:FINANCIAL:english': [
    "Oh, you need my account details? Wait, let me find my passbook. It's somewhere in the drawer, one minute.",
    "Account number? Yes yes, I have it written somewhere. Hold on, my eyes are not so good, the writing is small.",
    "The account number... let me think... it starts with 1 or 2? Wait, I'll get my reading glasses first.",
    "I keep all my bank papers in a file. Just give me a moment to find it, don't hang up please.",
    "My passbook is in the almirah. Let me go to bedroom and check. Can you hold for one minute?",
    "Account number... you know, my son set up the account for me. I don't remember all those numbers.",
    "Let me open my phone... my daughter saved the account number somewhere. Where is that notes app...",
    "Wait wait, I need to find my glasses first. I cannot read anything without them. Hold on please.",
    "Is it the 12 digit number or 16 digit? I'm looking at my card but there are so many numbers here.",
    "One second, the passbook is in the safe. Let me get the key... I keep it hidden, you understand.",
  ],
  'bank_fraud:EXTRACTION:english': [
    "OTP? Yes something came on my phone just now. The numbers are so tiny, wait I need my spectacles.",
    "Oh the OTP message? I got it but there are so many numbers. Which one do you need exactly?",
    "Yes yes, I see some numbers on my phone screen. But it's showing two messages, which one is the OTP?",
    "The code came but my phone screen is cracked a little. Let me read slowly... 4... no wait, is that a 9?",
    "Hold on, my phone is showing something. There are 6 numbers here. You want me to read all of them?",
    "Wait, I got three messages today. One from electricity bill, one from bank, one from offer. Which one?",
    "The message came but it disappeared! Let me check my inbox. Why does this phone work so slowly...",
    "OTP... okay I see it. But wait, the message says don't share with anyone. Are you sure it's okay?",
    "Let me read it for you... actually wait, my granddaughter said never tell OTP to strangers on phone.",
    "Yes the code is here. But before I tell you, let me just call the bank number on my card to confirm.",
    "I got the message. But there are two OTPs here - one says 6 digits, one says 4 digits. Which one you want?",
    "One second, the message is loading. My internet is very slow today. Okay... it's showing now... wait...",
  ],
  'bank_fraud:CLOSING:english': [
    "Oh no, my phone battery is very low. Can you give me your direct number? I'll call back in 5 minutes.",
    "Wait, someone is at my door. Can you hold on or give me a number to call you back?",
    "My landline is ringing also. This must be important! Give me your callback number.",
    "Listen, I think I should come to the bank in person. Which branch can I visit? What are the timings?",
    "Actually, let me call the bank customer care first to confirm. What was your name again?",
    "Wait, my husband is calling me. He handles all the money matters. Can I call you back after asking him?",
    "I'm getting another call. It might be my son. Can you send me your details on WhatsApp instead?",
    "My cooking is burning on the stove! Give me your number quickly, I'll call back in 10 minutes.",
  ],

  // Bank fraud - HINGLISH (11+ entries for variety)
  'bank_fraud:GREETING:hinglish': [
    "Arrey bhai, kaun bol raha hai? Mera account block hoga matlab? Lekin maine kuch kiya hi nahi...",
    "Hello? Sorry, kaunsi bank se bol rahe ho? Mera account mein koi problem hai kya? Abhi toh sab theek tha...",
    "Yeh kya bol rahe ho aap? Mera account band? Lekin pichle hafte hi maine balance check kiya tha, sab okay tha...",
    "Arrey arrey, ruko ruko! Pehle batao aap kaun ho? Kaunsi bank? Main confuse ho gayi completely...",
    "Kya? Account mein problem? Ruko ruko, pehle batao kaunsi bank se bol rahe ho? SBI ya ICICI?",
    "Haan haan, bol rahe ho toh sun rahi hoon... lekin yeh kya hai, mera account kyun block hoga?",
    "Hello ji? Aap kaun bol rahe ho? Bank se? Mera toh sab theek hai, kal hi ATM se paisa nikala tha...",
    "Ji? Kya bola? Account compromised? Lekin maine toh sirf apne phone se hi banking ki hai...",
    "Arrey baap re, yeh toh bada serious hai! Lekin aap sure ho ki mera hi account hai? Naam batao mera?",
    "Ruko ruko, itna jaldi mat bolo... meri sunaai bhi theek se nahi deti. Kaunsi bank bola aapne?",
    "Aap fraud department se ho? Sach mein? Lekin maine koi galti nahi ki... kya problem hai batao?",
    "Ji haan, sun rahi hoon... lekin pehle apna naam aur employee ID batao, likha rakhti hoon...",
  ],
  'bank_fraud:RAPPORT:hinglish': [
    "Accha accha, samajh gayi... lekin mera beta kehta hai pehle verify karo. Aapka employee ID kya hai?",
    "Haan ji theek hai, but aapka naam aur department batao na pehle? Main likh leti hoon...",
    "Ji haan, urgent hai samajh rahi hoon... lekin aap konse branch se bol rahe ho? Mujhe noting karna hai...",
    "Ek minute sahab, mera bhai bank mein kaam karta hai, usne bola hamesha ID verify karo... aapka ID number?",
  ],
  'bank_fraud:FINANCIAL:hinglish': [
    "Account number chahiye? Ruko, passbook doosre room mein hai... ek second, main lekar aati hoon...",
    "Haan haan, passbook mein likha hai... mera chashma kahaan hai? Bina chashme ke nahi dikh raha clearly...",
    "Account details... wait karo na, sab papers almirah mein rakhe hain... phone hold pe rakhti hoon, mat kaatna...",
    "Passbook toh hai mere paas... lekin itne numbers hain, kaun sa number account number hai batao?",
  ],
  'bank_fraud:EXTRACTION:hinglish': [
    "OTP aa gaya phone pe... ruko, dekh rahi hoon... screen pe bahut chhote numbers hain, chashma dhundti hoon...",
    "Haan haan, message aaya hai... 4 se start ho raha hai lagta hai... nahi wait, yeh 9 hai ya 4?",
    "OTP? Ek second... do message aaye hain, kaun sa wala chahiye aapko? Confused ho gayi main...",
    "Aa gaya code... lekin mera phone purana hai, screen thoda tuta hai... slowly padhti hoon, ek minute...",
  ],

  // Bank fraud - HINDI DEVANAGARI (11+ entries for variety)
  'bank_fraud:GREETING:hindi_devanagari': [
    "अरे बाबा, कौन बोल रहा है? मेरा खाता बंद होगा? लेकिन मैंने तो कुछ किया ही नहीं...",
    "हैलो? सॉरी, कौनसी बैंक से बोल रहे हो? मेरे अकाउंट में कोई प्रॉब्लम है क्या?",
    "ये क्या बोल रहे हो आप? मेरा खाता बंद? लेकिन पिछले हफ्ते ही तो बैलेंस चेक किया था...",
    "अरे अरे, रुको रुको! पहले बताओ आप कौन हो? कौनसी बैंक? मैं confuse हो गई...",
    "क्या? अकाउंट में प्रॉब्लम? रुको रुको, पहले बताओ कौनसी बैंक से बोल रहे हो? SBI या ICICI?",
    "हाँ हाँ, बोल रहे हो तो सुन रही हूँ... लेकिन ये क्या है, मेरा अकाउंट क्यों बंद होगा?",
    "हैलो जी? आप कौन बोल रहे हो? बैंक से? मेरा तो सब ठीक है, कल ही ATM से पैसा निकाला था...",
    "जी? क्या बोला? अकाउंट compromised? लेकिन मैंने तो सिर्फ अपने फोन से ही बैंकिंग की है...",
    "अरे बाप रे, ये तो बड़ा serious है! लेकिन आप sure हो कि मेरा ही अकाउंट है? मेरा नाम बताओ?",
    "रुको रुको, इतना जल्दी मत बोलो... मेरी सुनाई भी ठीक से नहीं देती। कौनसी बैंक बोला आपने?",
    "आप fraud department से हो? सच में? लेकिन मैंने कोई गलती नहीं की... क्या प्रॉब्लम है बताओ?",
    "जी हाँ, सुन रही हूँ... लेकिन पहले अपना नाम और employee ID बताओ, लिख रखती हूँ...",
  ],
  'bank_fraud:RAPPORT:hindi_devanagari': [
    "अच्छा अच्छा, समझ गई... लेकिन मेरा बेटा कहता है पहले verify करो। आपका employee ID क्या है?",
    "हाँ जी ठीक है, but आपका नाम और department बताओ ना पहले?",
    "जी हाँ, urgent है समझ रही हूँ... लेकिन आप कौनसे branch से बोल रहे हो?",
  ],
  'bank_fraud:EXTRACTION:hindi_devanagari': [
    "OTP आ गया फोन पे... रुको, देख रही हूँ... screen पे बहुत छोटे numbers हैं...",
    "हाँ हाँ, message आया है... 4 से start हो रहा है लगता है... नहीं wait, ये 9 है या 4?",
    "आ गया code... लेकिन मेरा phone पुराना है, थोड़ा धीरे धीरे पढ़ती हूँ...",
  ],

  // Bank fraud - TAMIL (11+ entries for variety)
  'bank_fraud:GREETING:tamil': [
    "ஐயோ, யாரு பேசுறீங்க? என் account block ஆகும்னு சொல்றீங்க? நான் என்ன பண்ணேன்?",
    "என்ன சொல்றீங்க? என் bank account-ல problem-ஆ? போன week-ல check பண்ணேன், okay-ஆ இருந்துச்சே...",
    "Hello? Sorry, எந்த bank-ல இருந்து call பண்றீங்க? என் account-ல என்ன issue?",
    "ஐயோ ஐயோ, என்ன problem? என் account block ஆகும்-ன்னு சொல்றீங்க? எப்படி?",
    "Wait wait, நான் purinjukkala... யாரு பேசுறீங்க? Bank-ல இருந்து-வா?",
    "என்ன இது? என் account-ல problem-ஆ? நான் yesterday ATM-ல money எடுத்தேன், okay-ஆ இருந்தது...",
    "Hello? யாரு சார்? Bank-ல இருந்து call-ஆ? என் account எந்த bank-ல?",
    "Ayyo, serious-ஆ இருக்கா? என் account block ஆகும்-ன்னு சொல்றீங்க? What happened?",
    "Wait பண்ணுங்க, en husband-கிட்ட கேக்கணும்... அவரு bank matters பாப்பாரு...",
    "என்ன சொன்னீங்க? Properly puriyala... மெதுவா சொல்லுங்க please?",
    "Bank call-ஆ? Okay okay, ஆனா first உங்க name என்ன? Employee ID என்ன?",
    "Aiyo, yenna achu? En account-ல yenna problem? Naan yenna thappum panalaye...",
  ],
  'bank_fraud:RAPPORT:tamil': [
    "சரி சரி, puriyuthu... ஆனா en son சொன்னாரு verify பண்ணணும்னு. உங்க employee ID என்ன?",
    "OK OK, urgent-னு puriyuthu... ஆனா உங்க name-um department-um சொல்லுங்க முதல்ல?",
  ],
  'bank_fraud:EXTRACTION:tamil': [
    "OTP வந்துருக்கு phone-ல... wait பண்ணுங்க, பாக்கறேன்... screen-ல numbers ரொம்ப சின்னதா இருக்கு...",
    "ஆமா ஆமா, message வந்துருக்கு... 4-ல start ஆகுது... illana wait, ithu 9-ஆ 4-ஆ?",
  ],

  // Bank fraud - TELUGU (11+ entries for variety)
  'bank_fraud:GREETING:telugu': [
    "అయ్యో, ఎవరు మాట్లాడుతున్నారు? నా account block అవుతుందా? నేను ఏమి చేశాను?",
    "Hello? Sorry, ఏ bank నుండి call చేస్తున్నారు? నా account లో ఏమి problem?",
    "ఏమిటి చెప్తున్నారు? నా bank account block? కానీ last week check చేశాను, okay గా ఉంది...",
    "అయ్యో అయ్యో, ఏమి problem? నా account block అవుతుందా అంటున్నారు? ఎలా?",
    "Wait wait, నాకు అర్థం కాలేదు... ఎవరు మాట్లాడుతున్నారు? Bank నుండి వా?",
    "ఏమిటి ఇది? నా account లో problem ఉందా? నేను నిన్న ATM లో money తీశాను, okay గా ఉంది...",
    "Hello? మీరు ఎవరు? Bank నుండి call వా? నా account ఏ bank లో?",
    "అయ్యో, serious గా ఉందా? నా account block అవుతుందని చెప్తున్నారు? What happened?",
    "Wait చేయండి, నా husband కి చెప్పాలి... ఆయన bank matters చూస్తారు...",
    "ఏమి చెప్పారు? Properly వినలేదు... మెల్లగా చెప్పండి please?",
    "Bank call వా? Okay okay, కానీ first మీ name ఏమిటి? Employee ID ఏమిటి?",
    "Ayyo, yemi ayyindi? Na account lo yemi problem? Nenu yemi tappu cheyyaledu...",
  ],
  'bank_fraud:RAPPORT:telugu': [
    "సరే సరే, అర్థమైంది... కానీ మా అబ్బాయి చెప్పాడు verify చేయమని. మీ employee ID ఏమిటి?",
  ],
  'bank_fraud:EXTRACTION:telugu': [
    "OTP వచ్చింది phone లో... wait, చూస్తున్నాను... screen లో numbers చాలా చిన్నగా ఉన్నాయి...",
  ],

  // Bank fraud - BENGALI (11+ entries for variety)
  'bank_fraud:GREETING:bengali': [
    "আরে বাবা, কে বলছেন? আমার অ্যাকাউন্ট ব্লক হবে? কিন্তু আমি তো কিছু করিনি...",
    "হ্যালো? সরি, কোন ব্যাংক থেকে বলছেন? আমার অ্যাকাউন্টে কি সমস্যা?",
    "কি বলছেন? আমার bank account block? কিন্তু last week check করলাম, okay ছিল...",
    "আরে আরে, কি problem? আমার account block হবে বলছেন? কিভাবে?",
    "Wait wait, আমি বুঝতে পারছি না... কে বলছেন? Bank থেকে কি?",
    "এটা কি? আমার account এ problem? আমি তো গতকাল ATM থেকে টাকা তুললাম, okay ছিল...",
    "হ্যালো? আপনি কে? Bank থেকে call? আমার account কোন bank এ?",
    "আরে, serious কি? আমার account block হবে বলছেন? What happened?",
    "Wait করুন, আমার স্বামীকে জিজ্ঞেস করি... উনি bank matters দেখেন...",
    "কি বললেন? ঠিকমতো শুনতে পেলাম না... ধীরে বলুন please?",
    "Bank call? Okay okay, কিন্তু first আপনার name কি? Employee ID কি?",
    "Are, ki holo? Amar account e ki problem? Ami to kichu kori ni...",
  ],
  'bank_fraud:RAPPORT:bengali': [
    "আচ্ছা আচ্ছা, বুঝলাম... কিন্তু আমার ছেলে বলে আগে verify করতে। আপনার employee ID কি?",
  ],
  'bank_fraud:EXTRACTION:bengali': [
    "OTP এসেছে ফোনে... wait করুন, দেখছি... screen-এ numbers খুব ছোট...",
  ],

  // KYC fraud
  'kyc_fraud:GREETING:english': [
    "KYC update? But I did that last year only... which bank is this from? My son usually handles these things...",
    "Oh, KYC verification? Wait, I thought we do that at the branch? How does it work on phone?",
  ],
  'kyc_fraud:GREETING:hinglish': [
    "KYC? Mera beta karta tha yeh sab... kaunsi bank se bol rahe ho? Last year toh ho gaya tha...",
    "KYC update karna hai? Lekin branch mein hota hai na yeh? Phone pe kaise karein?",
  ],
  'kyc_fraud:RAPPORT:hinglish': [
    "Accha, par KYC toh branch mein hota hai na? Online kaise karein? Mujhe samjhao thoda...",
  ],

  // OTP fraud (THE MAIN SCAM - needs many variations)
  'otp_fraud:GREETING:english': [
    "OTP? What OTP? I didn't request any OTP. Are you sure you have the right number?",
    "Which OTP are you talking about? I didn't do any transaction just now.",
    "Sorry, what did you say? OTP? But I didn't order anything or make any payment.",
    "OTP message? I get so many messages from different banks. What is this regarding?",
    "Hold on, OTP for what? I didn't try to log in anywhere. Are you sure this is my account?",
    "Wait, I'm confused. Why would I get an OTP if I didn't request it? Is someone trying to hack me?",
    "OTP? You mean the 6 digit code? But why did it come if I didn't do anything?",
    "Hello? Who is this? You're asking about OTP? Which bank is this from?",
  ],
  'otp_fraud:RAPPORT:english': [
    "Okay okay, but first tell me, how did you know I received an OTP? Are you really from the bank?",
    "Wait, my son told me OTPs are very important. Why do you need my OTP? Can you explain properly?",
    "I understand you want to help, but why would bank call asking for OTP? Isn't that supposed to be secret?",
    "Hmm, let me think. So you're saying if I don't share OTP, my account will be blocked? That sounds strange.",
    "Hold on sir, I watch those crime shows. Bank never asks for OTP they said. Are you sure you're from bank?",
    "But wait, the message itself says don't share OTP with anyone. Why are you asking me to share?",
    "Let me understand properly. You want me to read the OTP to you? But the bank SMS says never share!",
    "I'm a bit worried now. My neighbor aunty lost 50000 rupees to fraud. How do I know you're genuine?",
  ],
  'otp_fraud:EXTRACTION:english': [
    "OTP? Okay let me check my phone. Hold on... my phone is a bit slow, give me a moment.",
    "Yes yes, I see a message here. There are 6 numbers. You want me to tell all of them?",
    "Okay the OTP is... wait, let me get my glasses first. I cannot read the small font properly.",
    "I got the message. Let me read... wait, it says valid for 3 minutes only. It might have expired!",
    "The code came. But hold on, there are two OTPs here. One at 10:30 and one at 10:32. Which one?",
    "Yes I see it. 6 digit number right? Okay it's... wait my phone screen went dark. One second.",
    "Let me check... okay the OTP is here. But before I read it, can you confirm my account number first?",
    "The message is here. Numbers are 4-7... oh wait, my granddaughter is calling on the other line.",
    "Okay I'm looking at the SMS. It says OTP is... hold on, someone is at the door. One minute please.",
    "Yes the OTP came. It starts with 5 I think... or is that 6? The font is very small on this phone.",
    "I have the message open. There are multiple numbers - some account number, some code. Which do you need?",
    "The OTP is showing but wait - my phone is showing low battery warning. Let me plug charger first.",
    "Let me read it slowly. The first digit is... actually, can you first tell me what this OTP is for exactly?",
    "I see the code. But the message says expires in 3 minutes and we've been talking for so long already!",
    "Yes okay, the OTP is here. But wait - let me verify one thing. Can you tell me the last 4 digits of my account?",
  ],
  'otp_fraud:FINANCIAL:english': [
    "You also need my account number? Wait, let me get the passbook. It's in another room.",
    "Bank account details... okay but I have accounts in 3 banks. Which one are you asking about?",
    "Account number is there in passbook. Let me find it. I keep it in the drawer with my other papers.",
    "My card is in my purse. One second let me get it. The account number is on the back right?",
    "Account details? My son set all this up for me. I don't remember the full number. Can I call you back?",
  ],
  'otp_fraud:CLOSING:english': [
    "Wait wait, before I give OTP, let me just confirm with my son once. He handles all bank matters.",
    "You know what, let me call the bank customer care number first. What was your employee ID again?",
    "My phone is about to die. Can you give me your number? I'll call back after charging.",
    "Actually I'm getting scared now. Let me visit the bank branch tomorrow and sort this out in person.",
    "I think I should talk to my neighbor first. He is bank manager retired. He will know what to do.",
  ],

  // OTP fraud - HINGLISH
  'otp_fraud:GREETING:hinglish': [
    "OTP? Kaunsa OTP? Mujhe koi message nahi aaya abhi tak. Sure hai aap?",
    "Kaunsa OTP bhai? Maine toh koi transaction nahi kiya abhi.",
    "OTP? Mujhe kuch nahi aaya phone pe. Kaun bol raha hai yeh?",
    "Wait wait, OTP kis cheez ke liye aaya? Maine toh kuch nahi kiya.",
  ],
  'otp_fraud:RAPPORT:hinglish': [
    "Accha, but bank toh OTP nahi maangti phone pe. Mera bhai bola tha yeh.",
    "OTP kyun chahiye aapko? Message mein likha hai share mat karo kisi ko bhi.",
    "Pehle yeh batao, aapko kaise pata main ne OTP receive kiya? Suspicious lag raha hai.",
  ],
  'otp_fraud:EXTRACTION:hinglish': [
    "OTP? Haan ek message aaya hai. 4 se shuru ho raha hai lagta hai. Ruko clearly dekh loon.",
    "Achha haan, phone pe kuch numbers dikhe. Kaunsa wala OTP hai? Bahut saare messages hain.",
    "Ruko, message dhundh raha hoon. Bahut saare SMS aaye aaj. Kaunsa bank wala?",
    "OTP toh hai phone mein. Lekin 6 digits hain ya 4? Do messages hain confusing hai.",
    "Achha dekh raha hoon. OTP hai... wait, yeh expired toh nahi ho gaya? 3 minute likhta hai.",
    "Message mila. Numbers hain but mera phone dim hai. Roshni mein dekh ke batata hoon.",
    "Ha ha, OTP hai screen pe. Ruko glasses lagata hoon. Font bahut chhota hai.",
    "Code aa gaya. 5 se start ho raha hai... nahi wait, 6 hai shayad. Itna chhota likha hai.",
  ],

  // UPI fraud - more options
  'upi_fraud:GREETING:english': [
    "Cashback on UPI? Really? I didn't know about this scheme. How much cashback will I get?",
    "Free money on Paytm? Which offer is this? I use GPay mostly, will it work there too?",
    "UPI reward? Wait, I saw something like this on TV. Is this the government scheme?",
    "Cashback offer? But I didn't apply for anything. How did you select me for this?",
    "Free money? That sounds amazing! But is this real? My daughter warns me about scams.",
    "Which UPI app is this for? I have Paytm, PhonePe, and GPay all three. Which one?",
  ],
  'upi_fraud:RAPPORT:english': [
    "How much cashback exactly? And what do I need to do to get it?",
    "So I just need to share my UPI ID and I'll get money? That's it? Nothing else?",
    "This sounds like those offers I see on WhatsApp. Is this official from the bank?",
    "Wait, I need to understand properly. You'll transfer money or I need to pay first?",
  ],
  'upi_fraud:FINANCIAL:english': [
    "My UPI ID? Let me think. I have it on Paytm and PhonePe both. Which one do you need?",
    "UPI ID? It's something like my phone number I think. Wait, let me check in the app.",
    "The UPI ID is... hold on, I don't remember if it's my phone number or the handle thing.",
    "Let me open the app. Where do I find the UPI ID? Is it under profile or settings?",
    "Okay I'm opening Paytm. There are so many options here. Where is my UPI ID shown?",
  ],
  'upi_fraud:EXTRACTION:english': [
    "The PIN? But my son said never share UPI PIN. Why do you need it for cashback?",
    "Wait, to receive money I also need to enter PIN? I thought PIN is only for sending.",
    "UPI PIN? That's my secret number right? How will cashback come if I share it?",
    "I don't think I should share PIN. Let me confirm with my husband first. Can you wait?",
  ],
  'upi_fraud:GREETING:hinglish': [
    "Cashback? Sach mein? Kaunsa offer hai yeh? Kitna milega cashback?",
    "UPI pe free money? Kya baat kar rahe ho? Mujhe toh koi notification nahi aaya.",
    "Paytm reward hai? Lekin maine kuch apply nahi kiya. Mujhe kaise select kiya?",
  ],
  'upi_fraud:FINANCIAL:hinglish': [
    "UPI ID? Mera wala hai but mujhe exact yaad nahi. Paytm wala hai ya GPay wala chahiye?",
    "Mera UPI toh phone number hi hai na? Ya kuch aur bhi hota hai? Confused hoon.",
    "Ruko app open karta hoon. UPI ID kahaan likha hota hai? Profile mein?",
  ],

  // Lottery scam - more English options
  'lottery_scam:GREETING:english': [
    "I won a lottery? But I never entered any contest! Which lucky draw is this from?",
    "Oh my god, I won something? How much did I win? But when did I enter this contest?",
    "Wait wait, you're saying I won money? Which company's lottery is this? I don't remember entering.",
    "Lottery prize? For me? But I never buy lottery tickets. There must be some mistake.",
    "This is unbelievable! I actually won? How much money are we talking about here?",
    "You're not joking right? I really won? Which company organized this lottery?",
    "Wait, let me sit down. This is big news. But I'm confused - when did I enter any lottery?",
  ],
  'lottery_scam:RAPPORT:english': [
    "Such a big amount? Really? But I need to tell my family first. Can you send me the official letter?",
    "That's a lot of money! But how do I know this is real? Can you email me the details?",
    "I want to believe this is real. Can you give me some proof? Like a reference number or something?",
    "This is wonderful news! But my son always says verify first. Can you give me your office address?",
    "Before I proceed, can you tell me the name of your company and your registration number?",
  ],
  'lottery_scam:FINANCIAL:english': [
    "Processing fee? But if I won the money, why do I need to pay something first?",
    "Tax payment in advance? That seems strange. Can't you deduct it from my prize amount?",
    "I have to pay before receiving? My neighbor warned me this is how scams work. Let me confirm.",
    "How much is the fee exactly? And can you give me a receipt when I pay?",
  ],
  'lottery_scam:GREETING:hinglish': [
    "Main jeet gayi? Sach mein? Kaunsa lucky draw tha yeh? Maine toh enter hi nahi kiya tha!",
    "Lottery? Mujhe? Kitna jeeta hai? Par maine toh koi contest nahi khela.",
    "Lottery prize hai mere liye? Yeh toh amazing news hai! Kitna amount hai?",
  ],
  'lottery_scam:RAPPORT:hinglish': [
    "Sach mein itna paisa? Lekin mujhe toh koi SMS nahi aaya pehle. Official letter bhejoge kya?",
    "Itna bada amount? Main apne husband ko bata doon pehle. Kuch proof hai aapke paas?",
  ],

  // Job scam - more English options
  'job_scam:GREETING:english': [
    "A job offer? Really? Which company is this? I applied to so many places, I forgot.",
    "Oh, someone wants to hire me? What's the position? And how did you get my resume?",
    "Work from home job? What kind of work? And what is the salary? My nephew was also looking.",
    "You're offering me a job? That's great news! But which posting is this for?",
    "HR calling? Which company did you say? I've applied to JobsPortal and Naukri both.",
    "Job opportunity? Excellent! What's the role and what are the working hours?",
  ],
  'job_scam:RAPPORT:english': [
    "What's the salary package? Is it full time or part time? Do I need to come to office?",
    "Sounds interesting. But what skills do you need? I only know basic computer work.",
    "Can you tell me more about the company? What products or services do you provide?",
    "What would my daily work involve? Is there training provided for new employees?",
    "The offer sounds good. But can you send me the offer letter on email for my reference?",
  ],
  'job_scam:EXTRACTION:english': [
    "Registration fee for the job? But I've never heard of companies charging to give jobs.",
    "I need to pay for training? Usually companies pay during training period right?",
    "You need my bank details for salary deposit? But can't we do that after joining?",
  ],
  'job_scam:GREETING:hinglish': [
    "Job offer hai? Kaun si company se bol rahe ho? Mera resume kahaan se mila aapko?",
    "WFH job? Kya kaam karna padega? Salary kya hai? Mere bhatije ko bhi batana hai.",
    "Job ke liye call? Great! Kaun si position hai aur company ka naam kya hai?",
  ],
  'job_scam:RAPPORT:hinglish': [
    "Package kya hai bhai? WFH hai ya office jaana padega? Training milegi?",
    "Accha job opportunity hai. Mere liye suitable hai kya? Experience kitna chahiye?",
  ],

  // Phishing - more English options
  'phishing:GREETING:english': [
    "Click a link? My phone is showing some warning. Which website is this exactly?",
    "A link? Wait, my son told me to be careful with links. What is this website for?",
    "You want me to open a link? But I read that hackers send virus through links.",
    "What's in this link? My phone asked if I want to allow. Is it safe to click?",
    "Link for what? To update my details? Can't I do this by visiting the bank website directly?",
  ],
  'phishing:RAPPORT:english': [
    "The link looks different from the bank website I usually use. Is this the correct one?",
    "My antivirus is showing a warning. Can you confirm this is the official bank link?",
    "I'm not comfortable clicking unknown links. Can you give me the bank's official website instead?",
  ],
  'phishing:GREETING:hinglish': [
    "Link click karna hai? Ruko, mera internet slow hai. Kaunsi website hai batao?",
    "Link? Mera beta bolta hai links pe click mat karo. Yeh kya hai exactly?",
    "Link share kiya? Phone pe warning aa raha hai. Safe hai kya click karna?",
  ],

  // Investment fraud - more English options
  'investment_fraud:GREETING:english': [
    "Investment with guaranteed returns? That sounds too good to be true. Which company is this?",
    "500% returns? Wow. But is it safe? My husband lost money in shares once, he'll be angry.",
    "Double my money in 3 months? How is that possible? What's the investment in?",
    "You're promising high returns? But RBI only gives 7% on fixed deposit. How do you give more?",
    "Guaranteed profit scheme? My friend told me about one and he lost everything. How is yours different?",
  ],
  'investment_fraud:RAPPORT:english': [
    "Can you explain how this investment works? Where exactly does the money go?",
    "Do you have any registration with SEBI? I want to make sure this is legal.",
    "What if I need my money back urgently? Can I withdraw anytime without penalty?",
    "Can you show me some testimonials from other investors? People who actually got returns?",
  ],
  'investment_fraud:GREETING:hinglish': [
    "Invest karo aur 500% return? Bhai, yeh real hai kya? Company ka naam bata pehle.",
    "Guaranteed returns? Aisa possible hai kya? Mere husband ko batana padega but woh mana karenge shayad.",
    "Paisa double? Kitne din mein? Yeh legal hai na? SEBI registered company hai?",
  ],

  // Aggressive scammer responses - pure English
  'aggressive:ANY:english': [
    "Please don't shout at me sir. I'm just an old woman trying to understand. Can you explain slowly?",
    "Why are you getting angry? I just want to make sure before I do anything. Please have some patience.",
    "Sir, I'm just confused. No need to raise your voice. My hearing is also not so good.",
    "Please calm down. I was just asking questions to verify. Why are you getting so upset?",
    "There's no need to be rude. I'm trying to cooperate but you're making me nervous.",
    "Sir, your tone is scaring me. Can you please speak gently? I'm old and get anxious easily.",
    "Why so much anger? I just wanted to double-check. If you keep shouting I'll hang up the call.",
    "Please speak nicely. I'm trying my best to understand. Getting angry won't help either of us.",
  ],
  'aggressive:ANY:hinglish': [
    "Aise kyun bol rahe ho bhai... main samajhne ki koshish kar rahi hoon na, dhire bologe toh samjhungi...",
    "Arrey gussa kyun ho rahe ho? Main toh bas verify karna chahti hoon... sabr rakho thoda...",
    "Itna chilla kyun rahe ho? Meri sunaai bhi kam deti hai, please dhire bolo...",
  ],
  'aggressive:ANY:hindi_devanagari': [
    "ऐसे क्यों बोल रहे हैं... मैं समझने की कोशिश कर रही हूँ ना, धीरे बोलोगे तो समझूंगी...",
    "अरे गुस्सा क्यों हो रहे हो? मैं तो बस verify करना चाहती हूँ...",
  ],
  'aggressive:ANY:tamil': [
    "ஐயோ, ஏன் அப்படி சொல்றீங்க... நான் புரிஞ்சுக்க try பண்றேன், மெதுவா சொல்லுங்க...",
    "கோபப்படாதீங்க sir... நான் confuse ஆயிட்டேன், patience-ஆ explain பண்ணுங்க...",
  ],
  'aggressive:ANY:telugu': [
    "అయ్యో, అలా ఎందుకు మాట్లాడుతున్నారు... నేను అర్థం చేసుకోవడానికి try చేస్తున్నాను...",
    "కోపం ఎందుకు sir... నేను just verify చేయాలనుకుంటున్నాను...",
  ],
  'aggressive:ANY:bengali': [
    "এত রাগ করছেন কেন... আমি বোঝার চেষ্টা করছি তো, ধীরে বলুন...",
    "ও বাবা, চেঁচামেচি করবেন না... আমি তো just বুঝতে চাইছি...",
  ],
};

// ──────────────────────────────────────────────────
// TIER 3: Base fallbacks (multiple options for variety)
// ──────────────────────────────────────────────────
const BASE_FALLBACKS = {
  hindi_devanagari: [
    "रुकिए जी, मैं समझ नहीं पाई... एक बार फिर बताएंगे कृपया?",
    "अरे, थोड़ा धीरे बोलिए ना... मेरी समझ में नहीं आया...",
    "जी? आपने क्या कहा? मेरी सुनाई कम देती है, फिर से बोलिए...",
  ],
  hinglish: [
    "Ruko ruko, main samajh nahi paayi... aap phir se bologe please?",
    "Arrey, thoda slowly bolo na... meri samajh mein nahi aaya...",
    "Kya? Maine suna nahi properly... ek baar aur batao na?",
    "Sorry sorry, phone ki awaz kam hai... kya bola aapne?",
  ],
  tamil: [
    "ஐயோ, புரியவில்லை... மெதுவா மீண்டும் சொல்லுங்க?",
    "என்ன சொன்னீங்க? சரியா கேக்கல... once more please?",
    "Wait wait, puriyala... innum oru thadava sollunga?",
  ],
  telugu: [
    "అయ్యో, అర్థం కాలేదు... మెల్లగా మళ్ళీ చెప్పండి?",
    "ఏమిటి? సరిగ్గా వినలేదు... ఇంకోసారి చెప్పగలరా?",
  ],
  kannada: [
    "ಅಯ್ಯೋ, ಅರ್ಥವಾಗಲಿಲ್ಲ... ನಿಧಾನವಾಗಿ ಮತ್ತೆ ಹೇಳಿ?",
  ],
  bengali: [
    "আরে, বুঝলাম না... ধীরে আবার বলবেন please?",
    "কি বললেন? ঠিকমতো শুনতে পেলাম না... আবার বলুন?",
  ],
  gujarati: [
    "અરે, સમજ ન પડ્યું... ફરીથી કહો please?",
  ],
  punjabi: [
    "ਅਰੇ, ਸਮਝ ਨਹੀਂ ਆਇਆ... ਫਿਰ ਦੱਸੋ please?",
  ],
  malayalam: [
    "അയ്യോ, മനസ്സിലായില്ല... വീണ്ടും പറയൂ?",
  ],
  odia: [
    "ଅରେ, ବୁଝିଲା ନାହିଁ... ପୁଣି କୁହନ୍ତୁ?",
  ],
  marathi: [
    "अरे, समजलं नाही... परत सांगाल का please?",
  ],
  english: [
    "Oh sorry, I didn't catch that. Can you say it again slowly please?",
    "Wait what? My hearing is not so good. Can you please repeat?",
    "The line is not clear. Can you say that one more time?",
    "Sorry, I was distracted by something. What did you say just now?",
    "I couldn't hear properly. There's some noise here. Can you repeat please?",
    "What was that? My phone speaker is not working well. Say again?",
    "Hold on, I missed that. Can you speak a bit louder?",
    "Sorry, what? I didn't understand. Can you explain again?",
    "The connection is bad on my side. Can you repeat slowly?",
    "My ears are not what they used to be. Please say that again?",
    "I beg your pardon? I missed the last part. Can you repeat?",
    "Sorry, there was some disturbance. What were you saying?",
  ],
};

/**
 * Get an unused fallback from array, with rotation to prevent repetition
 */
function getRotatedFallback(options, sessionId) {
  if (!options || options.length === 0) return null;
  if (typeof options === 'string') return options; // Old format compatibility
  
  // Get or create used set for this session
  if (!usedResponses.has(sessionId)) {
    usedResponses.set(sessionId, new Set());
  }
  const used = usedResponses.get(sessionId);
  
  // Find unused options that haven't been used before (including similar ones)
  const available = options.filter(opt => {
    // Check if this exact response or very similar was used
    for (const usedResp of used) {
      if (opt === usedResp) return false;
      // Check for similar start (first 30 chars)
      if (opt.slice(0, 30).toLowerCase() === usedResp.slice(0, 30).toLowerCase()) return false;
    }
    return true;
  });
  
  // If all used, clear and start fresh
  if (available.length === 0) {
    // But keep tracking LLM responses, only clear fallback tracking
    const llmResponses = [...used].filter(r => r.startsWith('__LLM__'));
    used.clear();
    llmResponses.forEach(r => used.add(r));
    return options[Math.floor(Math.random() * options.length)];
  }
  
  // Pick random from available
  const selected = available[Math.floor(Math.random() * available.length)];
  used.add(selected);
  return selected;
}

/**
 * Check if an LLM response is too similar to previous responses
 */
function isResponseTooSimilar(newResponse, sessionId) {
  if (!usedResponses.has(sessionId)) return false;
  const used = usedResponses.get(sessionId);
  
  const newLower = newResponse.toLowerCase();
  const newWords = new Set(newLower.split(/\s+/).filter(w => w.length > 3));
  
  for (const usedResp of used) {
    const usedLower = usedResp.toLowerCase();
    
    // Check exact match
    if (newLower === usedLower) return true;
    
    // Check if starts the same way (first 40 chars)
    if (newLower.slice(0, 40) === usedLower.slice(0, 40)) return true;
    
    // Check word overlap (if >70% words are same, it's too similar)
    const usedWords = new Set(usedLower.split(/\s+/).filter(w => w.length > 3));
    const overlap = [...newWords].filter(w => usedWords.has(w)).length;
    const similarity = overlap / Math.max(newWords.size, 1);
    if (similarity > 0.7) return true;
  }
  
  return false;
}

/**
 * Track a used response (both LLM and fallback)
 */
function trackUsedResponse(response, sessionId) {
  if (!usedResponses.has(sessionId)) {
    usedResponses.set(sessionId, new Set());
  }
  usedResponses.get(sessionId).add(response);
}

/**
 * Get response using MULTI-LLM CASCADE with rate limit handling.
 * Order: Groq (200ms) → Gemini (cascade) → Claude → Human Pool → Smart Fallback.
 * THE ENDPOINT NEVER DIES.
 */
async function getResponseTiered(systemPrompt, messages, session, languageData) {
  const startMs = Date.now();
  const sessionId = session.sessionId || 'default';
  
  // Get session context for fallbacks
  const scamType = session.scamType || 'bank_fraud';
  const stage = session.stage || 'GREETING';
  let lang = languageData?.language || 'english';
  if (!lang || lang === 'unknown') lang = 'english';
  
  const wasAggressive = session.emotionHist && 
    (session.emotionHist.includes('HIGH') || session.emotionHist.includes('aggressive'));
  const emotion = wasAggressive ? 'HIGH' : 'MEDIUM';
  
  // Get used IDs for this session
  if (!usedResponses.has(sessionId)) {
    usedResponses.set(sessionId, new Set());
  }
  const usedIds = usedResponses.get(sessionId);

  // ═══════════════════════════════════════════════════════════════
  // LANGUAGE REINFORCEMENT — Prepend hard language constraint
  // The identity lock prompt has it, but LLMs sometimes ignore it.
  // This adds it as the LAST thing the LLM reads before generating.
  // ═══════════════════════════════════════════════════════════════
  const LANG_ENFORCEMENT = {
    hinglish: '\n\n[MANDATORY] Reply in HINGLISH only (Hindi words in Latin script mixed with English). Example: "Arrey, mera account... kya hua?"',
    hindi_devanagari: '\n\n[MANDATORY] Reply in HINDI DEVANAGARI script ONLY. हिंदी में जवाब दो।',
    tamil: '\n\n[MANDATORY] Reply in TAMIL script ONLY. தமிழில் பதில் சொல்லுங்கள்.',
    telugu: '\n\n[MANDATORY] Reply in TELUGU script ONLY. తెలుగులో సమాధానం చెప్పండి.',
    bengali: '\n\n[MANDATORY] Reply in BENGALI script ONLY. বাংলায় উত্তর দিন.',
    gujarati: '\n\n[MANDATORY] Reply in GUJARATI script ONLY. ગુજરાતીમાં જવાબ આપો.',
    kannada: '\n\n[MANDATORY] Reply in KANNADA script ONLY. ಕನ್ನಡದಲ್ಲಿ ಉತ್ತರಿಸಿ.',
    malayalam: '\n\n[MANDATORY] Reply in MALAYALAM script ONLY. മലയാളത്തിൽ മറുപടി നൽകുക.',
    marathi: '\n\n[MANDATORY] Reply in MARATHI Devanagari ONLY. मराठी मध्ये उत्तर द्या.',
    punjabi: '\n\n[MANDATORY] Reply in PUNJABI Gurmukhi ONLY. ਪੰਜਾਬੀ ਵਿੱਚ ਜਵਾਬ ਦਿਓ.',
    english: '',
  };
  
  const langEnforcement = LANG_ENFORCEMENT[lang] || '';
  const enhancedPrompt = systemPrompt + langEnforcement;

  // ════════════════════════════════════════════════════════════
  // TIER 1: GROQ (Primary — 200ms latency)
  // ════════════════════════════════════════════════════════════
  const groqResult = await callGroq(enhancedPrompt, messages);
  console.log(`[KAVACH] TIER 1 GROQ: ok=${groqResult.ok} skipped=${groqResult.skipped || false} error=${groqResult.error || 'none'} rateLimited=${groqResult.rateLimited || false}`);
  if (groqResult.ok && groqResult.text && groqResult.text.length >= 10) {
    if (!isResponseTooSimilar(groqResult.text, sessionId)) {
      trackUsedResponse(groqResult.text, sessionId);
      return { 
        reply: groqResult.text, 
        tier: 1, 
        provider: 'groq',
        ms: Date.now() - startMs 
      };
    }
    console.log('[KAVACH] GROQ response rejected: too similar to previous');
  }

  // ════════════════════════════════════════════════════════════
  // TIER 2: GEMINI (Secondary — 3-model cascade)
  // ════════════════════════════════════════════════════════════
  const geminiResult = await callGemini(enhancedPrompt, messages);
  console.log(`[KAVACH] TIER 2 GEMINI: ok=${geminiResult.ok} skipped=${geminiResult.skipped || false} error=${geminiResult.error || 'none'}`);
  if (geminiResult.ok && geminiResult.text && geminiResult.text.length >= 10) {
    if (!isResponseTooSimilar(geminiResult.text, sessionId)) {
      trackUsedResponse(geminiResult.text, sessionId);
      return { 
        reply: geminiResult.text, 
        tier: 2, 
        provider: 'gemini',
        model: geminiResult.model,
        ms: Date.now() - startMs 
      };
    }
    console.log('[KAVACH] GEMINI response rejected: too similar to previous');
  }

  // ════════════════════════════════════════════════════════════
  // TIER 3: CLAUDE (Tertiary — paid, ultra-reliable)
  // ════════════════════════════════════════════════════════════
  const claudeResult = await callClaude(enhancedPrompt, messages);
  console.log(`[KAVACH] TIER 3 CLAUDE: ok=${claudeResult.ok} skipped=${claudeResult.skipped || false} error=${claudeResult.error || 'none'}`);
  if (claudeResult.ok && claudeResult.text && claudeResult.text.length >= 10) {
    if (!isResponseTooSimilar(claudeResult.text, sessionId)) {
      trackUsedResponse(claudeResult.text, sessionId);
      return { 
        reply: claudeResult.text, 
        tier: 3, 
        provider: 'claude',
        ms: Date.now() - startMs 
      };
    }
    console.log('[KAVACH] CLAUDE response rejected: too similar to previous');
  }

  // ════════════════════════════════════════════════════════════
  // TIER 4: HUMAN POOL (120+ contextual responses — NEVER fails)
  // ════════════════════════════════════════════════════════════
  console.log(`[KAVACH] TIER 4 HUMAN POOL: lang=${lang} scamType=${scamType} stage=${stage} emotion=${emotion}`);
  const humanFallback = getSmartFallback(scamType, stage, lang, emotion, usedIds);
  if (humanFallback && humanFallback.id) {
    usedIds.add(humanFallback.id);
    return {
      reply: humanFallback.text,
      tier: 4,
      provider: 'human-pool',
      fallbackId: humanFallback.id,
      ms: Date.now() - startMs
    };
  }

  // ════════════════════════════════════════════════════════════
  // TIER 5: SMART FALLBACKS (legacy backup)
  // ════════════════════════════════════════════════════════════
  const keysToTry = wasAggressive 
    ? [`aggressive:ANY:${lang}`, `aggressive:ANY:english`, `aggressive:ANY:hinglish`]
    : [
        `${scamType}:${stage}:${lang}`,
        `${scamType}:RAPPORT:${lang}`,
        `${scamType}:GREETING:${lang}`,
        `${scamType}:${stage}:english`,
        `${scamType}:RAPPORT:english`,
        `${scamType}:GREETING:english`,
        `bank_fraud:${stage}:${lang}`,
        `bank_fraud:RAPPORT:${lang}`,
        `bank_fraud:GREETING:${lang}`,
        `bank_fraud:GREETING:english`,
        `otp_fraud:EXTRACTION:${lang}`,
        `otp_fraud:EXTRACTION:english`,
      ];

  for (const key of keysToTry) {
    const options = SMART_FALLBACKS[key];
    if (options) {
      const fallback = getRotatedFallback(options, sessionId);
      if (fallback && !isResponseTooSimilar(fallback, sessionId)) {
        trackUsedResponse(fallback, sessionId);
        return { reply: fallback, tier: 5, provider: 'smart-fallback', ms: Date.now() - startMs };
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // TIER 6: BASE LANGUAGE FALLBACK (ultimate backup)
  // ════════════════════════════════════════════════════════════
  const baseOptions = BASE_FALLBACKS[lang] || BASE_FALLBACKS.english || BASE_FALLBACKS.hinglish;
  const baseFallback = getRotatedFallback(baseOptions, sessionId + '_base');
  
  if (baseFallback) {
    trackUsedResponse(baseFallback, sessionId);
  }
  
  return {
    reply: baseFallback || "Sorry, I didn't understand... can you repeat please?",
    tier: 6,
    provider: 'base-fallback',
    ms: Date.now() - startMs,
  };
}

// Clean up old session tracking (memory management)
setInterval(() => {
  if (usedResponses.size > 1000) {
    usedResponses.clear();
  }
}, 60000);

module.exports = { getResponseTiered, SMART_FALLBACKS, BASE_FALLBACKS, rotateModel };
