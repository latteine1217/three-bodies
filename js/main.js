// 組裝各模組並驅動主迴圈。唯一把 physics / renderer / civilization / ui 接起來的地方。
import { Simulation } from './physics.js';
import { Renderer } from './renderer.js';
import { Civilization } from './civilization.js';
import { UI } from './ui.js';

const BASE_DT = 0.05;   // 基準時間步（每幀總推進 = BASE_DT·speed；滑桿 1× 對應此速度，1~4×）
const SUBSTEPS = 32;    // 每幀內部子步數：細步以解析近距遭遇、抑制數值加熱（計算成本可忽略）

const sim = new Simulation();
const renderer = new Renderer(document.getElementById('app'), sim);
const civ = new Civilization();

function restart(randomKick) {
  sim.reset(randomKick);
  renderer.clearTrails();
  civ.onCollapse();
}

const ui = new UI({
  sim, renderer,
  onReset: () => restart(false),
  onRandomize: () => restart(true),
});

let last = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const frameDt = Math.min((now - last) / 1000, 0.1);
  last = now;

  const speed = ui.speed ?? 1;
  const h = BASE_DT * speed / SUBSTEPS;
  if (speed > 0) for (let s = 0; s < SUBSTEPS; s++) sim.step(h);

  const env = sim.planetEnvironment();
  civ.update(speed > 0 ? frameDt * speed : 0, env);

  renderer.syncBodies(sim);
  renderer.render(frameDt);
  ui.update(sim, civ);

  // 系統解體 → 自動重置 + 文明湮滅
  if (sim.maxDistFromCOM() > sim.params.DD) restart(false);
}

addEventListener('resize', () => renderer.onResize());

renderer.syncBodies(sim);
renderer.render(0);
requestAnimationFrame(animate);
