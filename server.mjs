// 로컬 개발 서버: 정적 파일 + API 프록시
import express from "express";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const fetch = require("./functions/node_modules/node-fetch");

const app = express();
const PORT = 8080;

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || "ia6Fw4nb4oYKPZjghsYy";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || "HcR_YKhnCx";

app.use(express.json());
app.use(express.static("."));

// ═══════════════════════════════════════════════════════════
// 수익화 매핑 테이블 (클라이언트 keyword-data.js와 동기화)
// ═══════════════════════════════════════════════════════════

const MONEY_KEYWORD_PATTERNS = {
  subsidy: {
    derivatives: ["신청방법", "자격조건", "신청기간", "대상", "지급일", "홈페이지 바로가기", "서류", "온라인 신청", "소득기준", "금액"],
    thirdLevel: ["센터 전화번호", "오류 해결", "서류 다운로드", "신청 홈페이지", "고객센터 연락처"],
  },
  finance: {
    derivatives: ["금리 비교", "계산기", "가입방법", "수수료", "한도", "조건", "이자 계산", "신청 방법"],
    thirdLevel: ["앱 다운로드", "고객센터", "해지 방법", "수수료 면제", "우대 금리 조건"],
  },
  health: {
    derivatives: ["증상", "치료 방법", "좋은 음식", "병원 추천", "예방법", "검사 비용", "약 추천"],
    thirdLevel: ["명의 추천", "보험 적용", "수술 비용", "회복 기간", "부작용"],
  },
  person: {
    derivatives: ["프로필", "나이", "학력", "재산", "집안", "MBTI", "과거", "논란"],
    thirdLevel: ["인스타그램", "유튜브", "근황", "배우자", "자녀"],
  },
  drama: {
    derivatives: ["출연진", "줄거리", "몇부작", "시청률", "다시보기", "결말"],
    thirdLevel: ["OST", "촬영지", "시즌2", "원작 소설", "넷플릭스"],
  },
  travel: {
    derivatives: ["가볼만한곳", "맛집 추천", "숙소 추천", "여행 코스", "비용", "날씨"],
    thirdLevel: ["항공권 예약", "호텔 할인", "렌트카", "입장료", "주차장"],
  },
  app: {
    derivatives: ["사용법", "다운로드", "오류 해결", "요금제", "무료 버전", "탈퇴 방법"],
    thirdLevel: ["고객센터", "결제 취소", "환불 방법", "업데이트 내용", "대안 앱"],
  },
  quiz: {
    derivatives: ["정답", "참여방법", "경품", "기간", "응모 방법"],
    thirdLevel: ["당첨 확인", "이벤트 링크", "결과 확인"],
  },
  general: {
    derivatives: ["뜻", "의미", "총정리", "요약", "전망"],
    thirdLevel: ["최신 정보", "관련 뉴스"],
  },
};

const INTENT_SCORE_MAP = {
  "신청방법": 100, "가입방법": 98, "계산기": 95, "바로가기": 95,
  "다운로드": 93, "홈페이지 바로가기": 95, "온라인 신청": 95,
  "서류 다운로드": 92, "앱 다운로드": 92, "신청 홈페이지": 90,
  "오류 해결": 90, "결제 취소": 88, "환불 방법": 88,
  "해지 방법": 85, "탈퇴 방법": 85,
  "자격조건": 82, "신청기간": 80, "대상": 78, "지급일": 78,
  "금리 비교": 85, "수수료": 80, "한도": 78, "조건": 75,
  "비용": 75, "요금제": 75, "검사 비용": 75, "수술 비용": 75,
  "센터 전화번호": 75, "고객센터": 72, "고객센터 연락처": 72,
  "비교": 68, "추천": 65, "후기": 62, "사용법": 65,
  "치료 방법": 65, "예방법": 62, "좋은 음식": 60,
  "병원 추천": 65, "숙소 추천": 62, "맛집 추천": 60,
  "여행 코스": 58, "항공권 예약": 70, "호텔 할인": 68,
  "가볼만한곳": 58, "금액": 65, "소득기준": 68,
  "이자 계산": 78, "우대 금리 조건": 72, "수수료 면제": 72,
  "보험 적용": 70, "회복 기간": 55, "서류": 68,
  "무료 버전": 58, "대안 앱": 55, "업데이트 내용": 50,
  "뜻": 25, "의미": 25, "나이": 30, "프로필": 35,
  "학력": 30, "재산": 32, "집안": 28, "MBTI": 30,
  "논란": 25, "과거": 25, "근황": 28,
  "출연진": 35, "줄거리": 32, "시청률": 28, "결말": 30,
  "총정리": 40, "요약": 38, "전망": 42,
  "날씨": 45, "인스타그램": 25, "유튜브": 28,
  "OST": 30, "촬영지": 35, "원작 소설": 28,
  "정답": 45, "경품": 40, "기간": 42,
  "배우자": 25, "자녀": 25, "참여방법": 55,
  "증상": 50, "약 추천": 58, "명의 추천": 60,
  "부작용": 52, "다시보기": 45, "몇부작": 30,
  "응모 방법": 55, "당첨 확인": 50, "이벤트 링크": 48,
  "결과 확인": 45, "최신 정보": 40, "관련 뉴스": 30,
  "렌트카": 65, "입장료": 55, "주차장": 50,
  "시즌2": 30, "넷플릭스": 35, "신청 방법": 98,
};

