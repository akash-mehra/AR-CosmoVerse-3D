precision highp float;

varying float vColorParam;
varying float vAlpha;
varying float vSpawnFlash;
varying float vIsQSO;
varying float vIsHighlighted;
varying float vLandmarkId;

// Scientific SDSS redshift color palettes
vec3 getGalaxyColor(float t) {
  // 0.0 -> warm white, 0.5 -> golden yellow/orange, 1.0 -> crimson red
  vec3 c0 = vec3(1.00, 0.99, 0.97);
  vec3 c1 = vec3(1.00, 0.78, 0.38);
  vec3 c2 = vec3(0.96, 0.22, 0.14);

  if (t < 0.5) {
    return mix(c0, c1, t * 2.0);
  } else {
    return mix(c1, c2, (t - 0.5) * 2.0);
  }
}

vec3 getQSOColor(float t) {
  // 0.0 -> cyan, 0.33 -> sapphire blue, 0.66 -> magenta violet, 1.0 -> deep red
  vec3 c0 = vec3(0.15, 0.95, 1.00);
  vec3 c1 = vec3(0.25, 0.55, 1.00);
  vec3 c2 = vec3(0.85, 0.32, 0.95);
  vec3 c3 = vec3(0.98, 0.20, 0.35);

  if (t < 0.33) {
    return mix(c0, c1, t * 3.03);
  } else if (t < 0.66) {
    return mix(c1, c2, (t - 0.33) * 3.03);
  } else {
    return mix(c2, c3, (t - 0.66) * 2.94);
  }
}

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float distSq = dot(coord, coord);
  float r = sqrt(distSq);

  // Circular clip
  if (distSq > 0.25) {
    discard;
  }

  // Ultra-crisp Crystal Core + Smooth Diffuse Halo for Retina/4K clarity
  float core = exp(-distSq * 50.0);       // Sharp central kernel
  float innerGlow = exp(-distSq * 18.0);  // Diamond inner halo
  float outerHalo = exp(-distSq * 6.0);   // Soft outer nebula glow
  float shape = max(core, mix(outerHalo, innerGlow, 0.75));

  vec3 baseColor;
  if (vColorParam < 0.5) {
    float t = clamp(vColorParam * 2.0, 0.0, 1.0);
    baseColor = getGalaxyColor(t);
  } else {
    float t = clamp((vColorParam - 0.5) * 2.0, 0.0, 1.0);
    baseColor = getQSOColor(t);
  }

  // Highlight color boost (e.g. Boötes void or Sloan Wall)
  if (vIsHighlighted > 0.5) {
    baseColor = mix(baseColor, vec3(0.2, 1.0, 0.85), 0.55);
    shape = max(shape, outerHalo * 1.6);
  }

  // Magical Supernova Creation Ring & Sparkle on Spawn
  if (vSpawnFlash > 0.005) {
    // Expanding creation shockwave ring
    float ringRadius = 0.38 * (1.0 - vSpawnFlash);
    float ring = exp(-pow(r - ringRadius, 2.0) * 120.0) * vSpawnFlash * 1.8;

    vec3 flashColor = vec3(1.0, 1.0, 0.98);
    baseColor = mix(baseColor, flashColor, vSpawnFlash * 0.8);
    shape = min(1.0, shape * (1.0 + vSpawnFlash * 3.0) + ring);
  }

  // Tonemap-ready HDR output with boosted core brightness
  float alpha = clamp(shape * vAlpha, 0.0, 1.0);
  if (alpha < 0.008) {
    discard;
  }

  // Boost bright core for crystal clear appearance
  vec3 hdrColor = baseColor * (0.88 + 0.65 * core + 0.35 * innerGlow);

  gl_FragColor = vec4(hdrColor, alpha);
}
