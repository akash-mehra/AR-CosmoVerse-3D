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
uniform float uPlotSpeed; // Galaxies per second

varying float vColorParam;
varying float vAlpha;
varying float vSpawnFlash;
varying float vIsQSO;
varying float vIsHighlighted;
varying float vLandmarkId;

void main() {
  vColorParam = aColorParam;
  vIsQSO = aIsQSO;
  vLandmarkId = aLandmarkId;

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
  float sizeDistFactor = clamp(450.0 / max(dist, 8.0), 0.45, 5.0);
  float ptSize = baseSize * sizeDistFactor;

  // 5. Super Slow Motion & Standard Birth Flash Effect
  // In Super Slow-Mo (e.g., speed <= 25/sec), make the birth starburst window wider and dramatic
  float spawnWindow = clamp(2.5 / max(1.0, uPlotSpeed), 0.002, 0.06);
  float timeSinceSpawn = (uPlotProgress - aSpawnOrder);
  float flash = 0.0;
  if (timeSinceSpawn >= 0.0 && timeSinceSpawn < spawnWindow) {
    float normFlash = 1.0 - (timeSinceSpawn / spawnWindow);
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

  gl_PointSize = clamp(ptSize, 1.5, 48.0);
  gl_Position = projectionMatrix * mvPosition;
}
