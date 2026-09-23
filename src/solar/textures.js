import * as THREE from 'three';

export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (text) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

export function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const rgba = ([r, g, b], a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const shade = ([r, g, b], k) => [r * k, g * k, b * k];

function blob(ctx, x, y, rx, ry, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Soft light and dark patches: the base texture of every rocky or icy body. */
function mottle(ctx, w, h, rand, count, strength, sizeMax = 30) {
  for (let i = 0; i < count; i++) {
    const v = rand() < 0.5 ? 0 : 255;
    blob(ctx, rand() * w, rand() * h, 3 + rand() * sizeMax, 2 + rand() * sizeMax * 0.6, `rgba(${v},${v},${v},${strength * (0.4 + rand() * 0.6)})`);
  }
}

function craters(ctx, w, h, rand, count, { max = 12, rim = 'rgba(0,0,0,0.35)', floor = 'rgba(255,255,255,0.06)', rays = false } = {}) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = h * (0.08 + rand() * 0.84);
    const r = 1 + rand() ** 3 * max;
    blob(ctx, x, y, r, r * 0.9, floor);
    ctx.strokeStyle = rim;
    ctx.lineWidth = Math.max(0.6, r * 0.18);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (rays && r > max * 0.55) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 10; k++) {
        const a = rand() * Math.PI * 2;
        const len = r * (2 + rand() * 5);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
    }
  }
}

function heart(ctx, cx, cy, s, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.4, cy + s * 0.1, cx - s * 0.9, cy - s * 1.0, cx, cy - s * 0.35);
  ctx.bezierCurveTo(cx + s * 0.9, cy - s * 1.0, cx + s * 1.4, cy + s * 0.1, cx, cy + s * 0.9);
  ctx.fill();
}

/*
 * Procedural surfaces for bodies with no photographic map here, each painted
 * with the features it is known for: Io's volcanoes, Europa's cracked ice,
 * Iapetus's two faces, Pluto's heart. Impressions, not maps.
 */
