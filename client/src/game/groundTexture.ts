/**
 * Процедурная текстура «асфальт» для пола арены.
 *
 * — Бесшовно тайлится: noise-функции используют по-модульный hash и
 *   возвращают одинаковые значения на противоположных краях канваса.
 * — Тёплый тёмно-серый базовый цвет + три октавы зерна разной частоты
 *   (мелкая щебёнка / средние пятна / общий градиент).
 * — Немного «жирных» тёмных пятен через пороговую функцию noise — имитация
 *   масляных подтёков и неровного асфальта.
 */

export const GROUND_TEX_SIZE = 1024;
export const GROUND_TEX_VERSION = 1;

function hash(xi: number, yi: number, period: number): number {
  const px = ((xi % period) + period) % period;
  const py = ((yi % period) + period) % period;
  const h = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/** Билинейный шум с периодом `period` (бесшовно повторяется по X и Y). */
function tileNoise(x: number, y: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, period);
  const b = hash(xi + 1, yi, period);
  const c = hash(xi, yi + 1, period);
  const d = hash(xi + 1, yi + 1, period);
  const ab = a * (1 - u) + b * u;
  const cd = c * (1 - u) + d * u;
  return ab * (1 - v) + cd * v;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Создаёт ImageData со «свежим» асфальтом, готовый к записи в DynamicTexture.
 * Текстуру стоит вешать на пол с uScale/vScale = ARENA_SIZE / 6 (одна
 * «плитка» ≈ 6 метров, мелкое зерно различимо вблизи и сливается вдали).
 */
export function paintAsphaltTexture(size: number): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);

  // Базовый цвет: тёмный тёплый графит. Чуть холоднее, чем уличный асфальт,
  // чтобы попадать в палитру UI (тёмно-сине-серый фон).
  const baseR = 38;
  const baseG = 40;
  const baseB = 46;

  // Частоты слоёв шума — все делятся на size, поэтому тайлинг бесшовен.
  // (period = число ячеек на canvas; пиксельный шаг = size / period)
  const FINE = 384; // мелкие зёрна щебня (≈3 пикселя на «камешек»)
  const MED = 64; // средние пятна асфальтового покрытия
  const COARSE = 12; // крупные перепады освещённости

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;

      const fine = tileNoise(u * FINE, v * FINE, FINE);
      const med = tileNoise(u * MED, v * MED, MED);
      const coarse = tileNoise(u * COARSE, v * COARSE, COARSE);

      // Зерно: распределение около 0.5 → отклонение в обе стороны
      const grain = (fine - 0.5) * 26 + (med - 0.5) * 14 + (coarse - 0.5) * 8;

      // Редкие тёмные «пятна» — там, где средний шум сильно ниже порога
      const blot = med < 0.18 ? -10 * (0.18 - med) * 5 : 0;

      // Лёгкая цветовая вариация: зерно с разными смещениями (бежевые/синие зёрна)
      const tintBlue = (fine - 0.5) * 4;
      const tintWarm = (med - 0.5) * 3;

      const r = clamp(baseR + grain + blot + tintWarm, 14, 90);
      const g = clamp(baseG + grain + blot, 14, 90);
      const b = clamp(baseB + grain + blot + tintBlue, 14, 90);

      const i = (py * size + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }

  return new ImageData(data, size, size);
}
