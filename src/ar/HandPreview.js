// MediaPipe's 21-point hand topology (HandLandmarker.HAND_CONNECTIONS). Kept
// here so drawing it does not pull MediaPipe into the main bundle; the tracker
// itself is loaded only when gestures are switched on.
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
];

const ANCHOR_COLOUR = '#ffaa33';
const DRIVER_COLOUR = '#00f0ff';
const IDLE_COLOUR = 'rgba(255, 255, 255, 0.45)';
// Above this (rad/s) the sky counts as turning rather than merely armed.
const TURNING_ABOVE = 0.06;
// Tuning numbers are for whoever is tuning: add ?debug to the URL to see them.
const DEBUG = new URLSearchParams(location.search).has('debug');

/**
 * Small picture-in-picture inside the AR layer showing what the hand tracker
 * actually sees: the camera frame, the landmarks, and the skeleton between
 * them. Without it a gesture that fails to arm gives you nothing to go on —
 * no way to tell a hand out of frame from a palm read as closed.
 */
export class HandPreview {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'ar-hand-preview hidden';
    this.el.innerHTML = `
      <canvas class="ar-hand-canvas" width="192" height="144"></canvas>
      <span class="ar-hand-caption">show both hands</span>
      <span class="ar-hand-metrics"></span>
    `;
    this.canvas = this.el.querySelector('.ar-hand-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.caption = this.el.querySelector('.ar-hand-caption');
    this.metrics = this.el.querySelector('.ar-hand-metrics');
  }

  show() {
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
    this.clear();
  }

  clear() {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);
    this.caption.textContent = 'show both hands';
    this.metrics.textContent = '';
    this.el.classList.remove('engaged');
  }

  /**
   * @param video    the element MediaPipe is reading
   * @param hands    [{ points, role }] in raw frame coordinates
   * @param engaged  anchor palm open and driving the sky
   * @param openness the anchor hand's measured openness, shown against the
   *   threshold so a palm that will not arm says why instead of just failing
   * @param threshold the openness needed to arm (HandTracker's OPEN_ENTER)
   * @param mirrored selfie feed, drawn flipped to match what the user sees
   * @param gapMs    measured milliseconds between the last two readings
   * @param demand   rad/s the hand is asking for
   * @param speed    rad/s the sky is actually turning
   */
  draw({ video, hands = [], engaged = false, openness = 0, threshold = 0, mirrored = false,
         gapMs = null, demand = 0, speed = 0 }) {
    const { ctx, canvas } = this;
    const { width, height } = canvas;

    ctx.save();
    ctx.clearRect(0, 0, width, height);
    if (mirrored) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    this.drawFrame(video, width, height);
    for (const hand of hands) this.drawHand(hand, width, height, engaged);
    ctx.restore();

    this.el.classList.toggle('engaged', engaged);
    // Each caption says what to do next, not just what the tracker sees.
    if (engaged) {
      this.caption.textContent = speed > TURNING_ABOVE ? 'turning' : 'ready: sweep left hand';
    } else if (hands.length >= 2) {
      // The number is the tuning handle: if a comfortably open palm reads below
      // the threshold, OPEN_ENTER is wrong rather than the hand.
      this.caption.textContent = `open right palm ${openness.toFixed(2)}${threshold ? `/${threshold}` : ''}`;
    } else {
      this.caption.textContent = hands.length === 1 ? 'raise your other hand' : 'show both hands';
    }

    // Detection gap, what the hand is demanding, and what the sky is doing.
    // Tuning without these three is guesswork.
    this.metrics.textContent = DEBUG && gapMs
      ? `${gapMs}ms  ask ${demand.toFixed(1)}  sky ${speed.toFixed(1)}`
      : '';
  }

  /** Covers the box with the frame rather than letting the aspect squash it. */
  drawFrame(video, width, height) {
    if (!video?.videoWidth) return;

    const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    this.ctx.globalAlpha = 0.65;
    this.ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
    this.ctx.globalAlpha = 1;
  }

  drawHand({ points, role }, width, height, engaged) {
    const { ctx } = this;
    // Roles show before arming too, dimmed, so you can see which hand the
    // tracker has taken for the anchor.
    const colour = role === 'anchor' ? ANCHOR_COLOUR : role === 'driver' ? DRIVER_COLOUR : IDLE_COLOUR;
    ctx.globalAlpha = engaged ? 1 : 0.55;
    const at = (i) => [points[i].x * width, points[i].y * height];

    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [start, end] of HAND_CONNECTIONS) {
      const [x1, y1] = at(start);
      const [x2, y2] = at(end);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();

    ctx.fillStyle = colour;
    for (let i = 0; i < points.length; i++) {
      const [x, y] = at(i);
      // The wrist carries the gesture's reference point, so draw it larger.
      ctx.beginPath();
      ctx.arc(x, y, i === 0 ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
