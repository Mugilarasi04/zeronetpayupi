#!/usr/bin/env python3
"""
Build the ZeroNetPay demo brief as a polished PDF.
Sections:
  1. Cover
  2. Executive summary
  3. Live URLs & credentials
  4. User walkthrough (step-by-step demo script)
  5. System workflow / architecture
  6. Tech stack (frontend, backend, ops)
  7. Feature checklist
  8. Q & A — technical, security, business, regulatory
"""

from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    PageBreak,
    Table,
    TableStyle,
    KeepTogether,
    HRFlowable,
    ListFlowable,
    ListItem,
)

OUT = Path(__file__).resolve().parents[1] / "docs" / "ZeroNetPay_Brief.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

# ---------- Styles ----------
BLUE = colors.HexColor("#0f2c5a")
ACCENT = colors.HexColor("#2c7bff")
LIGHT_BG = colors.HexColor("#f2f6ff")
MUTED = colors.HexColor("#5b6b85")
GOOD = colors.HexColor("#137a35")

base = getSampleStyleSheet()

def style(name, base_name, **kw):
    s = ParagraphStyle(name, parent=base[base_name])
    for k, v in kw.items():
        setattr(s, k, v)
    return s

s_cover_title = style("CoverTitle", "Title", fontSize=42, leading=48, textColor=BLUE, alignment=TA_CENTER, spaceAfter=8)
s_cover_sub   = style("CoverSub", "Title", fontSize=16, leading=22, textColor=ACCENT, alignment=TA_CENTER, spaceAfter=24, fontName="Helvetica")
s_cover_tag   = style("CoverTag", "Normal", fontSize=13, leading=18, textColor=MUTED, alignment=TA_CENTER)
s_h1          = style("H1", "Heading1", fontSize=22, leading=26, textColor=BLUE, spaceBefore=20, spaceAfter=10)
s_h2          = style("H2", "Heading2", fontSize=15, leading=20, textColor=ACCENT, spaceBefore=14, spaceAfter=6)
s_h3          = style("H3", "Heading3", fontSize=12, leading=16, textColor=BLUE, spaceBefore=10, spaceAfter=4)
s_body        = style("Body", "BodyText", fontSize=10.5, leading=15, alignment=TA_JUSTIFY, spaceAfter=6)
s_bullet      = style("Bullet", "BodyText", fontSize=10.5, leading=15, spaceAfter=3, leftIndent=14)
s_qa_q        = style("QA_Q", "BodyText", fontSize=10.5, leading=15, textColor=BLUE, spaceAfter=3, fontName="Helvetica-Bold")
s_qa_a        = style("QA_A", "BodyText", fontSize=10.5, leading=15, alignment=TA_JUSTIFY, spaceAfter=10)
s_code        = style("Code", "Code", fontSize=9.5, leading=13, textColor=colors.HexColor("#0d2b5a"), backColor=LIGHT_BG, borderPadding=6, spaceAfter=8)
s_muted       = style("Muted", "BodyText", fontSize=9, leading=12, textColor=MUTED, alignment=TA_CENTER)
s_pill        = style("Pill", "BodyText", fontSize=9, textColor=colors.white, alignment=TA_CENTER)

# ---------- Content helpers ----------
def hr():
    return HRFlowable(width="100%", thickness=0.5, color=ACCENT, spaceBefore=6, spaceAfter=6)

def small_table(data, col_widths, header_bg=BLUE):
    t = Table(data, colWidths=col_widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, -1), 9.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#dfe6f5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t

def bullet_list(items):
    return ListFlowable(
        [ListItem(Paragraph(x, s_bullet), bulletColor=ACCENT) for x in items],
        bulletType="bullet",
        start="•",
        leftIndent=16,
        bulletFontSize=10,
    )

def qa(q, a):
    return KeepTogether([
        Paragraph("Q. " + q, s_qa_q),
        Paragraph("A. " + a, s_qa_a),
    ])

