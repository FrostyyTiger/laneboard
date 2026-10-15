// Web Push and the service worker. Moved from public/app.js (fleet F1).
import { $ } from '../core/dom.js';
import { post } from '../core/net.js';
import { toast } from './shell.js';

// ---------------------------------------------------------------- push / PWA

/** VAPID keys arrive base64url; the subscribe API wants a Uint8Array. */
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

let pushBtn = null;
let pushNote = null;

function setPushNote(text) {
  pushNote.textContent = text;
  pushNote.hidden = !text;
}

async function refreshPushUi() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    pushBtn.disabled = true;
    setPushNote('This browser has no Web Push support.');
    return;
  }
  if (!isSecureContext) {
    // iOS only offers the prompt to an installed PWA over HTTPS.
    pushBtn.disabled = true;
    setPushNote(
      'Needs HTTPS. Open the laneboard through its tailscale serve address ' +
      '(port 8443, see deploy/tailscale.md) and add it to the Home Screen.'
    );
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    pushBtn.textContent = 'Notifications on — send a test';
    pushBtn.classList.add('on');
    setPushNote('Permission prompts and questions notify immediately; finished work only after 5 min of running.');
  } else {
    pushBtn.textContent = 'Enable notifications';
    pushBtn.classList.remove('on');
    setPushNote(Notification.permission === 'denied' ? 'Blocked in the browser settings.' : '');
  }
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  pushBtn = $('btn-push');
  pushNote = $('push-note');
  pushBtn.addEventListener('click', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await post('/api/push/test');
        toast('Test notification sent');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setPushNote('Permission was not granted.'); return; }
      const { publicKey } = await (await fetch('/api/push/key')).json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await post('/api/push/subscribe', sub.toJSON());
      toast('Notifications enabled');
      refreshPushUi();
    } catch (err) {
      setPushNote(`Could not enable: ${err.message}`);
    }
  });

  if ('serviceWorker' in navigator && isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* reported by the button */ });
  }
  refreshPushUi();
}
