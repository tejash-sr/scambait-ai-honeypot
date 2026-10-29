# 🚀 KAVACH Deployment Guide

**HCL GUVI India AI Impact Buildathon 2026**  
Bharat Mandapam, New Delhi — February 16, 2026

---

## ✅ Pre-Deployment Checklist

Before deploying, ensure you have:

- [x] **Anthropic API Key** — Get from [console.anthropic.com](https://console.anthropic.com)
- [x] **Vercel Account** — Sign up at [vercel.com](https://vercel.com)
- [x] **GitHub Repository** — Code pushed to GitHub (optional but recommended)
- [x] **All Tests Passing** — Run `npm run test:kavach` → Should see 109/109 ✅

---

## 🎯 Quick Deploy (5 Minutes)

### Option 1: Deploy via Vercel CLI (Fastest)

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Login to Vercel
vercel login

# 3. Deploy from project directory
cd "d:\agentic pot"
vercel --prod

# 4. Set environment variables in Vercel dashboard
# (See "Environment Variables" section below)
```

### Option 2: Deploy via Vercel Dashboard (Easiest)

1. **Go to [vercel.com/new](https://vercel.com/new)**
2. **Import Git Repository** (or upload folder)
3. **Framework Preset:** Select "Other"
4. **Root Directory:** Leave as `/`
5. **Build Command:** Leave empty (no build needed)
6. **Output Directory:** Leave as default
7. **Install Command:** `npm install`
8. Click **"Deploy"**

---

## 🔐 Environment Variables Setup

After deployment, add these in **Vercel Dashboard → Settings → Environment Variables**:

| Variable | Value | Required |
|----------|-------|----------|
| `ANTHROPIC_API_KEY` | `sk-ant-your-actual-key` | ✅ YES |
| `API_KEY` | `fae26946fc2015d9bd6f1ddbb447e2f7` | ✅ YES |
| `GUVI_CALLBACK_URL` | `https://hackathon.guvi.in/api/updateHoneyPotFinalResult` | ✅ YES |
| `LOG_LEVEL` | `info` | ⚠️ Optional |

### How to Add Environment Variables:

1. Go to your Vercel project dashboard
2. Click **Settings** tab
3. Click **Environment Variables** in sidebar
4. Add each variable:
   - **Key:** `ANTHROPIC_API_KEY`
   - **Value:** Your actual Anthropic API key (starts with `sk-ant-`)
   - **Environment:** Select all (Production, Preview, Development)
   - Click **Save**
5. Repeat for `API_KEY` and `GUVI_CALLBACK_URL`
6. **Redeploy** after adding variables (go to Deployments → click ⋯ → Redeploy)

---

## 🧪 Post-Deployment Testing

### 1. Test Health Endpoint

```bash
curl https://your-app.vercel.app/api/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": 1739750400000,
  "version": "2.0.0",
  "endpoints": ["/api/honeypot", "/api/health", "/api/metrics", "/api/shield-report"]
}
```

### 2. Test Honeypot Endpoint

```bash
curl -X POST https://your-app.vercel.app/api/honeypot \
  -H "Content-Type: application/json" \
  -H "x-api-key: fae26946fc2015d9bd6f1ddbb447e2f7" \
  -d '{
    "sessionId": "test-session-123",
    "message": {
      "sender": "scammer",
      "text": "Aapka SBI account aaj band hoga. OTP share karein.",
      "timestamp": 1739750400000
    },
    "conversationHistory": []
  }'
```

**Expected Response:**
```json
{
  "status": "success",
  "sessionId": "test-session-123",
  "reply": "Arrey, kaun bol raha hai? Mera account...",
  "kavach": {
    "scam": { "detected": true, "type": "bank_fraud", "confidence": 0.92 },
    "agent": { "persona": "Savitri Devi, 67, Bhopal", "stage": "GREETING" },
    "language": { "detected": "hinglish", "mirrored": "hinglish" },
    "intel": { "phoneNumbers": [], "upiIds": [] }
  }
}
```

### 3. Test Landing Page

Open in browser: `https://your-app.vercel.app/`

You should see the KAVACH landing page with:
- ✅ Hero section with "कवच KAVACH"
- ✅ Live terminal demo
- ✅ 6 Supremacy Layers features
- ✅ Interactive tester (try sending a Hindi scam message)

---

## 📊 GUVI Submission

### 1. Get Your Deployed URL

After deployment, you'll get a URL like:
```
https://your-app.vercel.app
```

Use this for GUVI submission.

### 2. Submit to GUVI Portal

1. Go to [hackathon.guvi.in](https://hackathon.guvi.in)
2. Navigate to **"API Endpoint Submission for Evaluation"**
3. Fill in:
   - **Deployed URL:** `https://your-app.vercel.app/api/honeypot`
   - **API KEY:** `fae26946fc2015d9bd6f1ddbb447e2f7`
4. Click **"Test Endpoint"** to verify
5. Click **"Submit"**

### 3. GUVI Automated Testing

The GUVI system will:
1. Send multiple scam messages to your endpoint
2. Verify `x-api-key` authentication
3. Check response format and structure
4. Measure `totalMessagesExchanged` (your score: ~12 turns)
5. Validate `extractedIntelligence` fields
6. Check `agentNotes` quality

**Your Competitive Advantages:**
- ✅ **6 Supremacy Layers** vs competitors' basic setup
- ✅ **11+ languages** vs 1-2
- ✅ **3-Tier Response** = endpoint NEVER returns 500
- ✅ **10-15 turns** vs competitor's 4
- ✅ **Cumulative intel** vs single-message extraction
- ✅ **Police-report agentNotes** vs debug logs

---

## 🔧 Troubleshooting

### Issue: "Unauthorized" Error

**Cause:** API key not set in Vercel environment variables  
**Fix:** Add `API_KEY` in Vercel dashboard → Redeploy

### Issue: "Anthropic API Error"

**Cause:** Missing or invalid `ANTHROPIC_API_KEY`  
**Fix:** 
1. Get valid key from console.anthropic.com
2. Add to Vercel environment variables
3. Ensure key starts with `sk-ant-`
4. Redeploy

### Issue: Slow Response (>5 seconds)

**Cause:** Claude API timeout or cold start  
**Fix:** This is normal for Vercel cold starts. After 1-2 requests, responses will be <600ms.

### Issue: 500 Error

**Cause:** Should NEVER happen (3-tier fallback prevents this)  
**Fix:** If you see this, check Vercel logs:
1. Go to Vercel Dashboard → Deployments
2. Click your deployment → Function Logs
3. Look for error messages

### Issue: Landing Page Not Loading

**Cause:** Vercel route configuration  
**Fix:** Verify `vercel.json` has:
```json
{ "src": "/(.*)", "dest": "/public/$1" }
```

---

## ⚡ Performance Optimization (Optional)

Already implemented in KAVACH:
- ✅ **Max 80 tokens** — Claude responses limited
- ✅ **3ms language detection** — Unicode regex, no API calls
- ✅ **In-memory sessions** — No database latency
- ✅ **Non-blocking GUVI callback** — Never slows main response
- ✅ **Smart fallbacks** — 60+ pre-computed responses

Vercel-specific:
- ✅ **512MB memory** for honeypot (vercel.json)
- ✅ **30s max duration** for honeypot (vercel.json)
- ✅ **256MB memory** for other endpoints

---

## 📈 Monitoring (Optional but Recommended)

### View Logs in Real-Time

```bash
vercel logs --follow
```

### Check Deployment Status

```bash
vercel ls
```

### View Function Invocations

Go to Vercel Dashboard → Analytics → Functions

---

## 🎖️ Final Pre-Submission Checklist

Before submitting to GUVI:

- [ ] ✅ Deployed to Vercel successfully
- [ ] ✅ Environment variables set (ANTHROPIC_API_KEY, API_KEY)
- [ ] ✅ Health endpoint returns 200 OK
- [ ] ✅ Honeypot endpoint accepts POST and returns valid JSON
- [ ] ✅ Landing page loads correctly
- [ ] ✅ Tested with Hindi scam message → Got Hindi response
- [ ] ✅ Tested with Tamil scam message → Got Tamil response
- [ ] ✅ Verified `totalMessagesExchanged` increases across turns
- [ ] ✅ Verified `extractedIntelligence` accumulates (UPI, phone, URLs)
- [ ] ✅ URL submitted to GUVI portal
- [ ] ✅ GUVI endpoint test passes

---

## 🏆 Competition Day Preparation

### February 16, 2026 — Bharat Mandapam, New Delhi

**What the Judges Will See:**

1. **Live Demo** — Your landing page at `https://your-app.vercel.app`
2. **API Test** — GUVI automated test results
3. **Code Quality** — GitHub repository (clean structure, 109 tests)
4. **Documentation** — This README + PRESENTATION_DOCUMENT.md

**Your 60-Second Pitch:**

> "Type this into the tester: **'Aapka SBI account aaj band ho jayega. OTP abhi share karo.'**
> 
> Reply appears in under a second: **'Arrey, kaun bol raha hai? Mera SBI ka account toh theek tha kal... kya hua exactly?'**
> 
> She's 67. Her name is Savitri Devi. She's from Bhopal. She's scared.
> 
> Switch to Tamil. Get a Tamil reply instantly.
> 
> KAVACH just wasted that scammer's time. And built this."
> 
> *[Show SHIELD Report with 5 extracted intel items]*
> 
> **"Five lakh scam calls, every day. KAVACH answers every one of them."**

---

## 📞 Support & Resources

- **Vercel Docs:** [vercel.com/docs](https://vercel.com/docs)
- **Anthropic API Docs:** [docs.anthropic.com](https://docs.anthropic.com)
- **GUVI Portal:** [hackathon.guvi.in](https://hackathon.guvi.in)
- **National Cyber Crime Helpline:** 1930
- **Report Scams:** [cybercrime.gov.in](https://cybercrime.gov.in)

---

*KAVACH v2.0 SUPREMACY — Built for Bharat, Built to Win*

**कवच — हर स्कैमर का काल**