# ---------- Doc setup ----------
def on_first_page(canvas_obj, doc):
    canvas_obj.saveState()
    # Big accent bar top of cover.
    canvas_obj.setFillColor(BLUE)
    canvas_obj.rect(0, doc.pagesize[1] - 25 * mm, doc.pagesize[0], 25 * mm, fill=1, stroke=0)
    canvas_obj.setFillColor(colors.white)
    canvas_obj.setFont("Helvetica-Bold", 12)
    canvas_obj.drawString(20 * mm, doc.pagesize[1] - 15 * mm, "ZeroNetPay")
    canvas_obj.setFont("Helvetica", 10)
    canvas_obj.drawRightString(doc.pagesize[0] - 20 * mm, doc.pagesize[1] - 15 * mm, "Demo brief · Aug 2026")
    canvas_obj.restoreState()

def on_later_pages(canvas_obj, doc):
    canvas_obj.saveState()
    canvas_obj.setFillColor(BLUE)
    canvas_obj.rect(0, doc.pagesize[1] - 15 * mm, doc.pagesize[0], 15 * mm, fill=1, stroke=0)
    canvas_obj.setFillColor(colors.white)
    canvas_obj.setFont("Helvetica-Bold", 10)
    canvas_obj.drawString(20 * mm, doc.pagesize[1] - 10 * mm, "ZeroNetPay · Demo brief")
    canvas_obj.setFont("Helvetica", 9)
    canvas_obj.drawRightString(doc.pagesize[0] - 20 * mm, doc.pagesize[1] - 10 * mm, f"Page {doc.page}")
    # Footer.
    canvas_obj.setFillColor(MUTED)
    canvas_obj.setFont("Helvetica", 8)
    canvas_obj.drawString(20 * mm, 10 * mm, "https://upizeronetpay.pages.dev  ·  Backend: zeronetpayupi.onrender.com")
    canvas_obj.restoreState()

doc = SimpleDocTemplate(
    str(OUT),
    pagesize=A4,
    leftMargin=20 * mm,
    rightMargin=20 * mm,
    topMargin=28 * mm,
    bottomMargin=18 * mm,
    title="ZeroNetPay — Demo Brief",
    author="ZeroNetPay",
)

story = []

# ---------- 1. Cover ----------
story.append(Spacer(1, 55 * mm))
story.append(Paragraph("ZeroNetPay", s_cover_title))
story.append(Paragraph("Offline UPI · Device-Bound Digital Token Payments", s_cover_sub))
story.append(Paragraph(
    "A cryptographic layer on top of UPI that works with zero internet on both sides.<br/>"
    "Load once online. Pay offline. Cash out when either side reconnects.",
    s_cover_tag,
))
story.append(Spacer(1, 30 * mm))
story.append(Paragraph(
    "<b>Live demo:</b> <font color='#2c7bff'>https://upizeronetpay.pages.dev</font><br/>"
    "<b>Backend:</b> <font color='#2c7bff'>https://zeronetpayupi.onrender.com</font><br/>"
    "<b>Repo:</b> <font color='#2c7bff'>github.com/Mugilarasi04/zeronetpayupi</font>",
    s_cover_tag,
))
story.append(Spacer(1, 40 * mm))
story.append(Paragraph(
    "Prepared for hackathon demo · Aligned with RBI Regulatory Sandbox Cohort 5",
    s_muted,
))
story.append(PageBreak())

