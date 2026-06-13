// UI 層：控制面板綁定 + HUD/時鐘/日誌/排行榜 DOM 更新。
// 不含模擬邏輯，只讀取 sim/civ 狀態並寫入 DOM。

const mass7 = v => (v / 1e7).toFixed(1) + 'e7';
const FMT = {
  mass1: mass7, mass2: mass7, mass3: mass7,
  mass4: v => v.toFixed(0),
  speed: v => v.toFixed(2) + '×',
  spin: v => v.toFixed(2),
  ras: v => v.toFixed(2),
  containR: v => v.toFixed(1),
  containK: v => v.toFixed(1),
  trail: v => v.toFixed(0),
  bloom: v => v.toFixed(2),
};

const CIV_LEVELS = ['蠻荒', '農業文明', '工業文明', '原子文明', '資訊文明', '星際文明'];

// 《三体》三部曲名言（底部緩慢輪播，致敬）
const QUOTES = [
  '不要回答！不要回答！不要回答！',
  '弱小和無知不是生存的障礙，傲慢才是。',
  '給歲月以文明，而不是給文明以歲月。',
  '宇宙就是一座黑暗森林。',
  '我消滅你，與你無關。',
  '失去人性，失去很多；失去獸性，失去一切。',
  '前進！前進！！不擇手段地前進！！！',
  '在這裡，所有的一切都將被忘卻；在這裡，一切又都將被重新記起。',
  '主，不在乎。',
];

export class UI {
  constructor({ sim, renderer, onReset, onRandomize }) {
    this.sim = sim;
    this.renderer = renderer;

    const bind = (id, onInput) => {
      const el = document.getElementById(id);
      const val = document.getElementById('v-' + id);
      const apply = () => {
        const v = parseFloat(el.value);
        if (val && FMT[id]) val.textContent = FMT[id](v);
        onInput(v);
      };
      el.addEventListener('input', apply);
      apply();
    };

    bind('mass1', v => { sim.setStarMass(0, v); renderer.updateStarColors(sim); });
    bind('mass2', v => { sim.setStarMass(1, v); renderer.updateStarColors(sim); });
    bind('mass3', v => { sim.setStarMass(2, v); renderer.updateStarColors(sim); });
    bind('mass4', v => sim.setMass4(v));
    bind('speed', v => { this.speed = v; });
    bind('spin', v => { sim.params.spin = v; });
    bind('ras', v => { sim.params.ras = v; });
    bind('containR', v => { sim.params.containR = v; });
    bind('containK', v => { sim.params.containK = v; });
    bind('trail', v => renderer.setTrailLength(v));
    bind('bloom', v => renderer.setBloomStrength(v));

    document.getElementById('trailen').addEventListener('change', e => renderer.setTrailEnabled(e.target.checked));
    document.getElementById('contain').addEventListener('change', e => { sim.params.contain = e.target.checked; });
    document.getElementById('reset').addEventListener('click', onReset);
    document.getElementById('randomize').addEventListener('click', onRandomize);

    // 左側控制面板開合（菜單按鈕）
    const panel = document.getElementById('panel');
    document.getElementById('panel-collapse').addEventListener('click', () => panel.classList.add('collapsed'));
    document.getElementById('menu-toggle').addEventListener('click', () => panel.classList.remove('collapsed'));

    // 點擊時鐘切換側欄（仿 WE）
    this.sidebar = document.getElementById('sidebar');
    document.getElementById('clock').addEventListener('click', () => {
      this.sidebar.classList.toggle('hidden');
    });

    this.hud = document.getElementById('hud');
    this.clockCiv = document.getElementById('clock-civ');
    this.clockTime = document.getElementById('clock-time');
    this.clockEra = document.getElementById('clock-era');
    this.logEl = document.getElementById('log');
    this.boardEl = document.getElementById('leaderboard');
    this._lastLogVer = -1;
    this._lastBoardKey = '';

    this.#startQuotes();
  }

  // 《三体》名言輪播（緩慢淡入淡出）
  #startQuotes() {
    const el = document.getElementById('quote');
    let i = -1;
    const show = () => {
      i = (i + 1) % QUOTES.length;
      el.style.opacity = '0';
      setTimeout(() => { el.textContent = QUOTES[i]; el.style.opacity = '0.85'; }, 1200);
    };
    show();
    setInterval(show, 15000);
  }

  update(sim, civ) {
    // HUD
    if (civ) {
      const eraName = civ.era === 'stable' ? '恆紀元' : '亂紀元';
      this.hud.textContent =
        `三體世界 · 第 ${civ.civId} 號文明 · ${eraName} · 溫度 ${civ.temperature.toFixed(2)} · `
        + `${CIV_LEVELS[civ.civLevel]} · E ${sim.totalEnergy().toExponential(2)}`;

      // 時鐘
      this.clockCiv.textContent = `第 ${civ.civId} 號文明`;
      this.clockTime.textContent = formatSimTime(civ.simTime);
      this.clockEra.textContent = eraName;
      this.clockEra.className = 'era ' + (civ.era === 'stable' ? 'stable' : 'chaotic');

      // 日誌（僅在變動時重繪；log.length 會在上限飽和，故用 logVersion）
      if (civ.logVersion !== this._lastLogVer) {
        this._lastLogVer = civ.logVersion;
        this.logEl.innerHTML = civ.log.map(e =>
          `<div class="log-item ${e.kind}">${e.text}</div>`).join('');
      }

      // 排行榜
      const key = civ.leaderboard.map(r => r.id + ':' + r.level).join(',');
      if (key !== this._lastBoardKey) {
        this._lastBoardKey = key;
        this.boardEl.innerHTML = civ.leaderboard.length
          ? civ.leaderboard.map((r, i) =>
            `<div class="board-item"><span class="rank">${i + 1}</span>`
            + `<span class="name">第 ${r.id} 號文明</span>`
            + `<span class="lvl">${CIV_LEVELS[r.level]}</span></div>`).join('')
          : '<div class="board-empty">尚無文明記錄</div>';
      }
    } else {
      this.hud.textContent = `E ${sim.totalEnergy().toExponential(3)} · 最大半徑 ${sim.maxDistFromCOM().toFixed(2)}`;
    }
  }
}

function formatSimTime(t) {
  const total = Math.floor(t);
  const h = String(Math.floor(total / 3600) % 100).padStart(2, '0');
  const m = String(Math.floor(total / 60) % 60).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
