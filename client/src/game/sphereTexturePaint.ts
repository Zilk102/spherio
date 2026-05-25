/**
 * Процедурные текстуры для Babylon CreateSphere:
 * каждый пиксель = точка на сфере (u,v → нормаль), узор в сферических координатах.
 * UV совпадает с MeshBuilder.CreateSphere (coordv = acos(y) / π).
 */

const PHI = (1 + Math.sqrt(5)) / 2;

export const SPHERE_TEX_SIZE = 1024;
export const SPHERE_TEX_VERSION = 12;

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

/**
 * Реальное соответствие canvas-pixel → сфера в Babylon.
 *
 * CreateSphere пишет uv = (normalizedY, normalizedZ), где
 *   normalizedZ = 0 → angleZ = 0  → вершина (0,1,0)  — ВЕРХ
 *   normalizedZ = 1 → angleZ = π  → вершина (0,-1,0) — НИЗ
 * (useOpenGLOrientationForUV = false по умолчанию).
 *
 * DynamicTexture.update() по умолчанию передаёт invertY = true (см.
 * dynamicTexture.pure.ts: `invertY === undefined ? true : invertY`), значит
 * canvas-pixel с py=0 (верх холста) попадает в текстуру с uv.y = 1, то есть
 * на НИЖНЮЮ половину сферы. Поэтому в формуле нормали Y инвертируется.
 *
 * Источник: packages/dev/core/src/Meshes/Builders/sphereBuilder.pure.ts
 */
export function uvToNormal(u: number, v: number): Vec3 {
  const beta = v * Math.PI;
  const alpha = u * 2 * Math.PI;
  const sinB = Math.sin(beta);
  return {
    x: sinB * Math.cos(alpha),
    y: -Math.cos(beta),
    z: sinB * Math.sin(alpha),
  };
}

function angularDist(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(a, b), -1, 1));
}

/** Без направленного затемнения — объём даёт свет сцены, иначе «пятно» крутится с текстурой */
function shade(_n: Vec3, r: number, g: number, b: number): [number, number, number] {
  return [r, g, b];
}

/** Линейное смешивание двух цветов по фактору t ∈ [0,1] */
function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t];
}

/** Плавный edge: возвращает 0 при x<e0, 1 при x>e1, плавно между */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Простой 2D-хеш для шума (детерминированный) */
function hash3(x: number, y: number, z: number): number {
  let h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

/** Гладкий 3D шум (value noise на нормализованной нормали) */
function noise3(p: Vec3, freq: number): number {
  const x = p.x * freq;
  const y = p.y * freq;
  const z = p.z * freq;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c000 = hash3(xi, yi, zi);
  const c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi);
  const c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1);
  const c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);
  const x00 = c000 * (1 - u) + c100 * u;
  const x10 = c010 * (1 - u) + c110 * u;
  const x01 = c001 * (1 - u) + c101 * u;
  const x11 = c011 * (1 - u) + c111 * u;
  const y0 = x00 * (1 - v) + x10 * v;
  const y1 = x01 * (1 - v) + x11 * v;
  return y0 * (1 - w) + y1 * w;
}

function fbm(p: Vec3, freq: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = freq;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(p, f) * amp;
    f *= 2.07;
    amp *= 0.5;
  }
  return sum;
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

// ─────────────────────────────────────────────────────────────
// ⚽ Футбол (классический truncated icosahedron, Telstar)
//   12 чёрных пятиугольников + 20 белых шестиугольников.
//   Швы прошиты, фон не идеально-белый, у пятиугольника тонкая обводка.
// ─────────────────────────────────────────────────────────────
export function paintFootballTexture(size: number): ImageData {
  const seeds = soccerSeeds();
  const seamW = 0.024;
  const stitchW = 0.05;
  const hexColor: [number, number, number] = [244, 244, 246];
  const pentColor: [number, number, number] = [22, 22, 26];
  const seamColor: [number, number, number] = [12, 12, 14];
  const stitchColor: [number, number, number] = [86, 86, 92];

  return paintSphere(size, (n) => {
    const { d1, d2, pent } = nearestSeeds(n, seeds);
    const seamGap = d2 - d1;
    if (seamGap < seamW) {
      return seamColor;
    }
    // тонкая «прошивка» — пунктирные стежки вдоль шва
    if (seamGap < stitchW) {
      const lon = Math.atan2(n.z, n.x);
      const lat = Math.asin(clamp(n.y, -1, 1));
      const tick = Math.sin(lon * 64 + lat * 64);
      if (tick > 0.6) return stitchColor;
    }
    return pent ? pentColor : hexColor;
  });
}

