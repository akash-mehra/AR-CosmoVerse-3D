/*
 * Rebuilds public/textures/bodies/: a global map of Earth (day, night lights
 * and clouds), the Moon, Phobos, the Galilean and major Saturnian moons,
 * Triton, Pluto, Charon and Ceres, at ~2K (everyday) and ~4K (close-up), plus
 * the Moon's relief as a normal map, a manifest of every file and its size,
 * and CREDITS.md.
 *
 *   NODE_USE_ENV_PROXY=1 npm run fetch:textures   (behind the agent proxy)
 *
 * Sources are spacecraft mosaics from NASA's Earth Observatory, its Scientific
 * Visualization Studio, its image library and the Planetary Data System's
 * mosaic archive (run by USGS). Every source records its licence; one without is refused. Downloads
 * are cached in node_modules/.cache and checked against their published MD5 or
 * length, so a dropped connection cannot pass for a map.
 *
 * Mosaics come framed in different ways (west or east longitudes, 0° or 180°
 * at the centre); every output is re-framed to one convention, CONVENTION.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';

const OUT = 'public/textures/bodies';
const CACHE = 'node_modules/.cache/fetch-textures';
const SIZES = { '2k': 2048, '4k': 4096 };
const JPEG = { quality: 85, mozjpeg: true };
// Below this share of its surface photographed, a map's black gaps are filled.
const MOSTLY_SEEN = 0.98;
const CONVENTION = 'Equirectangular, north up, east to the right, 0° longitude at the centre and 180° at both edges.';

const PDS = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/';
const SVS = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/';
const EO = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/';
const NASA_GUIDELINES = 'https://www.nasa.gov/nasa-brand-center/images-and-media/';

const LICENCES = {
  svs: {
    licence: 'Public domain (NASA Scientific Visualization Studio)',
    licenceUrl: 'https://svs.gsfc.nasa.gov/help/'
  },
  nasa: {
    licence: 'NASA content, not subject to copyright in the US (NASA media usage guidelines)',
    licenceUrl: NASA_GUIDELINES
  },
  // The PDS Cartography and Imaging Sciences Node is NASA's archive, run by USGS.
  // Its mosaics name no copyright holder, so NASA's guidelines are what applies.
  pds: {
    licence: 'NASA Planetary Data System archive product, no copyright holder named (NASA media usage guidelines)',
    licenceUrl: NASA_GUIDELINES
  }
};

const GALILEO = 'NASA/JPL (Galileo SSI, Voyager); mosaic via USGS Astrogeology and the PDS';
const CASSINI = 'NASA/JPL-Caltech/Space Science Institute (Cassini ISS)';
const NEW_HORIZONS = 'NASA/JHUAPL/SwRI (New Horizons LORRI, MVIC); mosaic via USGS Astrogeology and the PDS';

/**
 * `pds` names a mosaic in the archive, framed from its ISIS label; anything
 * else gives `url` and `left`, the east longitude of its left edge. `layers`
 * are further maps framed like the first; `filled` marks a mosaic whose gaps
 * were painted in, so black pixels cannot measure what was seen.
 */
