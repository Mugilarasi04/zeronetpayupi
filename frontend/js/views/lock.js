import { toast, escapeHtml } from '../util.js';
import { authenticate as bioAuth, isBiometricEnrolled } from '../biometric.js';
import { hasPin, setPin, verifyPin, unlockApp } from '../lock.js';

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
          <input id="pinInput" type="password" inputmode="numeric" pattern="\\d*" maxlength="6" autocomplete="off" placeholder="••••" />
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
    const v = (pinInput.value || '').trim();
    if (!/^\d{4,6}$/.test(v)) {
      toast('PIN must be 4-6 digits', 'bad');
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
      unlockApp();
      toast('PIN set — unlocked', 'good');
      onUnlock();
    } else {
      const ok = await verifyPin(v);
      if (!ok) {
        toast('Wrong PIN', 'bad');
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
}
