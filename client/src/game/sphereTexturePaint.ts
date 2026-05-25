/**
 * Процедурные текстуры для Babylon CreateSphere:
 * каждый пиксель = точка на сфере (u,v → нормаль), узор в сферических координатах.
 * UV совпадает с MeshBuilder.CreateSphere (coordv = acos(y) / π).
 */

const PHI = (1 + Math.sqrt(5)) / 2;

export const SPHERE_TEX_SIZE = 512;
export const SPHERE_TEX_VERSION = 4;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Babylon: coordu = 1 - (atan2(x,z)/π + 1)/2, coordv = acos(y)/π */
export function uvToNormal(u: number, v: number): Vec3 {
  const beta = v * Math.PI;
  const alpha = (1 - u) * Math.PI - Math.PI;
  const sinB = Math.sin(beta);
  return {
    x: sinB * Math.sin(alpha),
    y: Math.cos(beta),
    z: sinB * Math.cos(alpha),
  };
}

function angularDist(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(a, b), -1, 1));
}

/** Без направленного затемнения — объём даёт свет сцены, иначе «пятно» крутится с текстурой */
function shade(_n: Vec3, r: number, g: number, b: number): [number, number, number] {
  return [r, g, b];
}

/** 12 вершин икосаэдра — центры чёрных пятиугольников */
function icosaPentagonCenters(): Vec3[] {
  const raw: Vec3[] = [
    { x: -1, y: PHI, z: 0 },
    { x: 1, y: PHI, z: 0 },
    { x: -1, y: -PHI, z: 0 },
    { x: 1, y: -PHI, z: 0 },
    { x: 0, y: -1, z: PHI },
    { x: 0, y: 1, z: PHI },
    { x: 0, y: -1, z: -PHI },
    { x: 0, y: 1, z: -PHI },
    { x: PHI, y: 0, z: -1 },
    { x: PHI, y: 0, z: 1 },
    { x: -PHI, y: 0, z: -1 },
    { x: -PHI, y: 0, z: 1 },
  ];
  return raw.map(normalize);
}

/** 20 центров треугольных граней — белые шестиугольники */
function icosaHexagonCenters(): Vec3[] {
  const v = icosaPentagonCenters();
  const faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  return faces.map(([a, b, c]) =>
    normalize({
      x: v[a]!.x + v[b]!.x + v[c]!.x,
      y: v[a]!.y + v[b]!.y + v[c]!.y,
      z: v[a]!.z + v[b]!.z + v[c]!.z,
    }),
  );
}

type Seed = { n: Vec3; pent: boolean };

function soccerSeeds(): Seed[] {
  return [
    ...icosaPentagonCenters().map((n) => ({ n, pent: true })),
    ...icosaHexagonCenters().map((n) => ({ n, pent: false })),
  ];
}

function nearestSeeds(n: Vec3, seeds: Seed[]): { d1: number; d2: number; pent: boolean } {
  let d1 = Math.PI;
  let d2 = Math.PI;
  let pent = false;
  for (const s of seeds) {
    const d = angularDist(n, s.n);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      pent = s.pent;
    } else if (d < d2) {
      d2 = d;
    }
  }
  return { d1, d2, pent };
}

function setPx(data: Uint8ClampedArray, size: number, x: number, y: number, rgb: [number, number, number]): void {
  const i = (y * size + x) * 4;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = 255;
}

function paintSphere(
  size: number,
  fn: (n: Vec3, u: number, v: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const v = (py + 0.5) / size;
      const n = uvToNormal(u, v);
      setPx(data, size, px, py, fn(n, u, v));
    }
  }
  return new ImageData(data, size, size);
}

export function paintFootballTexture(size: number): ImageData {
  const seeds = soccerSeeds();
  const seamW = 0.042;

  return paintSphere(size, (n) => {
    const { d1, d2, pent } = nearestSeeds(n, seeds);
    if (d2 - d1 < seamW) {
      return shade(n, 38, 38, 44);
    }
    if (pent) {
      return shade(n, 16, 16, 20);
    }
    return shade(n, 250, 250, 252);
  });
}

function nearSeam(n: Vec3, axis: Vec3, w = 0.038): boolean {
  return Math.abs(dot(n, axis)) < w;
}

export function paintBasketballTexture(size: number): ImageData {
  return paintSphere(size, (n) => {
    const seam =
      nearSeam(n, { x: 1, y: 0, z: 0 }) ||
      nearSeam(n, { x: 0, y: 1, z: 0 }) ||
      nearSeam(n, { x: 0, y: 0, z: 1 }) ||
      nearSeam(n, normalize({ x: 1, y: 0.15, z: 0.5 }), 0.032) ||
      nearSeam(n, normalize({ x: 0.5, y: 0.15, z: -1 }), 0.032);
    if (seam) return shade(n, 22, 14, 8);
    return shade(n, 232, 118, 28);
  });
}

export function paintVolleyballTexture(size: number): ImageData {
  const bands: { axis: Vec3; color: [number, number, number] }[] = [
    { axis: normalize({ x: 1, y: 0.2, z: 0 }), color: [52, 152, 219] },
    { axis: normalize({ x: 0.2, y: 1, z: 0.2 }), color: [241, 196, 15] },
    { axis: normalize({ x: 0, y: 0.25, z: 1 }), color: [149, 165, 166] },
    { axis: normalize({ x: 0.8, y: -0.3, z: 0.5 }), color: [231, 76, 60] },
    { axis: normalize({ x: -0.6, y: 0.4, z: 0.7 }), color: [46, 204, 113] },
  ];

  return paintSphere(size, (n) => {
    let best = 999;
    let col: [number, number, number] = [248, 248, 252];
    for (const b of bands) {
      const d = Math.abs(dot(n, b.axis));
      if (d < 0.11 && d < best) {
        best = d;
        col = b.color;
      }
    }
    if (best < 0.11) return shade(n, col[0], col[1], col[2]);
    return shade(n, 248, 248, 252);
  });
}

