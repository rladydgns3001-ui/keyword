// ═══════════════════════════════════════════════════════════
// DOM 이벤트, 탭 전환, 결과 렌더링
// ═══════════════════════════════════════════════════════════

import { CATEGORIES, NEWS_CATEGORIES, detectCategory } from "./keyword-data.js";
import { searchNews, setApiBase, testApiConnection, getApiStatus, autoAnalyze } from "./api-client.js";
import { generateKeywords, extractKeywordFromNews, getTotalVolume } from "./keyword-engine.js";
import { evaluateKeywords, getGradeColor, getGradeLabel } from "./scoring.js";
import { saveApiSettings, loadApiSettings, saveSession, loadSession, addToHistory } from "./storage.js";

/** 전역 상태 */
const state = {
  currentKeywords: [],
  evaluationResults: [],
  currentTab: "tab-news",
};

/** 외부에서 상태 접근 */
export function getState() {
  return state;
}

// ═══════════════════════════════════════════════════════════
// 초기화
// ═══════════════════════════════════════════════════════════

export function initUI() {
  initTabs();
  initSettings();
  initAutoAnalyze();
  initKeywordGenerator();
  initEvaluation();
  initThinkingProcess();
  initExport();
  restoreSession();
}

// ─── 탭 전환 ────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.tab;
      switchTab(tabId);
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));

  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add("active");
  document.getElementById(tabId)?.classList.add("active");
  state.currentTab = tabId;
}

// ─── 설정 모달 ──────────────────────────────────────────────

function initSettings() {
  const modal = document.getElementById("settings-modal");
  const btnOpen = document.getElementById("btn-settings");
  const btnClose = document.getElementById("btn-close-modal");
  const overlay = modal.querySelector(".modal-overlay");
  const btnSave = document.getElementById("btn-save-settings");
  const btnTest = document.getElementById("btn-test-api");

  btnOpen.addEventListener("click", () => {
    loadSettingsToForm();
    modal.classList.remove("hidden");
  });

  btnClose.addEventListener("click", () => modal.classList.add("hidden"));
  overlay.addEventListener("click", () => modal.classList.add("hidden"));

  btnSave.addEventListener("click", saveSettingsFromForm);
  btnTest.addEventListener("click", testConnection);

  // 저장된 API 설정 로드
  const settings = loadApiSettings();
  if (settings.apiBase) {
    setApiBase(settings.apiBase);
  }
  // 기본값: 같은 도메인의 /api 사용 (server.mjs 또는 Firebase Hosting rewrite)
  // setApiBase는 이미 "/api"로 초기화됨
}

function loadSettingsToForm() {
  const s = loadApiSettings();
  document.getElementById("input-api-base").value = s.apiBase || "";
  document.getElementById("input-naver-client-id").value = s.naverClientId || "";
  document.getElementById("input-naver-client-secret").value = s.naverClientSecret || "";
  document.getElementById("input-ad-license").value = s.adLicense || "";
  document.getElementById("input-ad-secret").value = s.adSecret || "";
  document.getElementById("input-ad-customer").value = s.adCustomerId || "";
}

function saveSettingsFromForm() {
  const settings = {
    apiBase: document.getElementById("input-api-base").value.trim(),
    naverClientId: document.getElementById("input-naver-client-id").value.trim(),
    naverClientSecret: document.getElementById("input-naver-client-secret").value.trim(),
    adLicense: document.getElementById("input-ad-license").value.trim(),
    adSecret: document.getElementById("input-ad-secret").value.trim(),
    adCustomerId: document.getElementById("input-ad-customer").value.trim(),
  };

  saveApiSettings(settings);

  if (settings.apiBase) {
    setApiBase(settings.apiBase);
  }

  showSettingsStatus("✅ 설정이 저장되었습니다.", "success");
  showToast("설정이 저장되었습니다.", "success");
}

async function testConnection() {
  showSettingsStatus("🔄 연결 테스트 중...", "info");
  const results = await testApiConnection();

  let msg = "";
  if (results.naverSearch && results.naverAd) {
    msg = "✅ 네이버 검색 API: 연결 성공\n✅ 네이버 검색광고 API: 연결 성공";
    showSettingsStatus(msg, "success");
  } else if (results.naverSearch) {
    msg = "✅ 네이버 검색 API: 연결 성공\n❌ 네이버 검색광고 API: 연결 실패";
    showSettingsStatus(msg, "warning");
  } else if (results.naverAd) {
    msg = "❌ 네이버 검색 API: 연결 실패\n✅ 네이버 검색광고 API: 연결 성공";
    showSettingsStatus(msg, "warning");
  } else {
    msg = "❌ 네이버 검색 API: 연결 실패\n❌ 네이버 검색광고 API: 연결 실패\n\nFirebase Functions URL과 API 키를 확인하세요.";
    showSettingsStatus(msg, "error");
  }

  updateApiStatusBadge();
}

