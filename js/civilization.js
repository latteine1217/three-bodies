// 文明模擬：由行星溫度驅動的恆/亂紀元判定與文明興衰狀態機。
// 零 Three.js 依賴。溫度模型在 physics.planetEnvironment()，此處只消費 temperature。
'use strict';

const T_LO = 0.7, T_HI = 1.5;     // 宜居帶（恆紀元條件）
const STD_MAX = 0.14;             // 恆紀元要求的溫度低變異
const T_MIN = 0.55, T_MAX = 1.9;  // 生存上下限（緩衝後表面溫），超出即文明毀滅
const T_SCORCH = 2.0;             // 瞬時灼燒：恆星近掠的瞬時高照射壓過熱緩衝，直接燒毀
const D_GIANT = 0.55;             // 最近恆星近於此且其餘遠 → 巨日
const WINDOW = 90;                // 溫度滑動視窗樣本數（平滑 T）
const THERMAL_TAU = 4;            // 行星熱慣性時間常數：大氣＋水體蓄熱，平滑短暫閃焰但讓持續變化爬升
const SWITCH_DWELL = 45;          // 紀元切換確認幀數：候選狀態須持續此久才真正切換（遲滯緩衝）
const RATE = 1;                   // 文明科技基礎成長率
const GROWTH_ACCEL = 0.05;        // 指數加速係數：越先進成長越快（dP/dt = RATE·(1+ACCEL·P)）
const LIFE_TAU = 15;              // 生命孵化期：毀滅後需在恆紀元穩定累積此時長，生命才重新演化萌芽
const DARK_FOREST_RATE = 0.012;   // 抵星際後每單位時間遭黑暗森林打擊的機率（暴露即死）
const YEARS_PER_SIMTIME = 300;    // 模擬時間 → 文明紀年換算（史詩尺度）

// 文明紀年格式化：年 / 萬年 / 億年
export function formatYears(y) {
  if (y >= 1e8) return (y / 1e8).toFixed(2) + ' 億年';
  if (y >= 1e4) return (y / 1e4).toFixed(1) + ' 萬年';
  return Math.round(y) + ' 年';
}
const THRESHOLDS = [0, 20, 50, 100, 180, 300]; // 各等級所需累積進度
const MAX_LEVEL = THRESHOLDS.length - 1;
const LEVEL_NAMES = ['蠻荒', '農業文明', '工業文明', '原子文明', '資訊文明', '星際文明'];
const LOG_MAX = 12;

function levelOf(progress) {
  let lv = 0;
  for (let i = 0; i <= MAX_LEVEL; i++) if (progress >= THRESHOLDS[i]) lv = i;
  return lv;
}

export class Civilization {
  constructor() {
    this.simTime = 0;
    this.temperature = 1;
    this.surfaceTemp = 1;      // 行星表面溫度（含大氣/水體熱慣性，落後於瞬時輻射）
    this.civAge = 0;           // 當前文明已發展年數（紀年）
    this.era = 'chaotic';
    this.window = [];
    this.log = [];
    this.logVersion = 0;       // 單調遞增，供 UI 判定日誌是否變動（log.length 會在 12 飽和）
    this.leaderboard = [];
    this.wasExtreme = false;   // 極端溫度邊緣偵測，避免每幀重複摧毀文明
    this.pendingEra = null;    // 紀元切換候選 + 連續計數（dwell 緩衝）
    this.pendingCount = 0;
    this.#newCiv(1);
  }