const PAINTERS = {
  moon(ctx, w, h, rand) {
    const base = [165, 163, 158];
    ctx.fillStyle = rgba(base); ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 500, 0.05);
    // Maria: the dark basalt seas, crowded onto the near side.
    for (let i = 0; i < 14; i++) blob(ctx, w * (0.3 + rand() * 0.4), h * (0.25 + rand() * 0.45), 18 + rand() * 45, 12 + rand() * 30, 'rgba(70,70,72,0.38)');
    craters(ctx, w, h, rand, 260, { max: 10, rays: true });
  },
  rubble(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(92,84,76)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 400, 0.08);
    craters(ctx, w, h, rand, 220, { max: 9, rim: 'rgba(0,0,0,0.45)' });
  },
  io(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(222,200,98)'; ctx.fillRect(0, 0, w, h);
    const tones = ['rgba(236,160,60,0.35)', 'rgba(250,245,210,0.35)', 'rgba(190,120,50,0.3)', 'rgba(140,160,80,0.2)'];
    for (let i = 0; i < 180; i++) blob(ctx, rand() * w, rand() * h, 6 + rand() * 40, 4 + rand() * 22, tones[i % tones.length]);
    for (let i = 0; i < 70; i++) {
      const x = rand() * w;
      const y = h * (0.1 + rand() * 0.8);
      blob(ctx, x, y, 5 + rand() * 9, 5 + rand() * 9, 'rgba(200,60,30,0.35)');
      blob(ctx, x, y, 1.5 + rand() * 2.5, 1.5 + rand() * 2.5, 'rgba(25,15,10,0.9)');
    }
  },
  europa(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(222,212,192)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 300, 0.06);
    for (let i = 0; i < 26; i++) blob(ctx, rand() * w, rand() * h, 20 + rand() * 50, 10 + rand() * 25, 'rgba(170,120,80,0.18)');
    // Lineae: the long reddish cracks that criss-cross the ice.
    ctx.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = `rgba(150,90,55,${0.25 + rand() * 0.35})`;
      ctx.lineWidth = 0.6 + rand() * 1.6;
      ctx.beginPath();
      let x = rand() * w;
      let y = rand() * h;
      ctx.moveTo(x, y);
      const a = rand() * Math.PI * 2;
      for (let k = 0; k < 6; k++) {
        x += Math.cos(a + (rand() - 0.5) * 0.5) * 30;
        y += Math.sin(a + (rand() - 0.5) * 0.5) * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
  ganymede(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(140,128,112)'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) blob(ctx, rand() * w, rand() * h, 25 + rand() * 50, 15 + rand() * 30, 'rgba(85,75,65,0.35)');
    // Bright grooved terrain between the old dark regions.
    for (let i = 0; i < 220; i++) {
      ctx.strokeStyle = 'rgba(215,205,190,0.18)';
      ctx.lineWidth = 1 + rand() * 2;
      const x = rand() * w;
      const y = rand() * h;
      const a = rand() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 26);
      ctx.stroke();
    }
    craters(ctx, w, h, rand, 120, { max: 8, floor: 'rgba(255,255,255,0.12)' });
  },
  callisto(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(78,68,58)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 300, 0.07);
    // Saturated with craters, most with bright icy floors.
    craters(ctx, w, h, rand, 520, { max: 8, rim: 'rgba(0,0,0,0.3)', floor: 'rgba(230,225,215,0.28)' });
  },
  mimas(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(176,174,170)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 200, 0.05);
    craters(ctx, w, h, rand, 260, { max: 7 });
    // Herschel: a third of the moon's width.
    blob(ctx, w * 0.25, h * 0.52, 44, 38, 'rgba(90,88,85,0.4)');
    ctx.strokeStyle = 'rgba(40,40,40,0.55)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(w * 0.25, h * 0.52, 44, 38, 0, 0, Math.PI * 2); ctx.stroke();
    blob(ctx, w * 0.25, h * 0.52, 6, 5, 'rgba(210,208,205,0.7)');
  },
  enceladus(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(244,247,250)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 160, 0.03);
    craters(ctx, w, h * 0.55, rand, 90, { max: 5, rim: 'rgba(120,130,150,0.25)' });
    // Tiger stripes: the fractures over the south-polar ocean.
    ctx.strokeStyle = 'rgba(90,150,200,0.55)'; ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(w * (0.2 + i * 0.12), h * 0.86);
      ctx.bezierCurveTo(w * (0.3 + i * 0.12), h * 0.8, w * (0.4 + i * 0.12), h * 0.92, w * (0.5 + i * 0.12), h * 0.86);
      ctx.stroke();
    }
  },
  ice(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(206,204,200)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 260, 0.06);
    craters(ctx, w, h, rand, 280, { max: 9, rim: 'rgba(60,60,60,0.3)' });
  },
  dark(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(96,94,92)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 260, 0.06);
    craters(ctx, w, h, rand, 260, { max: 9, rim: 'rgba(0,0,0,0.35)', floor: 'rgba(255,255,255,0.05)' });
  },
  titan(ctx, w, h) {
    // A smog of organic haze hides the surface: bands of orange, darker north.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgb(170,110,45)');
    g.addColorStop(0.35, 'rgb(215,155,70)');
    g.addColorStop(0.7, 'rgb(225,170,85)');
    g.addColorStop(1, 'rgb(200,140,60)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  },
  iapetus(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(222,216,204)'; ctx.fillRect(0, 0, w, h);
    // Cassini Regio: the leading hemisphere, dark as coal.
    const g = ctx.createLinearGradient(w * 0.15, 0, w * 0.6, 0);
    g.addColorStop(0, 'rgba(45,32,24,0)');
    g.addColorStop(0.25, 'rgba(45,32,24,0.95)');
    g.addColorStop(0.75, 'rgba(45,32,24,0.95)');
    g.addColorStop(1, 'rgba(45,32,24,0)');
    ctx.fillStyle = g; ctx.fillRect(0, h * 0.12, w, h * 0.76);
    craters(ctx, w, h, rand, 160, { max: 8, rim: 'rgba(0,0,0,0.25)' });
  },
  triton(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(214,196,186)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 280, 0.06);
    // "Cantaloupe" terrain in the north, a pink nitrogen cap in the south.
    for (let i = 0; i < 300; i++) blob(ctx, rand() * w, h * rand() * 0.45, 3 + rand() * 5, 3 + rand() * 5, 'rgba(120,100,90,0.18)');
    ctx.fillStyle = 'rgba(236,190,180,0.6)'; ctx.fillRect(0, h * 0.62, w, h * 0.38);
    ctx.strokeStyle = 'rgba(60,45,40,0.45)'; ctx.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      const x = rand() * w;
      const y = h * (0.68 + rand() * 0.25);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8 + rand() * 12, y - 2); ctx.stroke();
    }
  },
  charon(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(150,146,142)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 280, 0.06);
    craters(ctx, w, h, rand, 120, { max: 8 });
    // Mordor Macula: the reddish north polar stain, frost blown over from Pluto.
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.28);
    g.addColorStop(0, 'rgba(120,55,35,0.85)');
    g.addColorStop(1, 'rgba(120,55,35,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.28);
  },
  ceres(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(112,108,104)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 300, 0.06);
    craters(ctx, w, h, rand, 300, { max: 11 });
    // Occator's bright salt spots.
    blob(ctx, w * 0.62, h * 0.4, 5, 4, 'rgba(255,255,255,0.95)');
    blob(ctx, w * 0.635, h * 0.41, 2.5, 2, 'rgba(255,255,255,0.95)');
  },
  pluto(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(196,168,136)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 300, 0.07);
    // Cthulhu Macula, the dark red equatorial whale, then the pale heart.
    for (let i = 0; i < 30; i++) blob(ctx, w * (0.05 + rand() * 0.35), h * (0.5 + (rand() - 0.5) * 0.18), 12 + rand() * 30, 8 + rand() * 14, 'rgba(95,45,30,0.4)');
    heart(ctx, w * 0.62, h * 0.47, 58, 'rgba(250,244,236,0.92)');
    craters(ctx, w, h, rand, 80, { max: 6, rim: 'rgba(60,40,30,0.3)' });
  },
  haumea(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(236,236,240)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 200, 0.05);
    blob(ctx, w * 0.3, h * 0.5, 40, 26, 'rgba(140,60,50,0.55)');
  },
  makemake(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(178,120,86)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 420, 0.08);
  },
  eris(ctx, w, h, rand) {
    ctx.fillStyle = 'rgb(232,230,228)'; ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 260, 0.04);
  }
};

