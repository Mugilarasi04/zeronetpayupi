# Deploy ZeroNetPay live

Two hosts:

- **Backend** → Railway (Node.js + SQLite runs unchanged)
- **Frontend** → Firebase Hosting → `https://zeronetpay.web.app`

Total time: ~15 minutes. Both platforms have a free tier that fits this app.

You (not Claude) run all the commands below because they need your login. Claude cannot enter your Firebase / Railway credentials.

---

## Part 1 · Backend on Railway (5 min)

### 1.1 Install Railway CLI

```bash
brew install railway
```

### 1.2 Log in

```bash
railway login
```
This opens a browser tab. Approve the login.

### 1.3 Create a project and deploy

From the repo root (`/Users/mugilarasims/Desktop/zeronetpay`):

```bash
cd /Users/mugilarasims/Desktop/zeronetpay
railway init
```
Pick "Create new project", give it the name **zeronetpay-api**.

```bash
railway up
```
This uploads the code and starts a build. Watch the log; when you see `Deployment successful`, it's live.

### 1.4 Set environment variables

Open the project on the Railway dashboard (URL is printed at the end of `railway up`). Go to **Variables** and add:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `TOKEN_SECRET` | *(paste a random 64-char hex — run `openssl rand -hex 32` in your terminal)* |
| `TOKEN_DENOMINATION` | `1` |
| `ESCROW_UPI_ID` | `mugilarasims@okicici` *(or whichever escrow UPI you want to seed)* |
| `ESCROW_BANK_NAME` | `ZeroNetPay` |

Railway auto-restarts on save.

### 1.5 Generate the public domain

Railway → your project → **Settings → Networking → Generate Domain**.

You'll get something like `https://zeronetpay-api-production.up.railway.app`. **Copy this URL — you need it in Part 2.**

Verify it works:

```bash
curl https://YOUR-URL.up.railway.app/api/health
# → {"ok":true,"time":...}
```

⚠️ **SQLite caveat on Railway free tier:** the container filesystem is ephemeral, so tokens and settlements reset if the container restarts (roughly every deploy or after long idle). Fine for demo. For real persistence, add a Railway Volume (Settings → Volumes, ~$1/mo) mounted at `/app/backend/data` — the SQLite file will survive restarts.

---

## Part 2 · Frontend on Firebase Hosting (10 min)

### 2.1 Install Firebase CLI

```bash
npm install -g firebase-tools
```

### 2.2 Log in

```bash
firebase login
```
Browser opens; approve.

### 2.3 Create a Firebase project

Go to <https://console.firebase.google.com>, click **Add project**, name it **zeronetpay**. Skip Google Analytics. When it finishes, note the **Project ID** shown at the top (something like `zeronetpay-abc12`).

### 2.4 Wire the project ID

Edit `.firebaserc` in the repo root — replace the placeholder:

```json
{
  "projects": {
    "default": "zeronetpay-abc12"
  }
}
```

### 2.5 Point the frontend at your Railway backend

Edit `frontend/config.js` and replace `apiBase`:

```js
window.ZNP_CONFIG = {
  apiBase: 'https://zeronetpay-api-production.up.railway.app/api',
};
```

*(Use the URL you copied at step 1.5. Do include the trailing `/api`.)*

### 2.6 Make sure vendor libraries exist

```bash
cd /Users/mugilarasims/Desktop/zeronetpay
npm install
```
This runs the postinstall script that copies QR code + scanner libs into `frontend/vendor/`. Skip if `frontend/vendor/qrcode-generator.js` already exists.

### 2.7 Deploy

```bash
firebase deploy --only hosting
```

At the end you'll see:
```
Hosting URL: https://zeronetpay-abc12.web.app
```

### 2.8 Claim the zeronetpay subdomain (optional but nice)

Firebase gives you the `zeronetpay-abc12.web.app` URL automatically. To also get **`https://zeronetpay.web.app`** (the pretty one):

1. Firebase console → Hosting → **Add custom domain** → type `zeronetpay.web.app`
2. It's yours for free if no one else has taken it. If taken, pick a variant like `zeronetpay-app.web.app`.

Or use your own real domain (`zeronetpay.in` etc.) — Firebase gives you the exact DNS records to point at.

---

## Part 3 · Verify end-to-end (2 min)

Open the Firebase URL on your phone:

```
https://zeronetpay.web.app
```

Do the full loop: **Onboard → Load ₹1 → Pay (offline) → Cash out**. If any API call fails, open the browser DevTools → Network tab → check the fetch URL. It should hit your Railway host, not localhost.

---

## Troubleshooting

**Frontend loads but every API call fails with CORS error.**
Backend already sends `Access-Control-Allow-Origin: *` (via `cors()`), so this shouldn't happen. If it does, double-check that `apiBase` in `frontend/config.js` has the full `https://...` URL and ends with `/api`.

**Railway build fails with "SqliteError: SQLITE_CANTOPEN".**
The `backend/data/` directory isn't being created. Fix: change `dbPath` in `backend/lib/config.js` to ensure `mkdirSync` runs before opening. Already handled by the `resolveTokenSecret` path — should be fine.

**Firebase deploy says "no project active".**
You skipped step 2.4 — the placeholder in `.firebaserc` is still there. Edit it to your real project ID.

**Camera doesn't open on iPhone.**
iOS requires HTTPS + user tap. Both are true here. If it still fails, tap the Aa in the URL bar → Website Settings → Camera → Allow.

**Wallet resets after a while.**
That's Railway free tier ephemeral filesystem. Add a Volume (see step 1.5 caveat).

---

## What changes if you buy a real domain later

Only Firebase Hosting needs to know about the custom domain. Railway URL stays the same. Steps:

1. Buy `zeronetpay.in` (or similar) from GoDaddy / Cloudflare Registrar (~₹700-1500/year)
2. Firebase console → Hosting → Custom domain → paste your domain
3. Firebase gives you two A records → add them at your domain registrar
4. Wait 15-60 min for SSL provisioning
5. Done — `https://zeronetpay.in` serves your app