const BODIES = [
  {
    id: 'earth', name: 'Earth', url: `${EO}74000/74218/world.200412.3x5400x2700.jpg`, left: -180,
    credit: 'NASA Earth Observatory: Blue Marble Next Generation (MODIS, December 2004), Black Marble 2016 (Suomi NPP VIIRS) and Blue Marble clouds (MODIS)',
    layers: {
      night: { url: `${EO}144000/144898/BlackMarble_2016_3km.jpg` },
      clouds: { url: `${EO}57000/57747/cloud_combined_8192.tif`, grey: true }
    },
    ...LICENCES.nasa
  },
  {
    id: 'moon', name: 'Moon', url: `${SVS}lroc_color_16bit_srgb_8k.tif`, left: -180,
    credit: "NASA's Scientific Visualization Studio (CGI Moon Kit): LRO LROC WAC colour mosaic (NASA/GSFC/Arizona State University) and LOLA elevation (NASA/GSFC)",
    // Floating-point km above a 1737.4 km sphere, same framing as the colour map.
    relief: { url: `${SVS}ldem_16.tif`, radiusKm: 1737.4 },
    ...LICENCES.svs
  },
  {
    id: 'phobos', name: 'Phobos', pds: 'Phobos_Viking_Mosaic_40ppd_DLRcontrol',
    credit: 'NASA/JPL (Viking Orbiter); mosaic by P. Stooke (University of Western Ontario), via the PDS', ...LICENCES.pds
  },
  { id: 'io', name: 'Io', pds: 'Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km', credit: GALILEO, ...LICENCES.pds },
  { id: 'europa', name: 'Europa', pds: 'Europa_Voyager_GalileoSSI_global_mosaic_500m', credit: GALILEO, ...LICENCES.pds },
  { id: 'ganymede', name: 'Ganymede', pds: 'Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m', credit: GALILEO, ...LICENCES.pds },
  { id: 'callisto', name: 'Callisto', pds: 'Callisto_Voyager_GalileoSSI_global_mosaic_1km', credit: GALILEO, ...LICENCES.pds },
  {
    // NASA's library copy (Photojournal PIA17214): "Herschel is seen on the map at left".
    id: 'mimas', name: 'Mimas', url: 'https://images-assets.nasa.gov/image/PIA17214/PIA17214~orig.jpg', left: -180,
    credit: `${CASSINI}, PIA17214`, ...LICENCES.nasa
  },
  { id: 'enceladus', name: 'Enceladus', pds: 'Enceladus_Cassini_mosaic_global_110m', credit: `${CASSINI}; mosaic via the PDS`, ...LICENCES.pds },
  { id: 'tethys', name: 'Tethys', pds: 'Tethys_Cassini_mosaic_global_293m', credit: `${CASSINI}; mosaic via the PDS`, ...LICENCES.pds },
  { id: 'dione', name: 'Dione', pds: 'Dione_Cassini_Voyager_mosaic_global_154m', credit: `${CASSINI}, NASA/JPL (Voyager); mosaic via the PDS`, ...LICENCES.pds },
  { id: 'rhea', name: 'Rhea', pds: 'Rhea_Cassini_Voyager_mosaic_global_417m', credit: `${CASSINI}, NASA/JPL (Voyager); mosaic via the PDS`, ...LICENCES.pds },
  { id: 'titan', name: 'Titan', pds: 'Titan_ISS_P19658_Mosaic_Global_4km', credit: `${CASSINI}, surface at 938 nm through the haze; mosaic by JPL, via the PDS`, ...LICENCES.pds },
  { id: 'iapetus', name: 'Iapetus', pds: 'Iapetus_Cassini_Voyager_mosaic_global_783m', credit: `${CASSINI}, NASA/JPL (Voyager); mosaic via the PDS`, ...LICENCES.pds },
  {
    id: 'triton', name: 'Triton', pds: 'Triton_Voyager2_ClrMosaic_GlobalFill_600m',
    credit: 'NASA/JPL (Voyager 2); mosaic by the Lunar and Planetary Institute, via the PDS', ...LICENCES.pds,
    filled: 'Voyager 2 saw only part of Triton in 1989; the rest of this map is filled in'
  },
  { id: 'pluto', name: 'Pluto', pds: 'Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit', credit: NEW_HORIZONS, ...LICENCES.pds },
  { id: 'charon', name: 'Charon', pds: 'Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit', credit: NEW_HORIZONS, ...LICENCES.pds },
  {
    id: 'ceres', name: 'Ceres', pds: 'Ceres_Dawn_FC_DLR_global_20ppd_Oct2015',
    credit: 'NASA/JPL-Caltech/UCLA/MPS/DLR/IDA (Dawn Framing Camera); mosaic by DLR (T. Roatsch), via the PDS', ...LICENCES.pds
  }
];

const cacheFile = (url) => `${CACHE}/${new URL(url).pathname.split('/').pop()}`;

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

