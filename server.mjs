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
  // 세금/부동산/투자 관련
  "납부 방법": 95, "신고 방법": 92, "신고 기간": 80, "환급": 88,
  "세율": 70, "감면": 78, "가산세": 65, "납부 홈페이지": 90,
  "신고 홈페이지": 88, "환급 조회": 85,
  "시세": 65, "전망": 42, "매물": 55, "실거래가": 70, "가격": 60,
  "시세 조회": 75, "실거래가 조회": 78, "청약 일정": 72, "분양 일정": 70,
  "차트": 50, "투자 방법": 65, "실시간 시세": 72, "전망 분석": 55, "투자 후기": 58,
  // 축제/여행
  "일정": 60, "장소": 55, "프로그램": 50, "셔틀버스": 62, "교통편": 58, "맛집": 55,
  // 자동차
  "가격 비교": 75, "충전소": 68, "보험료 비교": 78, "보조금 신청": 88,
  // 복지 대상
  "혜택": 65, "지원 대상": 70, "서류 준비": 72, "상담 전화번호": 68,
  "필요 서류": 72,
  // 연금/보험
  "수령액": 78, "수령 나이": 75, "납부 확인": 72, "예상 수령액": 80,
  "임의가입": 65, "수령액 조회": 82, "납부 내역 조회": 78,
  "보험료 조회": 80, "피부양자": 65, "보험료 계산기": 85,
  // 교육
  "문의 전화": 60,
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
      // 일반 카테고리
      { id: "economy", query: "경제", name: "경제" },
      { id: "society", query: "사회", name: "사회" },
      { id: "life", query: "생활 문화", name: "생활/문화" },
      // 수익화 높은 특화 쿼리
      { id: "subsidy", query: "지원금 신청", name: "지원금" },
      { id: "health", query: "건강 질환 치료", name: "건강" },
      { id: "realestate", query: "아파트 분양 청약", name: "부동산" },
      { id: "finance", query: "대출 금리 보험", name: "금융" },
      { id: "travel", query: "축제 여행 관광", name: "여행" },
      { id: "welfare", query: "복지 수당 급여", name: "복지" },
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
      const topic = extractKeyword(news.title, news.description);
      if (!topic || topic.length < 2) continue;

      const detectedCategory = detectCategory(topic + " " + news.title + " " + news.description, topic);
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

// 토픽 특화 접미사 (카테고리 외에 토픽 자체로 접미사를 결정)
const TOPIC_SPECIFIC_SUFFIXES = {
  tax: {
    match: ["지방세", "종합소득세", "양도소득세", "세금", "연말정산", "소득세", "재산세", "취득세"],
    derivatives: ["계산기", "납부 방법", "신고 방법", "신고 기간", "환급", "세율", "감면"],
    thirdLevel: ["납부 홈페이지", "신고 홈페이지", "환급 조회", "가산세"],
  },
  realestate: {
    match: ["아파트", "부동산", "전세", "월세", "분양", "청약", "재건축", "재개발",
            "임대주택", "공공주택", "행복주택", "장기전세", "매입임대", "다주택", "양도세"],
    derivatives: ["시세", "전망", "매물", "실거래가", "가격", "조건"],
    thirdLevel: ["시세 조회", "실거래가 조회", "청약 일정", "분양 일정"],
  },
  investment: {
    match: ["비트코인", "이더리움", "코스피", "코스닥", "나스닥", "ETF"],
    derivatives: ["시세", "전망", "차트", "가격", "투자 방법"],
    thirdLevel: ["실시간 시세", "전망 분석", "투자 후기"],
  },
  guarantee: {
    match: ["특례보증", "신용보증", "보증서"],
    derivatives: ["신청방법", "자격조건", "한도", "금리", "필요 서류"],
    thirdLevel: ["온라인 신청", "신청 홈페이지", "상담 전화번호"],
  },
  festival: {
    match: ["축제", "엑스포", "박람회", "마라톤", "불꽃축제"],
    derivatives: ["일정", "장소", "주차장", "프로그램", "입장료"],
    thirdLevel: ["셔틀버스", "맛집", "숙소 추천", "교통편"],
  },
  vehicle: {
    match: ["전기차", "하이브리드", "자동차보험", "자동차세"],
    derivatives: ["보조금", "신청방법", "가격 비교", "추천", "세금"],
    thirdLevel: ["보조금 신청", "충전소", "보험료 비교"],
  },
  welfare_target: {
    match: ["다문화", "한부모", "장애인", "차상위", "기초수급"],
    derivatives: ["지원금", "혜택", "자격조건", "신청방법", "지원 대상"],
    thirdLevel: ["온라인 신청", "서류 준비", "상담 전화번호"],
  },
  pension: {
    match: ["국민연금", "기초연금", "공무원연금"],
    derivatives: ["수령액", "수령 나이", "납부 확인", "예상 수령액", "계산기", "임의가입"],
    thirdLevel: ["수령액 조회", "납부 내역 조회", "고객센터"],
  },
  healthInsurance: {
    match: ["건강보험", "실손보험", "자동차보험"],
    derivatives: ["신청방법", "자격조건", "보험료 조회", "환급", "피부양자"],
    thirdLevel: ["보험료 계산기", "고객센터", "납부 확인"],
  },
  scholarship: {
    match: ["장학금", "학자금", "등록금"],
    derivatives: ["신청방법", "자격조건", "신청기간", "지원 대상", "금액"],
    thirdLevel: ["온라인 신청", "서류 준비", "문의 전화"],
  },
};

