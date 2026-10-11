#!/usr/bin/env python3
"""
ZeroNetPay — Mini-project report (4 pages)
Sections: Abstract · Problem statement · Objectives · Existing systems ·
Proposed system & methodology · Architecture diagram · Implementation ·
Results & testing · Conclusion & future work · References
"""

from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether,
    HRFlowable, Image, PageBreak,
)
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from reportlab.graphics import renderPDF
import io

OUT = Path(__file__).resolve().parents[1] / "docs" / "ZeroNetPay_Report.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

# Palette (academic-look)
INK      = colors.HexColor("#111827")
INK2     = colors.HexColor("#374151")
MUTED    = colors.HexColor("#6b7280")
ACCENT   = colors.HexColor("#1f3a8a")   # deep blue
ACCENT2  = colors.HexColor("#0d6efd")
LIGHT    = colors.HexColor("#eef2ff")
BORDER   = colors.HexColor("#cbd5e1")
GOOD     = colors.HexColor("#137a35")

base = getSampleStyleSheet()

def style(name, base_name="Normal", **kw):
    s = ParagraphStyle(name, parent=base[base_name])
    for k, v in kw.items():
        setattr(s, k, v)
    return s

s_title    = style("Title",    "Title",    fontSize=18, leading=22, alignment=TA_CENTER, textColor=ACCENT, spaceAfter=4)
s_sub      = style("Sub",      "Normal",   fontSize=10, leading=13, alignment=TA_CENTER, textColor=MUTED, spaceAfter=4)
s_authors  = style("Authors",  "Normal",   fontSize=10, leading=13, alignment=TA_CENTER, textColor=INK, spaceAfter=10)
s_abst_h   = style("AbstH",    "Normal",   fontSize=10.5, leading=14, textColor=ACCENT, fontName="Helvetica-Bold", spaceAfter=2)
s_h        = style("H",        "Heading2", fontSize=11.5, leading=15, textColor=ACCENT, spaceBefore=8, spaceAfter=4)
s_h_sub    = style("Hsub",     "Heading3", fontSize=10.5, leading=13, textColor=INK, spaceBefore=6, spaceAfter=3)
s_body     = style("Body",     "BodyText", fontSize=10, leading=13.5, alignment=TA_JUSTIFY, textColor=INK, spaceAfter=5, fontName="Helvetica")
s_body_i   = style("BodyIt",   "BodyText", fontSize=9.5, leading=13, alignment=TA_JUSTIFY, textColor=INK2, fontName="Helvetica-Oblique")
s_bul      = style("Bul",      "BodyText", fontSize=10, leading=13, textColor=INK, leftIndent=14, spaceAfter=2, fontName="Helvetica")
s_code     = style("Code",     "Code",     fontSize=9, leading=12, textColor=INK, backColor=LIGHT, borderPadding=4)
s_capt     = style("Caption",  "Normal",   fontSize=9, leading=12, alignment=TA_CENTER, textColor=MUTED, spaceBefore=2, spaceAfter=8, fontName="Helvetica-Oblique")

def hr(color=BORDER, thick=0.5, sb=4, sa=4):
    return HRFlowable(width="100%", thickness=thick, color=color, spaceBefore=sb, spaceAfter=sa)

