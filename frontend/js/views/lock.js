import { toast, escapeHtml } from '../util.js';
import { authenticate as bioAuth, isBiometricEnrolled } from '../biometric.js';
import { hasPin, setPin, verifyPin, unlockApp, lockoutStatus, clearFails } from '../lock.js';
import { store } from '../store.js';

/**
 * Lock screen. Shown whenever the session isn't unlocked and a user is
 * registered on the device. Offers biometric (primary) + PIN (fallback).
 *
 * If no PIN has ever been set, prompts the user to create one after their
 * first successful biometric unlock (so they can still get in if biometric
 * hardware ever fails).
 */
export function renderLock(root, state, { onUnlock }) {
  const upi = (state.user && state.user.upiId) || '';
  const bio = isBiometricEnrolled();
  const pinSet = hasPin();

  root.innerHTML = `
    <div class="lock-screen">
      <div class="lock-card">
        <div class="brand-logo lock-logo">⚡</div>
        <h1 class="lock-title">ZeroNetPay</h1>
        <p class="lock-sub">Signed in as <strong>${escapeHtml(upi)}</strong></p>

        <div class="lock-actions">
          <button id="bioBtn" class="btn lock-primary">
            <span class="lock-ic">${bio ? '👆' : '🔐'}</span>
            <span>${bio ? 'Unlock with biometric' : 'Set up biometric'}</span>
          </button>

          ${pinSet
            ? `<button id="pinBtn" class="btn ghost">Use PIN instead</button>`
            : `<button id="pinBtn" class="btn ghost">Create a PIN</button>`
          }
        </div>

        <div id="pinForm" hidden class="lock-pin-form">
          <label id="pinLabel" for="pinInput">Enter your 4-6 digit PIN</label>
          <input id="pinInput" type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="••••" style="-webkit-text-security: disc; text-security: disc; letter-spacing: 8px;" />
          <div style="height: 10px"></div>
          <button id="pinSubmit" class="btn">Unlock</button>
          <button id="pinCancel" class="btn ghost btn-sm" style="margin-top: 6px;">Back</button>
        </div>

        <div class="lock-foot">
          <small class="muted">Tokens stay on your device. Biometric never leaves the browser.</small>
        </div>
      </div>
    </div>
  `;

  const bioBtn = root.querySelector('#bioBtn');
  const pinBtn = root.querySelector('#pinBtn');
  const pinForm = root.querySelector('#pinForm');
  const pinInput = root.querySelector('#pinInput');
  const pinSubmit = root.querySelector('#pinSubmit');
  const pinCancel = root.querySelector('#pinCancel');
  const pinLabel = root.querySelector('#pinLabel');

  // Whether the PIN form is in "create" mode (no PIN set yet).
  let creatingPin = !pinSet;

  bioBtn.addEventListener('click', async () => {
    bioBtn.disabled = true;
    bioBtn.innerHTML = '<span class="spinner"></span> Authenticating…';
    const ok = await bioAuth({
      userId: state.user && state.user.id,
      upiId: state.user && state.user.upiId,
    });
    if (ok) {
      unlockApp();
      toast('Unlocked', 'good');
      onUnlock();
      return;
    }
    toast('Authentication cancelled', 'bad');
    bioBtn.disabled = false;
    bioBtn.innerHTML = `<span class="lock-ic">${isBiometricEnrolled() ? '👆' : '🔐'}</span><span>${isBiometricEnrolled() ? 'Unlock with biometric' : 'Set up biometric'}</span>`;
  });

  pinBtn.addEventListener('click', () => {
    creatingPin = !hasPin();
    pinLabel.textContent = creatingPin
      ? 'Create a 4-6 digit PIN'
      : 'Enter your 4-6 digit PIN';
    pinForm.hidden = false;
    pinBtn.hidden = true;
    setTimeout(() => pinInput.focus(), 60);
  });

  pinCancel.addEventListener('click', () => {
    pinForm.hidden = true;
    pinBtn.hidden = false;
    pinInput.value = '';
  });

  pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pinSubmit.click();
  });

  pinSubmit.addEventListener('click', async () => {
    // Strip any non-digit character (mobile keyboards sometimes inject
    // whitespace or dashes without the user seeing).
    const v = (pinInput.value || '').replace(/\D/g, '');
    if (!/^\d{4,6}$/.test(v)) {
      toast('PIN must be 4-6 digits', 'bad');
      pinInput.value = '';
      pinInput.focus();
      return;
    }
    pinSubmit.disabled = true;
    if (creatingPin) {
      const ok = await setPin(v);
      if (!ok) {
        toast('Could not set PIN', 'bad');
        pinSubmit.disabled = false;
        return;
      }
      clearFails();
      unlockApp();
      toast('PIN set — unlocked', 'good');
      onUnlock();
    } else {
      // Pre-check lockout so we never leak the "right PIN" response
      // while throttled.
      const pre = lockoutStatus();
      if (pre.locked) {
        handleLockout(pre);
        pinSubmit.disabled = false;
        return;
      }
      const r = await verifyPin(v);
      if (!r.ok) {
        if (r.reason === 'wipe') {
          handleWipe();
          return;
        }
        if (r.reason === 'locked') {
          handleLockout({ until: r.retryAt });
          pinSubmit.disabled = false;
          return;
        }
        const left = typeof r.attemptsLeft === 'number' ? r.attemptsLeft : null;
        toast(
          left !== null && left > 0
            ? `Wrong PIN · ${left} attempt${left === 1 ? '' : 's'} left before lockout`
            : 'Wrong PIN',
          'bad',
        );
        pinInput.value = '';
        pinInput.focus();
        pinSubmit.disabled = false;
        return;
      }
      unlockApp();
      toast('Unlocked', 'good');
      onUnlock();
    }
  });

  function handleLockout(info) {
    const left = Math.max(0, Math.ceil(((info.until || 0) - Date.now()) / 60000));
    pinInput.disabled = true;
    pinSubmit.disabled = true;
    pinInput.value = '';
    pinLabel.innerHTML = `🔒 Too many wrong PINs — locked for ${left} minute${left === 1 ? '' : 's'}.`;
    pinLabel.style.color = '#fca5a5';
    toast('PIN locked — try again later', 'bad');
  }

  async function handleWipe() {
    pinInput.disabled = true;
    pinSubmit.disabled = true;
    pinLabel.innerHTML = '⚠ Too many wrong PINs — wiping this device.';
    pinLabel.style.color = '#fca5a5';
    toast('Wiping device after too many wrong PINs', 'bad');
    try {
      await store.clearTokens();
      await store.clearLedger();
    } catch (_) { /* best-effort */ }
    localStorage.removeItem('znp.user');
    localStorage.removeItem('znp.device');
    localStorage.removeItem('znp.pin.hash');
    localStorage.removeItem('znp.pin.salt');
    localStorage.removeItem('znp.pin.fails');
    sessionStorage.removeItem('znp.unlocked');
    setTimeout(() => location.reload(), 1500);
  }
}
