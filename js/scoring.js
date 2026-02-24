// ═══════════════════════════════════════════════════════════
// 키워드 품질 평가 (실제 API 데이터 기반)
// ═══════════════════════════════════════════════════════════

import { searchTrends } from "./api-client.js";
import { getTotalVolume } from "./keyword-engine.js";

/**
 * 평가 등급
 * @typedef {'S'|'A'|'B'|'C'|'D'} Grade
 */

/**
 * 평가 결과 객체
 * @typedef {Object} ScoreResult
 * @property {string} keyword
 * @property {number} totalScore - 총점 (0~100)
 * @property {Grade} grade - 등급
 * @property {Object} breakdown - 항목별 점수
 * @property {string} summary - 한줄 평가
 */

/** 점수 가중치 */
const WEIGHTS = {
  volume: 0.20,         // 검색량
  cpc: 0.15,            // CPC (광고 단가)
  competition: 0.15,    // 경쟁도 (낮을수록 좋음)
  lifespan: 0.15,       // 수명 (트렌드 안정성)
  ageReach: 0.10,       // 연령대 다양성
  monetization: 0.25,   // 수익화 점수 (서버에서 산정)
};

/**
 * 키워드 배열에 대한 일괄 평가
 * @param {Array<{keyword: string, stats: Object, category: string}>} keywords
 * @returns {Promise<ScoreResult[]>}
 */
export async function evaluateKeywords(keywords) {
  if (!keywords || keywords.length === 0) return [];

  // 트렌드 데이터 조회 (최대 5개 그룹)
  const trendData = await fetchTrendData(keywords.slice(0, 5));

  return keywords.map((kw) => evaluateSingle(kw, trendData));
}

/**
 * 단일 키워드 평가
 */
function evaluateSingle(kw, trendData) {
  const stats = kw.stats || {};
  const breakdown = {};

  // 1. 검색량 점수 (0~100)
  const totalVol = getTotalVolume(stats);
  breakdown.volume = scoreVolume(totalVol);

  // 2. CPC 점수 (클릭수 기반)
  const totalClicks =
    (stats.monthlyAvePcClkCnt || 0) + (stats.monthlyAveMobileClkCnt || 0);
  breakdown.cpc = scoreCPC(totalClicks, totalVol);

  // 3. 경쟁도 점수 (낮을수록 높은 점수)
  breakdown.competition = scoreCompetition(stats.compIdx);

  // 4. 수명 점수 (트렌드 분석)
  const trend = trendData.get(kw.keyword);
  breakdown.lifespan = scoreLifespan(trend);

  // 5. 연령대 점수
  breakdown.ageReach = scoreAgeReach(stats, kw.category);

  // 6. 수익화 점수 (서버에서 받은 monetizationScore 통합)
  breakdown.monetization = kw.monetizationScore || 50;

  // 총점 계산
  const totalScore = Math.round(
    breakdown.volume * WEIGHTS.volume +
    breakdown.cpc * WEIGHTS.cpc +
    breakdown.competition * WEIGHTS.competition +
    breakdown.lifespan * WEIGHTS.lifespan +
    breakdown.ageReach * WEIGHTS.ageReach +
    breakdown.monetization * WEIGHTS.monetization
  );

  // 등급 결정 (S등급 추가)
  const grade = totalScore >= 90 ? "S" : totalScore >= 75 ? "A" : totalScore >= 60 ? "B" : totalScore >= 40 ? "C" : "D";

  // 요약 생성
  const summary = generateSummary(kw.keyword, grade, breakdown);

  return {
    keyword: kw.keyword,
    totalScore,
    grade,
    breakdown,
    summary,
    stats: kw.stats,
  };
}

// ─── 개별 점수 계산 함수들 ──────────────────────────────────

function scoreVolume(totalVolume) {
  if (totalVolume >= 50000) return 100;
  if (totalVolume >= 20000) return 85;
  if (totalVolume >= 10000) return 70;
  if (totalVolume >= 5000) return 55;
  if (totalVolume >= 1000) return 40;
  if (totalVolume >= 100) return 25;
  return 10;
}

function scoreCPC(totalClicks, totalVolume) {
  if (totalVolume === 0) return 30;
  const ctr = totalClicks / totalVolume;
  if (ctr >= 0.1) return 100;
  if (ctr >= 0.05) return 80;
  if (ctr >= 0.03) return 60;
  if (ctr >= 0.01) return 40;
  return 20;
}

