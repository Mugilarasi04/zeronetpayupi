# Complete Deploy — zeronetpayupi.com

**Plan:**
- **GitHub** hosts the code
- **Render** deploys the backend from GitHub (auto-redeploys on push)
- **Cloudflare Pages** deploys the frontend
- **zeronetpayupi.com** points at Cloudflare Pages

Total time: **~20 minutes**. Every step is a click or a single copy-paste command.

---

# PART 1 · Push code to GitHub (5 min)

## Step 1.1 · Install GitHub CLI (one-time)

Open Terminal:

```bash
brew install gh
```

## Step 1.2 · Log in to GitHub

```bash
gh auth login
```

At the prompts:
- **What account?** → `GitHub.com`
- **What protocol?** → `HTTPS`
- **Authenticate Git?** → `Yes`
- **How to authenticate?** → `Login with a web browser`

It'll show a one-time code like `ABCD-1234`. Copy it, press Enter, browser opens, paste the code, approve.

Back in terminal: `✓ Logged in as YOUR_USERNAME`

## Step 1.3 · Initialize the repo

```bash
cd /Users/mugilarasims/Desktop/zeronetpay
```

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Initial deploy"
```

## Step 1.4 · Create the GitHub repo and push

```bash
gh repo create zeronetpay --public --source=. --remote=origin --push
```

Done. Your code is on GitHub at `https://github.com/YOUR_USERNAME/zeronetpay`.

---

# PART 2 · Deploy backend on Render (7 min)

Render is free, deploys from GitHub, and uses our Dockerfile automatically. Docker guarantees Node 24 (works with `--experimental-sqlite`).

## Step 2.1 · Sign up for Render

Go to <https://render.com>

Click **"Get Started"** → **"Sign in with GitHub"** → authorize.

## Step 2.2 · Create the web service

1. On your Render dashboard → click **"+ New"** (top right) → **"Web Service"**
2. Under **"Connect a repository"**, find `zeronetpay` in the list → click **Connect**
3. Fill in the form:

| Field | Value |
|---|---|
| **Name** | `zeronetpay-api` |
| **Region** | `Singapore` (closest to India) |
| **Branch** | `main` |
| **Runtime** | Should auto-detect as **Docker** ✅ |
| **Instance Type** | **Free** |

Leave everything else default.

## Step 2.3 · Add environment variables

Scroll to **"Environment Variables"** section, click **"Add Environment Variable"** for each row:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `TOKEN_DENOMINATION` | `1` |
| `ESCROW_UPI_ID` | `mugilarasims@okicici` |
| `ESCROW_BANK_NAME` | `ZeroNetPay` |
| `ESCROW_LOCKED` | `true` |
| `TOKEN_SECRET` | `paste-a-long-random-hex-string-here` (see below) |

For `TOKEN_SECRET`, open a new Terminal tab and run:

```bash
openssl rand -hex 32
```

Copy the 64-char string it prints and paste it as the value.

## Step 2.4 · Deploy

Scroll to bottom → click **"Deploy Web Service"** (big blue button).

Wait 3-5 minutes. You'll see the Docker build log stream. When you see:
```
==> Your service is live 🎉
```

At the top of the page there's a URL like:
```
https://zeronetpay-api.onrender.com
```

**📋 COPY THAT URL** — you need it in Part 3.

## Step 2.5 · Test the backend

```bash
curl https://zeronetpay-api.onrender.com/api/health
```

Should return: `{"ok":true,"time":...}`

```bash
curl https://zeronetpay-api.onrender.com/api/settings
```

Should return escrow config with `"locked":true`. ✅ Backend done.

**⚠️ Note:** Render free tier sleeps after 15 min of inactivity. First request after sleep takes ~30 seconds. Fine for demo, upgrade to $7/mo for always-on if needed later.

---

# PART 3 · Point frontend at Render backend (1 min)

