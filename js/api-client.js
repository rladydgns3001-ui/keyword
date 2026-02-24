// ═══════════════════════════════════════════════════════════
// Firebase Functions API 호출 클라이언트 + 폴백 처리
// ═══════════════════════════════════════════════════════════

import { SUFFIX_TEMPLATES } from "./keyword-data.js";

/** API 베이스 URL (Firebase Functions 또는 로컬 에뮬레이터) */
let API_BASE = "/api";

/**
 * API 베이스 URL 설정
 * 로컬 개발: http://localhost:5001/PROJECT_ID/us-central1
 * 프로덕션: Firebase Hosting에서 rewrite 사용 시 동일 도메인
 */
export function setApiBase(url) {
  API_BASE = url.replace(/\/$/, "");
}

export function getApiBase() {
  return API_BASE;
}

/** API 키 설정 상태 */
const apiStatus = {
  naverSearch: false, // 뉴스/DataLab용
  naverAd: false,     // 검색광고용
};

export function getApiStatus() {
  return { ...apiStatus };
}

// ─── 내부 fetch 헬퍼 ────────────────────────────────────────

async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}/${endpoint}`;
  const timeout = options.timeout || 10000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // API 미설정 에러 구분
      if (data.error === "API_NOT_CONFIGURED" || data.error === "AD_API_NOT_CONFIGURED") {
        return { _fallback: true, error: data.error, message: data.message };
      }
      throw new Error(data.message || `API 오류: ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      return { _fallback: true, error: "TIMEOUT", message: "요청 시간 초과" };
    }
    // 네트워크 오류 → 폴백
    return { _fallback: true, error: "NETWORK_ERROR", message: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// 1. 뉴스 검색
// ═══════════════════════════════════════════════════════════

/**
 * 네이버 뉴스 검색
 * @param {string} query - 검색어
 * @param {number} display - 결과 수 (기본 10)
 * @param {string} sort - 정렬 (date|sim)
 * @returns {Promise<{items: Array, _fallback?: boolean}>}
 */
export async function searchNews(query, display = 10, sort = "date") {
  const params = new URLSearchParams({ query, display, sort });
  const result = await apiFetch(`news?${params}`);

  if (result._fallback) {
    return { items: [], _fallback: true, message: result.message };
  }

  apiStatus.naverSearch = true;
  return result;
}

// ═══════════════════════════════════════════════════════════
// 2. 검색 트렌드 (DataLab)
// ═══════════════════════════════════════════════════════════

/**
 * 네이버 DataLab 검색 트렌드
 * @param {Array<{groupName: string, keywords: string[]}>} keywordGroups
 * @param {Object} options - startDate, endDate, timeUnit, device, gender, ages
 * @returns {Promise<Object>}
 */
export async function searchTrends(keywordGroups, options = {}) {
  const body = { keywordGroups, ...options };

  const result = await apiFetch("trends", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (result._fallback) {
    return { results: [], _fallback: true, message: result.message };
  }

  apiStatus.naverSearch = true;
  return result;
}

// ═══════════════════════════════════════════════════════════
// 3. 키워드 검색량/CPC 조회
// ═══════════════════════════════════════════════════════════

/**
 * 키워드 검색량/CPC/경쟁도 조회
 * @param {string[]} keywords - 키워드 배열
 * @returns {Promise<{keywordList: Array, _fallback?: boolean}>}
 */
export async function getKeywordStats(keywords) {
  const params = new URLSearchParams({ keywords: keywords.join(",") });
  const result = await apiFetch(`keywords?${params}`);

  if (result._fallback) {
    return { keywordList: generateFallbackStats(keywords), _fallback: true, message: result.message };
  }

  apiStatus.naverAd = true;
  return result;
}

// ═══════════════════════════════════════════════════════════
// 4. 연관 키워드 조회
// ═══════════════════════════════════════════════════════════

/**
 * 연관 키워드 조회
 * @param {string} keyword - 메인 키워드
 * @returns {Promise<{keyword: string, relatedKeywords: Array, _fallback?: boolean}>}
 */
export async function getRelatedKeywords(keyword) {
  const params = new URLSearchParams({ keyword });
  const result = await apiFetch(`related?${params}`);

  if (result._fallback) {
    return {
      keyword,
      relatedKeywords: generateFallbackRelated(keyword),
      _fallback: true,
      message: result.message,
    };
  }

  apiStatus.naverAd = true;
  return result;
}

// ═══════════════════════════════════════════════════════════
// 폴백 데이터 생성
// ═══════════════════════════════════════════════════════════

/**
 * API 미사용 시 카테고리 기반 추정 통계 생성
 */
function generateFallbackStats(keywords) {
  return keywords.map((kw) => {
    // 키워드 길이에 따른 검색량 추정 (롱테일일수록 적음)
    const lengthFactor = Math.max(0.1, 1 - (kw.length - 4) * 0.08);
    const baseVolume = 5000 + Math.floor(Math.random() * 15000);
    const volume = Math.floor(baseVolume * lengthFactor);

    return {
      relKeyword: kw,
      monthlyPcQcCnt: Math.floor(volume * 0.3),
      monthlyMobileQcCnt: Math.floor(volume * 0.7),
      monthlyAvePcClkCnt: Math.floor(volume * 0.3 * 0.03),
      monthlyAveMobileClkCnt: Math.floor(volume * 0.7 * 0.05),
      compIdx: ["낮음", "중간", "높음"][Math.floor(Math.random() * 3)],
      plAvgDepth: Math.floor(5 + Math.random() * 10),
      _estimated: true,
    };
  });
}

/**
 * API 미사용 시 템플릿 기반 연관 키워드 생성
 */
function generateFallbackRelated(keyword) {
  // 카테고리별 접미사에서 랜덤 선택
  const allSuffixes = Object.values(SUFFIX_TEMPLATES).flat();
  const selected = [];
  const used = new Set();

  for (let i = 0; i < 15 && selected.length < 10; i++) {
    const idx = Math.floor(Math.random() * allSuffixes.length);
    const suffix = allSuffixes[idx];
    if (used.has(suffix)) continue;
    used.add(suffix);

    const relKeyword = `${keyword} ${suffix}`;
    const volume = 500 + Math.floor(Math.random() * 10000);

    selected.push({
      keyword: relKeyword,
      monthlyPcQcCnt: Math.floor(volume * 0.3),
      monthlyMobileQcCnt: Math.floor(volume * 0.7),
      compIdx: ["낮음", "중간", "높음"][Math.floor(Math.random() * 3)],
      _estimated: true,
    });
  }

  return selected;
}

// ═══════════════════════════════════════════════════════════
// API 연결 테스트
// ═══════════════════════════════════════════════════════════

/**
 * API 연결 상태 확인
 * @returns {Promise<{naverSearch: boolean, naverAd: boolean}>}
 */
export async function testApiConnection() {
  const results = { naverSearch: false, naverAd: false };

  // 뉴스 API 테스트
  try {
    const newsResult = await searchNews("테스트", 1);
    results.naverSearch = !newsResult._fallback;
  } catch {
    results.naverSearch = false;
  }

  // 검색광고 API 테스트
  try {
    const kwResult = await getKeywordStats(["테스트"]);
    results.naverAd = !kwResult._fallback;
  } catch {
    results.naverAd = false;
  }

  Object.assign(apiStatus, results);
  return results;
}

// ═══════════════════════════════════════════════════════════
// 5. 자동 분석 (뉴스 수집 → 키워드 추출 → 일괄)
// ═══════════════════════════════════════════════════════════

/**
 * 자동 뉴스 분석 → 키워드 발굴
 * @returns {Promise<Object>}
 */
export async function autoAnalyze() {
  const result = await apiFetch("auto-analyze", { timeout: 30000 });

  if (result._fallback) {
    return result;
  }

  apiStatus.naverSearch = true;
  return result;
}
