import { HandLandmarker } from '@mediapipe/tasks-vision';

const ANCHOR_COLOUR = '#ffaa33';
const DRIVER_COLOUR = '#00f0ff';
const IDLE_COLOUR = 'rgba(255, 255, 255, 0.45)';

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
      <span class="ar-hand-caption">no hands</span>
    `;
    this.canvas = this.el.querySelector('.ar-hand-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.caption = this.el.querySelector('.ar-hand-caption');
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
    this.caption.textContent = 'no hands';
    this.el.classList.remove('engaged');
  }

  /**
   * @param video    the element MediaPipe is reading
   * @param hands    [{ points, role }] in raw frame coordinates
   * @param engaged  both hands up and driving the sky
   * @param mirrored selfie feed, drawn flipped to match what the user sees
   */
  draw({ video, hands = [], engaged = false, mirrored = false }) {
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
    this.caption.textContent = engaged
      ? 'turning'
      : hands.length === 2 ? 'open both palms' : `${hands.length} hand${hands.length === 1 ? '' : 's'}`;
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
    const colour = !engaged ? IDLE_COLOUR : role === 'anchor' ? ANCHOR_COLOUR : DRIVER_COLOUR;
    const at = (i) => [points[i].x * width, points[i].y * height];

    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
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
  }
}