async function md5(file) {
  const hash = createHash('md5');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** Downloads once into the cache, verified by MD5 when the source publishes one, else by length. */
async function download(url, expectedMd5) {
  const file = cacheFile(url);
  if (await stat(file).catch(() => null)) return file;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchOk(url);
      const length = Number(res.headers.get('content-length'));
      process.stdout.write(`  downloading ${url.split('/').pop()} (${length ? (length / 1e6).toFixed(1) + ' MB' : 'size unknown'})\n`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(`${file}.part`));
      const { size } = await stat(`${file}.part`);
      if (expectedMd5 && (await md5(`${file}.part`)) !== expectedMd5) throw new Error('MD5 mismatch');
      if (!expectedMd5 && length && size !== length) throw new Error(`got ${size} of ${length} bytes`);
      await rename(`${file}.part`, file);
      return file;
    } catch (err) {
      await rm(`${file}.part`, { force: true });
      // The proxy occasionally drops a long transfer; one retry, then give up.
      if (attempt >= 2) throw new Error(`${url}: ${err.message}`);
      console.warn(`  retrying ${url}: ${err.message}`);
    }
  }
}

/** East longitude of the left edge, from an ISIS label's Mapping group. */
function leftEdgeFromLabel(label) {
  const value = (key) => {
    const m = label.match(new RegExp(`\\b${key}\\s*=\\s*"?([^\\s"<]+)`));
    if (!m) throw new Error(`label has no ${key}`);
    return m[1];
  };
  const projection = value('ProjectionName');
  if (!/^(Equirectangular|SimpleCylindrical)$/.test(projection)) throw new Error(`unexpected projection ${projection}`);
  if (projection === 'Equirectangular' && Number(value('CenterLatitude')) !== 0) throw new Error('standard parallel is not the equator');
  const metresPerDegree = (Number(value('EquatorialRadius')) * Math.PI) / 180;
  const offset = Number(value('UpperLeftCornerX')) / metresPerDegree;
  const centre = Number(value('CenterLongitude'));
  // ISIS draws east to the right either way; west longitudes simply count the other way.
  const left = value('LongitudeDirection') === 'PositiveWest' ? offset - centre : centre + offset;
  return ((((left + 180) % 360) + 360) % 360) - 180;
}

async function resolveSource(body) {
  if (!body.licence || !body.licenceUrl) throw new Error(`${body.name}: no licence recorded, refusing the source`);
  if (!body.pds) return { file: await download(body.url), left: body.left, url: body.url };
  const url = `${PDS}${body.pds}.tif`;
  const label = await (await fetchOk(`${PDS}${body.pds}.lbl`)).text();
  const sum = (await (await fetchOk(`${url}.md5`)).text()).trim().split(/\s+/)[0];
  return { file: await download(url, sum), left: leftEdgeFromLabel(label), url };
}

/**
 * Moves the column at longitude `left` to the left edge, where -180° belongs,
 * and mends the join between the mosaic's own first and last columns, which
 * are often dark (Europa's showed as a line down 0° longitude).
 */
function reframe(data, width, height, channels, left) {
  const shift = Math.round((((((left + 180) % 360) + 360) % 360) / 360) * width) % width;
  const out = Buffer.alloc(data.length);
  const row = width * channels;
  const cut = (width - shift) * channels;
  for (let y = 0; y < height; y++) {
    const o = y * row;
    data.copy(out, o + shift * channels, o, o + cut);
    data.copy(out, o, o + cut, o + row);
  }
  const col = (x) => ((x % width) + width) % width;
  const [before, last, first, after] = [shift - 2, shift - 1, shift, shift + 1].map(col);
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < channels; c++) {
      const at = (x) => (y * width + x) * channels + c;
      out[at(last)] = Math.round((2 * out[at(before)] + out[at(after)]) / 3);
      out[at(first)] = Math.round((out[at(before)] + 2 * out[at(after)]) / 3);
    }
  }
  return out;
}

/** Share of the surface actually imaged: not the black fill of an unseen region, weighted by area. */
function imagedFraction(data, width, height, channels) {
  let seen = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    const w = Math.cos(((y + 0.5) / height - 0.5) * Math.PI);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += data[i + c];
      if (sum > 2 * channels) seen += w;
      total += w;
    }
  }
  return Math.round((seen / total) * 1000) / 1000;
}