def table_zebra(data, col_widths, first_col_bold=False, header=True):
    t = Table(data, colWidths=col_widths, hAlign="LEFT")
    styles = [
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("LEFTPADDING",  (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING",   (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 4),
        ("VALIGN",   (0, 0), (-1, -1), "TOP"),
        ("GRID",     (0, 0), (-1, -1), 0.25, BORDER),
        ("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [colors.white, LIGHT]),
    ]
    if header:
        styles += [
            ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
            ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
            ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
        ]
    if first_col_bold:
        styles += [("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold")]
    t.setStyle(TableStyle(styles))
    return t

def bullets(items):
    from reportlab.platypus import ListFlowable, ListItem
    return ListFlowable(
        [ListItem(Paragraph(x, s_bul), bulletColor=ACCENT2) for x in items],
        bulletType="bullet", start="•", leftIndent=14, bulletFontSize=9,
    )

# --------- Architecture diagram (ReportLab shapes) ---------
def arch_diagram():
    W, H = 170 * mm, 105 * mm
    d = Drawing(W, H)

    def box(x, y, w, h, text_lines, fill=LIGHT, stroke=ACCENT, tc=INK, radius=6):
        r = Rect(x, y, w, h, rx=radius, ry=radius)
        r.fillColor = fill
        r.strokeColor = stroke
        r.strokeWidth = 1
        d.add(r)
        for i, line in enumerate(text_lines):
            s = String(x + w / 2, y + h - 14 - i * 12, line)
            s.textAnchor = "middle"
            s.fontName = "Helvetica-Bold" if i == 0 else "Helvetica"
            s.fontSize = 9 if i == 0 else 8
            s.fillColor = tc
            d.add(s)

    def arrow(x1, y1, x2, y2, label=None, color=ACCENT2, dashed=False):
        ln = Line(x1, y1, x2, y2)
        ln.strokeColor = color
        ln.strokeWidth = 1.2
        if dashed:
            ln.strokeDashArray = [3, 3]
        d.add(ln)
        # arrowhead
        import math
        ang = math.atan2(y2 - y1, x2 - x1)
        ah = 6
        hx, hy = x2, y2
        p1x = hx - ah * math.cos(ang - math.pi / 7)
        p1y = hy - ah * math.sin(ang - math.pi / 7)
        p2x = hx - ah * math.cos(ang + math.pi / 7)
        p2y = hy - ah * math.sin(ang + math.pi / 7)
        head = Polygon([hx, hy, p1x, p1y, p2x, p2y])
        head.fillColor = color
        head.strokeColor = color
        d.add(head)
        if label:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2 + 3
            s = String(mx, my, label)
            s.fontName = "Helvetica"
            s.fontSize = 7.5
            s.fillColor = MUTED
            s.textAnchor = "middle"
            d.add(s)

    # Layout coordinates (mm converted implicitly by Drawing coords in points)
    # We'll work in points; 1mm ≈ 2.83pt. Use Drawing coord ~ points.
    # Convert helper
    def mmv(x): return x * 2.83464

    # Devices row (top)
    box(mmv(6),   mmv(70), mmv(45), mmv(24),
        ["Sender Phone (PWA)", "Onboard, Load, Pay,", "IndexedDB tokens, Biometric"],
        fill=colors.HexColor("#e0f2fe"), stroke=ACCENT2)
    box(mmv(65),  mmv(70), mmv(45), mmv(24),
        ["Receiver Phone (PWA)", "Receive, Cascade, Cash out,", "My cashouts + Complaint"],
        fill=colors.HexColor("#e0f2fe"), stroke=ACCENT2)
    box(mmv(124), mmv(70), mmv(42), mmv(24),
        ["Escrow operator", "Disburse view,", "One-tap UPI payout"],
        fill=colors.HexColor("#fef3c7"), stroke=colors.HexColor("#b45309"))

    # Offline channel (QR / pair code) between sender & receiver
    arrow(mmv(51), mmv(82), mmv(65), mmv(82), label="offline QR / 6-digit code")

    # Cloud row (backend)
    box(mmv(30), mmv(30), mmv(110), mmv(24),
        ["Backend (Node.js + Express on Render)",
         "/api/auth  ·  /api/load  ·  /api/redeem  ·  /api/pair  ·  /api/disburse  ·  /api/audit",
         "HMAC-SHA256 token issuance  ·  invariant: escrow == circulating"],
        fill=LIGHT, stroke=ACCENT)

    # Frontend hosted separately
    box(mmv(6), mmv(30), mmv(20), mmv(24),
        ["Cloudflare", "Pages CDN", "PWA + SW"],
        fill=colors.HexColor("#f1f5f9"), stroke=MUTED)

    # DB
    box(mmv(144), mmv(30), mmv(22), mmv(24),
        ["libsql", "(Turso)", "SQLite"],
        fill=colors.HexColor("#f1f5f9"), stroke=MUTED)

    # Real-world row (bottom)
    box(mmv(6),   mmv(4), mmv(45), mmv(18),
        ["User UPI app", "GPay / PhonePe / BHIM"],
        fill=colors.HexColor("#dcfce7"), stroke=GOOD)
    box(mmv(65),  mmv(4), mmv(45), mmv(18),
        ["Escrow bank account", "mugilarasims@okicici"],
        fill=colors.HexColor("#dcfce7"), stroke=GOOD)
    box(mmv(124), mmv(4), mmv(42), mmv(18),
        ["Receiver bank account", "via real UPI payout"],
        fill=colors.HexColor("#dcfce7"), stroke=GOOD)

    # Vertical arrows: phones <-> backend
    arrow(mmv(28), mmv(70), mmv(45), mmv(54), label="load / cashout (HTTPS)")
    arrow(mmv(87), mmv(70), mmv(87), mmv(54), label="cashout / poll")
    arrow(mmv(145), mmv(70), mmv(120), mmv(54), label="mark paid / complaint")

    # Frontend served by Cloudflare arrow
    arrow(mmv(16), mmv(54), mmv(16), mmv(70), label="serves PWA", dashed=True, color=MUTED)

    # Backend to DB
    arrow(mmv(140), mmv(42), mmv(144), mmv(42), color=MUTED)

    # Real-money arrows
    arrow(mmv(28), mmv(30), mmv(28), mmv(22), color=GOOD, label="₹ UPI in")
    arrow(mmv(155), mmv(30), mmv(145), mmv(22), color=GOOD, label="₹ UPI out")
    # Offline transfer real-world (no arrow — happens via QR box)
    arrow(mmv(50), mmv(13), mmv(65), mmv(13), color=GOOD, label="(offline — via tokens)", dashed=True)

    # Legend
    box(mmv(6), mmv(97), mmv(160), mmv(6),
        ["Legend: solid blue = HTTPS API · dashed grey = static asset · green = real money movement"],
        fill=colors.white, stroke=colors.white, tc=MUTED, radius=0)

    return d


# ---------- Document build ----------
doc = SimpleDocTemplate(
    str(OUT),
    pagesize=A4,
    leftMargin=18 * mm,
    rightMargin=18 * mm,
    topMargin=15 * mm,
    bottomMargin=15 * mm,
    title="ZeroNetPay — Mini-project report",
    author="ZeroNetPay",
)

story = []

# ---------- Title block ----------
story.append(Paragraph("ZeroNetPay: Offline UPI via Device-Bound Cryptographic Tokens", s_title))
story.append(Paragraph("A mini-project report", s_sub))
story.append(Paragraph("Mugilarasi M S &nbsp;·&nbsp; Akshayakumar T", s_authors))
story.append(hr(color=ACCENT, thick=1.2, sa=6))

# ---------- Abstract ----------
story.append(Paragraph("Abstract", s_abst_h))
story.append(Paragraph(
    "Unified Payments Interface (UPI) is now India's dominant retail payment rail, processing over "
    "400 million active users. Yet UPI fails the moment either party loses internet connectivity, "
    "which is a daily reality in metro tunnels, hill stations, stadiums, and rural belts. Existing "
    "&quot;offline&quot; solutions (UPI Lite, CBDC offline, USSD) require <b>at least one</b> side of the "
    "transaction to remain online, which does not solve the true peer-to-peer offline case. "
    "This paper presents <b>ZeroNetPay</b>, a Progressive Web Application that adds a cryptographic "
    "off-line layer on top of standard UPI. Users load money once via UPI; the backend issues "
    "HMAC-SHA256-signed digital tokens that live only on the user's device. Two devices in airplane "
    "mode can transfer tokens through a QR code or a 6-digit rendezvous code, with biometric "
    "authentication guarding every spend. Received tokens are cascade-spendable to a third party. "
    "When any holder returns online, tokens redeem against an escrow account and real money is "
    "disbursed to the holder's UPI ID. We describe the system architecture, cryptographic design, "
    "double-spend guards, and demonstrate an end-to-end deployment on Cloudflare Pages + Render.",
    s_body,
))
story.append(Paragraph(
    "<b>Keywords:</b> UPI, offline payments, digital tokens, HMAC-SHA256, escrow, PWA, WebAuthn, cascade transfer.",
    s_body_i,
))

# ---------- 1. Problem ----------
story.append(Paragraph("1. Problem statement", s_h))
story.append(Paragraph(
    "Approximately 600 million Indians face intermittent mobile connectivity, and every UPI failure "
    "in such areas forces users back to cash — undermining the country's digital-payments push. "
    "The core research question is: <i>Can we perform a secure, non-repudiable, peer-to-peer digital "
    "payment when neither the sender's nor the receiver's device has network access, while retaining "
    "the accounting guarantees of a bank-hosted rail?</i>",
    s_body,
))

# ---------- 2. Objectives ----------
story.append(Paragraph("2. Objectives", s_h))
story.append(bullets([
    "Design a token model that is unforgeable, device-bound, expiry-limited, and single-spend.",
    "Enable peer-to-peer transfer of these tokens without either device needing internet.",
    "Guarantee mathematical accounting: <i>escrow_balance = sum(unspent tokens)</i> at all times.",
    "Provide a real on-ramp (UPI in) and off-ramp (UPI out) using existing UPI infrastructure.",
    "Ship a cross-platform PWA that installs on iOS, Android, and desktop from a single URL.",
]))

# ---------- 3. Existing systems comparison ----------
story.append(Paragraph("3. Comparison with existing systems", s_h))
story.append(table_zebra([
    ["Capability", "UPI Lite", "CBDC offline", "USSD (*99#)", "ZeroNetPay"],
    ["Both parties offline",           "No", "No", "No",         "Yes"],
    ["Uses existing UPI ID",           "Yes","No",  "Yes",        "Yes"],
    ["Cascade re-transfer offline",    "No", "No", "No",          "Yes"],
    ["Automatic settlement on reconnect","No","No","No",          "Yes"],
    ["Biometric per-payment",          "No", "No", "No",          "Yes"],
    ["Cryptographic audit invariant",  "No", "No", "No",          "Yes"],
], [55 * mm, 20 * mm, 25 * mm, 22 * mm, 25 * mm]))

# ---------- 4. Proposed system & methodology ----------
story.append(Paragraph("4. Proposed system and methodology", s_h))
story.append(Paragraph(
    "The system is a three-tier architecture: (i) a Progressive Web App front-end serving as the "
    "user wallet, (ii) a Node.js REST back-end that mints and redeems tokens and enforces "
    "invariants, and (iii) a bank-partnered escrow account that holds actual fiat while tokens are "
    "in circulation. Tokens are issued only after a real UPI credit to escrow; they are burned only "
    "on redemption to a real UPI account. The device-side wallet persists tokens in IndexedDB and "
    "generates transfer QR codes offline using the qrcode-generator library.",
    s_body,
))

story.append(Paragraph("4.1 Token structure", s_h_sub))
story.append(Paragraph(
    "Each token is a signed record <font face='Courier'>{ id, value_paise, issued_to_user_id, "
    "issued_to_device, issued_at, expires_at, signature }</font>. The signature is "
    "<font face='Courier'>HMAC-SHA256(secret, canonical_json(fields))</font>. The signing secret is "
    "held only by the backend, making tokens unforgeable. Tokens are bearer instruments (any holder "
    "can spend), which enables cascade transfers A→B→C without server involvement.",
    s_body,
))

story.append(Paragraph("4.2 Offline transfer protocol", s_h_sub))
story.append(Paragraph(
    "The sender picks tokens summing to the target amount using a FIFO strategy, wraps them in a "
    "payload with sender metadata, and encodes as JSON. For payloads under 1500 bytes (typical for "
    "₹1–15 payments) the entire payload fits in a single QR frame; larger payloads are chunked into "
    "multiple frames that the receiver reassembles by seeing all frames of the same session id. A "
    "6-digit rendezvous code (via <font face='Courier'>/api/pair</font>) is available as a fallback "
    "when both devices have brief internet.",
    s_body,
))

story.append(Paragraph("4.3 Redemption and settlement", s_h_sub))
story.append(Paragraph(
    "When the receiver next has internet, they POST held tokens to <font face='Courier'>/api/redeem</font>. "
    "The backend verifies each token's signature, checks its <font face='Courier'>spent</font> flag, and "
    "checks its expiry. Successful tokens are marked spent and a settlement row is created, owed to "
    "the receiver's registered UPI ID. The escrow operator sees the queued payout, taps a UPI "
    "deeplink to disburse, and marks paid. WhatsApp click-to-chat notifies the receiver.",
    s_body,
))

# ---------- 5. Architecture diagram ----------
story.append(Paragraph("5. System architecture", s_h))
story.append(arch_diagram())
story.append(Paragraph(
    "Figure 1 — ZeroNetPay system architecture. Real money enters via user's UPI app to the escrow "
    "bank account (bottom-left green arrow) and leaves via the escrow operator's UPI payout to the "
    "receiver's bank account (bottom-right). Offline token transfer between the two phones "
    "(dashed green, bottom) happens entirely without server involvement.",
    s_capt,
))

# ---------- 6. Implementation ----------
story.append(Paragraph("6. Implementation", s_h))
story.append(table_zebra([
    ["Layer",              "Technology",                                            "Purpose"],
    ["Frontend",           "Vanilla ES modules, Service Worker (v25), IndexedDB",   "Offline app shell + token wallet"],
    ["QR gen / scan",      "qrcode-generator (client), jsQR (client)",              "Fully client-side, works offline"],
    ["Biometric",          "Web Authentication API (platform authenticator)",       "Touch ID / Face ID / Fingerprint / Windows Hello"],
    ["Backend",            "Node.js 20 + Express 4",                                "REST API in Docker on Render"],
    ["Database",           "libsql (Turso-compatible SQLite)",                      "Async driver, no experimental flags"],
    ["Token crypto",       "Node crypto HMAC-SHA256",                               "Standard library, deterministic"],
    ["Rendezvous",         "In-memory Map with 5-min TTL",                          "Short-code pair transfer"],
    ["Hosting",            "Cloudflare Pages (frontend) + Render (backend)",        "Free tier, GitHub push-to-deploy"],
    ["Domain",             "Cloudflare Registrar — zeronetpayupi.com",              "Wholesale pricing, free WHOIS privacy"],
], [30 * mm, 62 * mm, 68 * mm]))

# ---------- 7. Results & testing ----------
story.append(Paragraph("7. Results and testing", s_h))
story.append(bullets([
    "<b>End-to-end functional test</b> passed: load ₹1 → offline transfer → cascade → cashout → real UPI payout to receiver.",
    "<b>Double-spend rejection verified</b>: replaying the same token returns <font face='Courier'>{reason: &quot;already_spent&quot;}</font>.",
    "<b>Cryptographic invariant</b>: <font face='Courier'>/api/audit</font> returns <font face='Courier'>invariantHolds: true</font> after every operation in a 20-transaction sequence.",
    "<b>Latency</b>: ~4 seconds from sender authenticate to receiver &quot;Payment received&quot; over airplane-mode QR.",
    "<b>Cross-device compatibility</b>: tested on Safari (iOS 17), Chrome (Android 14), and Chrome (macOS).",
    "<b>Recovery paths</b>: complaint gate (1 hour), self-verify received, WhatsApp escrow nudge — all reachable and functional.",
]))

# ---------- 8. Conclusion & future work ----------
story.append(Paragraph("8. Conclusion and future work", s_h))
story.append(Paragraph(
    "ZeroNetPay demonstrates that peer-to-peer offline UPI is achievable today, using nothing "
    "beyond a signed-token model, a PWA, and existing UPI on- and off-ramps. The cryptographic "
    "escrow invariant makes the model auditable and RBI-friendly. The prototype aligns squarely with "
    "RBI Regulatory Sandbox Cohort 5's stated priorities for offline and rural payment innovation. "
    "Planned next steps are: (a) migrate signing from HMAC to ECDSA so receivers can verify tokens "
    "fully offline, (b) integrate a payment-gateway payout API (Razorpay / Cashfree) to remove the "
    "manual disbursement step, and (c) apply for a PPI license through a bank partnership so the "
    "escrow can hold funds at regulated scale.",
    s_body,
))

# ---------- References ----------
story.append(Paragraph("References", s_h))
story.append(Paragraph(
    "[1] NPCI, &quot;UPI Product Statistics&quot;, 2025.<br/>"
    "[2] Reserve Bank of India, &quot;Regulatory Sandbox — Cohort 5: Beyond the Branch / Offline Payments&quot;, Press release, 2025.<br/>"
    "[3] RFC 2104, &quot;HMAC: Keyed-Hashing for Message Authentication&quot;, IETF, 1997.<br/>"
    "[4] W3C, &quot;Web Authentication: An API for accessing Public Key Credentials — Level 3&quot;, W3C Editor's Draft, 2024.<br/>"
    "[5] W3C, &quot;Progressive Web Apps — Service Workers, App Manifest&quot;, 2023.<br/>"
    "[6] NPCI, &quot;UPI Lite &amp; Offline UPI Product Specification&quot;, 2024.",
    s_body,
))

# Build
def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawCentredString(doc.pagesize[0] / 2, 8 * mm,
        f"ZeroNetPay · Mini-project report · Page {doc.page}")
    canvas.restoreState()

doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
print(f"Wrote {OUT}")