function showSettingsStatus(msg, type) {
  const el = document.getElementById("settings-status");
  el.textContent = msg;
  el.style.color =
    type === "success" ? "var(--success)" :
    type === "error" ? "var(--danger)" :
    type === "warning" ? "var(--warning)" :
    "var(--text-muted)";
}

function updateApiStatusBadge() {
  const badge = document.getElementById("api-status");
  const status = getApiStatus();

  if (status.naverSearch && status.naverAd) {
    badge.textContent = "● 온라인";
    badge.className = "api-badge online";
  } else if (status.naverSearch || status.naverAd) {
    badge.textContent = "● 부분 연결";
    badge.className = "api-badge partial";
  } else {
    badge.textContent = "● 오프라인";
    badge.className = "api-badge offline";
  }
}

// ─── 자동 분석 ──────────────────────────────────────────────

function initAutoAnalyze() {
  const btn = document.getElementById("btn-auto-analyze");
  if (btn) {
    btn.addEventListener("click", handleAutoAnalyze);
  }
}

async function handleAutoAnalyze() {
  const btn = document.getElementById("btn-auto-analyze");
  const progress = document.getElementById("analyze-progress");
  const resultsContainer = document.getElementById("auto-results");
  const recSection = document.getElementById("recommended-keywords");

  btn.disabled = true;
  progress.classList.remove("hidden");
  resultsContainer.innerHTML = "";
  recSection.classList.add("hidden");

  // 진행 상태 표시
  setProgress("ps-news", "active", 10);

  try {
    const result = await autoAnalyze();

    if (result._fallback) {
      setProgress("ps-news", "done", 100);
      resultsContainer.innerHTML = `
        <div class="placeholder-msg">
          <p>❌ ${result.message || "API 서버에 연결할 수 없습니다."}</p>
          <p>⚙️ 우측 상단 설정에서 Firebase Functions URL을 확인하세요.</p>
        </div>`;
      btn.disabled = false;
      return;
    }

    setProgress("ps-news", "done", 25);
    setProgress("ps-extract", "active", 40);

    await delay(300);
    setProgress("ps-extract", "done", 55);
    setProgress("ps-expand", "active", 70);

    await delay(200);
    setProgress("ps-expand", "done", 80);
    setProgress("ps-score", "active", 90);

    // 결과 → 키워드 목록으로 변환하여 state에 저장
    const allKeywords = [];
    for (const item of (result.results || [])) {
      // 메인 키워드
      allKeywords.push({
        keyword: item.extractedKeyword,
        type: "api",
        level: 0,
        category: item.detectedCategory,
        parent: null,
        stats: item.stats,
        newsTitle: item.newsTitle,
      });
      // 파생 키워드 (수익화 점수 포함)
      for (const rk of (item.relatedKeywords || [])) {
        allKeywords.push({
          keyword: rk.keyword,
          type: "derived",
          level: rk.level || 1,
          category: item.detectedCategory,
          parent: item.extractedKeyword,
          stats: rk.stats || null,
          monetizationScore: rk.monetizationScore,
          grade: rk.grade,
          scoreBreakdown: rk.scoreBreakdown,
          reasoning: rk.reasoning,
        });
      }
    }

    state.currentKeywords = allKeywords;

    await delay(200);
    setProgress("ps-score", "done", 95);
    setProgress("ps-done", "active", 100);

    // 추천 키워드 섹션 렌더링 (S/A 등급)
    renderRecommendedKeywords(result.recommendedKeywords || []);

    // 뉴스-키워드 카드 렌더링
    renderAutoResults(result.results || []);

    // 다른 탭 활성화
    enableExportButtons();
    document.getElementById("btn-evaluate").disabled = false;
    saveSession({ keywords: allKeywords, autoResults: result.results });

    // 시각화 업데이트
    window.dispatchEvent(new CustomEvent("keywords-generated", {
      detail: { keywords: allKeywords, mainKeyword: allKeywords[0]?.keyword || "" }
    }));

    updateApiStatusBadge();

    const recCount = (result.recommendedKeywords || []).filter(k => k.grade === "S" || k.grade === "A").length;
    showToast(`${result.totalNews}개 뉴스에서 키워드 발굴! 추천 ${recCount}개`, "success");

  } catch (err) {
    resultsContainer.innerHTML = `
      <div class="placeholder-msg">
        <p>❌ 오류 발생: ${escapeHtml(err.message)}</p>
      </div>`;
    showToast("분석 중 오류가 발생했습니다.", "error");
  } finally {
    btn.disabled = false;
    setTimeout(() => {
      progress.classList.add("hidden");
      setProgress("ps-done", "done", 100);
    }, 2000);
  }
}