/** One pass along rows (wrapping round the globe) or columns: the max or mean over ±r pixels. */
function spread(src, w, h, r, alongRows, max) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let d = -r; d <= r; d++) {
        const v = alongRows ? src[y * w + ((x + d + w) % w)] : src[Math.min(Math.max(y + d, 0), h - 1) * w + x];
        acc = max ? Math.max(acc, v) : acc + v;
      }
      out[y * w + x] = max ? acc : acc / (2 * r + 1);
    }
  }
  return out;
}

/**
 * Fills what no spacecraft saw (black in the mosaic) with the average colour
 * of what was seen, feathered over a few pixels that also cover the dark
 * fringe resampling leaves along the gap. Unknown ground reads as plain, not
 * as black holes or invented features.
 */
function fillUnseen(data, width, height, channels) {
  const gap = new Float32Array(width * height);
  const sum = new Array(channels).fill(0);
  let seen = 0;
  for (let k = 0; k < gap.length; k++) {
    let total = 0;
    for (let c = 0; c < channels; c++) total += data[k * channels + c];
    if (total <= 2 * channels) {
      gap[k] = 1;
      continue;
    }
    for (let c = 0; c < channels; c++) sum[c] += data[k * channels + c];
    seen++;
  }
  if (!seen) return data;
  // 2 px of fringe and 4 px of feather at 2K, twice that at 4K.
  const r = Math.max(1, Math.round(width / 1024));
  let blend = spread(spread(gap, width, height, r, true, true), width, height, r, false, true);
  blend = spread(spread(blend, width, height, 2 * r, true, false), width, height, 2 * r, false, false);
  const out = Buffer.from(data);
  for (let k = 0; k < gap.length; k++) {
    const a = blend[k];
    if (!a) continue;
    for (let c = 0; c < channels; c++) {
      const i = k * channels + c;
      out[i] = Math.round(data[i] * (1 - a) + (sum[c] / seen) * a);
    }
  }
  return out;
}

async function writeJpeg(data, width, height, channels, name) {
  const path = `${OUT}/${name}`;
  await sharp(data, { raw: { width, height, channels } }).jpeg(JPEG).toFile(path);
  const { size } = await stat(path);
  return { file: name, width, height, bytes: size };
}

/**
 * One map at every size, 8-bit sRGB or greyscale, re-framed; files are
 * `${name}_${size}.jpg`. A surface map (`fill`) has its unseen gaps filled.
 */
async function colourMaps(file, left, name, { grey = false, fill = false } = {}) {
  const meta = await sharp(file, { limitInputPixels: false }).metadata();
  const channels = meta.channels >= 3 && !grey ? 3 : 1;
  const maps = {};
  let imaged = null;
  for (const [key, size] of Object.entries(SIZES)) {
    // Never upscale: a 4K map made from a 4,040-pixel mosaic would only be larger.
    const width = Math.min(size, meta.width - (meta.width % 2));
    const height = width / 2;
    const { data } = await sharp(file, { limitInputPixels: false })
      .resize(width, height, { fit: 'fill' })
      .removeAlpha()
      .toColourspace(channels === 3 ? 'srgb' : 'b-w')
      .raw()
      .toBuffer({ resolveWithObject: true });
    let framed = reframe(data, width, height, channels, left);
    imaged ??= imagedFraction(framed, width, height, channels);
    if (fill && imaged < MOSTLY_SEEN) framed = fillUnseen(framed, width, height, channels);
    maps[key] = await writeJpeg(framed, width, height, channels, `${name}_${key}.jpg`);
  }
  return { maps, imaged, grey: channels === 1 };
}

/**
 * Relief as a tangent-space normal map (red east, green north), from true
 * slopes: 8-bit heights would terrace. The renderer chooses how much to
 * exaggerate it.
 */