// ─────────────────────────────────────────────────────────────
// 🏀 Баскетбол (Spalding-style, 8 кожаных панелей).
//
//   Швы — четыре больших круга (great circles) с нормалями, лежащими
//   в плоскости YZ. Все они проходят через точки ±X (бока мяча), но
//   их пересечения разбросаны по сфере, поэтому с любого ракурса
//   видно 4 различимых шва, образующих 8 панелей:
//
//     • экватор:  плоскость XZ,         нормаль (0, 1,  0)
//     • меридиан: плоскость YZ,         нормаль (1, 0,  0)
//     • верхняя «C»-дуга:               нормаль (0, 1, -1)/√2
//     • нижняя  «C»-дуга:               нормаль (0, 1,  1)/√2
//
//   На фронте сферы это даёт «+» в центре и две дуги, обнимающие
//   верх и низ передней панели — как на настоящем мяче.
//   Плюс мягкое затемнение по краю шва и pebble-фактура кожи.
// ─────────────────────────────────────────────────────────────
export function paintBasketballTexture(size: number): ImageData {
  const baseColor: [number, number, number] = [222, 108, 32];
  const baseDark: [number, number, number] = [188, 86, 22];
  const seamColor: [number, number, number] = [16, 10, 4];
  const seamHalf = 0.018;
  const seamSoft = 0.030;
  const inv = Math.SQRT1_2;

  return paintSphere(size, (n) => {
    // геодезические расстояния до 4 great-circle (через arcsin модуля
    // скалярного произведения с нормалью плоскости круга)
    const d1 = Math.abs(n.y);
    const d2 = Math.abs(n.x);
    const d3 = Math.abs(n.y - n.z) * inv;
    const d4 = Math.abs(n.y + n.z) * inv;
    const d = Math.min(d1, d2, d3, d4);

    if (d < seamHalf) return seamColor;

    const pebble = fbm(n, 42, 3);
    const k = 1 - 0.09 * pebble;
    const skin: [number, number, number] = [
      baseColor[0] * k,
      baseColor[1] * k,
      baseColor[2] * k,
    ];
    if (d < seamSoft) {
      const t = smoothstep(seamSoft, seamHalf, d);
      return mix(skin, mix(skin, baseDark, 0.55), t);
    }
    return skin;
  });
}

// ─────────────────────────────────────────────────────────────
// 🏐 Волейбол (18-panel Mikasa: 6 «лиц» куба × 3 полоски)
//   Чередующиеся цветные полосы по типу пляжного мяча,
//   чёткие швы между панелями.
// ─────────────────────────────────────────────────────────────
export function paintVolleyballTexture(size: number): ImageData {
  const whiteCol: [number, number, number] = [248, 248, 252];
  const blueCol: [number, number, number] = [40, 110, 200];
  const yellowCol: [number, number, number] = [248, 200, 30];
  const seamCol: [number, number, number] = [40, 40, 48];
  const seamW = 0.015;

  return paintSphere(size, (n) => {
    // Какая «грань куба» — где |n| максимально
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    let face: "x" | "y" | "z";
    let s: number; // координата внутри грани (для деления на полоски)
    let t: number; // вторая координата (для шва между полосками)
    if (ax >= ay && ax >= az) {
      face = "x";
      s = n.y / ax;
      t = n.z / ax;
    } else if (ay >= ax && ay >= az) {
      face = "y";
      s = n.z / ay;
      t = n.x / ay;
    } else {
      face = "z";
      s = n.x / az;
      t = n.y / az;
    }
    // Швы между гранями куба (когда мы на ребре, |s| или |t| близко к 1)
    const edgeDist = Math.min(1 - Math.abs(s), 1 - Math.abs(t));
    if (edgeDist < seamW) return seamCol;

    // Деление каждой грани на 3 полосы по координате t
    // полоса: -1..-1/3, -1/3..1/3, 1/3..1
    const stripe = t < -1 / 3 ? 0 : t < 1 / 3 ? 1 : 2;

    // Тонкий шов между полосками
    if (Math.abs(t - (-1 / 3)) < seamW || Math.abs(t - 1 / 3) < seamW) return seamCol;

    // Цвет полосы: чередуем по грани + индексу
    const faceIdx = face === "x" ? 0 : face === "y" ? 1 : 2;
    const palette = [whiteCol, blueCol, yellowCol];
    const idx = (faceIdx + stripe) % 3;
    return palette[idx]!;
  });
}