# ---------- 2. Executive summary ----------
story.append(Paragraph("1. Executive summary", s_h1))
story.append(hr())
story.append(Paragraph(
    "400 million Indians use UPI daily, yet every payment fails the moment the network drops — "
    "metros, tunnels, hill stations, stadiums, rural belts. Existing offline solutions (UPI Lite, "
    "CBDC offline, USSD) share one critical flaw: they all require at least one side of the "
    "transaction to be online. Nobody has solved true peer-to-peer offline payment.",
    s_body,
))
story.append(Paragraph(
    "<b>ZeroNetPay is the offline layer UPI never had.</b> Users link their existing UPI ID once. "
    "Money converts into cryptographically-signed digital tokens stored only on the device. Tokens "
    "transfer between phones offline via QR (both phones in airplane mode). When any holder returns "
    "online, tokens redeem to real money in their bank — with no manual reconciliation.",
    s_body,
))
story.append(Paragraph("Why now", s_h2))
story.append(bullet_list([
    "<b>RBI Regulatory Sandbox Cohort 5</b> explicitly targets offline / rural payment solutions.",
    "600 million Indians live with patchy connectivity — the addressable market is the whole country.",
    "Real UPI on-ramp + real UPI off-ramp already work via existing bank rails — no NPCI cooperation needed for MVP.",
    "Cryptographic escrow custody with a mathematical invariant makes the model auditable end-to-end.",
]))

# ---------- 3. Live URLs & credentials ----------
story.append(Paragraph("2. Live URLs &amp; demo credentials", s_h1))
story.append(hr())
story.append(small_table([
    ["Component", "URL / value"],
    ["Frontend (PWA)",       "https://upizeronetpay.pages.dev"],
    ["Backend (REST API)",   "https://zeronetpayupi.onrender.com"],
    ["Escrow UPI ID",        "mugilarasims@okicici (env-locked)"],
    ["Escrow WhatsApp",      "+91 73059 67141 (AKSHAYAKUMAR T)"],
    ["Health check",         "GET /api/health → {\"ok\": true}"],
    ["Audit invariant",      "GET /api/audit → escrow == circulating tokens"],
], [55 * mm, 110 * mm]))

# ---------- 4. Walkthrough ----------
story.append(PageBreak())
story.append(Paragraph("3. User walkthrough — the 90-second demo", s_h1))
story.append(hr())

story.append(Paragraph("Setup", s_h2))
story.append(Paragraph(
    "Two phones (or two Safari tabs): one is the <b>sender</b>, one is the <b>receiver</b>. "
    "Both open <font color='#2c7bff'>https://upizeronetpay.pages.dev</font> once while online so the "
    "PWA shell caches. From this point, most steps run offline.",
    s_body,
))

story.append(Paragraph("Step 1 — Onboard (~15 seconds each)", s_h3))
story.append(bullet_list([
    "Enter your UPI ID (this is where cashouts land).",
    "Enter your phone number with country code (used for WhatsApp notifications and complaints).",
    "Set a 4-6 digit PIN. Biometric (Touch ID / Face ID / fingerprint) auto-enrols on the first payment.",
    "You are locked out on every tab close until PIN or biometric — no OTP.",
]))

story.append(Paragraph("Step 2 — Load (only step that needs internet, ~30 sec)", s_h3))
story.append(bullet_list([
    "Tap <b>Load</b> → enter amount → the app shows a UPI QR pointing to the escrow account.",
    "Scan with your real UPI app (GPay / PhonePe / WhatsApp Pay / BHIM) and pay.",
    "Take a screenshot of the &quot;Payment successful&quot; screen.",
    "Return to the app → upload the screenshot → tokens are minted to your device.",
]))

story.append(Paragraph("Step 3 — Offline transfer (airplane mode, ~10 sec)", s_h3))
story.append(bullet_list([
    "Both phones toggle <b>Airplane Mode ON</b>.",
    "Sender: <b>Pay</b> tab → amount → biometric → QR appears. Tokens stay in wallet until confirmed sent.",
    "Receiver: <b>Receive</b> tab → camera decodes the QR in one frame → &quot;Payment received&quot;.",
    "Sender: taps <b>Sent ✓</b> — tokens leave sender's wallet, appear in receiver's wallet.",
    "Fallback if QR won't scan: sender shows a <b>6-digit pair code</b>, receiver types it in.",
]))