Open `/Users/mugilarasims/Desktop/zeronetpay/frontend/config.js` in VS Code. Change to:

```js
window.ZNP_CONFIG = {
  apiBase: 'https://zeronetpay-api.onrender.com/api',
};
```

Save.

Commit and push so GitHub has the latest:

```bash
cd /Users/mugilarasims/Desktop/zeronetpay
git add frontend/config.js
git commit -m "Point frontend at Render backend"
git push
```

---

# PART 4 · Deploy frontend on Cloudflare Pages (5 min)

## Step 4.1 · Open Cloudflare Pages

<https://dash.cloudflare.com/?to=/:account/workers-and-pages>

Sign in with the account that owns `zeronetpayupi.com`.

## Step 4.2 · Create a Pages project connected to GitHub

1. Click **"Create application"** (top right) → **"Pages"** tab → **"Connect to Git"**
2. Click **"Connect GitHub"** → authorize Cloudflare on GitHub → select your `zeronetpay` repo → click **"Begin setup"**
3. Fill in the form:

| Field | Value |
|---|---|
| **Project name** | `zeronetpayupi` |
| **Production branch** | `main` |
| **Framework preset** | `None` |
| **Build command** | *(leave blank)* |
| **Build output directory** | `frontend` |
| **Root directory** | *(leave blank)* |

## Step 4.3 · Deploy

Click **"Save and Deploy"**.

Wait ~30 seconds. You'll see: **"Success! Your site is live"** with URL:
```
https://zeronetpayupi.pages.dev
```

Frontend is live ✅ — every future `git push` to `main` auto-deploys.

## Step 4.4 · Test on your phone

Open `https://zeronetpayupi.pages.dev` on your phone. The whole app should load and work end-to-end (lock screen, load, pay offline, cashout).

---

# PART 5 · Attach zeronetpayupi.com custom domain (2 min + SSL)

In the Cloudflare Pages project **`zeronetpayupi`**:

1. Top tabs → **"Custom domains"**
2. Click **"Set up a custom domain"**
3. Type: **`zeronetpayupi.com`** → Continue
4. Cloudflare detects you own it → click **"Activate domain"**
5. Wait 30-90 seconds for SSL

Repeat for **`www.zeronetpayupi.com`** (same steps).

## Step 5.1 · Verify

Open on your phone: **https://zeronetpayupi.com**

Full app, real domain, real HTTPS, real backend on Render, real frontend on Cloudflare. ✅

---

# ✅ Post-deploy checklist

Test each on your phone:

- [ ] Lock screen appears on first visit
- [ ] Set a PIN (4-6 digits) → unlocks
- [ ] Onboard with your UPI ID
- [ ] Load ₹1 → real UPI QR to `mugilarasims@okicici` → pay → tap "I've paid"
- [ ] Pay tab → ₹1 → biometric/PIN → QR appears
- [ ] Friend's phone: onboard → Receive tab → scan QR → tokens received
- [ ] Friend's phone: Cash out → biometric → UPI deeplink opens

---

# 🔁 Redeploy later

Any code change:

```bash
git add .
git commit -m "your change description"
git push
```

Both Render (backend) and Cloudflare Pages (frontend) auto-redeploy in ~1 min. Zero manual work.

---

# 💰 Costs

| Item | Cost |
|---|---|
| GitHub | Free |
| Render backend (free tier) | $0/mo (sleeps after 15min idle) |
| Render backend (always-on) | $7/mo (optional) |
| Cloudflare Pages | Free (unlimited bandwidth) |
| Cloudflare DNS + SSL | Free |
| `zeronetpayupi.com` | ~$9/yr (already paid) |
| **Ongoing** | **$9/yr + optional $7/mo** |

---

# 🚑 If anything fails

Paste back to me:
- Which step number
- Exact error text or screenshot
- Which service (Render / Cloudflare / GitHub)

I'll fix it immediately.

**Start with Step 1.1 — `brew install gh`**
