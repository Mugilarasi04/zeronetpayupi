# Deploy ZeroNetPay live at https://zeronetpayupi.com

**Goal:** frontend served at `https://zeronetpayupi.com`, backend on Railway. Total time: ~15 min.

Since you own `zeronetpayupi.com` on Cloudflare Registrar, we use:
- **Cloudflare Pages** for the frontend (same account as your domain — DNS auto-wires)
- **Railway** for the backend (keeps SQLite + Node code as-is)

Copy-paste every command below. You (not Claude) run them — Claude can never enter your login credentials.

---

## Part 1 · Backend on Railway (5 min)

### 1. Install Railway CLI

```bash
brew install railway
```

### 2. Log in

```bash
railway login
```
Browser opens → approve.

### 3. Deploy from the project root

```bash
cd /Users/mugilarasims/Desktop/zeronetpay
railway init
```
When prompted:
- **Create new project**
- Name: `zeronetpay-api`
- Environment: `production`

```bash
railway up --detach
```
Wait ~60 seconds. Watch the log; when you see `Deployment successful`, backend is live but not yet publicly reachable.

### 4. Set environment variables

```bash
railway variables --set NODE_ENV=production \
  --set TOKEN_DENOMINATION=1 \
  --set ESCROW_UPI_ID=mugilarasims@okicici \
  --set ESCROW_BANK_NAME=ZeroNetPay \
  --set ESCROW_LOCKED=true \
  --set TOKEN_SECRET=$(openssl rand -hex 32)
```

(That last line generates a fresh 64-char hex secret and pins it — you never see it, it just goes to Railway.)

### 5. Generate a public URL

```bash
railway domain
```
Railway prints something like `https://zeronetpay-api-production-abc1.up.railway.app`.

**Copy that URL.** You need it in Part 2.

### 6. Verify backend

```bash
curl https://YOUR-URL-FROM-STEP-5.up.railway.app/api/health
# → {"ok":true,"time":...}
```

---

## Part 2 · Frontend on Cloudflare Pages (7 min)

### 7. Install Wrangler (Cloudflare CLI)

```bash
npm install -g wrangler
```

### 8. Log in

```bash
wrangler login
```
Browser opens → approve on your Cloudflare account (same one that owns zeronetpayupi.com).

### 9. Point frontend at Railway backend

Edit `frontend/config.js` — replace `apiBase` with your Railway URL from step 5 (include the trailing `/api`):

```js
window.ZNP_CONFIG = {
  apiBase: 'https://zeronetpay-api-production-abc1.up.railway.app/api',
};
```

### 10. Make sure vendor libs are present

```bash
cd /Users/mugilarasims/Desktop/zeronetpay
npm install
```

### 11. Deploy to Cloudflare Pages

```bash
wrangler pages deploy frontend --project-name=zeronetpayupi --branch=main
```

At the end you'll see:
```
✨ Deployment complete! Take a peek over at:
https://zeronetpayupi.pages.dev
```

That subdomain is your app. Custom domain next.

---

## Part 3 · Wire custom domain (3 min + SSL wait)

### 12. Attach zeronetpayupi.com to Cloudflare Pages

1. Go to <https://dash.cloudflare.com>
2. **Workers & Pages** → click **zeronetpayupi** (the project you just deployed)
3. **Custom domains** tab → click **Set up a custom domain**
4. Type: **`zeronetpayupi.com`** → click **Continue**
5. Cloudflare auto-detects that the domain is in your account and offers to configure DNS. Click **Activate domain**.
6. It'll say "Setting up..." and provision SSL. Takes 30 seconds to 2 minutes.

### 13. Also attach the www subdomain

Repeat step 12 with **`www.zeronetpayupi.com`** — Cloudflare handles the redirect automatically.

### 14. Verify live

```bash
curl -sI https://zeronetpayupi.com | head -3
# → HTTP/2 200
```

Open <https://zeronetpayupi.com> in Safari on your phone. The app loads. Camera works. Biometric works. Real UPI works.

---

## Part 4 · Post-deploy checklist

Once <https://zeronetpayupi.com> loads, verify each feature quickly:

- [ ] Lock screen appears on first open
- [ ] Onboard with your UPI ID
- [ ] Load ₹1 → real UPI QR to `mugilarasims@okicici`
- [ ] Pay offline (airplane mode both sides) → receiver scans QR → "Sent ✓"
- [ ] Receiver's wallet shows ₹1 → Cash out → UPI deeplink opens

If any step fails, DevTools → Network tab → check the fetch URL. It should be `zeronetpay-api-production-*.up.railway.app`, not localhost.

---

## Troubleshooting

**"Not deployed" on Cloudflare Pages custom-domain screen**
Refresh the page. Sometimes takes 30s to detect the DNS records after step 12.

**API calls return CORS errors**
Backend already sends `Access-Control-Allow-Origin: *` (via `cors()` middleware). If you still see errors, double-check that `apiBase` in `frontend/config.js` includes `https://` and ends with `/api`.

**Wallet resets after a day**
Railway's free tier has ephemeral disk storage — SQLite data disappears on container restart. Fix: **Railway dashboard → Volumes → New Volume → mount at `/app/backend/data`** (~$1/mo).

**"Bad Gateway" from Cloudflare**
Railway is asleep. Free tier sleeps after inactivity. First request wakes it, takes ~10 seconds. Subsequent requests are instant.

**Custom domain stuck at "Verifying..."**
Cloudflare Pages auto-adds DNS records. If it hangs >5 min, go to **DNS → Records** manually and check for the `CNAME` record pointing to `zeronetpayupi.pages.dev`. Delete any conflicting old A records.

---

## Total costs

| Item | Cost |
|---|---|
| `zeronetpayupi.com` domain | ~$9/yr (~₹800) |
| Cloudflare Pages | Free (unlimited bandwidth) |
| Cloudflare DNS + SSL | Free |
| Railway backend | Free tier (500 hrs/mo). Paid $5/mo if you exceed |
| **Total ongoing** | **₹800/yr + optional $5/mo** |

---

## Redeploy later (only 2 commands)

Every time you change the frontend:
```bash
wrangler pages deploy frontend --project-name=zeronetpayupi --branch=main
```

Every time you change the backend:
```bash
railway up --detach
```

That's it.
