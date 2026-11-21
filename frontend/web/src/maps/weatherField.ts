import L from 'leaflet';

/** Smooth, Windy-style colour field (temperature or wind speed) with animated wind particles, drawn on canvas. */

export type FieldMode = 'temp' | 'wind';
export type GridPoint = { temp: number; wind: number; gust: number; pressure: number; u: number; v: number };
export type Grid = { lats: number[]; lons: number[]; rows: GridPoint[][] };

type Rgb = [number, number, number];
type Stop = [number, Rgb];

export const TEMP_STOPS: Stop[] = [
  [-10, [120, 60, 200]], [0, [60, 100, 220]], [10, [40, 170, 225]], [18, [60, 190, 120]],
  [24, [190, 215, 70]], [28, [250, 205, 50]], [32, [250, 150, 40]], [36, [225, 70, 40]], [42, [150, 25, 60]],
];
export const WIND_STOPS: Stop[] = [
  [0, [50, 80, 175]], [8, [45, 130, 200]], [18, [50, 170, 150]], [30, [110, 190, 80]],
  [45, [225, 200, 60]], [60, [240, 130, 45]], [80, [215, 50, 60]], [110, [170, 40, 150]],
];
export const TEMP_RANGE: [number, number] = [-10, 42];
export const WIND_RANGE: [number, number] = [0, 110];

function buildLut(stops: Stop[], [min, max]: [number, number]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const v = min + (i / 255) * (max - min);
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k += 1;
    const [v0, c0] = stops[k];
    const [v1, c1] = stops[k + 1];
    const t = Math.min(1, Math.max(0, (v - v0) / (v1 - v0)));
    for (let c = 0; c < 3; c += 1) lut[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * t;
  }
  return lut;
}

const LUTS = { temp: buildLut(TEMP_STOPS, TEMP_RANGE), wind: buildLut(WIND_STOPS, WIND_RANGE) };

export function rampCss(stops: Stop[]): string {
  const [min] = stops[0];
  const max = stops[stops.length - 1][0];
  return `linear-gradient(90deg, ${stops.map(([v, [r, g, b]]) => `rgb(${r},${g},${b}) ${(((v - min) / (max - min)) * 100).toFixed(0)}%`).join(', ')})`;
}

function frac(arr: number[], v: number): number {
  const last = arr.length - 1;
  if (v <= arr[0]) return 0;
  if (v >= arr[last]) return last;
  let i = 0;
  while (i < last - 1 && v > arr[i + 1]) i += 1;
  return i + (v - arr[i]) / (arr[i + 1] - arr[i]);
}

const CELL = 6;

export class WeatherField {
  private colour = document.createElement('canvas');
  private trail = document.createElement('canvas');
  private low = document.createElement('canvas');
  private grid: Grid | null = null;
  private mode: FieldMode = 'temp';
  private cols = 0;
  private rowsN = 0;
  private U = new Float32Array(0);
  private V = new Float32Array(0);
  private particles: { x: number; y: number; age: number }[] = [];
  private raf = 0;
  private alive = true;

  constructor(private map: L.Map, pane: HTMLElement) {
    [this.colour, this.trail].forEach((c) => {
      c.style.position = 'absolute';
      c.style.left = '0';
      c.style.top = '0';
      c.style.pointerEvents = 'none';
      pane.appendChild(c);
    });
    this.colour.style.opacity = '0.62';
    this.trail.style.opacity = '0.9';
    map.on('moveend zoomend resize', this.refresh, this);
    map.on('zoomstart', this.hide, this);
    this.refresh();
  }

  setData(grid: Grid | null, mode: FieldMode) {
    this.grid = grid;
    this.mode = mode;
    this.refresh();
  }