function renderRecommendedKeywords(keywords) {
  const section = document.getElementById("recommended-keywords");
  const list = document.getElementById("recommended-list");
  const countEl = document.getElementById("recommended-count");

  // S/A 등급만 필터
  const recommended = keywords.filter(k => k.grade === "S" || k.grade === "A");

  if (recommended.length === 0) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  countEl.textContent = `${recommended.length}개 키워드`;

  list.innerHTML = recommended.map((kw) => {
    const gradeClass = `grade-${kw.grade.toLowerCase()}`;
    const breakdown = kw.scoreBreakdown || {};
    return `
      <div class="recommended-item">
        <span class="grade-badge ${gradeClass}">${escapeHtml(kw.grade)}</span>
        <span class="rec-keyword">${escapeHtml(kw.keyword)}</span>
        <span class="rec-news-cat">${escapeHtml(kw.newsCategory || "")}</span>
        <span class="score-tooltip">
          <span class="rec-score">${kw.monetizationScore}점</span>
          <span class="tooltip-content">
            <div class="tooltip-row"><span>광고단가</span><span class="tooltip-val">${breakdown.adValueScore || 0}</span></div>
            <div class="tooltip-row"><span>검색의도</span><span class="tooltip-val">${breakdown.intentScore || 0}</span></div>
            <div class="tooltip-row"><span>롱테일</span><span class="tooltip-val">${breakdown.longtailScore || 0}</span></div>
            <div class="tooltip-row"><span>연령적합</span><span class="tooltip-val">${breakdown.ageScore || 0}</span></div>
            <div class="tooltip-row"><span>지속성</span><span class="tooltip-val">${breakdown.durabilityScore || 0}</span></div>
          </span>
        </span>
        <span class="rec-reason">${escapeHtml(kw.reasoning || "")}</span>
      </div>`;
  }).join("");
}

function renderAutoResults(results) {
  const container = document.getElementById("auto-results");
  if (!results || results.length === 0) {
    container.innerHTML = '<div class="placeholder-msg"><p>분석 결과가 없습니다.</p></div>';
    return;
  }

  container.innerHTML = results.map((item) => {
    // 수익화 키워드 목록 (점수순 정렬됨)
    const moneyKws = (item.moneyKeywords || item.relatedKeywords || []);
    const kwsHtml = moneyKws.map((mk) => {
      const gradeClass = mk.grade ? `grade-${mk.grade.toLowerCase()}` : "grade-d";
      const levelLabel = mk.level === 3 ? "3차" : "2차";
      const breakdown = mk.scoreBreakdown || {};
      return `
        <div class="money-kw-item">
          <span class="grade-badge ${gradeClass}">${escapeHtml(mk.grade || "-")}</span>
          <span class="mkw-text">${escapeHtml(mk.keyword)}</span>
          <span class="mkw-level">${levelLabel}</span>
          <span class="score-tooltip">
            <span class="mkw-score">${mk.monetizationScore || 0}점</span>
            <span class="tooltip-content">
              <div class="tooltip-row"><span>광고단가</span><span class="tooltip-val">${breakdown.adValueScore || 0}</span></div>
              <div class="tooltip-row"><span>검색의도</span><span class="tooltip-val">${breakdown.intentScore || 0}</span></div>
              <div class="tooltip-row"><span>롱테일</span><span class="tooltip-val">${breakdown.longtailScore || 0}</span></div>
              <div class="tooltip-row"><span>연령적합</span><span class="tooltip-val">${breakdown.ageScore || 0}</span></div>
              <div class="tooltip-row"><span>지속성</span><span class="tooltip-val">${breakdown.durabilityScore || 0}</span></div>
            </span>
          </span>
        </div>`;
    }).join("");

    return `
      <div class="news-kw-card">
        <div class="card-header">
          <div>
            <div class="news-title">${escapeHtml(item.newsTitle)}</div>
            <div class="news-source">${escapeHtml(item.newsSource || "")} · ${escapeHtml(item.newsCategory)}</div>
          </div>
          <span class="news-badge">${CATEGORIES[item.detectedCategory]?.icon || "📌"} ${CATEGORIES[item.detectedCategory]?.name || item.detectedCategory}</span>
        </div>
        <div class="main-keyword">🔑 ${escapeHtml(item.extractedKeyword)}</div>
        <div class="money-keywords-section">
          <div class="mkw-header">수익화 키워드 (점수순)</div>
          ${kwsHtml}
        </div>
      </div>`;
  }).join("");
}