// ─────────────────────────────────────────────────────────────
// 🎳 Боулинг (глянец, мраморные разводы, 3 отверстия + обводка)
// ─────────────────────────────────────────────────────────────
export function paintBowlingTexture(size: number, tint: number): ImageData {
  const baseR = (tint >> 16) & 0xff;
  const baseG = (tint >> 8) & 0xff;
  const baseB = tint & 0xff;
  const base: [number, number, number] = [baseR, baseG, baseB];
  const accent: [number, number, number] = [
    clamp(baseR + 50, 0, 255),
    clamp(baseG + 30, 0, 255),
    clamp(baseB + 80, 0, 255),
  ];
  const holeColor: [number, number, number] = [10, 8, 14];
  const holeRimColor: [number, number, number] = [
    Math.max(0, baseR * 0.5),
    Math.max(0, baseG * 0.5),
    Math.max(0, baseB * 0.5),
  ];

  // 3 отверстия лицом к камере (+Z): большой палец сверху, два пальца снизу
  const holes = [
    normalize({ x: 0.0, y: 0.45, z: 0.92 }), // большой палец (сверху по центру)
    normalize({ x: -0.32, y: -0.05, z: 0.96 }),
    normalize({ x: 0.32, y: -0.05, z: 0.96 }),
  ];
  const holeR = 0.13;
  const rimR = 0.17;

  return paintSphere(size, (n) => {
    for (const h of holes) {
      const d = angularDist(n, h);
      if (d < holeR) return holeColor;
      if (d < rimR) {
        // плавная тёмная окантовка отверстия
        const t = smoothstep(holeR, rimR, d);
        return mix(holeRimColor, base, t);
      }
    }
    // мраморный паттерн: турбулентный шум
    const swirl = fbm({ x: n.x + fbm(n, 4, 2) * 0.5, y: n.y, z: n.z + fbm(n, 4, 2) * 0.5 }, 3, 4);
    const t = clamp(swirl * 1.5 - 0.2, 0, 1);
    return mix(base, accent, t * 0.45);
  });
}

// ─────────────────────────────────────────────────────────────
// 🎱 Бильярд (восьмёрка): solid цвет + белый круг с цифрой
// ─────────────────────────────────────────────────────────────
export function paintBilliardTexture(size: number, color: number, num: number): ImageData {
  const br = (color >> 16) & 0xff;
  const bg = (color >> 8) & 0xff;
  const bb = color & 0xff;
  const baseColor: [number, number, number] = [br, bg, bb];
  const circleColor: [number, number, number] = [250, 250, 252];
  const numColor: [number, number, number] = [22, 22, 26];

  // Белый круг — прямо лицом к камере (+Z)
  const spotDir = normalize({ x: 0.0, y: 0.0, z: 1.0 });
  const spotInner = 0.34; // угол ядра круга (rad)
  const spotEdge = 0.38; // мягкое затухание

  // Цифра рендерится в маленький канвас и проецируется ортографически
  // на «купол» вокруг spotDir.
  const N = 256;
  const numCanvas = document.createElement("canvas");
  numCanvas.width = N;
  numCanvas.height = N;
  const nctx = numCanvas.getContext("2d")!;
  nctx.fillStyle = "rgba(0,0,0,0)";
  nctx.clearRect(0, 0, N, N);
  nctx.fillStyle = "#fff"; // alpha-маска: непрозрачное = там, где цифра
  nctx.font = `900 ${Math.floor(N * 0.78)}px "Inter", "SF Pro Display", system-ui, sans-serif`;
  nctx.textAlign = "center";
  nctx.textBaseline = "middle";
  nctx.fillText(String(num), N / 2, N * 0.54);
  const numData = nctx.getImageData(0, 0, N, N).data;

  // Базис для ортопроекции вокруг spotDir = +Z:
  //   right = +X (вправо в кадре с точки зрения камеры на +Z)
  //   up    = +Y (вверх)
  const right: Vec3 = { x: 1, y: 0, z: 0 };
  const up: Vec3 = { x: 0, y: 1, z: 0 };

  return paintSphere(size, (n) => {
    const dSpot = angularDist(n, spotDir);
    if (dSpot > spotEdge) {
      return baseColor;
    }
    // плавный край белого круга
    const circleT = smoothstep(spotEdge, spotInner, dSpot);
    const onCircle = mix(baseColor, circleColor, circleT);

    // Проекция нормали на касательную плоскость в spotDir
    const t1 = dot(n, right); // [-1..1]
    const t2 = dot(n, up);    // [-1..1]
    // приводим к [-1..1] так, чтобы цифра вписывалась в круг
    const k = 1 / Math.sin(spotInner * 0.95);
    const eu = Math.floor((t1 * k * 0.5 + 0.5) * N);
    const ev = Math.floor((0.5 - t2 * k * 0.5) * N); // canvas Y вниз — t2>0 → ev<0.5
    if (eu >= 0 && eu < N && ev >= 0 && ev < N) {
      const ei = (ev * N + eu) * 4;
      const na = numData[ei + 3]!;
      if (na > 100) {
        return mix(onCircle, numColor, na / 255);
      }
    }
    return onCircle;
  });
}

