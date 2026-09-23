attribute float aColorParam;
attribute float aSpawnOrder;
attribute float aRedshift;
attribute float aIsQSO;
attribute float aLandmarkId;

uniform float uPlotProgress;
uniform float uMinZ;
uniform float uMaxZ;
uniform float uPointSize;
uniform float uTime;
uniform float uHDRExposure;
uniform vec3 uHighlightCenter;
uniform float uHighlightRadius;
uniform float uHighlightActive;
uniform float uSpawnWindow; // Plot progress over which a new point flashes
uniform float uPixelRatio;  // Point sizes are CSS pixels; gl_PointSize is device pixels
uniform float uTrailAmount; // 0 = still sky, 1 = full star streaks
uniform float uAmongStars;  // 1 among the nearby stars, where galaxies are distant smudges

varying float vColorParam;
varying float vAlpha;
varying float vSpawnFlash;
varying float vIsQSO;
varying float vIsHighlighted;
varying float vLandmarkId;
varying float vTrail;

void main() {
  vColorParam = aColorParam;
  vIsQSO = aIsQSO;
  vLandmarkId = aLandmarkId;
  vTrail = uTrailAmount;

  // 1. One-by-One Plotting Filter
  if (aSpawnOrder > uPlotProgress) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // Outside clip space
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    return;
  }

  // 2. Redshift Range Filter (minZ .. maxZ)
  if (aRedshift < uMinZ || aRedshift > uMaxZ) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    return;
  }

  // 3. Transform to eye space
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float dist = length(mvPosition.xyz);

  // 4. Ricky Reusser Inverse Intensity & Point Size Correction
  // Scales point size inversely with camera distance to prevent blowout when zooming out
  // and dimness when zooming in.
  float baseSize = uPointSize * (aIsQSO > 0.5 ? 1.45 : 1.15);
  float sizeDistFactor = clamp(450.0 / max(dist, 8.0), 0.45, mix(5.0, 1.4, uAmongStars));
  float ptSize = baseSize * sizeDistFactor;

  // 5. Birth flash. The window is sized on the CPU from the speed, so a flash
  // lasts a set time however fast the plot runs.
  float timeSinceSpawn = (uPlotProgress - aSpawnOrder);
  float flash = 0.0;
  if (timeSinceSpawn >= 0.0 && timeSinceSpawn < uSpawnWindow) {
    float normFlash = 1.0 - (timeSinceSpawn / uSpawnWindow);
    // Smooth quadratic pulse
    flash = pow(normFlash, 1.5);
    // Expand point size dramatically on spawn for a supernova creation burst!
    ptSize *= (1.0 + flash * 3.5);
  }
  vSpawnFlash = flash;

  // 6. Highlight sphere (e.g. Boötes Void or Sloan Great Wall highlight)
  float highlighted = 0.0;
  if (uHighlightActive > 0.5) {
    float dHighlight = distance(position, uHighlightCenter);
    if (dHighlight < uHighlightRadius) {
      highlighted = 1.0;
      ptSize *= 1.5;
    }
  }
  vIsHighlighted = highlighted;

  // 7. Inverse camera distance alpha scaling (tonemapping prep)
  float densityComp = clamp(dist / 350.0, 0.35, 1.0);
  vAlpha = densityComp * uHDRExposure;
  if (highlighted > 0.5) {
    vAlpha = min(1.0, vAlpha * 1.8);
  }

  // Grow the sprite so a streak has room to live inside it. The fragment stage
  // scales its sampling back by the same factor, so the star keeps its width
  // and only gains length.
  float widen = 1.0 + uTrailAmount * 5.0;
  gl_PointSize = clamp(ptSize * widen, 1.5, 48.0 * widen) * uPixelRatio;
  gl_Position = projectionMatrix * mvPosition;
}