const CPC_SCORE_MAP = {
  finance: 95, subsidy: 80, health: 70, app: 60,
  travel: 55, person: 35, drama: 32, quiz: 30, general: 40,
};

const AGE_SCORE_MAP = {
  finance: 90, subsidy: 90, health: 85, app: 65,
  travel: 70, person: 40, drama: 45, quiz: 35, general: 55,
};

const DURABILITY_BASE_MAP = {
  subsidy: 80, finance: 85, health: 80, app: 60,
  travel: 55, person: 30, drama: 35, quiz: 25, general: 45,
};

// 지속성 판별 키워드
const SEASONAL_KEYWORDS = ["벚꽃", "단풍", "크리스마스", "설날", "추석", "여름", "겨울", "봄", "가을", "휴가", "방학"];
const EVENT_KEYWORDS = ["올림픽", "선거", "월드컵", "수능", "대회", "시상식", "축제"];
const EVERGREEN_KEYWORDS = ["신청", "방법", "계산기", "비교", "추천", "가입", "해지", "대출", "보험", "금리", "증상", "치료"];

// ─── /api/auto-analyze ─────────────────────────────────────
app.get("/api/auto-analyze", async (req, res) => {
  try {
    const categories = [
      { id: "economy", query: "경제", name: "경제" },
      { id: "politics", query: "정치", name: "정치" },
      { id: "society", query: "사회", name: "사회" },
      { id: "it", query: "IT 기술", name: "IT/과학" },
      { id: "life", query: "생활 문화", name: "생활/문화" },
      { id: "world", query: "세계 국제", name: "세계" },
    ];

    const newsItems = [];

    // 1. 뉴스 수집 (기존 유지)
    for (const cat of categories) {
      const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(cat.query)}&display=5&sort=date`;
      const r = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": NAVER_CLIENT_ID,
          "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
        },
      });
      if (!r.ok) continue;
      const data = await r.json();
      for (const item of (data.items || [])) {
        const title = (item.title || "")
          .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").replace(/<[^>]*>/g, "").trim();
        const description = (item.description || "").replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
        if (!title || title.length < 5) continue;

        newsItems.push({
          title,
          description,
          source: item.originallink ? (() => { try { return new URL(item.originallink).hostname.replace("www.", ""); } catch { return ""; } })() : "",
          date: item.pubDate || "",
          newsCategory: cat.name,
        });
      }
    }

    // 2. 각 뉴스 → deriveMoneyKeywords → 2차/3차 키워드 배열
    const allDerived = []; // { keyword, category, suffix, level, newsTitle, newsSource, ... , monetizationScore, grade }
    const seenKeywords = new Set();
    const allResults = [];

    for (const news of newsItems) {
      const topic = extractKeyword(news.title);
      if (!topic || topic.length < 2) continue;

      const detectedCategory = detectCategory(topic + " " + news.title + " " + news.description);
      const derived = deriveMoneyKeywords(topic, news.title, news.description, detectedCategory);

      const newsResult = {
        newsTitle: news.title,
        newsDescription: news.description,
        newsSource: news.source,
        newsDate: news.date,
        newsCategory: news.newsCategory,
        extractedKeyword: topic,
        detectedCategory,
        moneyKeywords: [], // 2차/3차 확장 키워드 + 점수
      };

      for (const dk of derived) {
        if (seenKeywords.has(dk.keyword)) continue;
        seenKeywords.add(dk.keyword);

        const scored = scoreMonetization(dk.keyword, dk.suffix, detectedCategory, news.title);
        newsResult.moneyKeywords.push({
          keyword: dk.keyword,
          suffix: dk.suffix,
          level: dk.level,
          source: "derived",
          monetizationScore: scored.totalScore,
          grade: scored.grade,
          scoreBreakdown: scored.breakdown,
          reasoning: scored.reasoning,
        });
      }

      // 점수순 정렬
      newsResult.moneyKeywords.sort((a, b) => b.monetizationScore - a.monetizationScore);

      // 기존 호환: relatedKeywords 필드도 유지
      newsResult.relatedKeywords = newsResult.moneyKeywords.map(mk => ({
        keyword: mk.keyword,
        source: mk.source,
        monetizationScore: mk.monetizationScore,
        grade: mk.grade,
        scoreBreakdown: mk.scoreBreakdown,
        reasoning: mk.reasoning,
        level: mk.level,
      }));

      newsResult.stats = null;
      allResults.push(newsResult);
    }

    // 3. 전체 키워드를 점수순으로 모아서 상위 20개 = 추천 키워드
    const allKeywordsFlat = [];
    for (const nr of allResults) {
      for (const mk of nr.moneyKeywords) {
        allKeywordsFlat.push({
          ...mk,
          newsTitle: nr.newsTitle,
          newsCategory: nr.newsCategory,
          detectedCategory: nr.detectedCategory,
        });
      }
    }
    allKeywordsFlat.sort((a, b) => b.monetizationScore - a.monetizationScore);
    const recommendedKeywords = allKeywordsFlat.slice(0, 20);

    res.json({
      analyzedAt: new Date().toISOString(),
      totalNews: Math.min(allResults.length, 20),
      recommendedKeywords,
      results: allResults.slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/news ─────────────────────────────────────────────
app.get("/api/news", async (req, res) => {
  const { query, display = 10, sort = "date" } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;
  const r = await fetch(url, {
    headers: { "X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET },
  });
  const data = await r.json();
  res.json(data);
});

// ─── /api/trends (stub) ────────────────────────────────────
app.post("/api/trends", (req, res) => {
  res.json({ results: [] });
});

// ─── /api/keywords (stub) ──────────────────────────────────
app.get("/api/keywords", (req, res) => {
  res.status(503).json({ error: "AD_API_NOT_CONFIGURED", message: "검색광고 API 미설정" });
});

// ─── /api/related (stub) ───────────────────────────────────
app.get("/api/related", (req, res) => {
  res.status(503).json({ error: "AD_API_NOT_CONFIGURED", message: "검색광고 API 미설정" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Preview: https://8080-${process.env.WEB_HOST || "localhost"}`);
});

