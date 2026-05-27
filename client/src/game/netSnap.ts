/** Два серверных снимка для интерполяции 30→60 Гц. */
export interface NetSample {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  radius: number;
}

export interface NetPair {
  from: NetSample;
  to: NetSample;
}

export function netSampleFromPlayer(
  p: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vz: number;
    qx: number;
    qy: number;
    qz: number;
    qw: number;
    radius: number;
  },
  t: number,
): NetSample {
  return {
    t,
    x: p.x,
    y: p.y,
    z: p.z,
    vx: p.vx,
    vz: p.vz,
    qx: p.qx,
    qy: p.qy,
    qz: p.qz,
    qw: p.qw,
    radius: p.radius,
  };
}

export function pushNetPair(
  pairs: Map<string, NetPair>,
  id: string,
  sample: NetSample,
): void {
  const cur = pairs.get(id);
  if (!cur) {
    pairs.set(id, { from: sample, to: sample });
    return;
  }
  if (sample.t < cur.to.t) return;
  if (sample.t === cur.to.t) {
    cur.to = sample;
    return;
  }
  cur.from = cur.to;
  cur.to = sample;
}

const MAX_EXTRAP_MS = 100;

export function sampleNetPair(pair: NetPair, renderT: number): NetSample {
  const { from, to } = pair;
  if (to.t <= from.t + 0.5) return to;
  if (renderT <= from.t) return from;
  if (renderT > to.t) {
    const aheadMs = Math.min(MAX_EXTRAP_MS, renderT - to.t);
    const dt = aheadMs / 1000;
    return {
      t: renderT,
      x: to.x + to.vx * dt,
      y: to.y,
      z: to.z + to.vz * dt,
      vx: to.vx,
      vz: to.vz,
      qx: to.qx,
      qy: to.qy,
      qz: to.qz,
      qw: to.qw,
      radius: to.radius,
    };
  }
  const f = (renderT - from.t) / (to.t - from.t);
  return {
    t: renderT,
    x: from.x + (to.x - from.x) * f,
    y: from.y + (to.y - from.y) * f,
    z: from.z + (to.z - from.z) * f,
    vx: from.vx + (to.vx - from.vx) * f,
    vz: from.vz + (to.vz - from.vz) * f,
    qx: from.qx + (to.qx - from.qx) * f,
    qy: from.qy + (to.qy - from.qy) * f,
    qz: from.qz + (to.qz - from.qz) * f,
    qw: from.qw + (to.qw - from.qw) * f,
    radius: from.radius + (to.radius - from.radius) * f,
  };
}