/** A surface texture for `name`, painted in the style of `kind`; falls back to mottled `colour`. */
export function surfaceTexture(name, kind, colour = [150, 150, 150]) {
  const rand = mulberry32(seedOf(name));
  return canvasTexture(512, 256, (ctx, w, h) => {
    const paint = PAINTERS[kind];
    if (paint) {
      paint(ctx, w, h, rand);
      return;
    }
    ctx.fillStyle = rgba(colour); ctx.fillRect(0, 0, w, h);
    mottle(ctx, w, h, rand, 700, 0.06);
    if (name === 'Mercury') craters(ctx, w, h, rand, 200, { max: 12 });
    if (name === 'Mars') {
      for (let i = 0; i < 40; i++) blob(ctx, rand() * w, h * (0.3 + rand() * 0.4), 10 + rand() * 45, 5 + rand() * 18, rgba(shade(colour, 0.5), 0.55));
      ctx.fillStyle = 'rgba(245,240,235,0.9)';
      ctx.fillRect(0, 0, w, h * 0.05);
      ctx.fillRect(0, h * 0.96, w, h * 0.04);
    }
  });
}

/** Radial profile of Saturn's rings, faint C ring to the Encke gap, Cassini division and all. */
export function saturnRingTexture() {
  // Band edges as fractions of the ring's width (C ring 1.24 R to A ring 2.27 R).
  const bands = [
    [0.0, 0.27, 'rgba(160,140,115,0.25)'],
    [0.27, 0.69, 'rgba(226,208,175,0.92)'],
    [0.69, 0.75, 'rgba(40,34,28,0.08)'],
    [0.75, 0.93, 'rgba(205,188,158,0.78)'],
    [0.93, 0.945, 'rgba(40,34,28,0.1)'],
    [0.945, 1.0, 'rgba(195,178,150,0.7)']
  ];
  return canvasTexture(1024, 8, (ctx, w, h) => {
    for (const [from, to, fill] of bands) {
      ctx.fillStyle = fill;
      ctx.fillRect(from * w, 0, (to - from) * w, h);
    }
    const rand = mulberry32(42);
    for (let x = 0; x < w; x++) {
      ctx.fillStyle = `rgba(0,0,0,${rand() * 0.18})`;
      ctx.fillRect(x, 0, 1, h);
    }
  });
}

