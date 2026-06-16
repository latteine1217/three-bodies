// Three.js 渲染層：場景、相機、OrbitControls、bloom 後製、
// 天體 mesh（3 電漿恆星 + 1 受光行星）、淡出軌跡、程序化背景。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createStarMaterial, updateStar, makeStarburstTexture } from './stars.js';
import { createBackground } from './background.js';
import { blackBodyRGB } from './blackbody.js';

// 由恆星表面色溫取得黑體色，再增飽和度讓星色更鮮明（放寬物理、加大變化）
function starColor(sim, i) {
  const c = blackBodyRGB(sim.starTemperature(i));
  const col = new THREE.Color(c.r, c.g, c.b);
  const hsl = { h: 0, s: 0, l: 0 };
  col.getHSL(hsl);
  col.setHSL(hsl.h, Math.min(hsl.s * 2.0, 0.8), hsl.l);
  return col;
}

const MAX_TRAIL = 4000;   // 軌跡緩衝上限，須 ≥ 滑桿最大值（4000）

export class Renderer {
  constructor(container, simulation) {
    this.trailEnabled = true;
    this.trailLength = 1000;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.domElement = renderer.domElement;

    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 2000);
    camera.position.set(0, 6, 34);   // 略拉遠：本體佔比變小、虛空變多，強化渺小感
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    this.controls = controls;

    // 後製：RenderPass → UnrealBloom → OutputPass
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // 解析度用實際繪圖緩衝大小（mip 較細）+ 小 radius → 圓形光暈（大 radius 會露出粗 mip 的方形 texel）
    const bsize = renderer.getDrawingBufferSize(new THREE.Vector2());
    const bloomPass = new UnrealBloomPass(bsize, 1.1, 0.28, 0.42);   // 收斂半徑，讓十字星芒不被圓暈蓋掉
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    // 攝影/鏡頭質感（最終 pass，display space）：徑向色差 + 暗角 + film grain
    const grainPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        time: { value: 0 },
        resolution: { value: new THREE.Vector2(bsize.x, bsize.y) },
        grainAmount: { value: 0.045 },
        vignetteAmount: { value: 0.45 },
        aberration: { value: 0.0026 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float time, grainAmount, vignetteAmount, aberration;
        uniform vec2 resolution;
        varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          vec2 toC = vUv - 0.5;
          float d = length(toC);
          // 徑向色差：紅藍通道沿徑向反向偏移，邊緣更明顯
          vec2 off = toC * d * aberration;
          vec3 col = vec3(
            texture2D(tDiffuse, vUv - off).r,
            texture2D(tDiffuse, vUv).g,
            texture2D(tDiffuse, vUv + off).b
          );
          // 暗角
          float vig = smoothstep(0.9, 0.35, d);
          col *= mix(1.0, vig, vignetteAmount);
          // film grain（逐幀變動）
          float n = hash(vUv * resolution + time) - 0.5;
          col += n * grainAmount;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    composer.addPass(grainPass);

    this.composer = composer;
    this.bloomPass = bloomPass;
    this.grainPass = grainPass;

    scene.add(new THREE.AmbientLight(0x404a66, 0.5));

    this.background = createBackground();
    scene.add(this.background.group);   // 銀河天球 + 星場（隨群組緩慢自轉）

    this.stars = [];          // 電漿恆星材質，逐幀推進 time
    this.starburstTex = makeStarburstTexture();   // 共用星芒貼圖
    this.flareTime = 0;                            // 星芒閃爍相位
    this.meshGroups = this.#buildBodies(simulation);
  }