story.append(Paragraph("Step 4 — Cash out (needs internet again, ~20 sec)", s_h3))
story.append(bullet_list([
    "Turn airplane mode OFF on receiver's phone.",
    "Cash out tab → enter amount → biometric → server marks tokens spent, creates a payout row.",
    "App opens WhatsApp with a message to the escrow operator: &quot;Please release my ₹X payout, ref STL_...&quot;",
    "Escrow operator's phone: Disburse view → taps <b>Pay now</b> → their UPI app pays receiver → taps <b>Mark as paid</b>.",
    "WhatsApp auto-opens with a &quot;Payout sent, ref XYZ&quot; message to the receiver.",
    "Receiver's <b>My cashouts</b> tab flips from ⏳pending to ✓paid within 10 seconds.",
]))

story.append(Paragraph("Step 5 — Recovery paths (built-in)", s_h3))
story.append(bullet_list([
    "<b>Cascade transfers:</b> received tokens are spendable — receiver can pay a third person offline; last holder to redeem wins.",
    "<b>Self-verify:</b> if the escrow forgets to mark paid, receiver taps <b>✓ I received the money</b> to close the row.",
    "<b>Complaint:</b> after 1 hour of no payout, receiver taps <b>Raise complaint</b> — the escrow operator's dashboard turns red.",
    "<b>Double-spend guard:</b> if the same tokens are replayed, backend returns already_spent — first cashout wins.",
]))

# ---------- 5. Architecture ----------
story.append(PageBreak())
story.append(Paragraph("4. System workflow &amp; architecture", s_h1))
story.append(hr())

story.append(Paragraph("Data flow", s_h2))
story.append(small_table([
    ["Stage", "What happens", "Online?"],
    ["Load",  "Real UPI payment to escrow → backend mints signed tokens → tokens saved to device IndexedDB.", "Yes"],
    ["Pay (sender)",  "Wallet selects tokens FIFO → biometric auth → QR frames encode signed payload.", "No"],
    ["Receive",       "Camera decodes QR (or 6-digit pair code) → receiver's IndexedDB stores tokens.", "No"],
    ["Cascade",       "Received tokens become spendable — receiver may pay a third party offline.", "No"],
    ["Cash out",      "Receiver POSTs tokens to /api/redeem → server verifies signature + not-spent + not-expired → creates settlement.", "Yes"],
    ["Disburse",      "Escrow operator taps Pay now → real UPI payout to receiver → marks paid.", "Yes"],
], [24 * mm, 100 * mm, 22 * mm]))

story.append(Paragraph("Cryptographic invariant", s_h2))
story.append(Paragraph(
    "Every token is signed as <font face='Courier'>HMAC-SHA256(secret, id || value_paise || issued_to_user_id || "
    "issued_to_device || issued_at || expires_at)</font>. Only the backend holds the secret, so tokens are "
    "unforgeable. The escrow ledger holds a strict invariant:",
    s_body,
))
story.append(Paragraph(
    "<b>escrow_balance == sum(value_paise WHERE spent = 0)</b>",
    s_qa_a,
))
story.append(Paragraph(
    "Live at <font color='#2c7bff'>GET /api/audit</font>. If the invariant ever breaks (which it never does under normal operation), "
    "the endpoint returns <font face='Courier'>invariantHolds: false</font> — a machine-verifiable trust signal.",
    s_body,
))

story.append(Paragraph("Security guards (implemented)", s_h2))
story.append(small_table([
    ["Threat", "Defence"],
    ["Fake tokens",              "HMAC-SHA256 — only backend can sign. Bad signatures rejected at redeem."],
    ["Double-spend",             "First redemption marks spent; second attempt returns already_spent."],
    ["Expired tokens",           "30-day TTL enforced at redeem. Expired tokens can be refunded."],
    ["Phone theft / QR reuse",   "Each payment requires biometric or PIN before the QR is generated."],
    ["Session hijack",           "App locks on every tab close — biometric or PIN to unlock; not cookie-based."],
    ["Escrow tampering",         "ESCROW_LOCKED env freezes the escrow UPI ID; PUT rejected with 403."],
    ["Payout dispute",           "1-hour complaint gate; escrow operator sees red banner + note."],
], [55 * mm, 110 * mm]))