export function glowTexture(inner, outer, size = 256) {
  return canvasTexture(size, size, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

function radial(ctx, x, y, r, colour, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(colour, alpha));
  g.addColorStop(1, rgba(colour, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/**
 * A glowing gas cloud: overlapping soft puffs of its emission colour, a
 * brighter core, and dark dust lanes cutting across it.
 */
export function nebulaTexture(name, colour, core) {
  const rand = mulberry32(seedOf(name));
  return canvasTexture(256, 256, (ctx, w) => {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 60; i++) {
      const a = rand() * Math.PI * 2;
      const d = (rand() ** 1.5) * w * 0.3;
      radial(ctx, w / 2 + Math.cos(a) * d, w / 2 + Math.sin(a) * d, 20 + rand() * 60, colour, 0.08 + rand() * 0.1);
    }
    radial(ctx, w / 2, w / 2, w * 0.14, core ?? colour, 0.28);
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.25 + rand() * 0.3})`;
      ctx.lineWidth = 4 + rand() * 10;
      ctx.beginPath();
      const y = w * (0.3 + rand() * 0.4);
      ctx.moveTo(w * 0.1, y);
      ctx.quadraticCurveTo(w * 0.5, y + (rand() - 0.5) * 80, w * 0.9, y + (rand() - 0.5) * 60);
      ctx.stroke();
    }
    // Keep the edge soft whatever the puffs did.
    const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** A spiral seen at an angle: bright bulge, faint disc, a dust lane along it. */
export function galaxyTexture(colour, tilt = 0.35) {
  return canvasTexture(256, 256, (ctx, w) => {
    ctx.save();
    ctx.translate(w / 2, w / 2);
    ctx.scale(1, tilt);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.48);
    g.addColorStop(0, rgba([255, 245, 225], 0.95));
    g.addColorStop(0.12, rgba(colour, 0.6));
    g.addColorStop(0.5, rgba(shade(colour, 0.8), 0.2));
    g.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = w * 0.04;
    ctx.beginPath();
    ctx.ellipse(0, w * 0.05, w * 0.36, w * 0.2, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.restore();
  });
}

/** An irregular dwarf galaxy: a clumpy cloud of faint stars. */
export function cloudTexture(name, colour) {
  const rand = mulberry32(seedOf(name));
  return canvasTexture(256, 256, (ctx, w) => {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const x = w / 2 + (rand() - 0.5) * w * 0.55;
      const y = w / 2 + (rand() - 0.5) * w * 0.35;
      radial(ctx, x, y, 14 + rand() * 40, colour, 0.06 + rand() * 0.07);
    }
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.5})`;
      ctx.fillRect(w / 2 + (rand() - 0.5) * w * 0.6, w / 2 + (rand() - 0.5) * w * 0.4, 1, 1);
    }
  });
}

/** A young cluster: a handful of blue-white stars in a veil of dust. */
export function clusterTexture(name, colour) {
  const rand = mulberry32(seedOf(name));
  return canvasTexture(256, 256, (ctx, w) => {
    ctx.globalCompositeOperation = 'lighter';
    radial(ctx, w / 2, w / 2, w * 0.45, colour, 0.18);
    for (let i = 0; i < 9; i++) {
      const x = w / 2 + (rand() - 0.5) * w * 0.5;
      const y = w / 2 + (rand() - 0.5) * w * 0.4;
      radial(ctx, x, y, 10 + rand() * 12, [230, 240, 255], 0.9);
    }
  });
}
