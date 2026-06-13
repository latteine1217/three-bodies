// 電漿恆星 ShaderMaterial：大尺度對流 + 細米粒組織 + 黑子，
// 並做邊緣昏暗（limb darkening）使圓盤像真實光球。日冕/光暈由外部星芒貼圖負責。
import * as THREE from 'three';
import { SNOISE, FBM } from './glsl-noise.js';

const VERT = /* glsl */`
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vView;
void main(){
  vPos = position;
  vNormal = normalMatrix * normal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
uniform float time;
uniform vec3  baseColor;
uniform float seed;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vView;
${SNOISE}
${FBM}
void main(){
  vec3 dir = normalize(vPos);
  vec3 q = dir * 2.6 + seed;
  // 大尺度對流（domain warp）
  vec3 warp = vec3(fbm(q + time * 0.06), fbm(q + 5.2 + time * 0.05), fbm(q + 9.1 + time * 0.07));
  float macro = fbm(q + warp * 0.7 + time * 0.04) * 0.5 + 0.5;
  // 細尺度米粒組織（高頻、流動較快）
  float gran = fbm(q * 5.5 + warp * 0.4 + time * 0.11) * 0.5 + 0.5;
  float n = mix(macro, gran, 0.45);

  float hot  = smoothstep(0.52, 0.95, n);     // 高溫亮區
  float spot = smoothstep(0.30, 0.12, macro); // 黑子（大尺度低溫區）

  vec3 hotCol = mix(baseColor, vec3(1.0), 0.4);
  vec3 col = mix(baseColor * 0.5, hotCol, hot);
  col = mix(col, baseColor * 0.12, spot);

  // 邊緣昏暗：mu = N·V，中心亮、邊緣暗且偏紅（看到較高較冷的高層）
  float mu = max(dot(normalize(vNormal), normalize(vView)), 0.0);
  col *= 0.32 + 0.68 * pow(mu, 0.55);
  col = mix(col, col * vec3(1.18, 0.72, 0.5), (1.0 - mu) * 0.4);

  col *= 1.4;                                  // 增亮觸發 bloom
  gl_FragColor = vec4(col, 1.0);
}
`;

// 恆星眩光貼圖（更真實的亮星輪廓）：緊湊亮核 + 柔和外延日冕（散射輝光）+ 細繞射尖刺。
// additive Sprite 貼於亮星、由 sprite color 染色。
export function makeStarburstTexture() {
  const s = 512, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const C = s / 2;
  ctx.globalCompositeOperation = 'lighter';

  // 外延日冕：大而極淡，提供自然的散射輝光（非霧）
  const corona = ctx.createRadialGradient(C, C, 0, C, C, s * 0.5);
  corona.addColorStop(0, 'rgba(255,255,255,0.22)');
  corona.addColorStop(0.18, 'rgba(255,255,255,0.07)');
  corona.addColorStop(0.55, 'rgba(255,255,255,0.015)');
  corona.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = corona;
  ctx.fillRect(0, 0, s, s);

  // 緊湊亮核：陡降，像真實點光源的眩光中心
  const core = ctx.createRadialGradient(C, C, 0, C, C, s * 0.07);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, s, s);

  // 繞射尖刺（細、漸隱）
  function spike(angle, length, halfW, alpha) {
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(0, 0, length, 0);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.25})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -halfW); ctx.lineTo(length, 0); ctx.lineTo(0, halfW);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const L = s * 0.5;
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) spike(a, L, s * 0.006, 0.45);             // 主十字
  for (const a of [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4]) spike(a, L * 0.5, s * 0.004, 0.18); // 斜軸

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createStarMaterial({ color, seed = 0 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      baseColor: { value: new THREE.Color(color) },
      seed: { value: seed },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

export function updateStar(material, dt) {
  material.uniforms.time.value += dt;
}
