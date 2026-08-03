import { api } from '../api.js';
import { deviceFingerprint, toast, isValidUpi } from '../util.js';

export function renderOnboarding(root, state, onUser) {
  root.innerHTML = `
    <section class="onboard">
      <div class="hero">
        <div class="brand-logo" style="margin: 0 auto 14px; width: 56px; height: 56px; font-size: 28px;">⚡</div>
        <h2 style="margin:0; color: #cfe0ff; text-transform: none; letter-spacing: 0;">Welcome to ZeroNetPay</h2>
        <p class="muted" style="margin: 6px 0 0;">UPI that works with zero internet.<br/>Pay anywhere, settle when you're back online.</p>
      </div>

      <div class="card">
        <label for="upi">Your UPI ID</label>
        <input id="upi" type="text" placeholder="ravi@okicici" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="email" />
        <small class="muted">We credit your bank here when your offline tokens settle.</small>

        <div style="height: 12px"></div>
        <label for="phone">Phone number (with country code)</label>
        <input id="phone" type="tel" placeholder="+91 98765 43210" autocomplete="tel" inputmode="tel" />
        <small class="muted">
          Used so the escrow operator can confirm payouts to you via WhatsApp,
          and so you can raise a complaint if a payout doesn't arrive.
        </small>

        <div style="height: 14px"></div>
        <button id="go" class="btn">Continue</button>
        <small class="muted" style="display:block; margin-top: 10px;">
          This device is identified by a private key — no OTP.
        </small>
      </div>
    </section>
  `;
  const upiInput = root.querySelector('#upi');
  const phoneInput = root.querySelector('#phone');
  const btn = root.querySelector('#go');
  upiInput.focus();

  async function submit() {
    const upiId = (upiInput.value || '').trim();
    const phone = (phoneInput.value || '').trim();
    if (!isValidUpi(upiId)) {
      toast('Enter a valid UPI ID like ravi@okicici', 'bad');
      upiInput.focus();
      return;
    }
    // Local-side sanity check on phone. Backend does the strict normalisation.
    const digits = phone.replace(/\D/g, '');
    if (!digits || digits.length < 10 || digits.length > 15) {
      toast('Enter a valid phone number (10-15 digits)', 'bad');
      phoneInput.focus();
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Linking…';
    try {
      const deviceId = deviceFingerprint();
      const r = await api.register(upiId, deviceId, phone);
      onUser(r.user);
      toast('Linked ' + r.user.upiId, 'good');
    } catch (e) {
      toast(e.code === 'offline' ? 'Need internet for first-time setup' : e.message, 'bad');
      btn.disabled = false;
      btn.textContent = 'Continue';
    }
  }

  btn.addEventListener('click', submit);
  for (const input of [upiInput, phoneInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }
}
