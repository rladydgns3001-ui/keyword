// ═══════════════════════════════════════════════════════════
// 키워드 전략 도우미 - 엔트리포인트
// ═══════════════════════════════════════════════════════════

import { initUI, getState } from "./js/ui-controller.js";
import { initVisualization } from "./js/visualization.js";
import { initThinkingProcess } from "./js/thinking-process.js";
import { initExport } from "./js/export.js";

// 전역 상태 노출 (export.js에서 접근)
window.addEventListener("export-request", () => {
  const state = getState();
  window.__kwState = {
    keywords: state.currentKeywords,
    evaluation: state.evaluationResults,
  };
});

// 앱 초기화
document.addEventListener("DOMContentLoaded", () => {
  initUI();
  initVisualization();
  initThinkingProcess();
  initExport();
});
