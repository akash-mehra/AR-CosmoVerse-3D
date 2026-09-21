precision highp float;

varying float vColorParam;
varying float vAlpha;
varying float vSpawnFlash;
varying float vIsQSO;
varying float vIsHighlighted;
varying float vLandmarkId;
varying float vTrail;

uniform vec2 uTrailDir; // Screen-space direction the sky is travelling

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

  // Stay inside the sprite quad regardless of how far it was grown.
  if (dot(coord, coord) > 0.25) {
    discard;
  }

  // Draw the star as a capsule swept along the direction of travel: distance to
  // a segment rather than to a point. The widen factor undoes the vertex stage's
  // sprite growth, so at vTrail = 0 this is exactly the original round star.
  float widen = 1.0 + vTrail * 5.0;
  float halfLen = 0.45 * vTrail;
  vec2 perp = vec2(-uTrailDir.y, uTrailDir.x);
  float along = dot(coord, uTrailDir);
  float across = dot(coord, perp);
  float slide = clamp(along, -halfLen, halfLen);
  vec2 offset = vec2((along - slide) * widen, across * widen);

  float distSq = dot(offset, offset);
  float r = sqrt(distSq);

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

  // Fade toward the tail so a streak reads as motion rather than a bar.
  float tail = clamp(-along / max(halfLen, 1e-4), 0.0, 1.0);
  shape *= mix(1.0, 1.0 - 0.55 * tail, vTrail);

  // A stretched star spreads the same light over more pixels, and additive
  // blending piles that up in the dense wedge. Dim by the square root of the
  // stretch: enough to stop the core blowing out, not so much the trails vanish.
  float spread = inversesqrt(widen);
  float alpha = clamp(shape * vAlpha * spread, 0.0, 1.0);
  if (alpha < 0.008) {
    discard;
  }

  // Boost bright core for crystal clear appearance
  vec3 hdrColor = baseColor * (0.88 + 0.65 * core + 0.35 * innerGlow);

  gl_FragColor = vec4(hdrColor, alpha);
}
