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
        <input id="upi" type="text" placeholder="ravi@okicici" autocomplete="off" inputmode="email" />
        <small class="muted">We use this to credit your bank when offline tokens settle.</small>
        <div style="height: 14px"></div>
        <button id="go" class="btn">Continue</button>
        <small class="muted" style="display:block; margin-top: 10px;">Your phone is identified by a private device key — no SMS, no OTP.</small>
      </div>

      <div class="note info">
        Demo build: payments use a mock UPI flow so you can run the full
        load → offline pay → settle loop without a bank gateway.
      </div>
    </section>
  `;
  const input = root.querySelector('#upi');
  const btn = root.querySelector('#go');
  input.focus();
  btn.addEventListener('click', async () => {
    const upiId = (input.value || '').trim();
    if (!isValidUpi(upiId)) {
      toast('Enter a valid UPI ID like ravi@okicici', 'bad');
      input.focus();
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Linking…';
    try {
      const deviceId = deviceFingerprint();
      const r = await api.register(upiId, deviceId);
      onUser(r.user);
      toast('Linked ' + r.user.upiId, 'good');
    } catch (e) {
      toast(e.code === 'offline' ? 'Need internet for first-time setup' : e.message, 'bad');
      btn.disabled = false;
      btn.textContent = 'Continue';
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btn.click();
  });
}