  destroy() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.map.off('moveend zoomend resize', this.refresh, this);
    this.map.off('zoomstart', this.hide, this);
    this.colour.remove();
    this.trail.remove();
  }

  private hide = () => {
    this.colour.style.visibility = 'hidden';
    this.trail.style.visibility = 'hidden';
  };

  private refresh = () => {
    if (!this.alive) return;
    cancelAnimationFrame(this.raf);
    const size = this.map.getSize();
    const origin = this.map.containerPointToLayerPoint([0, 0]);
    [this.colour, this.trail].forEach((c) => {
      c.width = size.x;
      c.height = size.y;
      c.style.visibility = 'visible';
      L.DomUtil.setPosition(c, origin);
    });
    const ctx = this.colour.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size.x, size.y);
    this.trail.getContext('2d')?.clearRect(0, 0, size.x, size.y);
    if (!this.grid) return;

    const { lats, lons, rows } = this.grid;
    this.cols = Math.ceil(size.x / CELL);
    this.rowsN = Math.ceil(size.y / CELL);
    this.low.width = this.cols;
    this.low.height = this.rowsN;
    const lctx = this.low.getContext('2d');
    if (!lctx) return;
    const image = lctx.createImageData(this.cols, this.rowsN);
    this.U = new Float32Array(this.cols * this.rowsN);
    this.V = new Float32Array(this.cols * this.rowsN);
    const lut = LUTS[this.mode];
    const [min, max] = this.mode === 'temp' ? TEMP_RANGE : WIND_RANGE;
    const maxR = rows.length - 1;
    const maxC = lons.length - 1;

    for (let j = 0; j < this.rowsN; j += 1) {
      for (let i = 0; i < this.cols; i += 1) {
        const ll = this.map.containerPointToLatLng([i * CELL + CELL / 2, j * CELL + CELL / 2]);
        const fr = frac(lats, ll.lat);
        const fc = frac(lons, ll.lng);
        const r0 = Math.min(Math.floor(fr), maxR - 1);
        const c0 = Math.min(Math.floor(fc), maxC - 1);
        const tr = fr - r0;
        const tc = fc - c0;
        const a = rows[r0][c0], b = rows[r0][c0 + 1], c = rows[r0 + 1][c0], d = rows[r0 + 1][c0 + 1];
        const mix = (k: 'temp' | 'u' | 'v') =>
          (a[k] * (1 - tc) + b[k] * tc) * (1 - tr) + (c[k] * (1 - tc) + d[k] * tc) * tr;
        const u = mix('u');
        const v = mix('v');
        const value = this.mode === 'temp' ? mix('temp') : Math.hypot(u, v);
        const idx = Math.round(Math.min(1, Math.max(0, (value - min) / (max - min))) * 255) * 3;
        const o = (j * this.cols + i) * 4;
        image.data[o] = lut[idx];
        image.data[o + 1] = lut[idx + 1];
        image.data[o + 2] = lut[idx + 2];
        image.data[o + 3] = 255;
        this.U[j * this.cols + i] = u;
        this.V[j * this.cols + i] = v;
      }
    }
    lctx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.low, 0, 0, size.x, size.y);

    if (this.mode === 'wind') this.startParticles(size.x, size.y);
  };

  private startParticles(w: number, h: number) {
    const count = Math.min(1100, Math.round((w * h) / 520));
    this.particles = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h, age: Math.floor(Math.random() * 80),
    }));
    const ctx = this.trail.getContext('2d');
    if (!ctx) return;
    const step = () => {
      if (!this.alive) return;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.09)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const p of this.particles) {
        const ci = Math.floor(p.x / CELL);
        const cj = Math.floor(p.y / CELL);
        if (p.age > 90 || ci < 0 || cj < 0 || ci >= this.cols || cj >= this.rowsN) {
          p.x = Math.random() * w; p.y = Math.random() * h; p.age = 0;
          continue;
        }
        const u = this.U[cj * this.cols + ci];
        const v = this.V[cj * this.cols + ci];
        const nx = p.x + u * 0.07;
        const ny = p.y - v * 0.07;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        p.x = nx; p.y = ny; p.age += 1;
      }
      ctx.stroke();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}
