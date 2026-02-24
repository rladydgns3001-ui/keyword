// ═══════════════════════════════════════════════════════════
// CSV/JSON/클립보드 내보내기
// ═══════════════════════════════════════════════════════════

import { getTotalVolume } from "./keyword-engine.js";

/**
 * 내보내기 모듈 초기화
 */
export function initExport() {
  document.getElementById("btn-export-csv")?.addEventListener("click", exportCSV);
  document.getElementById("btn-export-json")?.addEventListener("click", exportJSON);
  document.getElementById("btn-export-clipboard")?.addEventListener("click", exportClipboard);
}

/**
 * 현재 키워드 + 평가 데이터 수집
 */
function collectData() {
  // main.js에서 전역 상태를 가져오기 위해 커스텀 이벤트 사용
  const event = new CustomEvent("export-request");
  window.dispatchEvent(event);

  // getState는 ui-controller에서 export
  // 직접 DOM에서도 데이터 접근
  return window.__kwState || { keywords: [], evaluation: [] };
}

// ═══════════════════════════════════════════════════════════
// CSV 내보내기
// ═══════════════════════════════════════════════════════════

function exportCSV() {
  const data = collectData();
  if (!data.keywords || data.keywords.length === 0) {
    showExportToast("내보낼 키워드가 없습니다.", "warning");
    return;
  }

  // 평가 결과 맵
  const evalMap = new Map();
  if (data.evaluation) {
    for (const e of data.evaluation) {
      evalMap.set(e.keyword, e);
    }
  }

  // BOM + CSV 헤더
  const BOM = "\uFEFF";
  const headers = ["키워드", "레벨", "타입", "카테고리", "PC 검색량", "모바일 검색량", "총 검색량", "경쟁도", "등급", "총점", "평가"];
  const rows = [headers.join(",")];

  for (const kw of data.keywords) {
    const vol = kw.stats ? getTotalVolume(kw.stats) : "";
    const pcVol = kw.stats?.monthlyPcQcCnt ?? "";
    const mobileVol = kw.stats?.monthlyMobileQcCnt ?? "";
    const comp = kw.stats?.compIdx || "";
    const evalResult = evalMap.get(kw.keyword);
    const grade = evalResult?.grade || "";
    const score = evalResult?.totalScore ?? "";
    const summary = evalResult?.summary || "";

    const row = [
      csvEscape(kw.keyword),
      kw.level,
      kw.type,
      kw.category,
      pcVol,
      mobileVol,
      vol,
      comp,
      grade,
      score,
      csvEscape(summary),
    ];

    rows.push(row.join(","));
  }

  const csv = BOM + rows.join("\n");
  downloadFile(csv, "keywords.csv", "text/csv;charset=utf-8");
  showExportPreview(csv);
  showExportToast("CSV 파일을 다운로드했습니다.", "success");
}

// ═══════════════════════════════════════════════════════════
// JSON 내보내기
// ═══════════════════════════════════════════════════════════

function exportJSON() {
  const data = collectData();
  if (!data.keywords || data.keywords.length === 0) {
    showExportToast("내보낼 키워드가 없습니다.", "warning");
    return;
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    totalKeywords: data.keywords.length,
    keywords: data.keywords.map((kw) => ({
      keyword: kw.keyword,
      level: kw.level,
      type: kw.type,
      category: kw.category,
      parent: kw.parent,
      stats: kw.stats,
    })),
    evaluation: data.evaluation || [],
  };

  const json = JSON.stringify(exportData, null, 2);
  downloadFile(json, "keywords.json", "application/json;charset=utf-8");
  showExportPreview(json.substring(0, 2000) + (json.length > 2000 ? "\n..." : ""));
  showExportToast("JSON 파일을 다운로드했습니다.", "success");
}

// ═══════════════════════════════════════════════════════════
// 클립보드 복사
// ═══════════════════════════════════════════════════════════

async function exportClipboard() {
  const data = collectData();
  if (!data.keywords || data.keywords.length === 0) {
    showExportToast("내보낼 키워드가 없습니다.", "warning");
    return;
  }

  const lines = data.keywords.map((kw) => {
    const vol = kw.stats ? getTotalVolume(kw.stats) : "-";
    const comp = kw.stats?.compIdx || "-";
    return `${kw.keyword}\t${vol}\t${comp}`;
  });

  const text = "키워드\t검색량\t경쟁도\n" + lines.join("\n");

  try {
    await navigator.clipboard.writeText(text);
    showExportPreview(text);
    showExportToast("클립보드에 복사했습니다.", "success");
  } catch {
    // 폴백: textarea 사용
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    showExportPreview(text);
    showExportToast("클립보드에 복사했습니다.", "success");
  }
}

// ═══════════════════════════════════════════════════════════
// 유틸리티
// ═══════════════════════════════════════════════════════════

function csvEscape(str) {
  if (!str) return '""';
  const s = String(str);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showExportPreview(text) {
  const preview = document.getElementById("export-preview");
  if (preview) {
    preview.textContent = text;
  }
}

function showExportToast(message, type) {
  // 토스트 표시 (ui-controller의 것 재사용)
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(40px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