function deriveMoneyKeywords(topic, newsTitle, newsDescription, category) {
  // 토픽 특화 접미사가 있으면 우선 사용
  let patterns = null;
  for (const [, spec] of Object.entries(TOPIC_SPECIFIC_SUFFIXES)) {
    if (spec.match.some(m => topic.includes(m))) {
      patterns = spec;
      break;
    }
  }
  if (!patterns) {
    patterns = MONEY_KEYWORD_PATTERNS[category] || MONEY_KEYWORD_PATTERNS.general;
  }

  const results = [];

  let baseTopic = topic;
  if (!baseTopic || baseTopic.length < 2 || isNoiseTopic(baseTopic)) {
    return results;
  }

  // 2차 확장: 토픽 + 파생 접미사 (의미 검증 후 추가)
  for (const suffix of patterns.derivatives) {
    const combined = `${baseTopic} ${suffix}`;
    // 의미적으로 말이 되는지 기본 검증
    if (isValidCombination(baseTopic, suffix, category)) {
      results.push({ keyword: combined, suffix, level: 2 });
    }
  }

  // 3차 확장: 토픽 + 3차 접미사
  for (const suffix of patterns.thirdLevel) {
    const combined = `${baseTopic} ${suffix}`;
    if (isValidCombination(baseTopic, suffix, category)) {
      results.push({ keyword: combined, suffix, level: 3 });
    }
  }

  return results;
}

/**
 * 토픽 + 접미사 조합이 의미적으로 유효한지 검증
 */