function setProgress(stepId, status, percent) {
  const step = document.getElementById(stepId);
  if (step) {
    step.className = `progress-step ${status}`;
  }
  const fill = document.getElementById("progress-fill");
  if (fill) {
    fill.style.width = `${percent}%`;
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── 키워드 생성기 ──────────────────────────────────────────

function initKeywordGenerator() {
  const btn = document.getElementById("btn-generate");
  const input = document.getElementById("main-keyword-input");
  const catSelect = document.getElementById("category-select");

  btn.addEventListener("click", () => handleGenerateKeywords());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleGenerateKeywords();
  });

  // 키워드 입력 시 카테고리 자동 감지
  input.addEventListener("input", () => {
    const val = input.value.trim();
    if (val && !catSelect.value) {
      const detected = detectCategory(val);
      const span = document.getElementById("detected-category");
      if (detected) {
        span.textContent = `→ ${CATEGORIES[detected]?.icon || ""} ${CATEGORIES[detected]?.name || ""} (자동 감지)`;
      } else {
        span.textContent = "";
      }
    }
  });
}

async function handleGenerateKeywords() {
  const input = document.getElementById("main-keyword-input");
  const keyword = input.value.trim();
  if (!keyword) {
    showToast("키워드를 입력하세요.", "warning");
    return;
  }

  const catSelect = document.getElementById("category-select");
  const category = catSelect.value || null;

  showLoading("키워드 생성 중...");

  try {
    const results = await generateKeywords(keyword, category);
    state.currentKeywords = results;

    renderKeywordResults(results);
    enableExportButtons();
    addToHistory(keyword, category || detectCategory(keyword));
    saveSession({ keywords: results, mainKeyword: keyword });
    updateApiStatusBadge();

    // 평가 버튼 활성화
    document.getElementById("btn-evaluate").disabled = false;

    showToast(`${results.length}개 키워드가 생성되었습니다.`, "success");

    // 시각화 업데이트를 위한 이벤트
    window.dispatchEvent(new CustomEvent("keywords-generated", { detail: { keywords: results, mainKeyword: keyword } }));
  } catch (err) {
    showToast(`오류: ${err.message}`, "error");
  } finally {
    hideLoading();
  }
}

function renderKeywordResults(keywords) {
  const container = document.getElementById("keyword-results");

  // 레벨별 그룹화
  const levels = {};
  for (const kw of keywords) {
    if (!levels[kw.level]) levels[kw.level] = [];
    levels[kw.level].push(kw);
  }

  const levelNames = ["🎯 메인 키워드", "📌 1차 확장", "🔗 2차 확장", "🔍 3차 롱테일"];

  let html = "";
  for (const [level, kws] of Object.entries(levels)) {
    html += `<div class="kw-level-group">`;
    html += `<div class="kw-level-header">${levelNames[level] || `Level ${level}`} (${kws.length}개)</div>`;

    for (const kw of kws) {
      const vol = kw.stats ? getTotalVolume(kw.stats) : null;
      const estimated = kw.stats?._estimated ? " estimated" : "";
      const typeLabel =
        kw.type === "api" ? "API" :
        kw.type === "template" ? "템플릿" :
        kw.type === "intent" ? "의도" : "";

      html += `
        <div class="kw-item">
          <span class="kw-text">${escapeHtml(kw.keyword)}</span>
          ${typeLabel ? `<span class="kw-type ${kw.type}">${typeLabel}</span>` : ""}
          <span class="kw-stats">
            ${vol !== null ? `<span class="${estimated}">${formatNumber(vol)}회/월</span>` : ""}
            ${kw.stats?.compIdx ? `<br><span class="${estimated}">${kw.stats.compIdx}</span>` : ""}
          </span>
        </div>`;
    }

    html += `</div>`;
  }

  container.innerHTML = html;
}

// ─── 평가 ───────────────────────────────────────────────────

function initEvaluation() {
  document.getElementById("btn-evaluate").addEventListener("click", handleEvaluate);
}