function scoreCompetition(compIdx) {
  if (!compIdx) return 50;
  const idx = typeof compIdx === "string" ? compIdx : String(compIdx);
  if (idx === "낮음" || idx === "LOW") return 90;
  if (idx === "중간" || idx === "MEDIUM") return 50;
  if (idx === "높음" || idx === "HIGH") return 20;
  return 50;
}

function scoreLifespan(trend) {
  if (!trend || !trend.data || trend.data.length < 2) return 50; // 데이터 없으면 중립

  const values = trend.data.map((d) => d.ratio);
  const len = values.length;
  if (len < 2) return 50;

  // 최근 vs 이전 비교
  const recentAvg = average(values.slice(-3));
  const olderAvg = average(values.slice(0, Math.max(1, len - 3)));

  if (olderAvg === 0) return recentAvg > 0 ? 80 : 30;

  const changeRate = (recentAvg - olderAvg) / olderAvg;

  if (changeRate > 0.3) return 90;  // 상승 트렌드
  if (changeRate > 0) return 70;    // 약간 상승
  if (changeRate > -0.2) return 55; // 안정
  if (changeRate > -0.5) return 35; // 하락
  return 15;                         // 급하락
}

function scoreAgeReach(stats, category) {
  // DataLab 연령별 데이터가 있으면 사용
  if (stats && stats.ageData) {
    const ages = Object.values(stats.ageData);
    const nonZero = ages.filter((v) => v > 5).length;
    return Math.min(100, nonZero * 20);
  }

  // 카테고리 기반 추정
  const categoryAgeScore = {
    subsidy: 70,
    person: 60,
    drama: 65,
    travel: 75,
    finance: 55,
    health: 80,
    app: 50,
    quiz: 45,
  };

  return categoryAgeScore[category] || 50;
}

// ─── 트렌드 데이터 일괄 조회 ────────────────────────────────

async function fetchTrendData(keywords) {
  const trendMap = new Map();

  if (keywords.length === 0) return trendMap;

  const keywordGroups = keywords.map((kw) => ({
    groupName: kw.keyword,
    keywords: [kw.keyword],
  }));

  // DataLab은 최대 5개 그룹
  const groups = keywordGroups.slice(0, 5);

  try {
    const result = await searchTrends(groups);
    if (result.results) {
      for (const r of result.results) {
        trendMap.set(r.title, r);
      }
    }
  } catch {
    // 트렌드 데이터 실패 시 빈 맵 반환
  }

  return trendMap;
}

// ─── 요약 생성 ──────────────────────────────────────────────

function generateSummary(keyword, grade, breakdown) {
  const parts = [];

  if (grade === "S") {
    parts.push("수익화 최적 키워드입니다!");
  } else if (grade === "A") {
    parts.push("우수한 키워드입니다.");
  } else if (grade === "B") {
    parts.push("괜찮은 키워드입니다.");
  } else if (grade === "C") {
    parts.push("보통 수준의 키워드입니다.");
  } else {
    parts.push("개선이 필요한 키워드입니다.");
  }

  if (breakdown.volume >= 70) parts.push("검색량이 높고");
  else if (breakdown.volume <= 30) parts.push("검색량이 낮고");

  if (breakdown.competition >= 70) parts.push("경쟁이 적어 유리합니다.");
  else if (breakdown.competition <= 30) parts.push("경쟁이 치열합니다.");
  else parts.push("경쟁은 보통입니다.");

  return parts.join(" ");
}

// ─── 등급 스타일 ────────────────────────────────────────────

export function getGradeColor(grade) {
  switch (grade) {
    case "S": return "#f9a825";
    case "A": return "#2ecc71";
    case "B": return "#3498db";
    case "C": return "#f39c12";
    case "D": return "#e74c3c";
    default: return "#95a5a6";
  }
}

export function getGradeLabel(grade) {
  switch (grade) {
    case "S": return "S (최우수)";
    case "A": return "A (우수)";
    case "B": return "B (양호)";
    case "C": return "C (보통)";
    case "D": return "D (미흡)";
    default: return "-";
  }
}

// ─── 유틸 ───────────────────────────────────────────────────

function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