# ---------- 6. Tech stack ----------
story.append(PageBreak())
story.append(Paragraph("5. Tech stack", s_h1))
story.append(hr())

story.append(Paragraph("Frontend (PWA)", s_h2))
story.append(small_table([
    ["Layer", "Choice", "Why"],
    ["Runtime",         "Vanilla ES modules, no bundler",  "Zero build step; every browser runs it natively."],
    ["Rendering",       "Hand-rolled component functions", "No framework overhead; predictable DOM churn."],
    ["Offline shell",   "Service Worker (cache v25)",      "App loads with no internet after first visit."],
    ["Local storage",   "IndexedDB (znp DB)",              "Persists tokens + ledger across app restarts."],
    ["QR generation",   "qrcode-generator (vendored)",     "Client-side single-frame QR up to 1500 bytes per frame."],
    ["QR scanning",     "jsQR (vendored)",                 "Pure-JS decoder; works offline in the camera loop."],
    ["Biometric",       "Web Authentication API",          "Real Touch ID / Face ID / fingerprint via platform authenticator."],
    ["PIN storage",     "SHA-256 + salt in localStorage",  "Lock screen fallback when biometric is unavailable."],
], [30 * mm, 55 * mm, 80 * mm]))

story.append(Paragraph("Backend (REST API)", s_h2))
story.append(small_table([
    ["Layer", "Choice", "Why"],
    ["Runtime",       "Node.js 20 in Docker on Render",   "Free tier, GitHub push → auto-deploy."],
    ["Framework",     "Express 4",                        "Small, well understood, express.json body parser."],
    ["Database",      "libsql (Turso-compatible)",        "Async SQLite driver, no experimental flags, no native compilation."],
    ["CORS",          "cors middleware",                  "Frontend on Cloudflare Pages talks to backend on Render."],
    ["Crypto",        "Node crypto (HMAC-SHA256)",        "Standard library, no third-party dependency."],
    ["Env",           "dotenv-free custom loader",        "Reads .env locally; Render's dashboard supplies prod vars."],
    ["Rendezvous",    "In-memory Map for pair codes",     "5-minute TTL, no persistence needed."],
], [30 * mm, 55 * mm, 80 * mm]))

story.append(Paragraph("Deployment &amp; ops", s_h2))
story.append(small_table([
    ["Component",         "Provider",              "Notes"],
    ["Domain",            "Cloudflare Registrar",  "zeronetpayupi.com (~$9/yr wholesale, WHOIS privacy free)."],
    ["Frontend hosting",  "Cloudflare Pages",      "Free unlimited bandwidth, auto SSL, edge caching."],
    ["Backend hosting",   "Render (free tier)",    "Docker image built from Dockerfile in repo, GitHub auto-deploy on push."],
    ["Version control",   "GitHub",                "Public repo — Mugilarasi04/zeronetpayupi."],
    ["CI/CD",             "GitHub → Render + Pages", "Zero-config: push to master, both hosts redeploy."],
    ["Monitoring",        "Render logs + /api/audit invariant", "One-glance health via the invariant endpoint."],
], [30 * mm, 45 * mm, 90 * mm]))

story.append(Paragraph("External integrations", s_h2))
story.append(bullet_list([
    "<b>UPI intent deeplink</b> (upi://pay?pa=...) — recognized by every UPI app.",
    "<b>WhatsApp click-to-chat</b> (wa.me/&lt;number&gt;?text=...) — receiver ↔ escrow rendezvous, notifications, disputes.",
    "<b>PWA install</b> — Add to Home Screen on iOS/Android, launches without browser chrome.",
]))

