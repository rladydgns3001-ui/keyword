const functions = require("firebase-functions");
const fetch = require("node-fetch");
const CryptoJS = require("crypto-js");

// ─── 환경 변수 ──────────────────────────────────────────────
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || "";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || "";
const NAVER_AD_API_LICENSE = process.env.NAVER_AD_API_LICENSE || "";
const NAVER_AD_API_SECRET = process.env.NAVER_AD_API_SECRET || "";
const NAVER_AD_CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID || "";

// ─── CORS 헬퍼 ─────────────────────────────────────────────
function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function handleCors(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

// ─── 캐시 (간단한 인메모리) ─────────────────────────────────
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10분

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
  // 캐시 크기 제한
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// ─── 재시도 헬퍼 ────────────────────────────────────────────
async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 429 && i < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ─── 네이버 검색광고 API 서명 생성 ──────────────────────────
function generateSearchAdSignature(timestamp, method, path) {
  const message = `${timestamp}.${method}.${path}`;
  const hmac = CryptoJS.HmacSHA256(message, NAVER_AD_API_SECRET);
  return CryptoJS.enc.Base64.stringify(hmac);
}

// ═══════════════════════════════════════════════════════════
// 1. 뉴스 검색 API
// ═══════════════════════════════════════════════════════════
exports.news = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  const query = req.query.query || req.body.query;
  const display = req.query.display || req.body.display || 10;
  const sort = req.query.sort || req.body.sort || "date";

  if (!query) {
    return res.status(400).json({ error: "query 파라미터가 필요합니다." });
  }

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return res.status(503).json({
      error: "API_NOT_CONFIGURED",
      message: "네이버 API 키가 설정되지 않았습니다.",
    });
  }

  const cacheKey = `news:${query}:${display}:${sort}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;
    const response = await fetchWithRetry(url, {
      headers: {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "NAVER_API_ERROR",
        status: response.status,
        message: text,
      });
    }

    const data = await response.json();
    setCache(cacheKey, data);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: "FETCH_ERROR", message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 2. DataLab 검색 트렌드 API
// ═══════════════════════════════════════════════════════════
exports.trends = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 메서드만 지원합니다." });
  }

  const { startDate, endDate, timeUnit, keywordGroups, device, gender, ages } =
    req.body;

  if (!keywordGroups || !Array.isArray(keywordGroups)) {
    return res.status(400).json({
      error: "keywordGroups 배열이 필요합니다.",
    });
  }

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return res.status(503).json({
      error: "API_NOT_CONFIGURED",
      message: "네이버 API 키가 설정되지 않았습니다.",
    });
  }

  const cacheKey = `trends:${JSON.stringify(req.body)}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const body = {
      startDate: startDate || getDateMonthsAgo(12),
      endDate: endDate || getToday(),
      timeUnit: timeUnit || "month",
      keywordGroups,
    };
    if (device) body.device = device;
    if (gender) body.gender = gender;
    if (ages) body.ages = ages;

    const response = await fetchWithRetry(
      "https://openapi.naver.com/v1/datalab/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Naver-Client-Id": NAVER_CLIENT_ID,
          "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "NAVER_API_ERROR",
        status: response.status,
        message: text,
      });
    }

    const data = await response.json();
    setCache(cacheKey, data);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: "FETCH_ERROR", message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 3. 검색광고 키워드 도구 API (검색량/CPC/경쟁도)
// ═══════════════════════════════════════════════════════════
exports.keywords = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  const hintKeywords = req.query.keywords || req.body.keywords;
  if (!hintKeywords) {
    return res.status(400).json({ error: "keywords 파라미터가 필요합니다." });
  }

  if (!NAVER_AD_API_LICENSE || !NAVER_AD_API_SECRET || !NAVER_AD_CUSTOMER_ID) {
    return res.status(503).json({
      error: "AD_API_NOT_CONFIGURED",
      message: "네이버 검색광고 API 키가 설정되지 않았습니다.",
    });
  }

  const keywordList = Array.isArray(hintKeywords)
    ? hintKeywords
    : hintKeywords.split(",").map((k) => k.trim());

  const cacheKey = `keywords:${keywordList.sort().join(",")}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const timestamp = Date.now().toString();
    const method = "GET";
    const path = "/keywordstool";
    const signature = generateSearchAdSignature(timestamp, method, path);

    const params = new URLSearchParams();
    params.set("hintKeywords", keywordList.join(","));
    params.set("showDetail", "1");

    const url = `https://api.searchad.naver.com${path}?${params.toString()}`;
    const response = await fetchWithRetry(url, {
      method: "GET",
      headers: {
        "X-Timestamp": timestamp,
        "X-API-KEY": NAVER_AD_API_LICENSE,
        "X-Customer": NAVER_AD_CUSTOMER_ID,
        "X-Signature": signature,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "SEARCH_AD_API_ERROR",
        status: response.status,
        message: text,
      });
    }

    const data = await response.json();
    setCache(cacheKey, data);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: "FETCH_ERROR", message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 4. 검색광고 연관 키워드 API