function isValidCombination(topic, suffix, category) {
  // 인물이 아닌데 인물 접미사 → 거절
  if (category !== "person") {
    const personOnly = ["나이", "프로필", "학력", "재산", "집안", "MBTI", "배우자", "자녀", "인스타그램", "유튜브", "근황", "과거", "논란"];
    if (personOnly.includes(suffix)) return false;
  }

  // 드라마가 아닌데 드라마 접미사 → 거절
  if (category !== "drama") {
    const dramaOnly = ["출연진", "줄거리", "몇부작", "시청률", "결말", "OST", "촬영지", "시즌2", "원작 소설", "다시보기", "넷플릭스"];
    if (dramaOnly.includes(suffix)) return false;
  }

  // 여행이 아닌데 여행 접미사 → 거절
  if (category !== "travel") {
    const travelOnly = ["맛집 추천", "숙소 추천", "여행 코스", "항공권 예약", "호텔 할인", "렌트카", "입장료", "주차장", "가볼만한곳"];
    if (travelOnly.includes(suffix)) return false;
  }

  // 행정 접미사가 어울리지 않는 카테고리/토픽 → 거절
  const adminSuffixes = ["신청방법", "신청 방법", "가입방법", "온라인 신청", "홈페이지 바로가기",
    "자격조건", "신청기간", "대상", "지급일", "서류", "소득기준", "신청 홈페이지",
    "서류 다운로드", "센터 전화번호", "오류 해결", "고객센터 연락처"];

  // 투자/시세성 키워드 + 행정 접미사 → 거절
  const investmentTopics = ["비트코인", "이더리움", "코인", "주식", "코스피", "코스닥", "나스닥", "ETF", "펀드", "환율", "달러"];
  if (investmentTopics.some(t => topic.includes(t)) && adminSuffixes.includes(suffix)) {
    return false;
  }

  // general/person 카테고리에 행정 접미사 → 거절 (일반 뉴스 주제에 "신청방법" 등 무의미)
  if ((category === "general" || category === "person") && adminSuffixes.includes(suffix)) {
    return false;
  }

  // 부동산 카테고리에 복지성 접미사 → 거절
  if (category === "finance" && ["대상", "지급일", "소득기준", "서류"].includes(suffix)) {
    if (!topic.includes("대출") && !topic.includes("보험")) return false;
  }

  // 세금 키워드에 금융상품(은행) 접미사 → 거절
  const taxTopics = ["지방세", "종합소득세", "양도소득세", "세금", "연말정산", "소득세", "재산세", "취득세"];
  const bankOnlySuffixes = ["금리 비교", "가입방법", "해지 방법", "수수료", "수수료 면제",
    "우대 금리 조건", "이자 계산", "한도", "조건", "앱 다운로드", "고객센터"];
  if (taxTopics.some(t => topic.includes(t)) && bankOnlySuffixes.includes(suffix)) {
    return false;
  }

  // 앱/서비스가 아닌데 앱 전용 접미사 → 거절
  if (category !== "app") {
    const appOnly = ["앱 다운로드", "결제 취소", "환불 방법", "업데이트 내용", "대안 앱", "탈퇴 방법", "무료 버전"];
    if (appOnly.includes(suffix)) return false;
  }

  return true;
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

// ─── 핵심 헬퍼: extractKeyword (v4 재설계) ────────────────────
//
// 전략: 뉴스 제목 앞부분을 기계적으로 자르는 대신,
//       1) 제목에서 "사람들이 실제로 검색할 핵심 주제어"를 찾고
//       2) 검색 가능한 형태로 정제
//

// 검색 가치 높은 핵심 키워드 패턴 (이것들이 포함되면 해당 단어 중심으로 추출)
// 주의: 3글자 미만 키워드는 너무 제네릭하므로 제외 (AI, 암 등 → context 필요)
const HIGH_VALUE_TOPICS = [
  // 금융
  { keywords: ["비트코인", "이더리움", "암호화폐", "가상자산"], topic: null },
  { keywords: ["가계대출", "주담대", "전세대출", "신용대출"], topic: null },
  { keywords: ["기준금리", "대출금리", "예금금리"], topic: null },
  { keywords: ["코스피", "코스닥", "나스닥"], topic: null },
  { keywords: ["ETF", "펀드", "적금", "예금", "저축"], topic: null },
  { keywords: ["부동산", "아파트", "전세", "월세", "분양"], topic: null },
  { keywords: ["환율", "원달러"], topic: null },
  { keywords: ["실손보험", "자동차보험", "건강보험"], topic: null },
  { keywords: ["종합소득세", "양도소득세", "지방세", "연말정산"], topic: null },
  // 지원금/복지
  { keywords: ["지원금", "보조금", "바우처", "장려금"], topic: null },
  { keywords: ["국민연금", "기초연금", "공무원연금"], topic: null },
  { keywords: ["실업급여", "고용보험"], topic: null },
  { keywords: ["근로장려금", "자녀장려금"], topic: null },
  { keywords: ["기초생활수급", "기초생활", "긴급복지"], topic: null },
  // 건강 (구체적 질환명만)
  { keywords: ["코로나", "독감", "백신", "접종"], topic: null },
  { keywords: ["당뇨", "혈압", "콜레스테롤", "치매"], topic: null },
  { keywords: ["구제역", "조류독감"], topic: null },
  { keywords: ["틱장애", "우울증", "불면증", "탈모", "비만"], topic: null },
  // 서비스/앱 (구체적 서비스명만)
  { keywords: ["카카오톡", "카카오뱅크", "네이버페이", "쿠팡", "배달의민족", "토스", "당근마켓"], topic: null },
  { keywords: ["ChatGPT", "챗GPT"], topic: null },
  // 여행/축제
  { keywords: ["축제", "벚꽃", "해수욕장"], topic: null },
  // 부동산
  { keywords: ["아파트 분양", "청약", "재건축", "재개발"], topic: null },
  // 제도/정책 (검색 가치 있는 것만)
  { keywords: ["촉법소년", "최저임금"], topic: null },
  // 생활
  { keywords: ["전기요금", "가스요금", "수도요금", "통신비"], topic: null },
  // 보증/신용
  { keywords: ["특례보증", "신용보증", "보증서", "신용등급", "신용점수"], topic: null },
  // 임대/주거
  { keywords: ["임대주택", "공공주택", "행복주택", "장기전세", "매입임대"], topic: null },
  // 교육/장학
  { keywords: ["장학금", "학자금", "등록금", "교육비", "교육급여"], topic: null },
  // 노동/일자리
  { keywords: ["일자리", "구직급여", "취업성공패키지", "직업훈련"], topic: null },
  // 자동차/교통
  { keywords: ["전기차", "하이브리드", "자동차보험", "운전면허", "자동차세"], topic: null },
  // 정부 서비스
  { keywords: ["여권", "주민등록", "인감증명", "등기"], topic: null },
  // 복지 대상
  { keywords: ["다문화", "한부모", "장애인", "차상위", "기초수급"], topic: null },
  { keywords: ["노인돌봄", "요양보험", "장기요양", "노인일자리"], topic: null },
  { keywords: ["출산급여", "출산장려금", "육아휴직", "아동수당"], topic: null },
  // 건강 추가
  { keywords: ["건강검진", "종합검진", "암검진", "대장내시경", "위내시경"], topic: null },
  { keywords: ["탈모치료", "비만클리닉", "피부과", "성형외과", "치과"], topic: null },
  // 이벤트/축제
  { keywords: ["엑스포", "박람회", "마라톤", "불꽃축제"], topic: null },
  // 생활 서비스
  { keywords: ["이사비용", "인테리어", "입주청소", "에어컨청소"], topic: null },
  { keywords: ["반려동물", "동물병원", "펫보험", "애견호텔"], topic: null },
];

// 뉴스에서만 쓰이는 서술/수식 단어 (제거 대상)
const JUNK_WORDS = new Set([
  "은", "는", "이", "가", "을", "를", "에", "의", "로", "와", "과", "도", "만",
  "및", "등", "중", "더", "또", "그", "한", "수", "것", "듯", "vs", "VS",
  "속보", "단독", "종합", "긴급", "사상", "최초", "최대", "역대",
  "전격", "공식", "확정", "돌파", "화제", "논란", "포토", "사진",
  "올해", "내년", "지난해", "상반기", "하반기", "이번", "오늘", "어제",
  "위해", "대해", "통해", "따라", "관련", "대한", "또한", "외신", "주제로",
  "본격", "본격화", "공식화", "전면", "강행", "강화", "추진", "시행",
  "밝혀", "밝힐", "전했다", "보도", "발급", "모집", "선정", "체결",
  "전개", "진행", "개최", "출범", "착수", "마련", "가결", "전한다",
  "있다", "없다", "했다", "된다", "한다", "나선다", "나섰다",
  "공유", "반대", "찬성", "발표", "예정", "성공", "실패",
  "주축", "대폭", "소폭", "급격", "대규모", "소규모",
  "다시", "또다시", "전문", "현지", "특별", "직접", "이상",
]);

// 숫자+단위 패턴
const NUM_PATTERNS = [
  /^\d+[선조억만천백]/, /^\d+개$/, /^\d+차$/, /^\d+[월일년]/, /^\d+~/, /^\d+기$/,
  /^\d+%$/, /^\d+분기$/, /^제?\d+[차회기]$/, /^민선/, /^[\d,.]+$/, /^\d+호$/,
  /^\d+명$/, /^\d+원$/, /^\d+위$/, /^\d+강$/, /^\d+배$/, /^\d+km/, /^\d+세$/,
  /^\d+돌$/, /^\d+곳$/, /^\d+건$/, /^\d+대$/, /^\d+층$/, /^\d+번$/,
];

/**
 * 뉴스 제목 + 설명에서 검색 가능한 핵심 주제어 추출
 */
function extractKeyword(title, description) {
  // 전략 1: 제목에서 "검색 가치 높은 키워드" 직접 탐색
  const cleanTitle = title.replace(/[()（）\[\]<>'"""'']/g, " ").replace(/[,·…!?]/g, " ").replace(/\s+/g, " ");
  const hvTopic = findHighValueTopic(cleanTitle);
  if (hvTopic) return hvTopic;

  // 전략 1.5: 도메인 패턴 매칭 — 제목에서 수익화 가능한 도메인 키워드를 포함하는 단어 추출
  const domainTopic = findDomainPattern(cleanTitle);
  if (domainTopic) return domainTopic;

  // 전략 2: 제목 정리 후 핵심 명사구 추출 (매우 보수적)
  let clean = title
    .replace(/\[.*?\]/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/…|\.{2,}/g, " ")         // 말줄임표 → 공백으로 (합쳐짐 방지)
    .replace(/["""'''`''""「」『』《》〈〉]/g, " ")  // 모든 종류의 따옴표
    .replace(/[,·!?()（）:;…→←↔▶◀△▽■□●○☞★]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 앞쪽 태그 제거
  clean = clean.replace(/^(속보|단독|종합|1보|2보|3보)\s*/i, "");

  // 쉼표/마침표 기준 첫 절만 사용
  const firstClause = clean.split(/[,…·]/)[0].trim();
  if (firstClause.length >= 4) clean = firstClause;

  // 단어 분리 후 필터
  const words = clean.split(/\s+/).filter(w => {
    if (w.length === 0) return false;
    if (w.length === 1) return false;
    if (JUNK_WORDS.has(w)) return false;
    if (NUM_PATTERNS.some(p => p.test(w))) return false;
    // "300여" 같은 숫자+여 패턴
    if (/^\d+여$/.test(w)) return false;
    // 서술어/동사형 어미 제거
    if (/[다며고서요]$/.test(w) && w.length > 2 && !/[시군구도청]$/.test(w)) return false;
    if (/(했|됐|된|할|될|하는|되는|있는|없는|한다|된다|겠다|라고|라며|에서)/.test(w)) return false;
    // 형용사/부사형 어미 제거
    if (/[한적런큰힌진]$/.test(w) && w.length > 2 && !/[센터원관]$/.test(w.slice(-2))) return false;
    // 관형형/부사형 제거
    if (/^(겹겹|유연|갇힌|꺼져|커진|줄기|폭발|파급|급변|재발하나)/.test(w)) return false;
    // "~하나", "~인가", "~인지", "~에도" 등 의문/서술형
    if (/(하나|인가|인지|에도|만에|으로|이라)$/.test(w) && w.length > 3) return false;
    return true;
  });

  // 조사 제거 (복합 조사 순서대로)
  const cleaned = words.map(w => {
    let c = w;
    c = c.replace(/(에는|에서|으로|에게|에도|까지|부터|이라)$/, "");
    c = c.replace(/(은|는|이|가|을|를|에|의|로|와|과|도|만)$/, "");
    return c;
  }).filter(w => w.length >= 2);

  // 추상명사/뉴스전용 단어 추가 필터 (검색어로 쓰이지 않는 단어)
  const abstractNouns = new Set([
    "현실감", "매운맛", "우회로", "감독", "방향", "성격", "경쟁력", "대전환",
    "사기", "소환", "하향", "연루설", "산하", "성장", "통제", "갈등", "변화",
    "안전", "혼돈", "공백", "쟁점", "위기", "위험", "행정", "정책", "상생",
    "협력", "역량", "파장", "확대", "축소", "투입", "연임", "전환", "개편",
    "재점화", "몸살", "내홍", "졸속", "핵심", "가속", "공략", "직판", "개시",
    "체결", "분석", "지원", "경계", "맞춤", "독자", "기존", "산업",
    "목소리", "피켓", "로드맵", "활성화", "홍보", "개발", "설계",
    "전통", "역사", "동행", "나눔", "희망", "지역", "시민", "주민",
    "대응책", "흐름", "연속", "달성", "총력전", "대상", "수상",
    "생태계", "경고등", "리스크", "내수면", "양식어가", "양식어",
    "관광객", "여행객", "방문객", "이용객", "입주량",
    "맞손", "외친", "총력", "추진단", "공식화",
  ]);
  const finalWords = cleaned.filter(w => !abstractNouns.has(w));

  if (finalWords.length === 0) return "";

  // 최대 2어절, 10자 이내의 핵심 명사구
  let result = finalWords[0];
  if (finalWords.length >= 2) {
    const two = `${finalWords[0]} ${finalWords[1]}`;
    if (two.length <= 10) result = two;
  }

  // 최종 검증: 3자 미만이면 너무 제네릭
  if (result.replace(/\s/g, "").length < 3) return "";
  if (isNoiseTopic(result)) return "";
  if (isLowSearchValue(result)) return "";

  // ★ 전략2 핵심 필터: 추출된 토픽이 "수익화 가능한 주제"인지 검증
  // 뉴스 제목의 아무 단어나 가져오면 안 됨 → 특정 도메인 키워드가 포함된 경우만 허용
  if (!isMonetizableTopic(result, title)) return "";

  return result;
}

/**
 * 텍스트에서 검색 가치 높은 핵심 토픽 탐색
 * 예: "비트코인 71만개 추가 매수" → "비트코인"
 *     "가계대출 증가 추세" → "가계대출"
 *     "청년 지원금 확대" → "청년 지원금"
 */
function findHighValueTopic(text) {
  for (const hvt of HIGH_VALUE_TOPICS) {
    for (const kw of hvt.keywords) {
      if (text.includes(kw)) {
        // 한글 2글자는 허용 (환율, 금리, 보험 등), 비한글 2글자 이하는 스킵 (AI 등 너무 제네릭)
        if (kw.replace(/\s/g, "").length < 3 && !/^[가-힣]{2,}$/.test(kw)) continue;

        // 해당 키워드 앞뒤 맥락에서 수식어 찾기
        const contextTopic = extractContextAround(text, kw);
        return contextTopic || kw;
      }
    }
  }
  return null;
}

/**
 * 전략 1.5: 도메인 패턴 매칭
 * 제목에서 수익화 도메인 접미사를 포함하는 복합 명사를 찾아 추출
 *
 * 예: "계양구노인복지관 '평생교육사업 개강식' 개최"
 *   → "노인복지관" 패턴 매칭 → "계양구노인복지관" 추출
 *
 * 예: "힘찬병원, 마코로봇 무릎 인공관절 수술 '3년 연속 세계 1위'"
 *   → "병원" 패턴 매칭 → "힘찬병원" 추출
 */
const DOMAIN_SUFFIX_PATTERNS = [
  // 복지/지원 시설 (구체적 복지 시설명만)
  { suffix: /([가-힣]{2,}(?:복지관|복지센터|안심센터|지원센터|보건소|보건센터|고용센터|일자리센터))/, category: "subsidy" },
  { suffix: /([가-힣]{2,}(?:지원금|보조금|장려금|바우처|지원사업))/, category: "subsidy" },
  { suffix: /([가-힣]{2,}(?:수당|급여|연금))/, category: "subsidy" },
  // 건강/의료
  { suffix: /([가-힣]{2,}(?:병원|의원|약국|한의원|치과|클리닉))/, category: "health" },
  { suffix: /([가-힣]{2,}(?:증상|증후군|질환|감염증|검진))/, category: "health" },
  // 금융
  { suffix: /([가-힣]{2,}(?:대출|적금|보험|보증|금리))/, category: "finance" },
  // 부동산
  { suffix: /([가-힣]{2,}(?:아파트|청약|분양|임대주택|공공주택))/, category: "realestate" },
  // 여행/축제
  { suffix: /([가-힣]{2,}(?:축제|엑스포|박람회))/, category: "travel" },
  // 상품/서비스
  { suffix: /([가-힣]{2,}(?:상품권))/, category: "app" },
];

function findDomainPattern(text) {
  for (const dp of DOMAIN_SUFFIX_PATTERNS) {
    const match = text.match(dp.suffix);
    if (match) {
      let topic = match[1] || match[0];
      // 너무 긴 단어는 잘라냄 (최대 10자)
      if (topic.length > 10) {
        topic = topic.slice(-10);
      }
      // 인물 직함으로 끝나면 스킵
      if (/(?:원장|사장|회장|대표|교수|장관|감독|기자)$/.test(topic)) continue;
      // 유효한 토픽이면 반환
      if (topic.length >= 3 && !isNoiseTopic(topic)) {
        // 뒤에 맥락어 추가 시도 (제한적)
        const contextTopic = extractContextAround(text, topic);
        return contextTopic || topic;
      }
    }
  }
  return null;
}

/**
 * 키워드 주변 맥락에서 검색용 토픽 추출
 * 매우 보수적으로: 키워드 뒤에 의미 보충어만 추가
 * "가계대출 금리 인상" → "가계대출 금리"
 * "비트코인 전 세계" → "비트코인"
 */
function extractContextAround(text, keyword) {
  const idx = text.indexOf(keyword);
  if (idx < 0) return keyword;

  // 키워드 뒤 텍스트에서 의미 보충어만 탐색
  const after = text.substring(idx + keyword.length, idx + keyword.length + 15)
    .replace(/[^가-힣a-zA-Z\s]/g, " ").trim();

  const afterWords = after.split(/\s+/).filter(w => w.length >= 2);
  if (afterWords.length > 0) {
    const firstWord = afterWords[0];
    // 매우 제한적인 보충어만 허용
    const allowedSuffixes = ["금리", "전망", "시세", "가격", "대출", "보험",
      "증상", "치료", "예방", "접종", "지원", "신청", "확대", "인상", "인하", "동결",
      "관광", "여행", "축제", "검진", "수당", "급여", "보조금"];
    if (allowedSuffixes.includes(firstWord)) {
      const combined = `${keyword} ${firstWord}`;
      if (combined.length <= 12) return combined;
    }
  }

  return keyword;
}

/**
 * 뉴스 노이즈 토픽 판별
 */
function isNoiseTopic(topic) {
  if (!topic || topic.length < 2) return true;
  const noiseList = [
    "현장", "목소리", "현장 목소리", "관계자", "전문가", "정부", "당국",
    "기자", "취재", "보도", "특파원", "편집", "단독", "속보",
    "법리오해", "입틀막", "공소 취소", "감독 방향", "추가 매수",
    "예술가 정치", "시민사회단체", "예비후보",
  ];
  if (noiseList.includes(topic)) return true;
  if (/^(밝혀|밝힐|전했|것으로|있다|없다|했다|된다)/.test(topic)) return true;
  // 한 글자 단어만으로 구성
  if (topic.split(/\s+/).every(w => w.length <= 1)) return true;
  return false;
}

/**
 * 검색 가치가 낮은 토픽 판별 (Strategy 2 결과 필터)
 * 정치, 조직, 추상적 개념 등 → 사람들이 검색하지 않는 것
 */
function isLowSearchValue(topic) {
  // 정치/행정 관련 (수익화 불가)
  const politicalPatterns = [
    "민주당", "국민의힘", "여당", "야당", "국회", "의원", "정당", "계파",
    "대통령", "탄핵", "총리", "차관", "위원장", "사무총장",
    "행정통합", "법안", "조례", "의결", "의정", "선거구", "공천",
  ];
  if (politicalPatterns.some(p => topic.includes(p))) return true;

  // 뉴스 서술형 조합 (검색어로 안 쓰이는 패턴)
  const noSearchPatterns = [
    /MOU/, /CEO/, /ESG/, /인터뷰/,
    /총동문/, /동문회/, /아카데미/, /포럼/,
    /예비후보/, /피켓/, /시민단체/, /시민사회/,
    /음악회/, /공연/, /전시/, /박물관$/,
  ];
  if (noSearchPatterns.some(p => p.test(topic))) return true;

  // 고유명사 + 고유명사 조합 (특정 기관+인물 등 → 검색량 없음)
  // 예: "석유유통협회 김정훈", "경인교대 인천상"
  const words = topic.split(/\s+/);
  if (words.length >= 2) {
    // 둘 다 단체/기관명 같으면 검색 가치 없음
    const orgSuffixes = /^.*(회|청|원|대|부|처|관|교|단|국|소|재단|공사|센터|학교|대학|법원|병원|의원)$/;
    if (words.every(w => orgSuffixes.test(w) || /^[가-힣]{1}$/.test(w))) return true;
  }

  return false;
}

/**
 * 전략2 결과가 수익화 가능한 주제인지 검증
 * 뉴스 제목의 아무 단어나 가져오면 안 됨 → 특정 도메인 키워드가 포함된 경우만 허용
 *
 * 허용 조건: 토픽 또는 뉴스 제목에 수익화 도메인 키워드가 있어야 함
 * - 복지/지원: 센터, 복지관, 지원사업, 수당, 급여, 바우처, 돌봄, 보육
 * - 건강: 증상, 질환, 치료, 장애, 감염, 접종, 수술, 재활
 * - 금융: 대출, 보험, 연금, 적금, 금리, 세금, 환급
 * - 서비스: 상품권, 요금, 결제, 구독
 */
function isMonetizableTopic(topic, title) {
  // 인물 직함으로 끝나면 → 수익화 불가
  if (/(?:원장|사장|회장|대표|교수|위원장|장관|총장|감독|국장|처장|실장|부장|사무국장|기자단|기자)$/.test(topic)) return false;
  // 정치인 의원
  if (/(?:도의원|시의원|구의원|군의원|국회의원)/.test(topic)) return false;

  // ── 1차: 토픽 자체에 수익화 키워드가 있으면 즉시 허용 ──

  // 복지/지원
  if (/복지센터|안심센터|지원센터|보건센터|고용센터|일자리센터|돌봄센터|건강센터/.test(topic)) return true;
  if (/복지관|복지|보건소|지원금|보조금|수당|급여|바우처|장려금|보험료|실업급여/.test(topic)) return true;
  if (/돌봄|보육|어린이집|유치원|다문화|한부모|장애인|차상위/.test(topic)) return true;

  // 건강
  if (/증상|질환|치료|장애|감염|접종|수술|재활|병원|약국|백신|검진|클리닉/.test(topic)) return true;

  // 금융
  if (/대출|보험|연금|적금|금리|세금|환급|이자|환율|보증/.test(topic)) return true;

  // 투자
  if (/주식|코인|비트코인|이더리움|코스피|코스닥|ETF|펀드/.test(topic)) return true;

  // 생활 서비스
  if (/상품권|요금|결제|전기차|자동차|운전면허/.test(topic)) return true;

  // 부동산
  if (/분양|청약|재건축|재개발|전세|월세|아파트|임대주택/.test(topic)) return true;

  // 여행/축제
  if (/축제|엑스포|박람회|관광|여행/.test(topic)) return true;

  // 교육
  if (/장학금|학자금|등록금|수능|자격증/.test(topic)) return true;

  // ── 2차: 토픽은 일반적이지만 제목에 수익화 컨텍스트가 명확한 경우 ──
  const titleCheck = topic + " " + title;
  if (/지원금|보조금|장려금|수당 지급|급여 인상|연금 인상|연금 개혁/.test(titleCheck)) return true;
  if (/대출 금리|금리 인하|금리 인상|금리 동결/.test(titleCheck)) return true;
  if (/분양 일정|청약 접수|입주 물량|입주량/.test(titleCheck)) return true;
  if (/축제 개막|축제 개최|관광객|여행객/.test(titleCheck)) return true;
  if (/건강검진|종합검진|암검진|무료 검진/.test(titleCheck)) return true;
  if (/전기차 보조금|자동차세|자동차 리콜/.test(titleCheck)) return true;
  if (/지원 사업|지원사업/.test(titleCheck)) return true;

  return false;
}

function detectCategory(text, topicOnly) {
  const lower = text.toLowerCase();
  // topicOnly가 있으면 토픽에서 먼저 판별 시도 (토픽 우선)
  if (topicOnly) {
    const topicLower = topicOnly.toLowerCase();
    const topicMap = {
      finance: ["대출", "금리", "환율", "세금", "지방세", "양도세", "소득세", "사모대출",
                "비트코인", "이더리움", "코인", "주식", "코스피", "ETF", "펀드", "적금", "예금"],
      subsidy: ["지원금", "보조금", "수당", "바우처", "장려금", "복지", "복지관", "실업급여", "고용보험",
                "국민연금", "기초연금", "건강보험", "장학금", "학자금", "등록금",
                "보험", "연금", "다문화", "한부모", "장애인", "차상위", "보육"],
      health: ["증상", "질환", "치료", "병원", "약국", "접종", "백신", "수술", "재활", "검진", "클리닉"],
      app: ["카카오", "네이버", "쿠팡", "토스", "배달의민족", "당근마켓"],
      travel: ["여행", "관광", "축제", "맛집", "호텔", "엑스포", "박람회"],
      realestate: ["아파트", "분양", "청약", "전세", "월세", "임대주택", "재건축", "재개발", "부동산"],
    };
    for (const [cat, kws] of Object.entries(topicMap)) {
      if (kws.some(k => topicLower.includes(k.toLowerCase()))) return cat;
    }
  }

  const map = {
    subsidy: ["지원금", "보조금", "수당", "지급", "신청", "복지", "혜택", "바우처", "연금", "급여", "장려금",
              "지원 사업", "공모", "접수", "모집", "취업", "고용", "일자리", "실업", "구직",
              "기초생활", "기초연금", "국민연금", "건강보험", "의료비", "돌봄", "보육", "육아"],
    person: ["대통령", "의원", "배우", "가수", "선수", "장관", "후보", "대표", "총리",
             "교수", "감독", "작가", "아나운서", "기자", "사장", "회장", "위원장"],
    drama: ["드라마", "예능", "방송", "시청률", "넷플릭스", "출연", "시즌", "종영", "첫방",
            "웨이브", "쿠팡플레이", "티빙", "디즈니", "방영", "편성"],
    travel: ["여행", "관광", "맛집", "축제", "호텔", "항공", "숙소", "관광지", "명소",
             "벚꽃", "해수욕장", "캠핑", "펜션", "리조트"],
    finance: ["주식", "코인", "금리", "대출", "투자", "보험", "부동산", "환율", "증권", "펀드", "ETF",
              "가계대출", "주담대", "전세대출", "적금", "예금", "저축", "세금", "지방세", "종합소득세",
              "비트코인", "이더리움", "암호화폐", "가상자산", "영끌", "갭투자"],
    health: ["건강", "병원", "치료", "증상", "다이어트", "운동", "의료", "백신",
             "수술", "진료", "약국", "처방", "질환", "질병", "암", "당뇨", "혈압", "구제역"],
    app: ["앱", "플랫폼", "소프트웨어", "챗봇", "업데이트", "출시",
          "서비스", "결제", "카카오", "네이버", "구글", "애플", "쿠팡",
          "배달의민족", "토스", "당근마켓", "인공지능", "ChatGPT", "챗GPT"],
    quiz: ["퀴즈", "이벤트", "경품", "당첨", "응모", "정답"],
  };
  let best = "general", bestScore = 0;
  for (const [cat, kws] of Object.entries(map)) {
    let score = kws.filter(k => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}