# ---------- 7. Feature checklist ----------
story.append(PageBreak())
story.append(Paragraph("6. Feature checklist", s_h1))
story.append(hr())
story.append(small_table([
    ["Feature", "Status"],
    ["UPI ID linking + phone at onboarding",                          "Shipped"],
    ["4-6 digit PIN + real WebAuthn biometric lock",                  "Shipped"],
    ["App lock on every tab close (session-only unlock)",             "Shipped"],
    ["Real UPI intent QR / deeplink at load time",                    "Shipped"],
    ["Payment-proof screenshot upload before minting tokens",         "Shipped"],
    ["HMAC-SHA256 signed tokens, 30-day TTL",                         "Shipped"],
    ["Offline QR payment (single-frame for small amounts)",           "Shipped"],
    ["6-digit pair-code rendezvous (fallback when QR fails)",         "Shipped"],
    ["Full-text transfer-code (advanced fallback)",                   "Shipped"],
    ["Tokens stay in wallet until sender confirms &quot;Sent ✓&quot;",       "Shipped"],
    ["Cascade transfers — received tokens are spendable",             "Shipped"],
    ["User-initiated cashout with biometric",                         "Shipped"],
    ["Escrow-locked to a single UPI ID (env-controlled)",             "Shipped"],
    ["Disbursement queue with one-tap Pay now UPI deeplink",          "Shipped"],
    ["WhatsApp &quot;nudge escrow&quot; from receiver",                     "Shipped"],
    ["WhatsApp auto-open on Mark as paid",                            "Shipped"],
    ["Receiver &quot;✓ I received&quot; self-verify",                       "Shipped"],
    ["1-hour complaint gate with live countdown",                     "Shipped"],
    ["Complaint red banner on operator's Home",                       "Shipped"],
    ["Audit invariant endpoint",                                      "Shipped"],
    ["Double-spend rejection with per-token reason",                  "Shipped"],
    ["Live URL on custom brand: upizeronetpay.pages.dev",             "Shipped"],
], [125 * mm, 30 * mm]))

# ---------- 8. Q&A ----------
story.append(PageBreak())
story.append(Paragraph("7. Anticipated Q &amp; A", s_h1))
story.append(hr())

story.append(Paragraph("Technical", s_h2))
for q, a in [
    ("Why HMAC-SHA256 instead of asymmetric signatures?",
     "For hackathon speed. HMAC needs no key distribution and every token verifies in one hash. "
     "The production upgrade is ECDSA per token: the backend signs with a private key, receivers verify "
     "with a cached public key <i>offline</i> — same architecture, one primitive swap. We chose HMAC "
     "because it made the offline-both-sides claim demonstrable end-to-end in a weekend."),
    ("What stops a sender from showing the same QR to two people?",
     "Nothing at the QR layer — tokens are bearer instruments (like cash). The <b>first receiver to "
     "redeem online wins</b>; the second gets rejected with <font face='Courier'>already_spent</font>. "
     "For high-value flows we would add sender-side sequence numbers stored in a TEE / secure enclave, "
     "but for the demo we accept bearer semantics because they are auditable at redeem time."),
    ("How does the receiver verify a token offline without server access?",
     "They don't cryptographically — they trust the QR envelope and reconcile at cash-out time. If the "
     "sender ever forges a token, the receiver discovers it at redeem and can raise a complaint. This "
     "is a deliberate simplification of the spec; a production build would use ECDSA so any receiver "
     "verifies locally with the backend's public key."),
    ("What's the QR payload limit?",
     "We cap at 1,500 bytes per QR frame (QR version ~25, error-correction Level L). That fits a ₹1–15 "
     "payment in a single frame. Larger payments auto-chunk into multiple frames with the receiver's "
     "camera reassembling them; a live chip strip shows which frames are still missing."),
    ("Why did you replace &quot;I've paid&quot; with a screenshot upload?",
     "The old flow was pure honor-system — the user just tapped a button and tokens minted. Judges "
     "would rightly call that trust theatre. Screenshot upload creates an auditable paper trail: "
     "server stores the base64 image on the load order row before minting. A real production build "
     "swaps this for a bank webhook — the interface is the same."),
    ("How does the app work offline if it's a web app?",
     "Progressive Web App with a Service Worker (cache v25) that pre-caches the entire app shell — "
     "HTML, CSS, all JS modules, vendor libs. IndexedDB stores tokens and ledger. Once loaded once, "
     "the app runs indefinitely in airplane mode. Add to Home Screen makes it launch like a native app."),
]:
    story.append(qa(q, a))

