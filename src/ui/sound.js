// One mute switch for everything that makes a sound: the wormhole's ship and
// the tour's narration. Remembered per browser; storage can be blocked, in
// which case the choice lasts for the visit.
const KEY = 'cosmoverse.sound';

export function soundMuted() {
  try {
    return localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
}

export function setSoundMuted(muted) {
  try {
    localStorage.setItem(KEY, muted ? 'off' : 'on');
  } catch {
    // Storage blocked: remembered for this visit only.
  }
}
