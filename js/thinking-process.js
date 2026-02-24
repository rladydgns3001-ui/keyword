// ═══════════════════════════════════════════════════════════
// 사고 프로세스 단계별 UI
// ═══════════════════════════════════════════════════════════

import { detectCategory, CATEGORIES, SUFFIX_TEMPLATES } from "./keyword-data.js";
import { searchNews, getRelatedKeywords, getKeywordStats } from "./api-client.js";
import { getTotalVolume } from "./keyword-engine.js";

/**
 * 사고 프로세스 초기화
 */
export function initThinkingProcess() {
  window.addEventListener("start-thinking", (e) => {
    runThinkingProcess(e.detail.issue);
  });
}

/**
 * 5단계 사고 프로세스 실행
 * @param {string} issue - 이슈/뉴스 텍스트
 */
async function runThinkingProcess(issue) {
  const container = document.getElementById("thinking-steps");
  if (!container) return;

  container.innerHTML = "";

  // Step 1: 이슈 발견
  const step1 = renderStep(1, "이슈 발견", "관련 뉴스를 검색합니다...");
  container.appendChild(step1);

  const newsResult = await searchNews(issue, 5, "sim");
  const newsItems = newsResult.items || [];
  updateStepContent(step1, buildStep1Content(issue, newsItems));

  // Step 2: 검색 의도 예측
  await delay(200);
  const step2 = renderStep(2, "검색 의도 예측", "사람들이 무엇을 검색할지 예측합니다...");
  container.appendChild(step2);

  const relatedResult = await getRelatedKeywords(issue);
  const relatedKws = relatedResult.relatedKeywords || [];
  const intents = predictIntents(issue, relatedKws);
  updateStepContent(step2, buildStep2Content(issue, intents, relatedKws));

  // Step 3: 카테고리 분류
  await delay(200);
  const step3 = renderStep(3, "카테고리 분류", "키워드 카테고리를 분류합니다...");
  container.appendChild(step3);

  const detectedCat = detectCategory(issue);
  updateStepContent(step3, buildStep3Content(issue, detectedCat));

  // Step 4: 세부 키워드 확장
  await delay(200);
  const step4 = renderStep(4, "세부 키워드 확장", "키워드를 다단계로 확장합니다...");
  container.appendChild(step4);

  const expandedKeywords = expandKeywords(issue, detectedCat, relatedKws);
  updateStepContent(step4, buildStep4Content(expandedKeywords));

  // Step 5: 품질 필터링
  await delay(200);
  const step5 = renderStep(5, "품질 필터링", "검색량과 경쟁도로 필터링합니다...");
  container.appendChild(step5);

  const topKeywords = expandedKeywords.slice(0, 20);
  const statsResult = await getKeywordStats(topKeywords.map((k) => k.keyword));
  const statsList = statsResult.keywordList || [];
  const filtered = filterByQuality(topKeywords, statsList);
  updateStepContent(step5, buildStep5Content(filtered));
}

// ─── Step 콘텐츠 빌더 ──────────────────────────────────────

function buildStep1Content(issue, newsItems) {
  let html = `<p>"<strong>${escapeHtml(issue)}</strong>" 관련 이슈를 분석합니다.</p>`;
  html += `<p>💭 <em>"이 뉴스를 보면 사람들이 뭘 검색할까?"</em></p>`;

  if (newsItems.length > 0) {
    html += `<div class="step-tags">`;
    for (const item of newsItems.slice(0, 5)) {
      const title = item.title.replace(/<[^>]*>/g, "");
      html += `<span class="step-tag">${escapeHtml(truncate(title, 30))}</span>`;
    }
    html += `</div>`;
  } else {
    html += `<p style="color:var(--text-dim)">📡 API 연결 시 실시간 뉴스가 표시됩니다.</p>`;
  }

  return html;
}

function buildStep2Content(issue, intents, relatedKws) {
  let html = `<p>사용자 검색 의도를 예측합니다:</p>`;

  html += `<div class="step-tags">`;
  for (const intent of intents) {
    html += `<span class="step-tag">${escapeHtml(intent)}</span>`;
  }
  html += `</div>`;

  if (relatedKws.length > 0) {
    html += `<p style="margin-top:10px">API 연관 키워드:</p>`;
    html += `<div class="step-tags">`;
    for (const rk of relatedKws.slice(0, 8)) {
      html += `<span class="step-tag" style="border-color:var(--accent)">${escapeHtml(rk.keyword)}</span>`;
    }
    html += `</div>`;
  }

  return html;
}

function buildStep3Content(issue, detectedCat) {
  const cat = CATEGORIES[detectedCat];
  let html = "";

  if (cat) {
    html += `<p>감지된 카테고리: <strong>${cat.icon} ${cat.name}</strong></p>`;
    html += `<p style="color:var(--text-dim)">${cat.description}</p>`;
    html += `<p style="margin-top:8px">이 카테고리의 주요 키워드 패턴:</p>`;

    const suffixes = SUFFIX_TEMPLATES[detectedCat] || [];
    html += `<div class="step-tags">`;
    for (const s of suffixes.slice(0, 8)) {
      html += `<span class="step-tag">${escapeHtml(issue)} ${escapeHtml(s)}</span>`;
    }
    html += `</div>`;
  } else {
    html += `<p>카테고리를 자동 감지하지 못했습니다. 범용 키워드 패턴을 적용합니다.</p>`;
  }

  return html;
}