async function normalMaps(body, left) {
  const file = await download(body.relief.url);
  const maps = {};
  for (const [key, width] of Object.entries(SIZES)) {
    const height = width / 2;
    const { data } = await sharp(file, { limitInputPixels: false })
      .resize(width, height, { fit: 'fill' })
      .extractChannel(0)
      .raw({ depth: 'float' })
      .toBuffer({ resolveWithObject: true });
    const h = new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
    if (h.length !== width * height) throw new Error(`${body.relief.url}: expected one float channel`);
    const out = Buffer.alloc(width * height * 3);
    const dy = (Math.PI * body.relief.radiusKm) / height;
    for (let y = 0; y < height; y++) {
      // Near the poles columns converge; a floor keeps noise from reading as cliffs.
      const cosLat = Math.max(Math.cos(((y + 0.5) / height - 0.5) * Math.PI), 0.05);
      const dx = (2 * Math.PI * body.relief.radiusKm * cosLat) / width;
      const north = Math.max(y - 1, 0) * width;
      const south = Math.min(y + 1, height - 1) * width;
      for (let x = 0; x < width; x++) {
        const east = h[y * width + ((x + 1) % width)] - h[y * width + ((x - 1 + width) % width)];
        const up = h[north + x] - h[south + x];
        const nx = -east / (2 * dx);
        const ny = -up / (2 * dy);
        const len = Math.hypot(nx, ny, 1);
        const i = (y * width + x) * 3;
        out[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
        out[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
        out[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      }
    }
    maps[key] = await writeJpeg(reframe(out, width, height, 3, left), width, height, 3, `${body.id}_normal_${key}.jpg`);
  }
  return maps;
}

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

function creditsMarkdown(manifest) {
  const rows = Object.values(manifest.bodies).map((b) =>
    `| ${b.name} | ${b.credit} | [${b.licence}](${b.licenceUrl}) | [source](${b.source}) |`);
  return `# Body maps

Generated by \`npm run fetch:textures\` (scripts/fetchTextures.mjs); do not edit by hand.
Each map comes at ~2K and ~4K; Earth also has night lights and clouds, and the
Moon a normal map derived from LOLA elevation. ${CONVENTION}

| Body | Credit | Licence | Source |
| --- | --- | --- | --- |
${rows.join('\n')}
`;
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const manifest = { convention: CONVENTION, sizes: SIZES, bodies: {}, totals: {} };

  for (const body of BODIES) {
    console.log(body.name);
    const source = await resolveSource(body);
    const { maps, imaged, grey } = await colourMaps(source.file, source.left, body.id, { fill: true });
    const entry = {
      name: body.name,
      credit: body.credit,
      licence: body.licence,
      licenceUrl: body.licenceUrl,
      source: source.url,
      imaged: body.filled ? null : imaged,
      // A greyscale mosaic: the renderer tints it to the body's overall colour.
      grey,
      ...(body.filled && { note: body.filled }),
      maps: { color: maps }
    };
    for (const [key, layer] of Object.entries(body.layers ?? {})) {
      entry.maps[key] = (await colourMaps(await download(layer.url), source.left, `${body.id}_${key}`, layer)).maps;
    }
    if (body.relief) entry.maps.normal = await normalMaps(body, source.left);
    manifest.bodies[body.id] = entry;
    console.log(`  left edge ${source.left.toFixed(2)}°E, ${entry.imaged === null ? 'gaps filled' : `${Math.round(imaged * 100)}% imaged`}, ` +
      Object.entries(maps).map(([k, m]) => `${k} ${m.width}×${m.height} ${mb(m.bytes)}`).join(', '));
  }

  for (const key of Object.keys(SIZES)) {
    const files = Object.values(manifest.bodies).flatMap((b) => Object.values(b.maps).map((m) => m[key]));
    manifest.totals[key] = { files: files.length, bytes: files.reduce((sum, f) => sum + f.bytes, 0) };
  }
  await writeFile(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(`${OUT}/CREDITS.md`, creditsMarkdown(manifest));
  console.log(`\n2K set: ${manifest.totals['2k'].files} files, ${mb(manifest.totals['2k'].bytes)}`);
  console.log(`4K set: ${manifest.totals['4k'].files} files, ${mb(manifest.totals['4k'].bytes)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
