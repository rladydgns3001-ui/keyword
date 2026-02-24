// ═══════════════════════════════════════════════════════════
// 키워드 생성 엔진 (규칙 기반 + API 결합)
// ═══════════════════════════════════════════════════════════

import {
  CATEGORIES,
  SUFFIX_TEMPLATES,
  INTENT_PREFIXES,
  INTENT_SUFFIXES,
  detectCategory,
} from "./keyword-data.js";
import { getRelatedKeywords, getKeywordStats } from "./api-client.js";

/**
 * 키워드 결과 객체
 * @typedef {Object} KeywordResult
 * @property {string} keyword - 키워드 텍스트
 * @property {string} type - 'main' | 'template' | 'api' | 'intent'
 * @property {number} level - 확장 레벨 (0=메인, 1=1차, 2=2차, 3=3차)
 * @property {string} category - 카테고리 ID
 * @property {string} parent - 부모 키워드
 * @property {Object|null} stats - 검색량/CPC 데이터
 */

/**
 * 메인 키워드에서 전체 키워드 트리 생성
 * @param {string} mainKeyword - 메인 키워드
 * @param {string} [categoryId] - 카테고리 ID (미지정 시 자동 감지)
 * @returns {Promise<KeywordResult[]>}
 */
export async function generateKeywords(mainKeyword, categoryId) {
  if (!mainKeyword || !mainKeyword.trim()) return [];

  const keyword = mainKeyword.trim();
  const category = categoryId || detectCategory(keyword) || "subsidy";
  const results = [];

  // Level 0: 메인 키워드
  results.push({
    keyword,
    type: "main",
    level: 0,
    category,
    parent: null,
    stats: null,
  });

  // Level 1: 템플릿 기반 1차 확장
  const templateKeywords = generateTemplateKeywords(keyword, category);
  for (const tk of templateKeywords) {
    results.push({
      keyword: tk,
      type: "template",
      level: 1,
      category,
      parent: keyword,
      stats: null,
    });
  }

  // Level 1: API 연관 키워드
  const apiRelated = await getRelatedKeywords(keyword);
  const apiKeywords = (apiRelated.relatedKeywords || []).slice(0, 15);
  for (const rk of apiKeywords) {
    // 중복 방지
    if (results.some((r) => r.keyword === rk.keyword)) continue;
    results.push({
      keyword: rk.keyword,
      type: "api",
      level: 1,
      category,
      parent: keyword,
      stats: {
        monthlyPcQcCnt: rk.monthlyPcQcCnt,
        monthlyMobileQcCnt: rk.monthlyMobileQcCnt,
        compIdx: rk.compIdx,
        _estimated: rk._estimated || false,
      },
    });
  }

  // Level 2: 의도 기반 확장
  const intentKeywords = generateIntentKeywords(keyword);
  for (const ik of intentKeywords) {
    if (results.some((r) => r.keyword === ik)) continue;
    results.push({
      keyword: ik,
      type: "intent",
      level: 2,
      category,
      parent: keyword,
      stats: null,
    });
  }

  // Level 2~3: 1차 키워드에서 2차 확장 (상위 5개만)
  const level1Keywords = results
    .filter((r) => r.level === 1)
    .slice(0, 5);

  for (const l1 of level1Keywords) {
    const subSuffixes = getTopSuffixes(category, 3);
    for (const suffix of subSuffixes) {
      const expanded = `${l1.keyword} ${suffix}`;
      if (results.some((r) => r.keyword === expanded)) continue;
      results.push({
        keyword: expanded,
        type: "template",
        level: l1.level + 1,
        category,
        parent: l1.keyword,
        stats: null,
      });
    }
  }

  // 검색량/CPC 데이터 일괄 조회 (stats가 없는 키워드)
  const needStats = results.filter((r) => !r.stats).map((r) => r.keyword);
  if (needStats.length > 0) {
    // 최대 100개씩 분할
    const chunks = chunkArray(needStats, 100);
    for (const chunk of chunks) {
      const statsResult = await getKeywordStats(chunk);
      const statsList = statsResult.keywordList || [];
      const statsMap = new Map(statsList.map((s) => [s.relKeyword, s]));

      for (const r of results) {
        if (!r.stats && statsMap.has(r.keyword)) {
          const s = statsMap.get(r.keyword);
          r.stats = {
            monthlyPcQcCnt: s.monthlyPcQcCnt,
            monthlyMobileQcCnt: s.monthlyMobileQcCnt,
            monthlyAvePcClkCnt: s.monthlyAvePcClkCnt,
            monthlyAveMobileClkCnt: s.monthlyAveMobileClkCnt,
            compIdx: s.compIdx,
            plAvgDepth: s.plAvgDepth,
            _estimated: s._estimated || false,
          };
        }
      }
    }
  }

  return results;
}

/**
 * 템플릿 기반 키워드 생성
 */
function generateTemplateKeywords(keyword, category) {
  const suffixes = SUFFIX_TEMPLATES[category] || SUFFIX_TEMPLATES.subsidy;
  return suffixes.map((s) => `${keyword} ${s}`);
}

/**
 * 의도 기반 키워드 생성
 */
function generateIntentKeywords(keyword) {
  const results = [];

  for (const { prefix } of INTENT_PREFIXES) {
    if (prefix) results.push(`${prefix}${keyword}`);
  }
  for (const { suffix } of INTENT_SUFFIXES) {
    results.push(`${keyword}${suffix}`);
  }

  return results;
}

/**
 * 카테고리별 상위 N개 접미사 반환
 */
function getTopSuffixes(category, n) {
  const suffixes = SUFFIX_TEMPLATES[category] || SUFFIX_TEMPLATES.subsidy;
  return suffixes.slice(0, n);
}

/**
 * 배열을 N개씩 분할
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * 뉴스 제목에서 키워드 추출
 * @param {string} title - 뉴스 제목
 * @returns {{keyword: string, category: string|null}}
 */
export function extractKeywordFromNews(title) {
  // HTML 태그 제거
  const clean = title.replace(/<[^>]*>/g, "").trim();

  // 따옴표 안 내용 우선 추출
  const quoted = clean.match(/['"「」『』""'']([^'"「」『』""'']+)['"「」『』""'']/);
  if (quoted) {
    return {
      keyword: quoted[1].trim(),
      category: detectCategory(quoted[1]),
    };
  }

  // 주요 명사구 추출 (조사 제거)
  const stripped = clean
    .replace(/\[.*?\]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/…|\.{3}/g, "")
    .trim();

  // 첫 번째 의미 있는 구절 (15자 이내)
  const words = stripped.split(/\s+/);
  let keyword = "";
  for (const w of words) {
    const next = keyword ? `${keyword} ${w}` : w;
    if (next.length > 15) break;
    keyword = next;
  }

  // 조사 제거
  keyword = keyword.replace(/(은|는|이|가|을|를|에|의|로|와|과|도|만|까지|부터|에서)$/, "");

  return {
    keyword: keyword.trim(),
    category: detectCategory(keyword),
  };
}

/**
 * 키워드 총 검색량 계산
 * @param {Object} stats
 * @returns {number}
 */
export function getTotalVolume(stats) {
  if (!stats) return 0;
  return (stats.monthlyPcQcCnt || 0) + (stats.monthlyMobileQcCnt || 0);
}