async function handleEvaluate() {
  if (state.currentKeywords.length === 0) {
    showToast("먼저 키워드를 생성하세요.", "warning");
    return;
  }

  showLoading("키워드 평가 중...");

  try {
    const results = await evaluateKeywords(state.currentKeywords);
    state.evaluationResults = results;

    renderEvalResults(results);
    saveSession({ keywords: state.currentKeywords, evaluation: results });
    showToast("평가가 완료되었습니다.", "success");

    window.dispatchEvent(new CustomEvent("evaluation-done", { detail: { results } }));
  } catch (err) {
    showToast(`평가 오류: ${err.message}`, "error");
  } finally {
    hideLoading();
  }
}

function renderEvalResults(results) {
  const container = document.getElementById("eval-results");

  // 점수 내림차순 정렬
  const sorted = [...results].sort((a, b) => b.totalScore - a.totalScore);

  let html = `
    <table class="eval-table">
      <thead>
        <tr>
          <th>등급</th>
          <th>키워드</th>
          <th>총점</th>
          <th>수익화</th>
          <th>검색량</th>
          <th>CPC</th>
          <th>경쟁도</th>
          <th>수명</th>
          <th>연령</th>
          <th>평가</th>
        </tr>
      </thead>
      <tbody>`;

  for (const r of sorted) {
    const gradeColor = getGradeColor(r.grade);
    const gradeClass = `grade-${r.grade.toLowerCase()}`;
    html += `
      <tr>
        <td><span class="grade-badge ${gradeClass}" style="background:${gradeColor}">${r.grade}</span></td>
        <td>${escapeHtml(r.keyword)}</td>
        <td><strong>${r.totalScore}</strong></td>
        <td>${renderScoreBar(r.breakdown.monetization || 0)}</td>
        <td>${renderScoreBar(r.breakdown.volume)}</td>
        <td>${renderScoreBar(r.breakdown.cpc)}</td>
        <td>${renderScoreBar(r.breakdown.competition)}</td>
        <td>${renderScoreBar(r.breakdown.lifespan)}</td>
        <td>${renderScoreBar(r.breakdown.ageReach)}</td>
        <td style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(r.summary)}</td>
      </tr>`;
  }

  html += `</tbody></table>`;
  container.innerHTML = html;
}

function renderScoreBar(value) {
  const color =
    value >= 70 ? "var(--success)" :
    value >= 40 ? "var(--warning)" :
    "var(--danger)";

  return `
    <span class="score-bar">
      <span class="score-bar-fill" style="width:${value}%;background:${color}"></span>
    </span>
    <span style="font-size:0.75rem;margin-left:4px;color:var(--text-dim)">${value}</span>`;
}

// ─── 사고 프로세스 ──────────────────────────────────────────

function initThinkingProcess() {
  document.getElementById("btn-think").addEventListener("click", () => {
    const input = document.getElementById("issue-input");
    const issue = input.value.trim();
    if (!issue) {
      showToast("이슈를 입력하세요.", "warning");
      return;
    }
    // thinking-process.js에서 처리
    window.dispatchEvent(new CustomEvent("start-thinking", { detail: { issue } }));
  });
}

// ─── 내보내기 ───────────────────────────────────────────────

function initExport() {
  // export.js에서 별도 처리
}

function enableExportButtons() {
  document.getElementById("btn-export-csv").disabled = false;
  document.getElementById("btn-export-json").disabled = false;
  document.getElementById("btn-export-clipboard").disabled = false;
}

// ─── 세션 복원 ──────────────────────────────────────────────

function restoreSession() {
  const session = loadSession();
  if (session && session.keywords && session.keywords.length > 0) {
    state.currentKeywords = session.keywords;
    renderKeywordResults(session.keywords);
    enableExportButtons();
    document.getElementById("btn-evaluate").disabled = false;

    if (session.mainKeyword) {
      document.getElementById("main-keyword-input").value = session.mainKeyword;
    }
    if (session.evaluation) {
      state.evaluationResults = session.evaluation;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 유틸리티
// ═══════════════════════════════════════════════════════════

export function showLoading(text = "로딩 중...") {
  document.getElementById("loading-text").textContent = text;
  document.getElementById("loading-overlay").classList.remove("hidden");
}

export function hideLoading() {
  document.getElementById("loading-overlay").classList.add("hidden");
}

export function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatNumber(n) {
  if (typeof n !== "number" || isNaN(n)) return "-";
  return n.toLocaleString("ko-KR");
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return dateStr;
  }
}