function buildStep4Content(expandedKeywords) {
  let html = `<p>총 <strong>${expandedKeywords.length}개</strong> 키워드로 확장되었습니다:</p>`;

  // 레벨별 분류
  const byLevel = {};
  for (const kw of expandedKeywords) {
    const lvl = kw.level || 0;
    if (!byLevel[lvl]) byLevel[lvl] = [];
    byLevel[lvl].push(kw);
  }

  const levelNames = ["메인", "1차 확장", "2차 확장", "3차 롱테일"];

  for (const [level, kws] of Object.entries(byLevel)) {
    html += `<p style="margin-top:8px;font-weight:600">${levelNames[level] || `Level ${level}`} (${kws.length}개):</p>`;
    html += `<div class="step-tags">`;
    for (const kw of kws.slice(0, 6)) {
      html += `<span class="step-tag">${escapeHtml(kw.keyword)}</span>`;
    }
    if (kws.length > 6) {
      html += `<span class="step-tag" style="opacity:0.5">+${kws.length - 6}개 더</span>`;
    }
    html += `</div>`;
  }

  return html;
}

function buildStep5Content(filtered) {
  let html = `<p>품질 필터링 결과 <strong>상위 ${filtered.length}개</strong> 키워드:</p>`;

  if (filtered.length === 0) {
    html += `<p style="color:var(--text-dim)">필터링된 키워드가 없습니다. API 연결 시 실제 데이터가 표시됩니다.</p>`;
    return html;
  }

  html += `<table style="width:100%;font-size:0.82rem;margin-top:10px">`;
  html += `<tr style="color:var(--text-dim)"><th style="text-align:left;padding:4px 8px">키워드</th><th>검색량</th><th>경쟁도</th></tr>`;

  for (const kw of filtered.slice(0, 10)) {
    const vol = kw.totalVolume ? kw.totalVolume.toLocaleString("ko-KR") : "-";
    const comp = kw.compIdx || "-";
    const estimated = kw._estimated ? ' style="opacity:0.6;font-style:italic"' : "";

    html += `<tr${estimated}><td style="padding:4px 8px">${escapeHtml(kw.keyword)}</td>`;
    html += `<td style="text-align:center">${vol}</td>`;
    html += `<td style="text-align:center">${comp}</td></tr>`;
  }

  html += `</table>`;
  return html;
}

// ─── 헬퍼 함수 ─────────────────────────────────────────────

function predictIntents(issue, relatedKws) {
  const intents = [
    `${issue} 뜻`,
    `${issue} 정리`,
    `${issue} 방법`,
    `${issue} 신청`,
    `${issue} 대상`,
    `${issue} 후기`,
  ];

  // 연관 키워드에서 의도 추출
  for (const rk of relatedKws.slice(0, 3)) {
    if (!intents.includes(rk.keyword)) {
      intents.push(rk.keyword);
    }
  }

  return intents.slice(0, 10);
}

function expandKeywords(issue, category, relatedKws) {
  const keywords = [{ keyword: issue, level: 0 }];

  // 카테고리 접미사
  const suffixes = SUFFIX_TEMPLATES[category] || SUFFIX_TEMPLATES.subsidy;
  for (const s of suffixes) {
    keywords.push({ keyword: `${issue} ${s}`, level: 1 });
  }

  // 연관 키워드
  for (const rk of relatedKws) {
    if (!keywords.some((k) => k.keyword === rk.keyword)) {
      keywords.push({ keyword: rk.keyword, level: 1 });
    }
  }

  // 2차 확장 (상위 5개)
  const level1 = keywords.filter((k) => k.level === 1).slice(0, 5);
  for (const l1 of level1) {
    for (const s of suffixes.slice(0, 3)) {
      const expanded = `${l1.keyword} ${s}`;
      if (!keywords.some((k) => k.keyword === expanded)) {
        keywords.push({ keyword: expanded, level: 2 });
      }
    }
  }

  return keywords;
}

function filterByQuality(keywords, statsList) {
  const statsMap = new Map(statsList.map((s) => [s.relKeyword, s]));

  return keywords
    .map((kw) => {
      const stats = statsMap.get(kw.keyword);
      return {
        keyword: kw.keyword,
        totalVolume: stats ? (stats.monthlyPcQcCnt || 0) + (stats.monthlyMobileQcCnt || 0) : 0,
        compIdx: stats?.compIdx || null,
        _estimated: stats?._estimated || false,
      };
    })
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

// ─── DOM 헬퍼 ───────────────────────────────────────────────

function renderStep(num, title, placeholder) {
  const div = document.createElement("div");
  div.className = `step-card step-${num}`;
  div.innerHTML = `
    <div class="step-number">STEP ${num}</div>
    <h3>${title}</h3>
    <div class="step-content"><p style="color:var(--text-dim)">${placeholder}</p></div>
  `;
  return div;
}

function updateStepContent(stepEl, html) {
  const content = stepEl.querySelector(".step-content");
  if (content) content.innerHTML = html;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  if (!str) return "";
  return str.length > len ? str.substring(0, len) + "…" : str;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
