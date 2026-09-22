const VISIBLE_MS = 5000;

let el = null;
let timer = 0;

/**
 * Non-blocking notice. `alert()` froze the render loop — and, in AR, the camera
 * feed and hand tracking with it — until someone found the OK button. Lives on
 * <body> rather than in the HUD, which is hidden wholesale in AR.
 */
export function notify(message, { error = false } = {}) {
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('aria-live', 'polite');
    el.addEventListener('click', () => el.classList.remove('visible'));
  }
  if (!el.isConnected) document.body.appendChild(el);

  el.textContent = String(message);
  el.classList.toggle('error', error);
  el.classList.add('visible');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('visible'), VISIBLE_MS);
}