/** @deprecated — теперь эмодзи делаются через Babylon CreateDecal в skinTextures.ts */
export function paintEmojiTexture(size: number, emoji: string, tint: number): ImageData {
  const E = 384;
  const emojiCanvas = document.createElement("canvas");
  emojiCanvas.width = E;
  emojiCanvas.height = E;
  const ectx = emojiCanvas.getContext("2d")!;
  ectx.clearRect(0, 0, E, E);
  // ~78% от размера канваса — лицо занимает основную часть передней полусферы
  ectx.font = `${Math.floor(E * 0.78)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ectx.textAlign = "center";
  ectx.textBaseline = "middle";
  ectx.fillText(emoji, E / 2, E / 2);
  const emojiData = ectx.getImageData(0, 0, E, E).data;

  // Доминирующий цвет глифа (среднее по непрозрачным пикселям)
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let i = 0; i < emojiData.length; i += 4) {
    const a = emojiData[i + 3]!;
    if (a < 220) continue;
    sr += emojiData[i]!;
    sg += emojiData[i + 1]!;
    sb += emojiData[i + 2]!;
    sn++;
  }
  let baseR = 220, baseG = 220, baseB = 220;
  if (sn > 0) {
    baseR = sr / sn;
    baseG = sg / sn;
    baseB = sb / sn;
  }
  // Если игрок явно выбрал цвет (не белый) — используем его как основу
  const userPicked = (tint & 0xffffff) !== 0xffffff;
  if (userPicked) {
    baseR = (tint >> 16) & 0xff;
    baseG = (tint >> 8) & 0xff;
    baseB = tint & 0xff;
  }

  const data = new Uint8ClampedArray(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const v = (py + 0.5) / size;
      const n = uvToNormal(u, v);

      let r = baseR;
      let g = baseG;
      let b = baseB;

      if (n.z > 0) {
        // Ортопроекция передней полусферы на канвас глифа:
        //  n.x ∈ [-1, 1] → eu ∈ [0, E];  n.y ∈ [-1, 1] (вверх) → ev ∈ [E, 0]
        const eu = Math.floor((n.x + 1) * 0.5 * E);
        const ev = Math.floor((1 - n.y) * 0.5 * E);
        if (eu >= 0 && eu < E && ev >= 0 && ev < E) {
          const ei = (ev * E + eu) * 4;
          const ea = emojiData[ei + 3]!;
          if (ea > 8) {
            // Затухание у силуэта (n.z → 0), чтобы не было «пиксельного» обреза
            const edge = clamp(n.z * 4, 0, 1);
            const a = (ea / 255) * edge;
            r = emojiData[ei]! * a + baseR * (1 - a);
            g = emojiData[ei + 1]! * a + baseG * (1 - a);
            b = emojiData[ei + 2]! * a + baseB * (1 - a);
          }
        }
      }

      setPx(data, size, px, py, shade(n, r, g, b));
    }
  }
  return new ImageData(data, size, size);
}

export function blitImageData(ctx: CanvasRenderingContext2D, img: ImageData): void {
  ctx.putImageData(img, 0, 0);
}