  #newCiv(id) {
    this.civId = id;
    this.civProgress = 0;
    this.civLevel = 0;
    this.civMaxLevel = 0;
    this.civBirth = this.simTime;
    this.lifeEmerged = false;   // 生命是否已重新演化萌芽
    this.incubation = 0;        // 恆紀元穩定累積的孵化時間
  }

  #pushLog(kind, text) {
    this.log.unshift({ kind, text: `[${formatTime(this.simTime)}] ${text}` });
    if (this.log.length > LOG_MAX) this.log.pop();
    this.logVersion++;
  }

  #recordToBoard(cause) {
    const years = (this.simTime - this.civBirth) * YEARS_PER_SIMTIME;
    if (this.civMaxLevel > 0) {
      this.leaderboard.push({ id: this.civId, level: this.civMaxLevel, years });
      this.leaderboard.sort((a, b) => b.level - a.level || b.years - a.years);
      this.leaderboard = this.leaderboard.slice(0, 5);
    }
    // 《三体》遊戲經典毀滅宣告格式 + 文明延續年數
    this.#pushLog('doom',
      `第 ${this.civId} 號文明毀滅於${cause}，該文明進化到了「${LEVEL_NAMES[this.civMaxLevel]}」層次、`
      + `延續 ${formatYears(years)}。文明的種子仍在，它將重新啟動……`);
    this.#newCiv(this.civId + 1);
  }

  update(dt, env) {
    this.simTime += dt;
    this.civAge = (this.simTime - this.civBirth) * YEARS_PER_SIMTIME;   // 當前文明紀年

    // 熱慣性：行星表面溫度（大氣＋水體蓄熱）以時間常數 THERMAL_TAU 緩慢趨近瞬時輻射平衡溫度，
    // 平滑短暫的烈日/寒潮，使宜居星球更耐瞬時波動。
    this.surfaceTemp += (env.temperature - this.surfaceTemp) * (1 - Math.exp(-dt / THERMAL_TAU));
    const T = this.surfaceTemp;
    this.temperature = T;

    // 溫度滑動視窗 → 均值與標準差
    this.window.push(T);
    if (this.window.length > WINDOW) this.window.shift();
    let mean = 0;
    for (const t of this.window) mean += t;
    mean /= this.window.length;
    let varSum = 0;
    for (const t of this.window) varSum += (t - mean) * (t - mean);
    const std = Math.sqrt(varSum / this.window.length);

    // 災難判定 → 文明毀滅（僅在進入危機的邊緣觸發一次，避免每幀重複摧毀）
    // 引力撕裂：行星進入最近恆星的洛希極限內
    const tidal = env.nearestDist < env.rocheLimit;      // 極近 → 潮汐撕裂
    const scorch = env.temperature > T_SCORCH;           // 瞬時高照射壓過緩衝 → 灼燒
    const doomed = tidal || scorch || T > T_MAX || T < T_MIN;
    if (doomed && !this.wasExtreme) this.#recordToBoard(classifyCatastrophe(env, T, tidal));
    this.wasExtreme = doomed;

    // 紀元判定：視窗平滑 T 後得候選狀態，再經 dwell 緩衝確認才切換（避免邊界抖動）
    const ready = this.window.length >= WINDOW * 0.5;
    const candidate = (ready && mean >= T_LO && mean <= T_HI && std < STD_MAX) ? 'stable' : 'chaotic';
    if (candidate === this.era) {
      this.pendingCount = 0;
    } else if (candidate === this.pendingEra) {
      if (++this.pendingCount >= SWITCH_DWELL) {
        this.era = candidate;
        this.pendingCount = 0;
        this.#pushLog('era', candidate === 'stable'
          ? '恆紀元到來，三體人浸泡復甦，文明重建'
          : '亂紀元降臨，三體人脫水避難');
      }
    } else {
      this.pendingEra = candidate;
      this.pendingCount = 1;
    }

    // 文明發展（僅恆紀元）：先孵化（生命重新演化），再指數加速成長
    if (this.era === 'stable') {
      if (!this.lifeEmerged) {
        this.incubation += dt;                       // 需穩定一陣子，生命才萌芽
        if (this.incubation >= LIFE_TAU) {
          this.lifeEmerged = true;
          this.#pushLog('level', `第 ${this.civId} 號文明 — 原始生命萌芽`);
        }
      } else {
        // dP/dt = RATE·(1 + ACCEL·P)：越先進成長越快（指數加速）
        this.civProgress += RATE * (1 + GROWTH_ACCEL * this.civProgress) * dt;
        const lv = levelOf(this.civProgress);
        if (lv > this.civLevel) {
          this.civLevel = lv;
          this.civMaxLevel = Math.max(this.civMaxLevel, lv);
          this.#pushLog('level', `第 ${this.civId} 號文明 躍升至 ${LEVEL_NAMES[lv]}`);
        }
      }
    }

    // 黑暗森林打擊：文明抵達星際即座標暴露，隨機遭更高等文明清除（暴露即死）
    if (this.civLevel >= MAX_LEVEL && Math.random() < DARK_FOREST_RATE * dt) {
      this.#recordToBoard('黑暗森林打擊');
    }
  }

  // 系統解體：現存文明全數湮滅
  onCollapse() {
    this.#recordToBoard('三體系統崩潰');
    this.window.length = 0;
    this.era = 'chaotic';
  }
}

// 依行星與三星的幾何/溫度，判定小說式災難名稱
function classifyCatastrophe(env, T, tidal) {
  if (tidal) return '引力撕裂';
  // 熱死：持續高溫（緩衝後 T_MAX）或瞬時灼燒（T_SCORCH）
  if (T > T_MAX || env.temperature > T_SCORCH) {
    const d = [...env.dists].sort((a, b) => a - b);
    // 一顆極近、其餘明顯較遠 → 巨日；否則多日逼近 → 三日凌空
    if (d[0] < D_GIANT && d[1] > d[0] * 1.8) return '巨日炙烤';
    return '三日凌空';
  }
  return '三飛星嚴寒';   // T < T_MIN
}

function formatTime(t) {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60) % 100).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
