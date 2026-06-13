// 三體物理核心：PEFRL 四階辛積分 + Plummer 軟化重力 + 第四天體約束力。
// 此模組零 Three.js 依賴，可獨立推理與測試。
'use strict';

export const G = 6.67430e-11;

// PEFRL 4 階辛積分係數（Omelyan-Mryglod-Folk 2002）：4 次力評估，誤差常數遠優於 Yoshida
const XI = 0.1786178958448091, LAMBDA = -0.2123418310626054, CHI = -0.06626458266981849;
const PE_DRIFT = [XI, CHI, 1 - 2 * (CHI + XI), CHI, XI];                       // 5 個 drift 係數
const PE_KICK = [(1 - 2 * LAMBDA) / 2, LAMBDA, LAMBDA, (1 - 2 * LAMBDA) / 2];  // 4 個 kick 係數

const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

// 三主星色（紅/黃/青）+ 行星色（紫）
export const BODY_COLORS = [0xff6a4d, 0xffd166, 0x4dd6ff, 0xb388ff];

export class Simulation {
  constructor() {
    this.params = {
      masses: [2.0e7, 1.3e7, 2.9e7],   // 三主星各自質量（預設不等）
      mass4: 10, spin: 1,
      ras: 0.15,             // Plummer 軟化長度 ε
      DD: 20,                // 天體距質心超出此值視為系統解體（數值安全網）
      tempRef: 4,            // 溫度正規化參考距離（reset 時設為平均星半徑 R0）
      planetDensity: 2.0e10, // 行星密度，決定洛希（引力撕裂）半徑
      contain: true,         // 邊界收束：飛離的恆星減速折返而非逃逸
      containR: 8.0,         // 收束半徑（質心相對）
      containK: 6,           // 彈簧回復強度
      containDamp: 0.5,      // 向外徑向阻尼率
    };
    this.bodies = BODY_COLORS.map((color, i) => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      mass: i < 3 ? this.params.masses[i] : this.params.mass4, color,
    }));
    // 加速度 scratch（預配置，避免熱路徑每幀配置物件造成 GC 壓力）
    const n = this.bodies.length;
    this._ax = new Float64Array(n);
    this._ay = new Float64Array(n);
    this._az = new Float64Array(n);
    this.reset(false);
  }

  // 非共面 3D 初始組態：三星沿非共面方向、各自給 ~4 的隨機半徑，繞傾斜軸旋轉。
  // 不等質量 + 隨機半徑/初速 → 每次重置都不同，自然演化為三體混沌。
  reset(randomKick) {
    const b = this.bodies, m = this.params.masses;
    const dirs = [[0, 1, 0.5], [-0.866, -0.5, -0.6], [0.866, -0.5, 0.2]];   // 非共面基準方向
    for (let i = 0; i < 3; i++) {
      const d = dirs[i], dl = Math.hypot(d[0], d[1], d[2]);
      const r = 4 * (0.82 + Math.random() * 0.36);   // 半徑 ~4（約 3.3–4.7，含隨機）
      b[i].x = d[0] / dl * r; b[i].y = d[1] / dl * r; b[i].z = d[2] / dl * r;
      b[i].mass = m[i];
    }
    // 行星：起始於星系內側（與星體共用同一邊界收束，可在 0~containR 範圍漫遊）
    const pd = [0.4, -0.3, 0.5], pl = Math.hypot(pd[0], pd[1], pd[2]), pr = 2.5;
    b[3].x = pd[0] / pl * pr; b[3].y = pd[1] / pl * pr; b[3].z = pd[2] / pl * pr;
    b[3].mass = this.params.mass4;

    // 以實際平均半徑計算圓軌道角速度與溫度基準（與系統大小無關，維持束縛與紀元平衡）
    const mAvg = (m[0] + m[1] + m[2]) / 3;
    let R0 = 0;
    for (let i = 0; i < 3; i++) R0 += Math.hypot(b[i].x, b[i].y, b[i].z);
    R0 /= 3;
    this.params.tempRef = R0;
    const omega = this.params.spin * Math.sqrt(G * mAvg / (Math.sqrt(3) * R0 * R0 * R0));

    // 傾斜的自轉軸（非 z 軸）→ 軌道面明顯傾斜；v = ω·(軸 × r)，再疊加隨機初速
    // （即使 spin=0 三星也不會死寂；每次重置演化都不同）
    const vRef = Math.sqrt(G * mAvg / (Math.sqrt(3) * R0));   // R0 處的圓軌道速度尺度
    const axLen = Math.sqrt(0.5 * 0.5 + 0.4 * 0.4 + 1);
    const ax = 0.5 / axLen, ay = 0.4 / axLen, az = 1 / axLen;
    for (let i = 0; i < 3; i++) {
      const rx = b[i].x, ry = b[i].y, rz = b[i].z;
      b[i].vx = omega * (ay * rz - az * ry) + (Math.random() - 0.5) * vRef * 0.5;
      b[i].vy = omega * (az * rx - ax * rz) + (Math.random() - 0.5) * vRef * 0.5;
      b[i].vz = omega * (ax * ry - ay * rx) + (Math.random() - 0.5) * vRef * 0.5;
    }
    b[3].vx = 0; b[3].vy = 0; b[3].vz = 0;

    if (randomKick) {
      // 擾動而非炸開：力道遠小於軌道速度，系統維持大致束縛
      for (const body of b) {
        body.vx += (Math.random() - 0.5) * omega * 0.4;
        body.vy += (Math.random() - 0.5) * omega * 0.4;
        body.vz += (Math.random() - 0.5) * omega * 0.4;
      }
    }
  }

  // 計算全體加速度寫入 scratch 陣列 _ax/_ay/_az（零配置）。
  // 重力：Plummer 軟化 a = G·m·r/(r²+ε²)^{3/2}，每無序對只算一次，依牛頓第三定律以 ±質量套用兩體。
  #computeAccelerations(com) {
    const b = this.bodies, n = b.length;
    const ax = this._ax, ay = this._ay, az = this._az;
    ax.fill(0); ay.fill(0); az.fill(0);

    const eps2 = this.params.ras * this.params.ras;   // Plummer 軟化長度平方

    for (let i = 0; i < n; i++) {
      const bi = b[i];
      for (let j = i + 1; j < n; j++) {
        const bj = b[j];
        const dx = bj.x - bi.x, dy = bj.y - bi.y, dz = bj.z - bi.z;
        const inv3 = 1 / Math.pow(dx * dx + dy * dy + dz * dz + eps2, 1.5);
        const ux = dx * inv3, uy = dy * inv3, uz = dz * inv3;   // 方向×1/(r²+ε²)^1.5
        const gi = G * bj.mass, gj = G * bi.mass;
        ax[i] += gi * ux; ay[i] += gi * uy; az[i] += gi * uz;   // i 朝 j（+）
        ax[j] -= gj * ux; ay[j] -= gj * uy; az[j] -= gj * uz;   // j 朝 i（−）
      }
    }

    // 邊界收束（所有天體共用同一標準）：任一天體飛離質心超過 containR 時，
    // 施加彈簧回復力 + 向外徑向阻尼，使其減速折返而非逃逸。星體與行星一視同仁。
    if (this.params.contain) {
      const cR = this.params.containR, cK = this.params.containK, cD = this.params.containDamp;
      let mSys = 0; for (let i = 0; i < n; i++) mSys += b[i].mass;
      const gM = G * mSys;
      for (let i = 0; i < n; i++) {
        const s = b[i];
        const rx = s.x - com.x, ry = s.y - com.y, rz = s.z - com.z;
        const rdist = Math.max(len(rx, ry, rz), 1e-5);
        if (rdist > cR) {
          const ux = rx / rdist, uy = ry / rdist, uz = rz / rdist;   // 向外單位向量
          let a = cK * gM * (rdist - cR);                            // 彈簧回復（指向質心）
          const vr = s.vx * ux + s.vy * uy + s.vz * uz;              // 徑向速度（向外為正）
          if (vr > 0) a += cD * vr;                                  // 僅減速向外運動
          ax[i] -= a * ux; ay[i] -= a * uy; az[i] -= a * uz;
        }
      }
    }
  }

  // 單一 PEFRL 四階辛步：drift-kick 交替（5 drift + 4 kick，4 次力評估）
  step(h) {
    const b = this.bodies, n = b.length;
    const com = this.centerOfMass();
    const ax = this._ax, ay = this._ay, az = this._az;
    for (let s = 0; s < 5; s++) {
      const cs = PE_DRIFT[s] * h;
      for (let i = 0; i < n; i++) {
        const body = b[i];
        body.x += cs * body.vx; body.y += cs * body.vy; body.z += cs * body.vz;
      }
      if (s < 4) {
        this.#computeAccelerations(com);
        const ds = PE_KICK[s] * h;
        for (let i = 0; i < n; i++) {
          b[i].vx += ds * ax[i]; b[i].vy += ds * ay[i]; b[i].vz += ds * az[i];
        }
      }
    }
  }

  centerOfMass() {
    let m = 0, x = 0, y = 0, z = 0;
    for (const b of this.bodies) { m += b.mass; x += b.mass * b.x; y += b.mass * b.y; z += b.mass * b.z; }
    return m > 0 ? { x: x / m, y: y / m, z: z / m } : { x: 0, y: 0, z: 0 };
  }

  // 與 Plummer 軟化力一致的兩體位能（每單位 G·m_i·m_j）：U = −1/√(d²+ε²)，F=−dU/dd，U(∞)=0
  #softPotential(d) {
    return -1 / Math.sqrt(d * d + this.params.ras * this.params.ras);
  }

  totalEnergy() {
    const b = this.bodies, P = this.params;
    let ke = 0;
    for (const body of b) ke += 0.5 * body.mass * (body.vx * body.vx + body.vy * body.vy + body.vz * body.vz);

    let pe = 0;
    for (let i = 0; i < b.length; i++)
      for (let j = i + 1; j < b.length; j++) {
        const d = len(b[i].x - b[j].x, b[i].y - b[j].y, b[i].z - b[j].z);
        pe += G * b[i].mass * b[j].mass * this.#softPotential(d);   // Plummer 一致位能
      }

    // 邊界收束彈簧位能（所有天體 dist>containR）：½·m·cK·G·M_sys·(d−cR)²
    if (P.contain) {
      const com = this.centerOfMass();
      let mSys = 0; for (const bb of b) mSys += bb.mass;
      const gM = G * mSys;
      for (let i = 0; i < b.length; i++) {
        const d = Math.max(len(b[i].x - com.x, b[i].y - com.y, b[i].z - com.z), 1e-5);
        if (d > P.containR) pe += 0.5 * b[i].mass * P.containK * gM * (d - P.containR) * (d - P.containR);
      }
    }

    return ke + pe;
  }

  maxDistFromCOM() {
    const com = this.centerOfMass();
    let d = 0;
    for (const b of this.bodies) d = Math.max(d, len(b.x - com.x, b.y - com.y, b.z - com.z));
    return d;
  }

  // 行星接收三星輻射通量與正規化溫度（恆/亂紀元判定的輸入）
  // T = (Σ massᵢ/distᵢ²  /  Σ massᵢ)^(1/4)：所有星距 1 時 T=1（宜居基準）
  planetEnvironment() {
    const p = this.bodies[3];
    let flux = 0, ref = 0, nearest = Infinity, nearestMass = this.bodies[0].mass;
    const dists = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const s = this.bodies[i];
      const d2 = Math.max((p.x - s.x) ** 2 + (p.y - s.y) ** 2 + (p.z - s.z) ** 2, 1e-4);
      const d = Math.sqrt(d2);
      flux += s.mass / d2;
      ref += s.mass;
      dists[i] = d;
      if (d < nearest) { nearest = d; nearestMass = s.mass; }
    }
    // 正規化溫度：以系統半徑 tempRef 為基準（不隨系統大小改變），再乘校準常數
    // 0.7 使「居中行星 + 恆星近掠通量暴衝」下的均溫落回宜居帶中央
    const temperature = Math.pow(flux / ref, 0.25) * Math.sqrt(this.params.tempRef) * 0.7;
    // 引力撕裂閾值：對最近恆星計算流體洛希極限
    return { temperature, nearestDist: nearest, dists, flux, rocheLimit: this.rocheLimit(nearestMass) };
  }

  // 流體洛希極限：d = 2.44·(3·M_star / (4π·ρ_planet))^{1/3}
  // 恆星密度於推導中約掉，僅依恆星質量與行星密度；隨 M^{1/3} 縮放。
  rocheLimit(starMass) {
    return 2.44 * Math.cbrt(3 * starMass / (4 * Math.PI * this.params.planetDensity));
  }

  // 恆星表面色溫（K）：以主序質量-溫度關係為基礎，但放寬指數與範圍以加大色彩變化（非嚴格物理）
  starTemperature(i) {
    const T = 6200 * Math.pow(this.bodies[i].mass / 2e7, 0.9);
    return Math.min(Math.max(T, 3200), 13000);
  }

  setStarMass(i, v) { this.params.masses[i] = v; this.bodies[i].mass = v; }
  setMass4(v) { this.params.mass4 = v; this.bodies[3].mass = v; }
}
