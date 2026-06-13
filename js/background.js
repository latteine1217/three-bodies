// 太空背景：靜態銀河貼圖（scene.background）+ 雙層視差星場 +
// 遠方裝飾亮星（不參與四體計算，純為層次與真實感）。
import * as THREE from 'three';
import { makeGalaxyTexture } from './galaxy.js';

const STAR_PALETTE = [
  [1.0, 1.0, 1.0], [0.78, 0.85, 1.0], [1.0, 0.88, 0.7], [0.9, 0.93, 1.0], [1.0, 0.78, 0.6],
];

// 一層視差星場（近於銀河貼圖，旋轉視角時產生位移感）
function makeStarLayer(count, size, minB, maxB, rMin, rMax) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = rMin + Math.random() * (rMax - rMin);
    const t = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(t);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(t);
    pos[i * 3 + 2] = r * Math.cos(ph);
    const c = STAR_PALETTE[(Math.random() * STAR_PALETTE.length) | 0];
    const b = minB + Math.random() * (maxB - minB);
    col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true }));
}

// 暈圈貼圖（給遠方亮星）
function glowTexture() {
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

// 遠方裝飾亮星：固定位置、不參與物理，營造鄰近恆星的層次感
function makeDistantStars() {
  const group = new THREE.Group();
  const tex = glowTexture();
  const palette = [0xfff2e0, 0xcfe0ff, 0xffd2a0, 0xff9a7a, 0xbcd0ff];
  // [x, y, z, 大小, 顏色索引]（半徑 ~70–130，位於視差星場與四體之間）
  const defs = [
    [60, 20, -40, 1.0, 0], [-72, -15, -52, 0.8, 1], [42, 50, -95, 1.3, 2],
    [-95, 28, 34, 0.7, 3], [82, -32, 52, 0.9, 1], [-52, -44, -82, 1.1, 4], [26, 64, 74, 0.6, 0],
  ];
  for (const [x, y, z, s, ci] of defs) {
    const col = palette[ci];
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    halo.position.set(x, y, z);
    halo.scale.setScalar(s * 4);
    group.add(halo);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(s * 0.3, 12, 12),
      new THREE.MeshBasicMaterial({ color: col }),
    );
    core.position.set(x, y, z);
    group.add(core);
  }
  return group;
}

// 銀河貼於大型內翻球（可隨群組旋轉，不同於綁相機的 scene.background）
function makeGalaxySphere() {
  const geo = new THREE.SphereGeometry(800, 64, 32);
  const mat = new THREE.MeshBasicMaterial({ map: makeGalaxyTexture(), side: THREE.BackSide });
  return new THREE.Mesh(geo, mat);
}

const SPIN_AXIS = new THREE.Vector3(0.3, 1, 0.15).normalize();
const SPIN_RATE = 0.01;   // rad/s，全圈約 10 分鐘

export function createBackground() {
  const group = new THREE.Group();
  group.add(makeGalaxySphere());                              // 銀河天球
  group.add(makeStarLayer(3000, 1.0, 0.25, 0.65, 200, 360)); // 視差暗星
  group.add(makeStarLayer(120, 2.2, 0.8, 1.2, 200, 360));    // 視差亮星
  group.add(makeDistantStars());
  return {
    group,
    update(dt) { group.rotateOnWorldAxis(SPIN_AXIS, SPIN_RATE * dt); },  // 整體緩慢自轉
  };
}
