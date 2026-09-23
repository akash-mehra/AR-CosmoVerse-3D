import * as THREE from 'three';

/*
 * An atmosphere as a shell around its body, shaded by how much air each
 * sight line crosses: little over the middle of the disc, most just outside
 * the limb, none at the shell's edge. Density falls with height, so the glow
 * hugs the ground. The Sun is at the origin: the air is lit on the day side,
 * takes its sunset colour near the terminator and is dark at night.
 */
const VERTEX = `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAGMENT = `
uniform vec3 uCentre;
uniform float uInner;
uniform float uOuter;
uniform float uDensity;
uniform float uVeil;
uniform vec3 uColour;
uniform vec3 uSunset;
varying vec3 vWorld;
void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  vec3 toCentre = uCentre - cameraPosition;
  float along = dot(toCentre, dir);
  float b2 = max(dot(toCentre, toCentre) - along * along, 0.0);
  float b = sqrt(b2);
  float thick = uOuter - uInner;
  float span = sqrt(max(uOuter * uOuter - b2, 0.0));
  float path;
  vec3 p;
  if (b < uInner) {
    // In front of the disc: from the shell down to the ground.
    float ground = sqrt(uInner * uInner - b2);
    path = span - ground;
    p = cameraPosition + dir * (along - ground);
  } else {
    // Past the limb: right through, lowest at the closest approach.
    path = 2.0 * span;
    p = cameraPosition + dir * along;
  }
  float lowest = max(b - uInner, 0.0) / thick;
  float depth = uDensity * (path / thick) * exp(-4.0 * lowest);
  float alpha = 1.0 - exp(-depth);
  if (b < uInner) alpha = max(alpha, uVeil);
  float sun = dot(normalize(p - uCentre), normalize(-p));
  vec3 colour = mix(uSunset, uColour, smoothstep(-0.1, 0.35, sun));
  gl_FragColor = vec4(colour, alpha * smoothstep(-0.25, 0.2, sun));
}`;

// The limb spans at least this share of the radius, or Earth's, at 1% to
// scale, is under a pixel from a normal viewing distance. Titan's is to scale.
const MIN_THICKNESS = 0.03;
// Haze over the middle of the disc per decade of surface pressure (mb):
// faint for Mars, a blue wash for Earth, more for Venus.
const DENSITY_PER_DECADE = 0.04;

/**
 * A shell for a body of display radius `radius`, from its fact-sheet values:
 * `pressureMb` (surface), `extentKm` (how high the air reaches, about seven
 * scale heights unless a source gives it) and `radiusKm`; `veil` is how much
 * a haze hides the ground, and `colour`/`sunset` are RGB 0–1.
 */
export function createAtmosphere(radius, { pressureMb, extentKm, radiusKm, veil = 0, colour, sunset }) {
  const thickness = Math.max(extentKm / radiusKm, MIN_THICKNESS);
  const uniforms = {
    uCentre: { value: new THREE.Vector3() },
    uInner: { value: radius },
    uOuter: { value: radius * (1 + thickness) },
    uDensity: { value: DENSITY_PER_DECADE * Math.log10(pressureMb) },
    uVeil: { value: veil },
    uColour: { value: new THREE.Color(...colour) },
    uSunset: { value: new THREE.Color(...sunset) }
  };
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(radius * (1 + thickness), 64, 32),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false })
  );
  // Drawn after the body and its clouds.
  shell.renderOrder = 1;
  shell.onBeforeRender = () => shell.getWorldPosition(uniforms.uCentre.value);
  return shell;
}