// ═══════════════════════════════════════════════════════════
// 핵심 신규 함수: deriveMoneyKeywords
// 뉴스에서 "사람들이 실제로 검색할 키워드" 도출 (2차/3차 확장)
// ═══════════════════════════════════════════════════════════

function deriveMoneyKeywords(topic, newsTitle, newsDescription, category) {
  const patterns = MONEY_KEYWORD_PATTERNS[category] || MONEY_KEYWORD_PATTERNS.general;
  const results = [];

  // 2차 확장: 토픽 + 파생 접미사
  for (const suffix of patterns.derivatives) {
    results.push({
      keyword: `${topic} ${suffix}`,
      suffix,
      level: 2,
    });
  }

  // 3차 확장: 토픽 + 3차 접미사
  for (const suffix of patterns.thirdLevel) {
    results.push({
      keyword: `${topic} ${suffix}`,
      suffix,
      level: 3,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// 핵심 신규 함수: scoreMonetization
// 5가지 수익화 점수 산정 (각 20점, 총 100점)
// ═══════════════════════════════════════════════════════════

function scoreMonetization(keyword, suffix, category, newsTitle) {
  const breakdown = {};

  // 1. 광고단가 잠재력 (adValueScore) - 카테고리 기반
  breakdown.adValueScore = CPC_SCORE_MAP[category] || 40;

  // 2. 검색 의도 점수 (intentScore) - 접미사 기반
  breakdown.intentScore = INTENT_SCORE_MAP[suffix] || 40;

  // 3. 롱테일 적합도 (longtailScore) - 어절 수 기반
  const wordCount = keyword.split(/\s+/).length;
  if (wordCount <= 1) breakdown.longtailScore = 30;
  else if (wordCount === 2) breakdown.longtailScore = 40;
  else if (wordCount === 3) breakdown.longtailScore = 80;
  else if (wordCount === 4) breakdown.longtailScore = 95;
  else if (wordCount === 5) breakdown.longtailScore = 70;
  else breakdown.longtailScore = 55;

  // 4. 연령 적합도 (ageScore) - 30대+ 검색 가능성
  breakdown.ageScore = AGE_SCORE_MAP[category] || 55;

  // 5. 지속성 점수 (durabilityScore)
  breakdown.durabilityScore = scoreDurability(keyword, newsTitle, category);

  // 총점 계산 (각 20% 가중치)
  const totalScore = Math.round(
    breakdown.adValueScore * 0.2 +
    breakdown.intentScore * 0.2 +
    breakdown.longtailScore * 0.2 +
    breakdown.ageScore * 0.2 +
    breakdown.durabilityScore * 0.2
  );

  // 등급 산정
  let grade;
  if (totalScore >= 90) grade = "S";
  else if (totalScore >= 75) grade = "A";
  else if (totalScore >= 60) grade = "B";
  else if (totalScore >= 45) grade = "C";
  else grade = "D";

  // 추천 이유 생성
  const reasoning = generateReasoning(breakdown, grade, category, suffix);

  return { totalScore, grade, breakdown, reasoning };
}

function scoreDurability(keyword, newsTitle, category) {
  const text = keyword + " " + newsTitle;

  // 상시 키워드 체크
  if (EVERGREEN_KEYWORDS.some(k => text.includes(k))) return 90;
  // 계절 키워드 체크
  if (SEASONAL_KEYWORDS.some(k => text.includes(k))) return 55;
  // 이벤트 키워드 체크
  if (EVENT_KEYWORDS.some(k => text.includes(k))) return 40;

  // 카테고리 기본값
  return DURABILITY_BASE_MAP[category] || 45;
}

function generateReasoning(breakdown, grade, category, suffix) {
  const parts = [];

  if (breakdown.adValueScore >= 80) parts.push("광고단가 높은 분야");
  if (breakdown.intentScore >= 85) parts.push("전환율 높은 행동 키워드");
  else if (breakdown.intentScore >= 60) parts.push("구체적 정보 탐색 키워드");
  if (breakdown.longtailScore >= 80) parts.push("롱테일 경쟁 유리");
  if (breakdown.ageScore >= 80) parts.push("30대+ 타겟 적합");
  if (breakdown.durabilityScore >= 80) parts.push("상시 검색 키워드");
  else if (breakdown.durabilityScore <= 40) parts.push("단기 이슈성");

  if (parts.length === 0) {
    if (grade === "D") parts.push("수익화 잠재력 낮음");
    else parts.push("보통 수준");
  }

  return parts.join(" / ");
}

// ─── 기존 헬퍼 함수 ─────────────────────────────────────────
function extractKeyword(title) {
  const quoted = title.match(/["'"「」『』""'']([^"'"「」『』""'']{2,20})["'"「」『』""'']/);
  if (quoted && quoted[1].trim().length >= 2) {
    return quoted[1].trim().replace(/(은|는|이|가|을|를|에|의|로|와|과|도|만)$/, "");
  }
  let clean = title.replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "").replace(/…|\.{3}/g, "")
    .replace(/["'"']/g, "").replace(/[,·…]/g, " ").trim();
  clean = clean.replace(/^(속보|단독|종합|1보|2보|3보)\s*/i, "");
  const words = clean.split(/\s+/).filter(w => w.length > 0);
  let kw = "";
  for (const w of words) {
    if (/^(은|는|이|가|을|를|에|의|로|와|과|도|만|및|등|중|더|또)$/.test(w)) continue;
    const next = kw ? `${kw} ${w}` : w;
    if (next.length > 15) break;
    kw = next;
  }
  return kw.replace(/(은|는|이|가|을|를|에|의|로|와|과|도|만|까지|부터|에서)$/, "").trim();
}

function detectCategory(text) {
  const lower = text.toLowerCase();
  const map = {
    subsidy: ["지원금", "보조금", "수당", "지급", "신청", "복지", "혜택", "바우처", "연금", "급여", "장려금"],
    person: ["대통령", "의원", "배우", "가수", "선수", "장관", "후보", "대표", "총리"],
    drama: ["드라마", "예능", "방송", "시청률", "넷플릭스", "출연", "시즌"],
    travel: ["여행", "관광", "맛집", "축제", "호텔", "항공", "숙소"],
    finance: ["주식", "코인", "금리", "대출", "투자", "보험", "부동산", "환율", "증권", "펀드", "ETF"],
    health: ["건강", "병원", "치료", "증상", "다이어트", "운동", "의료", "백신"],
    app: ["앱", "플랫폼", "AI", "소프트웨어", "챗봇", "업데이트", "출시"],
    quiz: ["퀴즈", "이벤트", "경품", "당첨"],
  };
  let best = "general", bestScore = 0;
  for (const [cat, kws] of Object.entries(map)) {
    let score = kws.filter(k => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}