// ═══════════════════════════════════════════════════════════
exports.related = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  const keyword = req.query.keyword || req.body.keyword;
  if (!keyword) {
    return res.status(400).json({ error: "keyword 파라미터가 필요합니다." });
  }

  if (!NAVER_AD_API_LICENSE || !NAVER_AD_API_SECRET || !NAVER_AD_CUSTOMER_ID) {
    return res.status(503).json({
      error: "AD_API_NOT_CONFIGURED",
      message: "네이버 검색광고 API 키가 설정되지 않았습니다.",
    });
  }

  const cacheKey = `related:${keyword}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const timestamp = Date.now().toString();
    const method = "GET";
    const path = "/keywordstool";
    const signature = generateSearchAdSignature(timestamp, method, path);

    const params = new URLSearchParams();
    params.set("hintKeywords", keyword);
    params.set("showDetail", "1");

    const url = `https://api.searchad.naver.com${path}?${params.toString()}`;
    const response = await fetchWithRetry(url, {
      method: "GET",
      headers: {
        "X-Timestamp": timestamp,
        "X-API-KEY": NAVER_AD_API_LICENSE,
        "X-Customer": NAVER_AD_CUSTOMER_ID,
        "X-Signature": signature,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "SEARCH_AD_API_ERROR",
        status: response.status,
        message: text,
      });
    }

    const data = await response.json();

    // 연관 키워드만 추출 (입력 키워드 제외)
    const result = {
      keyword,
      relatedKeywords: [],
    };

    if (data.keywordList) {
      result.relatedKeywords = data.keywordList
        .filter((item) => item.relKeyword !== keyword)
        .map((item) => ({
          keyword: item.relKeyword,
          monthlyPcQcCnt: item.monthlyPcQcCnt,
          monthlyMobileQcCnt: item.monthlyMobileQcCnt,
          monthlyAvePcClkCnt: item.monthlyAvePcClkCnt,
          monthlyAveMobileClkCnt: item.monthlyAveMobileClkCnt,
          monthlyAvePcCtr: item.monthlyAvePcCtr,
          monthlyAveMobileCtr: item.monthlyAveMobileCtr,
          plAvgDepth: item.plAvgDepth,
          compIdx: item.compIdx,
        }));
    }

    setCache(cacheKey, result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: "FETCH_ERROR", message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 5. 자동 분석 (뉴스 수집 → 키워드 추출 → 일괄 처리)
// ═══════════════════════════════════════════════════════════
exports.autoAnalyze = functions.https.onRequest(async (req, res) => {
  if (handleCors(req, res)) return;

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return res.status(503).json({
      error: "API_NOT_CONFIGURED",
      message: "네이버 API 키가 설정되지 않았습니다.",
    });
  }

  const cacheKey = "autoAnalyze:" + getToday();
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    // 1단계: 6개 카테고리 뉴스 병렬 수집
    const categories = [
      { id: "economy", query: "경제", name: "경제" },
      { id: "politics", query: "정치", name: "정치" },
      { id: "society", query: "사회", name: "사회" },
      { id: "it", query: "IT 기술", name: "IT/과학" },
      { id: "life", query: "생활 문화", name: "생활/문화" },
      { id: "world", query: "세계 국제", name: "세계" },
    ];

    const newsPromises = categories.map((cat) =>
      fetchNaverNews(cat.query, 5).then((items) => ({
        category: cat,
        items: items || [],
      }))
    );

    const allNewsResults = await Promise.all(newsPromises);

    // 2단계: 각 뉴스에서 키워드 추출
    const analysisResults = [];

    for (const { category, items } of allNewsResults) {
      for (const item of items) {
        const title = (item.title || "").replace(/<[^>]*>/g, "").trim();
        if (!title) continue;

        const keyword = extractKeyword(title);
        if (!keyword || keyword.length < 2) continue;

        // 중복 키워드 스킵
        if (analysisResults.some((r) => r.extractedKeyword === keyword)) continue;

        const detectedCategory = detectCategoryServer(keyword + " " + title);

        analysisResults.push({
          newsTitle: title,
          newsDescription: (item.description || "").replace(/<[^>]*>/g, "").trim(),
          newsSource: item.originallink
            ? extractDomain(item.originallink)
            : "",
          newsDate: item.pubDate || "",
          newsCategory: category.name,
          extractedKeyword: keyword,
          detectedCategory,
          relatedKeywords: [],
          stats: null,
        });
      }
    }

    // 최대 15개 뉴스 키워드로 제한
    const topResults = analysisResults.slice(0, 15);

    // 3단계: 각 키워드에 대해 템플릿 기반 파생 키워드 생성
    for (const result of topResults) {
      const suffixes = getSuffixesForCategory(result.detectedCategory);
      result.relatedKeywords = suffixes.slice(0, 8).map((s) => ({
        keyword: `${result.extractedKeyword} ${s}`,
        source: "template",
      }));
    }

    const data = {
      analyzedAt: new Date().toISOString(),
      totalNews: topResults.length,
      results: topResults,
    };

    setCache(cacheKey, data);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: "AUTO_ANALYZE_ERROR", message: err.message });
  }
});

