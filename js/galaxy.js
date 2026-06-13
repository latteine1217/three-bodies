// 程序烘焙的高解析銀河等距柱狀（equirectangular）貼圖：傾斜銀河帶 + 銀心隆起 +
// 暗塵縫 + 暖核冷臂星雲 + 細絲星雲 + 密集星帶。一次生成，貼於大型內翻球作為可旋轉背景。
// 想換真實照片：改成 new THREE.TextureLoader().load('milkyway.jpg')（2:1 equirect）即可。
import * as THREE from 'three';

export function makeGalaxyTexture() {
  const W = 4096, H = 2048;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const rnd = Math.random;

  ctx.fillStyle = '#010208';
  ctx.fillRect(0, 0, W, H);

  const coreX = W * 0.5;
  const tilt = H * 0.26;
  const phase = 0.6;
  const bandY = x => H * 0.5 + tilt * Math.sin((x / W) * Math.PI * 2 + phase);
  const sigma = H * 0.10;

  function glow(x, y, r, col, a) {
    for (const xx of [x, x - W, x + W]) {
      if (xx < -r || xx > W + r) continue;
      const g = ctx.createRadialGradient(xx, y, 0, xx, y, r);
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(xx - r, y - r, r * 2, r * 2);
    }
  }

  ctx.globalCompositeOperation = 'lighter';

  // 1) 全天微弱星（疏，銀河帶附近略密）
  for (let i = 0; i < 6000; i++) {
    const x = rnd() * W, y = rnd() * H;
    const d = (y - bandY(x)) / sigma;
    if (rnd() > Math.exp(-d * d * 0.5) * 0.6 + 0.1) continue;
    glow(x, y, 0.7 + rnd() * 0.9, '255,255,255', (0.25 + rnd() * 0.4) * 0.6);
  }

  // 2) 銀河帶星雲輝光（大尺度底襯，暗以避免被 bloom 放大成霧）
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * W, yc = bandY(x);
    const y = yc + (rnd() - 0.5) * sigma * 2.0 * (0.5 + rnd());
    const d = (y - yc) / sigma, fall = Math.exp(-d * d * 0.7);
    if (rnd() > fall) continue;
    const dxCore = Math.min(Math.abs(x - coreX), W - Math.abs(x - coreX)) / (W * 0.5);
    const warm = 1 - dxCore;
    let col;
    if (rnd() < 0.1) col = '185,100,130';
    else if (rnd() < warm * 0.7) col = '165,128,80';
    else col = '100,122,180';
    glow(x, y, 55 + rnd() * 160, col, 0.012 + 0.026 * fall);
  }

  // 2b) 細絲星雲（小尺度，增加細緻度）
  for (let i = 0; i < 2200; i++) {
    const x = rnd() * W, yc = bandY(x);
    const y = yc + (rnd() - 0.5) * sigma * 2.6;
    const d = (y - yc) / sigma, fall = Math.exp(-d * d * 0.8);
    if (rnd() > fall) continue;
    const dxCore = Math.min(Math.abs(x - coreX), W - Math.abs(x - coreX)) / (W * 0.5);
    let col = rnd() < (1 - dxCore) * 0.6 ? '180,140,90' : '110,130,190';
    glow(x, y, 12 + rnd() * 45, col, 0.02 + 0.03 * fall);
  }

  // 2c) 外盤反射星雲（藍調、廣域低強度）：散射星光，使盤面外側有微弱輝光而非驟暗
  for (let i = 0; i < 700; i++) {
    const x = rnd() * W, yc = bandY(x);
    const y = yc + (rnd() - 0.5) * sigma * 6.0;     // 垂直分布更廣，延伸到外盤
    const d = (y - yc) / sigma, fall = Math.exp(-d * d * 0.06);   // 緩 falloff
    if (rnd() > fall) continue;
    glow(x, y, 90 + rnd() * 220, '70,95,150', 0.006 + 0.010 * fall);
  }

  // 3) 銀心隆起（暖色焦點，收斂亮度避免過曝）
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
    glow(coreX + Math.cos(a) * rr * W * 0.07,
      bandY(coreX) + Math.sin(a) * rr * sigma * 1.1,
      70 + rnd() * 200, '205,165,115', 0.02);
  }
  glow(coreX, bandY(coreX), 440, '220,180,130', 0.05);

  // 4) 暗塵縫（粗 + 細，沿帶壓暗，加強對比與層次）
  ctx.globalCompositeOperation = 'source-over';
  function dust(count, rMin, rMax, aMin, aMax, spread) {
    for (let i = 0; i < count; i++) {
      const x = rnd() * W, y = bandY(x) + (rnd() - 0.5) * sigma * spread;
      const r = rMin + rnd() * (rMax - rMin);
      for (const xx of [x, x - W, x + W]) {
        const g = ctx.createRadialGradient(xx, y, 0, xx, y, r);
        g.addColorStop(0, `rgba(1,2,8,${aMin + rnd() * (aMax - aMin)})`);
        g.addColorStop(1, 'rgba(1,2,8,0)');
        ctx.fillStyle = g; ctx.fillRect(xx - r, y - r, r * 2, r * 2);
      }
    }
  }
  // 暗塵：較淡且更分散（斑駁感，不在中線形成硬縫把銀河劈兩半）
  dust(420, 45, 150, 0.08, 0.18, 1.6);   // 粗塵帶
  dust(800, 12, 48, 0.06, 0.14, 2.0);    // 細塵絲

  // 5) 帶內密集星 + 少數亮星（最上層）
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6000; i++) {
    const x = rnd() * W, y = bandY(x) + (rnd() - 0.5) * sigma * 3;
    const d = (y - bandY(x)) / sigma;
    if (rnd() > Math.exp(-d * d * 0.5)) continue;
    glow(x, y, 0.7 + rnd() * 0.8, '255,250,240', 0.4 + rnd() * 0.5);
  }
  for (let i = 0; i < 110; i++) {
    const pal = ['255,255,255', '200,215,255', '255,225,190'][(rnd() * 3) | 0];
    glow(rnd() * W, rnd() * H, 2 + rnd() * 4, pal, 0.9);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