export function paintBowlingTexture(size: number, tint: number): ImageData {
  const r = (tint >> 16) & 0xff;
  const g = (tint >> 8) & 0xff;
  const b = tint & 0xff;
  const holes = [
    normalize({ x: 0.25, y: 0.82, z: 0.52 }),
    normalize({ x: -0.55, y: 0.78, z: 0.32 }),
    normalize({ x: 0.42, y: 0.76, z: -0.48 }),
  ];
  const holeRad = 0.2;

  return paintSphere(size, (n) => {
    for (const h of holes) {
      if (angularDist(n, h) < holeRad) {
        return shade(n, 12, 12, 16);
      }
    }
    return shade(n, r, g, b);
  });
}

export function paintBilliardTexture(size: number, color: number, num: number): ImageData {
  const br = (color >> 16) & 0xff;
  const bg = (color >> 8) & 0xff;
  const bb = color & 0xff;
  const spotDir = normalize({ x: 0.15, y: 0.35, z: 0.92 });
  const spotRad = 0.44;
  const right = normalize(cross(spotDir, { x: 0, y: 1, z: 0 }));
  const up = normalize(cross(right, spotDir));

  const numCanvas = document.createElement("canvas");
  numCanvas.width = 128;
  numCanvas.height = 128;
  const nctx = numCanvas.getContext("2d")!;
  nctx.fillStyle = num === 8 ? "#f8f8f8" : "#111";
  nctx.font = "bold 88px system-ui, sans-serif";
  nctx.textAlign = "center";
  nctx.textBaseline = "middle";
  nctx.fillText(String(num), 64, 68);
  const numData = nctx.getImageData(0, 0, 128, 128).data;

  const data = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const v = (py + 0.5) / size;
      const n = uvToNormal(u, v);
      const dSpot = angularDist(n, spotDir);
      let rgb: [number, number, number];
      if (dSpot < spotRad) {
        const dv = dot(n, spotDir);
        const t1 = dot(n, right) / dv;
        const t2 = dot(n, up) / dv;
        const eu = Math.floor((t1 * 0.55 + 0.5) * 128);
        const ev = Math.floor((t2 * 0.55 + 0.5) * 128);
        if (eu >= 0 && eu < 128 && ev >= 0 && ev < 128 && dv > 0.75) {
          const ei = (ev * 128 + eu) * 4;
          const na = numData[ei + 3]!;
          if (na > 80) {
            const nr = numData[ei]!;
            const ng = numData[ei + 1]!;
            const nb = numData[ei + 2]!;
            rgb = shade(n, nr, ng, nb);
          } else {
            rgb = shade(n, 252, 252, 255);
          }
        } else {
          rgb = shade(n, 252, 252, 255);
        }
      } else {
        rgb = shade(n, br, bg, bb);
      }
      setPx(data, size, px, py, rgb);
    }
  }
  return new ImageData(data, size, size);
}

/** Эмодзи на «лицевой» полусфере + сферический градиент */
export function paintEmojiTexture(size: number, emoji: string, tint: number): ImageData {
  const tr = (tint >> 16) & 0xff;
  const tg = (tint >> 8) & 0xff;
  const tb = tint & 0xff;
  const viewDir = normalize({ x: 0, y: 0.25, z: 1 });
  const right = normalize(cross(viewDir, { x: 0, y: 1, z: 0 }));
  const up = normalize(cross(right, viewDir));

  const emojiCanvas = document.createElement("canvas");
  emojiCanvas.width = 256;
  emojiCanvas.height = 256;
  const ectx = emojiCanvas.getContext("2d")!;
  ectx.clearRect(0, 0, 256, 256);
  ectx.font = "200px \"Segoe UI Emoji\", \"Apple Color Emoji\", sans-serif";
  ectx.textAlign = "center";
  ectx.textBaseline = "middle";
  ectx.fillText(emoji, 128, 138);
  const emojiData = ectx.getImageData(0, 0, 256, 256).data;

  const data = new Uint8ClampedArray(size * size * 4);
  const capDot = 0.52;
  const capScale = 0.95;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const v = (py + 0.5) / size;
      const n = uvToNormal(u, v);
      const dv = dot(n, viewDir);

      let rgb: [number, number, number];
      if (dv > capDot) {
        const t1 = dot(n, right) / dv;
        const t2 = dot(n, up) / dv;
        const eu = Math.floor((t1 / capScale + 0.5) * 256);
        const ev = Math.floor((t2 / capScale + 0.5) * 256);
        if (eu >= 0 && eu < 256 && ev >= 0 && ev < 256) {
          const ei = (ev * 256 + eu) * 4;
          const ea = emojiData[ei + 3]!;
          if (ea > 40) {
            const er = emojiData[ei]!;
            const eg = emojiData[ei + 1]!;
            const eb = emojiData[ei + 2]!;
            rgb = [
              clamp(er * 0.85 + tr * 0.15, 0, 255),
              clamp(eg * 0.85 + tg * 0.15, 0, 255),
              clamp(eb * 0.85 + tb * 0.15, 0, 255),
            ];
          } else {
            rgb = shade(n, tr, tg, tb);
          }
        } else {
          rgb = shade(n, tr, tg, tb);
        }
      } else {
        rgb = shade(n, tr, tg, tb);
      }
      setPx(data, size, px, py, rgb);
    }
  }
  return new ImageData(data, size, size);
}

export function blitImageData(ctx: CanvasRenderingContext2D, img: ImageData): void {
  ctx.putImageData(img, 0, 0);
}