// ─── 자동 분석 헬퍼 함수들 ──────────────────────────────────

async function fetchNaverNews(query, count) {
  try {
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${count}&sort=date`;
    const response = await fetchWithRetry(url, {
      headers: {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.items || [];
  } catch {
    return [];
  }
}

function extractKeyword(rawTitle) {
  // HTML 엔티티 디코딩
  let title = rawTitle
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/<[^>]*>/g, "")
    .trim();

  // 따옴표/꺽쇠 안 내용 우선 추출
  const quoted = title.match(/["'"「」『』""'']([^"'"「」『』""'']{2,20})["'"「」『』""'']/);
  if (quoted && quoted[1].trim().length >= 2) {
    let kw = quoted[1].trim();
    // 조사 제거
    kw = kw.replace(/(은|는|이|가|을|를|에|의|로|와|과|도|만)$/, "");
    return kw;
  }

  // 괄호/특수문자 제거
  let clean = title
    .replace(/\[.*?\]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/…|\.{3}/g, "")
    .replace(/["'"']/g, "")
    .replace(/[,·…]/g, " ")
    .trim();

  // 불필요한 접두어 제거 (뉴스 소스 등)
  clean = clean.replace(/^(속보|단독|종합|1보|2보|3보)\s*/i, "");

  // 의미 있는 명사 구절 추출 (최대 15자)
  const words = clean.split(/\s+/).filter((w) => w.length > 0);
  let keyword = "";
  for (const w of words) {
    // 조사/어미로만 된 단어 스킵
    if (/^(은|는|이|가|을|를|에|의|로|와|과|도|만|및|등|중|더|또)$/.test(w)) continue;
    const next = keyword ? `${keyword} ${w}` : w;
    if (next.length > 15) break;
    keyword = next;
  }

  // 끝 조사 제거
  keyword = keyword.replace(
    /(은|는|이|가|을|를|에|의|로|와|과|도|만|까지|부터|에서|에게|한테|께서|처럼|보다|같이)$/,
    ""
  );

  return keyword.trim();
}

function detectCategoryServer(text) {
  const lower = text.toLowerCase();
  const map = {
    subsidy: ["지원금", "보조금", "수당", "지급", "신청", "복지", "정부", "지자체", "혜택", "바우처", "장려금", "연금"],
    person: ["대통령", "의원", "배우", "가수", "선수", "감독", "교수", "장관", "총리"],
    drama: ["드라마", "예능", "방송", "시청률", "출연", "넷플릭스", "시즌"],
    travel: ["여행", "관광", "맛집", "축제", "호텔", "항공", "숙소"],
    finance: ["주식", "코인", "금리", "대출", "투자", "보험", "펀드", "은행", "증권", "부동산", "ETF", "환율"],
    health: ["건강", "병원", "약", "치료", "증상", "다이어트", "운동", "의료", "질병", "백신"],
    app: ["앱", "어플", "서비스", "플랫폼", "업데이트", "AI", "소프트웨어"],
    quiz: ["퀴즈", "이벤트", "경품", "당첨", "응모", "정답"],
  };

  let best = "subsidy";
  let bestScore = 0;
  for (const [cat, keywords] of Object.entries(map)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return best;
}

function getSuffixesForCategory(category) {
  const templates = {
    subsidy: ["신청방법", "신청기간", "자격조건", "대상", "지급일", "금액", "서류", "홈페이지", "조건", "총정리"],
    person: ["나이", "학력", "프로필", "재산", "논란", "근황", "인스타", "과거"],
    drama: ["출연진", "줄거리", "몇부작", "시청률", "결말", "다시보기", "OST"],
    travel: ["맛집", "가볼만한곳", "숙소", "비용", "날씨", "코스", "항공권"],
    finance: ["금리", "수익률", "조건", "비교", "추천", "전망", "세금", "한도"],
    health: ["증상", "원인", "치료", "좋은 음식", "운동", "병원", "예방"],
    app: ["사용법", "다운로드", "후기", "요금", "무료", "대안", "비교"],
    quiz: ["정답", "참여방법", "경품", "기간", "당첨", "응모"],
  };
  return templates[category] || templates.subsidy;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

// ─── 유틸리티 ───────────────────────────────────────────────
function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getDateMonthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
