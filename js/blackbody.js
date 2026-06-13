// 黑體輻射溫度 → RGB（Tanner Helland 近似 Planckian locus）。
// 零相依純函式：恆星依表面溫度決定顏色（冷→紅橙，熱→藍白）。

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

// tempK: 色溫（K），有效範圍約 1000–40000
export function blackBodyRGB(tempK) {
  const t = Math.min(Math.max(tempK, 1000), 40000) / 100;
  let r, g, b;

  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);

  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);

  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255) };
}