  // 為每個天體建立 mesh + 軌跡；恆星用電漿材質 + 點光源，行星用受光標準材質
  #buildBodies(sim) {
    return sim.bodies.map((b, idx) => {
      const isStar = idx < 3;
      const radius = isStar ? 0.085 : 0.028;   // 偏點狀：更小更渺小，與遠景塵埃拉開尺度對比
      const col = isStar ? starColor(sim, idx) : new THREE.Color(b.color);
      let sphere, light = null, flare = null;

      if (isStar) {
        const mat = createStarMaterial({ color: col, seed: idx * 13.7 });
        this.stars.push(mat);
        sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat);
        light = new THREE.PointLight(col, 2.4, 80, 1.5);
        this.scene.add(light);
        // 星芒（繞射眩光）：十字尖刺貼圖，色隨黑體
        flare = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.starburstTex, color: col, blending: THREE.AdditiveBlending,
          transparent: true, depthWrite: false,
        }));
        flare.scale.setScalar(1.8);
        this.scene.add(flare);
      } else {
        sphere = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 32, 32),
          new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, metalness: 0.0 }),
        );
      }
      this.scene.add(sphere);

      // 軌跡線（預配置最大長度，逐幀更新 drawRange + 年齡淡出）
      const positions = new Float32Array(MAX_TRAIL * 3);
      const colors = new Float32Array(MAX_TRAIL * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.scene.add(line);

      return { sphere, light, flare, line, geo, positions, colors, baseColor: col.clone(), trail: [], lastN: -1 };
    });
  }

  // 以質心為原點寫入天體位置，並更新軌跡
  syncBodies(sim) {
    const com = sim.centerOfMass();
    for (let i = 0; i < sim.bodies.length; i++) {
      const b = sim.bodies[i], m = this.meshGroups[i];
      const rx = b.x - com.x, ry = b.y - com.y, rz = b.z - com.z;
      m.sphere.position.set(rx, ry, rz);
      if (m.light) m.light.position.set(rx, ry, rz);
      if (m.flare) m.flare.position.set(rx, ry, rz);

      if (this.trailEnabled) {
        m.trail.push(rx, ry, rz);
        const maxLen = this.trailLength * 3;
        while (m.trail.length > maxLen) m.trail.splice(0, 3);
      }
      this.#updateTrail(m);
    }
  }

  #updateTrail(m) {
    const n = this.trailEnabled ? (m.trail.length / 3 | 0) : 0;
    // 位置每幀更新
    for (let i = 0; i < n * 3; i++) m.positions[i] = m.trail[i];
    m.geo.setDrawRange(0, n);
    m.geo.attributes.position.needsUpdate = true;

    // 顏色純由索引年齡決定：僅在長度變動時重算（穩態後免上傳）
    if (n !== m.lastN) {
      for (let i = 0; i < n; i++) {
        const f = (i / n) * (i / n);   // 0=最舊暗 → 1=最新亮
        m.colors[i * 3] = m.baseColor.r * f;
        m.colors[i * 3 + 1] = m.baseColor.g * f;
        m.colors[i * 3 + 2] = m.baseColor.b * f;
      }
      m.geo.attributes.color.needsUpdate = true;
      m.lastN = n;
    }
  }

  render(dt) {
    for (const mat of this.stars) updateStar(mat, dt);

    // 星芒緩慢閃爍（雙 sine 疊加避免機械感）；亮度同時牽動 bloom，故光暈一起呼吸
    this.flareTime += dt;
    const t = this.flareTime;
    for (let i = 0; i < this.meshGroups.length; i++) {
      const m = this.meshGroups[i];
      if (!m.flare) continue;
      const p = i * 2.3;
      const tw = 0.5 + 0.38 * Math.sin(t * 0.7 + p) + 0.12 * Math.sin(t * 1.9 + p * 1.7);
      m.flare.material.opacity = Math.max(0.1, Math.min(1, tw));
      m.flare.scale.setScalar(1.8 * (0.9 + 0.12 * Math.sin(t * 0.7 + p)));
    }

    this.grainPass.uniforms.time.value += dt * 55;   // film grain 逐幀變動
    this.background.update(dt);
    this.controls.update();
    this.composer.render();
  }

  // 質量改變時，依新表面色溫更新恆星黑體色（材質 / 點光源 / 軌跡）
  updateStarColors(sim) {
    for (let i = 0; i < 3; i++) {
      const col = starColor(sim, i);
      this.stars[i].uniforms.baseColor.value.copy(col);
      const m = this.meshGroups[i];
      if (m.light) m.light.color.copy(col);
      if (m.flare) m.flare.material.color.copy(col);
      m.baseColor.copy(col);
      m.lastN = -1;   // 強制重算軌跡顏色
    }
  }

  setBloomStrength(v) { this.bloomPass.strength = v; }
  setTrailLength(n) { this.trailLength = n; }
  setTrailEnabled(on) {
    this.trailEnabled = on;
    if (!on) for (const m of this.meshGroups) { m.trail.length = 0; this.#updateTrail(m); }
  }
  clearTrails() { for (const m of this.meshGroups) m.trail.length = 0; }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.renderer.getDrawingBufferSize(this.grainPass.uniforms.resolution.value);
  }
}