story.append(Paragraph("Security", s_h2))
for q, a in [
    ("What if my phone is stolen with unspent tokens on it?",
     "Every spend needs a fresh biometric / PIN via WebAuthn or the SHA-256+salt local hash. A thief "
     "without your fingerprint or PIN cannot generate a QR. On top of that, the app locks on every tab "
     "close and requires biometric or PIN before showing the wallet. Tokens on-device are useless "
     "without live authentication."),
    ("How do I know the escrow operator isn't stealing?",
     "The <font color='#2c7bff'>/api/audit</font> endpoint publishes the invariant "
     "<font face='Courier'>escrow_balance == tokens_in_circulation</font>. If the operator withdraws "
     "escrow without a matching redemption, the invariant breaks and every user sees it. In production "
     "the escrow would be a PPI-licensed bank-partnered account (not the operator's personal UPI), "
     "which regulators audit quarterly."),
    ("What data does the app send to the server?",
     "Only what's necessary: UPI ID + phone + device fingerprint at onboarding, signed tokens at "
     "cashout, payment screenshot at load. No location, no contacts, no messages, no analytics. "
     "Frontend and backend are open source on GitHub — anyone can audit."),
    ("Is the biometric data ever transmitted?",
     "No. WebAuthn is a challenge–response protocol; only a signed assertion leaves the device, and even "
     "that never leaves the browser in our client-only WebAuthn setup. Actual fingerprint / face data "
     "stays in the OS secure enclave forever."),
    ("What happens if the backend gets breached?",
     "Attacker gets the HMAC secret and can forge tokens. Mitigations already in place: secret is "
     "environment-injected (not in git), fresh per deploy via <font face='Courier'>openssl rand -hex "
     "32</font>. Production migration to ECDSA moves the private key to an HSM."),
]:
    story.append(qa(q, a))

story.append(PageBreak())
story.append(Paragraph("Business &amp; regulatory", s_h2))
for q, a in [
    ("Who is your competition?",
     "UPI Lite, CBDC offline, USSD — all of which require at least one side online at the moment of "
     "payment. Our claim is stronger: both sides can be in airplane mode. When NPCI eventually ships "
     "official offline UPI for both parties, we become the front-end layer on top of it — the crypto "
     "and UX are already built."),
    ("What's your business model?",
     "Two natural revenue streams. (a) Small merchant subscription for the disbursement dashboard "
     "and complaint handling. (b) Interchange share on real UPI settlements routed through our "
     "PPI-licensed escrow. Neither is turned on for the demo."),
    ("Why should RBI approve this?",
     "Because it materially expands UPI's reach into 600 million people with patchy connectivity "
     "without breaking any existing rail. Sandbox Cohort 5 is explicitly framed for offline and rural "
     "payment innovation — this is exactly the category. Our architecture keeps money in a bank-audited "
     "escrow, which is the model RBI already knows how to supervise."),
    ("How do you handle KYC?",
     "The linked UPI ID is the KYC anchor — every user must already have a bank-KYC'd UPI account to "
     "onboard. We add no new KYC surface. For higher transaction limits (₹5,000+), we'd trigger PPI-level "
     "KYC on top, matching RBI PPI rules."),
    ("What are the transaction limits?",
     "For the demo, unlimited (₹1 minimum). Production would follow RBI PPI Small Wallet limits: "
     "₹10,000 per month full-KYC, ₹20,000 per month with minimum-KYC upgrade. Escrow itself is capped "
     "by the partner bank's PPI license."),
    ("How does the money actually move?",
     "In: real UPI intent deeplink from user's UPI app to the escrow account (same UPI infrastructure "
     "everyone already uses). Out: manual UPI deeplink today (escrow operator taps Pay now to disburse). "
     "Production V2: Razorpay/Cashfree payout API for fully automated disbursement."),
    ("What's your roadmap?",
     "Month 1: this demo. Month 2: incorporate Pvt Ltd. Month 3: apply RBI Sandbox Cohort 5. "
     "Months 4-6: sandbox evaluation with real users. Month 6: bank partnership for PPI-licensed "
     "escrow. Month 12: full PPI license. Month 18-24: commercial launch."),
]:
    story.append(qa(q, a))

