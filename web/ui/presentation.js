// Shared display wording. Missing v2/v3 metadata never invents a heatmap.
export const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '';
export function heatmapText(answer) {
  if (answer?.heatmapSource === 'precomputed') return 'Grad-CAM (precomputed)';
  if (answer?.heatmapSource === 'live') return 'Grad-CAM, computed live from the last layer';
  if (answer?.heatmapSource === null || answer?.hasHeatmap === false) return 'No heatmap for this class';
  return answer?.hasHeatmap === true ? 'Grad-CAM shown on the display' : '';
}
export const stabilityPlaying = s => s?.mode === 'stability' && s?.stability?.active === true && s.stability.phase === 'playing';
