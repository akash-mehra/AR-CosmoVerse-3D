/**
 * Keeping the wheel turning speeds the zoom up, to 5× after about half a
 * second, so crossing ten orders of magnitude takes seconds of scrolling rather
 * than hundreds of notches. A single notch stays as fine as before; pinch is
 * already proportional to the fingers and is left alone.
 */
export function accelerateZoom(controls) {
  let last = 0;
  let streak = 0;
  // Capture, so the speed is set before OrbitControls handles the same event.
  controls.domElement.addEventListener('wheel', () => {
    const now = performance.now();
    streak = now - last < 150 ? Math.min(streak + 1, 24) : 0;
    last = now;
    controls.zoomSpeed = 1 + streak / 6;
  }, { capture: true, passive: true });
}