story.append(Paragraph("Product &amp; UX", s_h2))
for q, a in [
    ("Why a PWA and not a native app?",
     "Distribution and reach. A single URL onboards iPhone, Android, and desktop users. No app store "
     "review latency, no per-platform release engineering. If a specific platform requires deeper "
     "hardware integration later (e.g. NFC), we'll add a thin native wrapper."),
    ("What if the receiver's camera won't scan the QR?",
     "Three fallbacks in order of ease. (1) 6-digit pair code — sender's phone posts payload to "
     "backend; receiver types 6 digits to fetch it. (2) Full text transfer code — sender copies a "
     "long ZNP-XXXX.b64… string, shares via WhatsApp; receiver pastes. (3) Live progress chips on the "
     "receive screen show which QR frames are still missing so the receiver knows when to hold the "
     "camera steady."),
    ("What happens if the tunnel or backend goes down mid-demo?",
     "Frontend continues to work for anything cached: showing the wallet, generating QR, scanning QR, "
     "cascade transfers. Only load and cashout need the backend. Once the backend recovers, cashout "
     "auto-retries silently every 15 seconds. If Render's free tier is asleep, the first request "
     "wakes it in ~10 seconds."),
    ("How do you keep the receiver notified?",
     "Three mechanisms. (a) My-cashouts view polls every 10 sec so paid status shows within 10 sec of "
     "the operator marking it. (b) Operator taps Mark as paid → WhatsApp auto-opens on the operator's "
     "phone with a &quot;paid, ref XYZ&quot; message to the receiver. (c) Receiver's phone shows a "
     "green ✓ paid chip the moment the poll picks it up."),
]:
    story.append(qa(q, a))

# ---------- 8. Closing ----------
story.append(PageBreak())
story.append(Paragraph("8. Try it now", s_h1))
story.append(hr())
story.append(Paragraph(
    "Open <font color='#2c7bff'>https://upizeronetpay.pages.dev</font> on any phone. "
    "Set a PIN. Load ₹1. Pay in airplane mode. Cash out. The whole loop takes under two minutes.",
    s_body,
))
story.append(Spacer(1, 15 * mm))
story.append(small_table([
    ["Health",     "https://zeronetpayupi.onrender.com/api/health"],
    ["Audit",      "https://zeronetpayupi.onrender.com/api/audit"],
    ["Settings",   "https://zeronetpayupi.onrender.com/api/settings"],
    ["Source",     "https://github.com/Mugilarasi04/zeronetpayupi"],
], [30 * mm, 130 * mm]))

story.append(Spacer(1, 30 * mm))
story.append(Paragraph(
    "<i>&quot;We didn't build another UPI app. We built the offline layer UPI never had.&quot;</i>",
    s_cover_tag,
))

# ---------- Build ----------
doc.build(story, onFirstPage=on_first_page, onLaterPages=on_later_pages)
print(f"Wrote {OUT}")
