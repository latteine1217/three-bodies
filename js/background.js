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

// 塵埃閃爍 shader：每點帶獨立相位/頻率，亮度與尺寸隨 time 脈動；圓形柔邊 + additive。
const DUST_VERT = /* glsl */`
attribute vec3 acolor;
attribute float aphase;
attribute float arate;
uniform float time;
uniform float uSize;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vTw;
void main(){
  float tw = clamp(0.4 + 0.6 * sin(time * arate + aphase), 0.0, 1.0);  // 0~1 脈動（略偏暗底）
  vTw = tw;
  vColor = acolor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * uPixelRatio * (0.7 + 0.5 * tw);               // 尺寸同步微脈動
}
`;
const DUST_FRAG = /* glsl */`
varying vec3 vColor;
varying float vTw;
void main(){
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));   // 圓形柔邊
  gl_FragColor = vec4(vColor * vTw, a);
}
`;

// 一層會閃爍的稀疏塵埃星點（介面同 makeStarLayer，但每點獨立 twinkle）
function makeDustLayer(count, size, minB, maxB, rMin, rMax) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const rate = new Float32Array(count);
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
    phase[i] = Math.random() * Math.PI * 2;
    rate[i] = 0.5 + Math.random() * 1.6;   // 各點頻率不同 → 避免整片同步閃爍的機械感
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('acolor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aphase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('arate', new THREE.BufferAttribute(rate, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      uSize: { value: size },
      uPixelRatio: { value: Math.min(devicePixelRatio, 2) },
    },
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
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

// 遠方裝飾亮星：固定位置、不參與物理，純為層次焦點。
// 縮成「星點」並外推到背景（~r 105–195），不再以大光暈搶尺度、壓縮空間感。
function makeDistantStars() {
  const group = new THREE.Group();
  const tex = glowTexture();
  const palette = [0xfff2e0, 0xcfe0ff, 0xffd2a0, 0xff9a7a, 0xbcd0ff];
  const PUSH = 1.5;   // 原 r 70–130 外推到 ~105–195，明確落在背景而非中景
  // [x, y, z, 大小, 顏色索引]
  const defs = [
    [60, 20, -40, 1.0, 0], [-72, -15, -52, 0.8, 1], [42, 50, -95, 1.3, 2],
    [-95, 28, 34, 0.7, 3], [82, -32, 52, 0.9, 1], [-52, -44, -82, 1.1, 4], [26, 64, 74, 0.6, 0],
  ];
  for (const [x, y, z, s, ci] of defs) {
    const col = palette[ci];
    const px = x * PUSH, py = y * PUSH, pz = z * PUSH;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    halo.position.set(px, py, pz);
    halo.scale.setScalar(s * 0.9);   // 由 ×4 大幅縮小為點狀光暈
    group.add(halo);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(s * 0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: col }),
    );
    core.position.set(px, py, pz);
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

// 星際塵埃兩層的差速漂移軸/速率：與整體自轉不同步，製造縱深「呼吸」與視差，
// 即使相機靜止也有空間深度感。
const DUST_AXIS_NEAR = new THREE.Vector3(0.8, 0.3, 0.5).normalize();
const DUST_AXIS_FAR = new THREE.Vector3(-0.2, 1, 0.4).normalize();
const DUST_RATE_NEAR = 0.006;
const DUST_RATE_FAR = 0.003;

export function createBackground() {
  const group = new THREE.Group();
  group.add(makeGalaxySphere());                              // 銀河天球
  group.add(makeStarLayer(3000, 1.0, 0.25, 0.65, 200, 360)); // 視差暗星
  group.add(makeStarLayer(120, 2.2, 0.8, 1.2, 200, 360));    // 視差亮星
  group.add(makeDistantStars());

  // 星際塵埃：兩層稀疏懸浮星點，遠離系統（內緣 ~r28，遠在 containR/解體距離之外）後才出現，
  // 保留系統周圍的空曠純黑。每點獨立閃爍（twinkle）。
  const dustNear = makeDustLayer(260, 2.0, 0.20, 0.45, 28, 65);   // 近層：略亮略大
  const dustFar = makeDustLayer(360, 1.4, 0.12, 0.30, 65, 120);   // 遠層：更暗更小
  group.add(dustNear, dustFar);

  let dustTime = 0;
  return {
    group,
    update(dt) {
      group.rotateOnWorldAxis(SPIN_AXIS, SPIN_RATE * dt);            // 整體緩慢自轉
      dustNear.rotateOnWorldAxis(DUST_AXIS_NEAR, DUST_RATE_NEAR * dt); // 差速漂移 → 縱深視差
      dustFar.rotateOnWorldAxis(DUST_AXIS_FAR, DUST_RATE_FAR * dt);
      dustTime += dt;
      dustNear.material.uniforms.time.value = dustTime;             // 推進閃爍相位
      dustFar.material.uniforms.time.value = dustTime;
    },
  };
}
