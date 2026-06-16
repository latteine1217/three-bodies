// UI 層：控制面板綁定 + HUD/時鐘/日誌/排行榜 DOM 更新。
// 不含模擬邏輯，只讀取 sim/civ 狀態並寫入 DOM。
import { formatYears } from './civilization.js';

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

    // era-reactive 狀態追蹤（純驅動樣式，不觸碰模擬數值）
    this.eraVeil = document.getElementById('era-veil');
    this._lastEra = null;       // 偵測紀元切換 → 掃描轉場
    this._starRGB = [120, 220, 230];   // 平滑後的三日色（寫入 CSS 變數）

    document.body.classList.add('era-chaotic');   // 初始與時鐘預設一致

    this.#startQuotes();
  }

  // 把三日當下的黑體平均色平滑後寫入 CSS 變數，讓 UI 強調色與天上的三日連動。
  // 平滑避免質量滑桿拖動時顏色跳動。
  #syncStarColor() {
    const rgb = this.renderer.eraStarRGB?.();
    if (!rgb) return;
    const s = this._starRGB;
    for (let i = 0; i < 3; i++) s[i] += (rgb[i] - s[i]) * 0.08;
    const st = document.body.style;
    st.setProperty('--star-r', s[0].toFixed(0));
    st.setProperty('--star-g', s[1].toFixed(0));
    st.setProperty('--star-b', s[2].toFixed(0));
  }

  // 切換 body 紀元 class；紀元真正翻轉時放一道全螢幕色彩掃描（恆⇄亂的張力）
  #applyEra(civ) {
    if (civ.era === this._lastEra) return;
    const wasInit = this._lastEra === null;
    this._lastEra = civ.era;
    document.body.classList.toggle('era-stable', civ.era === 'stable');
    document.body.classList.toggle('era-chaotic', civ.era !== 'stable');
    if (wasInit) return;   // 初次套用不放轉場
    // 重觸發掃描動畫（移除→強制重排→加回）
    this.eraVeil.classList.remove('sweep');
    void this.eraVeil.offsetWidth;
    this.eraVeil.classList.add('sweep');
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
        + `${CIV_LEVELS[civ.civLevel]}（已歷 ${formatYears(civ.civAge)}） · E ${sim.totalEnergy().toExponential(2)}`;

      // 時鐘
      this.clockCiv.textContent = `第 ${civ.civId} 號文明`;
      this.clockTime.textContent = formatSimTime(civ.simTime);
      this.clockEra.textContent = eraName;
      this.clockEra.className = 'era ' + (civ.era === 'stable' ? 'stable' : 'chaotic');

      // === era-reactive 主題：整個介面與 3D 場景隨紀元呼吸／變色 ===
      this.#applyEra(civ);
      this.#syncStarColor();
      this.renderer.setEra?.(civ.era);

      // 日誌（僅在變動時重繪；log.length 會在上限飽和，故用 logVersion）
      if (civ.logVersion !== this._lastLogVer) {
        this._lastLogVer = civ.logVersion;
        this.logEl.innerHTML = civ.log.map(e =>
          `<div class="log-item ${e.kind}">${e.text}</div>`).join('');
      }

      // 排行榜（編號 · 等級 · 延續年數）
      const key = civ.leaderboard.map(r => r.id + ':' + r.level + ':' + Math.round(r.years)).join(',');
      if (key !== this._lastBoardKey) {
        this._lastBoardKey = key;
        this.boardEl.innerHTML = civ.leaderboard.length
          ? civ.leaderboard.map((r, i) =>
            `<div class="board-item"><span class="rank">${i + 1}</span>`
            + `<span class="name">第 ${r.id} 號文明</span>`
            + `<span class="lvl">${CIV_LEVELS[r.level]}</span>`
            + `<span class="yrs">${formatYears(r.years)}</span></div>`).join('')
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
