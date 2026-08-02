# ZeroNetPay — Offline UPI

> UPI that works like WhatsApp — send money anytime, it delivers when they come online.

A complete reference implementation of device-bound digital token payments
on top of UPI. The system mints HMAC-signed tokens against an escrow
account, transfers them peer-to-peer over QR (with both phones offline),
and auto-settles to the receiver's UPI ID when either device next sees
internet.

## What's in the box

- **Node.js / Express** backend with SQLite (zero external services).
- **Progressive Web App** frontend — installs on Android, iOS, and desktop. No native build required.
- **HMAC-SHA256** signed tokens with double-spend protection.
- **Offline-first** wallet using IndexedDB; transfers via dynamic QR codes (multi-frame for larger amounts).
- **Auto-settlement** when the receiver next has internet — happens silently in the background.
- **Live escrow audit endpoint** — proves `escrow_balance == sum(unspent_tokens)` at all times.
- **Docker** image for one-command deploy to any host.

## Run it locally

```bash
# Requires Node.js >= 18 (tested on Node 20 / 26)
npm install        # also copies QR libs into frontend/vendor
npm start
```

Open <http://localhost:3000> on your laptop. Open the same address on
phones connected to the same Wi-Fi (replace `localhost` with your laptop's
LAN IP — e.g. `http://192.168.1.20:3000`) to install the app on each
device. The app prompts to add to home screen; tap "Install" or
"Add to Home Screen".

> **Note on mobile camera access:** browsers require HTTPS for the camera
> API (or the `localhost` exception). For testing across devices, run the
> app over HTTPS via a tunnel (e.g. `ngrok http 3000`) or self-signed cert.
> For the demo flow you can also load tokens on Phone A while online, then
> switch both phones to airplane mode and complete the transfer.

## Run it on a server (Docker)

```bash
docker build -t zeronetpay .
docker run -d \
  -p 3000:3000 \
  -e TOKEN_SECRET="$(openssl rand -hex 64)" \
  -v zeronetpay-data:/app/backend/data \
  --name zeronetpay zeronetpay
```

Deploy the resulting image to Render, Railway, Fly.io, AWS App Runner,
or any host that runs containers. The SQLite database lives in
`/app/backend/data` — back this up periodically.

## Configuration

Copy `.env.example` to `.env` and set:

| Variable             | Default                    | Notes                              |
| -------------------- | -------------------------- | ---------------------------------- |
| `PORT`               | `3000`                     |                                    |
| `HOST`               | `0.0.0.0`                  | Bind address                       |
| `TOKEN_SECRET`       | auto-generated, persisted  | Use a 64-char random hex in prod   |
| `TOKEN_DENOMINATION` | `10`                       | Each token is worth this many ₹    |
| `TOKEN_EXPIRY_DAYS`  | `30`                       | Tokens auto-expire and refund      |
| `ESCROW_BANK_NAME`   | `ZeroNetPay Escrow`        | Cosmetic                           |

## API surface

| Method | Path                       | Purpose                                         |
| ------ | -------------------------- | ----------------------------------------------- |
| POST   | `/api/auth/register`       | Link a UPI ID to this device                    |
| GET    | `/api/auth/lookup`         | Resolve a device fingerprint to a user          |
| POST   | `/api/load/create`         | Create a load order; returns a UPI deeplink     |
| POST   | `/api/load/confirm`        | Mock bank webhook → mints signed tokens         |
| GET    | `/api/load/status/:id`     | Poll a load order                               |
| POST   | `/api/redeem`              | Settle a batch of received tokens               |
| POST   | `/api/preflight`           | Non-committing freshness check                  |
| GET    | `/api/audit`               | Returns escrow balance and circulation totals   |
| GET    | `/api/user/:id/history`    | Loads + settlements for a user                  |
| GET    | `/api/user/:id/tokens`     | Server-side token records (for debug)           |
| GET    | `/api/health`              | Liveness                                        |

## Design notes

**Why HMAC and not asymmetric signatures?**
For a self-contained reference build HMAC keeps the keying simple — the
backend is the only signer and the only verifier of token authenticity at
redemption. A production deployment should switch to ECDSA so receivers
can verify offline against a published public key without trusting the
sender's claim.

**Why SQLite?**
Zero deps, zero ops; runs on a phone, a laptop, or a $5 VM. WAL mode
gives concurrent readers + a single writer, which is exactly the shape of
this workload. Swap in Postgres by replacing `lib/db.js` if you need
horizontal scale.

**Why a PWA and not React Native / Flutter?**
The user requirement was *"works on every device, not just my laptop"*.
A PWA installs natively on Android, iOS (16.4+), Windows, macOS, Linux,
and ChromeOS — one codebase, no app stores, no notarisation, no
provisioning profiles. The downsides (Web NFC limited on iOS, BLE
peer-to-peer limited on iOS) don't matter for the QR-based offline
transfer flow.

## Demo script (the 90-second hackathon flow)

1. Open the app on Phone A. Onboard with `ravi@okicici`.
2. Tap **Load** → enter ₹200 → tap **Open UPI app** (or skip via the
   **I've paid** button for the demo) → tokens arrive.
3. Open the app on Phone B with `merchant@okhdfc`.
4. **Both phones to airplane mode.**
5. Phone A: tap **Pay** → enter ₹100 → enter PIN → QR appears.
6. Phone B: tap **Receive** → camera opens → scan the QR → "Payment
   received" toast appears with no internet.
7. Turn airplane mode off on Phone B only.
8. Within ~1 second the app silently settles the tokens; the home screen
   shows **Settled to merchant@okhdfc** and the audit endpoint
   (`/api/audit`) confirms the invariant still holds.

## License

MIT
