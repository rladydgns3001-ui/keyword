// ═══════════════════════════════════════════════════════════
// 키워드 확장 사고 엔진 — 로컬 개발 서버
// 5단계 파이프라인: 뉴스수집 → 토픽추출 → 키워드확장 → 점수화 → 트렌드검증
// ═══════════════════════════════════════════════════════════
import express from "express";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const fetch = require("./functions/node_modules/node-fetch");

import {
  CATEGORIES,
  SUFFIX_TEMPLATES,
  MONEY_KEYWORD_PATTERNS,
  INTENT_SCORE_MAP,
  CPC_SCORE_MAP,
  AGE_SCORE_MAP,
  DURABILITY_BASE_MAP,
  SEASONAL_PENALTY_PATTERNS,
  detectCategory,
} from "./js/keyword-data.js";

const app = express();
const PORT = 8080;

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || "ia6Fw4nb4oYKPZjghsYy";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || "HcR_YKhnCx";

app.use(express.json());
app.use(express.static("."));

// ═══════════════════════════════════════════════════════════
// 시드 쿼리 (6개 카테고리)
// ═══════════════════════════════════════════════════════════
// 시즌별 시드 쿼리 (월에 따라 자동 반영)
function getSeasonalSeeds() {
  const month = new Date().getMonth() + 1; // 1~12
  const seeds = [];

  // 1~3월: 입학/신학기/연말정산
  if (month >= 1 && month <= 3) {
    seeds.push({ query: "교복비 입학준비금 학자금 지원", newsCategory: "교육지원" });
    seeds.push({ query: "신학기 입학 준비물 지원금", newsCategory: "교육지원2" });
  }
  // 3~5월: 근로장려금/종합소득세
  if (month >= 3 && month <= 5) {
    seeds.push({ query: "근로장려금 종합소득세 신고", newsCategory: "세금" });
  }
  // 6~8월: 여름 에너지/냉방
  if (month >= 6 && month <= 8) {
    seeds.push({ query: "에너지바우처 냉방비 전기요금 지원", newsCategory: "에너지" });
  }
  // 9~11월: 난방/겨울 대비
  if (month >= 9 && month <= 11) {
    seeds.push({ query: "난방비 지원 에너지바우처 동절기", newsCategory: "에너지" });
  }
  // 11~12월: 연말정산
  if (month >= 11 || month === 1) {
    seeds.push({ query: "연말정산 소득공제 세액공제", newsCategory: "세금" });
  }

  return seeds;
}

const SEED_QUERIES = [
  // 지원금/복지 (세분화)
  { query: "지원금 신청 바우처 수당", newsCategory: "경제" },
  { query: "복지 혜택 정책 신청", newsCategory: "생활" },
  { query: "출산지원금 육아수당 아동수당", newsCategory: "육아복지" },
  { query: "청년 지원금 취업 창업 월세", newsCategory: "청년복지" },
  // 금융/부동산
  { query: "대출 금리 적금 예금", newsCategory: "금융" },
  { query: "부동산 아파트 전세 세금", newsCategory: "부동산" },
  // 건강
  { query: "건강검진 질병 증상 치료 지방간", newsCategory: "건강" },
  { query: "다이어트 영양제 탈모 피부", newsCategory: "건강2" },
  // 기타
  { query: "앱 서비스 출시 업데이트", newsCategory: "IT" },
  { query: "드라마 예능 시청률 방송", newsCategory: "연예" },
  { query: "여행 축제 관광 맛집", newsCategory: "여행" },
  // 시즌별 시드 자동 추가
  ...getSeasonalSeeds(),
];

// ═══════════════════════════════════════════════════════════
// Step 1: 뉴스 수집 (fetchAllNews)
// 6개 시드 쿼리 → 네이버 뉴스 API 병렬 호출 → ~60개 뉴스
// ═══════════════════════════════════════════════════════════
async function fetchAllNews() {
  const fetches = SEED_QUERIES.map(async ({ query, newsCategory }) => {
    try {
      const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=10&sort=date`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": NAVER_CLIENT_ID,
          "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map((item) => ({ ...item, newsCategory }));
    } catch {
      return [];
    }
  });

  const allResults = await Promise.all(fetches);

  // 카테고리별 라운드 로빈 인터리빙 (특정 카테고리가 토픽 슬롯 독점 방지)
  const maxLen = Math.max(...allResults.map((r) => r.length));
  const interleaved = [];
  for (let i = 0; i < maxLen; i++) {
    for (const batch of allResults) {
      if (i < batch.length) interleaved.push(batch[i]);
    }
  }
  return interleaved;
}

// ═══════════════════════════════════════════════════════════
// Step 2: 토픽 추출 (extractTopics)
// 뉴스 제목 → HTML 제거 → 핵심 구문 추출 → 카테고리 감지 → 중복 제거
// ═══════════════════════════════════════════════════════════
function stripHtml(str) {
  return str
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Only strip particles if the resulting word is still ≥ 2 chars
const PARTICLES = [
  "에서", "에도", "에는", "으로부터", "으로", "까지", "부터",
  "처럼", "만큼", "라는", "이라는", "이란", "라며", "라고",
  "에", "은", "는", "을", "를", "의", "과", "와",
];
const STOPWORDS = new Set([
  "올해", "오늘", "내일", "최근", "현재", "이번", "지난", "관련",
  "위해", "대해", "통해", "따라", "함께", "모두", "처음", "매우",
  "대상", "확대", "논란", "본격화", "진행", "공개", "달성",
  "역대급", "역대", "사상", "최대", "전년", "동기", "대비",
  "전망", "예상", "분석", "발표", "보도", "조사", "결과",
  "실적", "은행권", "업계", "시장", "시중", "포용금융", "당국",
  "접근성", "구조", "폭리", "사실", "가능성", "이유", "배경",
  "장사", "강화", "추이", "동향", "현황", "규모", "총액",
  "서구화된", "불안해서", "조절해도", "특정", "달간",
  "원인", "어마어마하다",
]);

function cleanWord(w) {
  for (const p of PARTICLES) {
    if (w.endsWith(p) && w.length - p.length >= 2) {
      return w.slice(0, -p.length);
    }
  }
  return w;
}

// 합성어에서 지역명 접두사 분리: "전남청년" → "청년"
const REGION_PREFIXES = [
  "전남", "전북", "경남", "경북", "충남", "충북", "강원", "제주",
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기",
];
function splitRegionCompound(word) {
  for (const r of REGION_PREFIXES) {
    if (word.startsWith(r) && word.length >= r.length + 2) {
      return word.slice(r.length); // "전남청년" → "청년"
    }
  }
  return word;
}

// Segment → clean words 배열
function segmentToWords(seg) {
  return seg
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[…·.!?~]+$/g, "").replace(/^[…·.!?~]+/g, "")) // 구두점 제거
    .map(cleanWord)
    .map(splitRegionCompound)
    .filter(
      (w) =>
        w.length >= 2 &&
        !STOPWORDS.has(w) &&
        !/^\d+$/.test(w) &&
        // 숫자+단위 패턴 제거: "2026년", "5대", "19~28세", "153억원", "7%", "1호" 등
        !/^\d+[~\-]?\d*[세년원%억만천개월일호위대곳건]?$/.test(w) &&
        !/(?:한다|된다|했다|됐다|인다|이다|였다|쏟아낸다|돌려달라|덜어요|받다가|내려준다|알려|시작|전망|마세요|됩니다|합니다|입니다|습니다|는데|지만|라니|커지|향하|줄어|오르|내리|나온|보인|열린|치솟|급등|급락|높아|낮아|넘어|빠져|늘어|줄어|돌파|기록|일까|될까|할까|인가|는가|나요|세요|까지|까요|대로|만에|사실일까)$/.test(w)
    );
}

// 단어 조합의 "키워드 적합도" 점수: 카테고리 매칭이 핵심
function phraseScore(words) {
  const text = words.join(" ");
  let score = 0;
  const cat = detectCategory(text);
  if (cat && cat !== "general") score += 10; // 카테고리 매칭 = 가장 중요
  if (words.length >= 2 && words.length <= 3) score += 5;
  if (text.length >= 6) score += 3;
  return score;
}

function extractTopicPhrase(rawTitle) {
  let clean = stripHtml(rawTitle);
  // Remove brackets and their content
  clean = clean.replace(/[\[【「(〈][^\]】」)〉]*[\]】」)〉]/g, "");

  // 따옴표 안의 텍스트를 먼저 추출 (프로그램명, 상품명 등 핵심 키워드)
  const quotedTerms = [];
  // 모든 종류의 따옴표 매칭 (ASCII + 유니코드)
  const quoteRe = /[\x27\x22\u2018\u2019\u201C\u201D\u300C\u300D]([^\x27\x22\u2018\u2019\u201C\u201D\u300C\u300D]{2,20})[\x27\x22\u2018\u2019\u201C\u201D\u300C\u300D]/g;
  let m;
  while ((m = quoteRe.exec(clean)) !== null) {
    const term = m[1].trim();
    // stopword로만 구성된 인용 텍스트 제외
    const termWords = term.split(/\s+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
    if (termWords.length >= 1 && term.length >= 2) quotedTerms.push(term);
  }

  clean = clean.replace(/[\u2018\u2019\u201C\u201D\u300C\u300D"'`''""]/g, "");
  clean = clean.replace(/^\s*(속보|단독|종합|긴급)\s*/g, "");

  // Split on separators (NOT ~ : 숫자 범위에 쓰임)
  const segments = clean.split(/[…·|,\-–→↑↓:;]+|\.{2,}|···+/);

  // 각 세그먼트에서 슬라이딩 윈도우로 최적 2-3단어 조합 탐색
  let bestPhrase = null;
  let bestScore = -1;

  for (const seg of segments) {
    if (seg.trim().length < 4) continue;
    const words = segmentToWords(seg);
    if (words.length < 2) continue;

    // 슬라이딩 윈도우: 연속 2~3단어 조합 중 카테고리 매칭 최고 점수 선택
    for (let start = 0; start <= words.length - 2; start++) {
      for (let len = 2; len <= Math.min(3, words.length - start); len++) {
        const window = words.slice(start, start + len);
        const phrase = window.join(" ");
        if (phrase.length < 4) continue;
        const score = phraseScore(window);
        if (score > bestScore) {
          bestScore = score;
          bestPhrase = phrase;
        }
      }
    }
  }

  // 품질 필터: 말줄임표, 물음표, 문장 조각 제거
  if (bestPhrase) {
    if (/[…?？!]/.test(bestPhrase)) bestPhrase = null;
    else if (/(?:때부터|못하|뿐만|에서도|이지만|인데|지만|로서|에게|하며|으며|면서|지도|라도|는데|해야|해서|해도|만큼|까지도|보다|처럼|합시다|합니다|입니다|됩니다|한다고|이라고|라는데|라며|에서|원인|이라면|불안해서|자던|묶은|나왔다|쏜다|뜬다|올까|할까|인가|된다|한다)$/.test(bestPhrase)) bestPhrase = null;
    // 너무 긴 토픽 = 뉴스 제목 통째 유입 (5단어 이상 차단)
    else if (bestPhrase.split(/\s+/).length > 4) bestPhrase = null;
  }

  // 따옴표 안 텍스트가 카테고리 매칭되면 우선 사용 (프로그램명, 상품명)
  for (const qt of quotedTerms) {
    const cat = detectCategory(qt);
    if (cat && cat !== "general") return qt;
  }
  // 따옴표 텍스트가 있으면 bestPhrase보다 우선 (고유명사일 가능성)
  if (quotedTerms.length > 0 && quotedTerms[0].length >= 3) {
    return quotedTerms[0];
  }

  if (bestPhrase) return bestPhrase;

  // Fallback: try the whole cleaned title
  const words = segmentToWords(clean);
  if (words.length >= 2) {
    return words.slice(0, 3).join(" ");
  }
  return words.length === 1 && words[0].length >= 3 ? words[0] : null;
}

// 단어 단위 중복 검사 (글자 단위는 "문화향유" vs "문화복지카드"를 같다고 판정하는 문제)
function wordOverlap(a, b) {
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  const minLen = Math.min(wordsA.size, wordsB.size);
  return minLen > 0 ? overlap / minLen : 0;
}

function extractSource(link) {
  try {
    const host = new URL(link).hostname;
    return host.replace(/^www\./, "").split(".")[0];
  } catch {
    return "";
  }
}

// 1단어 토픽으로 쓰기엔 너무 뻔한 단어 (범용 카테고리 명사만)
// "지방간", "탈모", "넷마블" 같은 구체적 명사는 허용
const GENERIC_TOPICS = new Set([
  "복지", "지원", "혜택", "정책", "지급", "수당", "바우처",
  "건강", "병원", "치료", "질환", "증상", "의료", "검사",
  "은행", "투자", "보험",
  "축제", "여행", "호텔", "투어", "관광",
  "앱", "게임", "서비스", "플랫폼",
  "드라마", "예능", "방송", "시청률",
  "경제", "사회", "시장", "이벤트", "퀴즈", "뉴스",
]);

function extractTopics(newsItems) {
  const topics = [];
  const seen = new Set();

  for (const item of newsItems) {
    const phrase = extractTopicPhrase(item.title);
    if (!phrase || seen.has(phrase)) continue;

    // 1단어 + 너무 뻔한 단어 필터 ("복지", "건강", "게임" 등)
    const phraseWords = phrase.split(/\s+/);
    if (phraseWords.length === 1 && GENERIC_TOPICS.has(phrase)) continue;

    // Category detection: try phrase first, then full title
    const category =
      detectCategory(phrase) || detectCategory(stripHtml(item.title)) || "general";

    // general 카테고리 필터: 카테고리 키워드가 하나도 없으면 품질 낮음 → 스킵
    if (category === "general") continue;

    // 카테고리 오분류 방지: 뉴스 제목에서 감지한 카테고리와 토픽에서 감지한 카테고리가 다르면
    // 뉴스 내용과 무관한 토픽이 추출된 것 → 스킵
    const phraseCat = detectCategory(phrase);
    const titleCat = detectCategory(stripHtml(item.title));
    if (phraseCat && titleCat && phraseCat !== titleCat) continue;

    // Dedup: 단어 겹침 OR 글자 포함 관계
    let isDup = false;
    const phraseNoSpace = phrase.replace(/\s+/g, "");
    for (const t of topics) {
      if (wordOverlap(phrase, t.topic) > 0.6) { isDup = true; break; }
      // 글자 포함 관계 (4자 이상): "문화복지카드" ⊂ "청년 문화복지카드"
      const tNoSpace = t.topic.replace(/\s+/g, "");
      if (phraseNoSpace.length >= 4 && tNoSpace.length >= 4) {
        if (phraseNoSpace.includes(tNoSpace) || tNoSpace.includes(phraseNoSpace)) {
          isDup = true; break;
        }
      }
    }
    if (isDup) continue;

    seen.add(phrase);
    topics.push({
      topic: phrase,
      category,
      newsTitle: stripHtml(item.title),
      newsSource: extractSource(item.originallink || item.link || ""),
      newsCategory: item.newsCategory || "일반",
    });
  }

  return topics.slice(0, 30); // Cap at 30 unique topics
}

// ═══════════════════════════════════════════════════════════
// 네이버 자동완성 API (공개, 키 불필요)
// ═══════════════════════════════════════════════════════════
async function fetchAutocomplete(query) {
  try {
    const url = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(query)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    // Response: { items: [[ ["suggestion1"], ["suggestion2"], ... ]] }
    if (data.items && data.items[0]) {
      return data.items[0].map((item) => item[0]).filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// Step 3: 키워드 확장 (expandKeywords) — 핵심
// 1차: 자동완성 + 템플릿 (사람들이 뭘 검색할까?)
// 2차: 의도 접미사 + 자동완성 (그거 하다가 뭐에 막힐까?)
// 3차: 롱테일 패턴 (이 사람이 또 뭘 검색할까?)
// ═══════════════════════════════════════════════════════════
async function expandKeywords(topics) {
  const allExpanded = [];

  // Process in batches of 5 topics
  for (let i = 0; i < topics.length; i += 5) {
    const batch = topics.slice(i, i + 5);

    const batchResults = await Promise.all(
      batch.map(async (topicObj) => {
        const { topic, category, newsCategory } = topicObj;
        const keywords = [];
        const seenKw = new Set([topic]);

        const addKw = (kw) => {
          if (!seenKw.has(kw.keyword)) {
            seenKw.add(kw.keyword);
            keywords.push(kw);
          }
        };

        // Determine L2 intent suffixes upfront (from MONEY_KEYWORD_PATTERNS)
        const catPatterns = MONEY_KEYWORD_PATTERNS[category] || MONEY_KEYWORD_PATTERNS.general;
        const intentSuffixes = (catPatterns?.derivatives || [])
          .sort((a, b) => (INTENT_SCORE_MAP[b] || 50) - (INTENT_SCORE_MAP[a] || 50))
          .slice(0, 4);

        // Base keyword: first 2 words of topic (for L2 queries to stay short)
        const baseKw = topic.split(/\s+/).slice(0, 2).join(" ");

        // === Run L1 and L2 autocomplete calls in parallel ===
        const autocompletePromises = [
          fetchAutocomplete(topic), // L1
          ...intentSuffixes.map((suffix) =>
            fetchAutocomplete(`${baseKw} ${suffix}`)
          ), // L2
        ];

        let [l1Suggestions, ...l2SuggestionSets] = await Promise.all(
          autocompletePromises
        );

        // 자동완성 0건이면 뉴스 제목에서 카테고리 키워드 찾아 재시도
        if (l1Suggestions.length === 0 && topicObj.newsTitle) {
          const { CATEGORY_DETECT_KEYWORDS: CDK } = await import("./js/keyword-data.js");
          const catKws = CDK[category] || [];
          const titleLower = topicObj.newsTitle.toLowerCase();
          for (const ckw of catKws) {
            // 제네릭 단어로 교체 방지 ("복지", "건강" 등)
            if (GENERIC_TOPICS.has(ckw)) continue;
            if (titleLower.includes(ckw) && ckw.length >= 2) {
              const retry = await fetchAutocomplete(ckw);
              if (retry.length > 0) {
                l1Suggestions = retry;
                topicObj.topic = ckw; // 토픽을 키워드로 교체
                break;
              }
            }
          }
        }

        // === Level 1: "이 뉴스 보고 사람들이 뭘 검색할까?" ===
        for (const s of l1Suggestions.slice(0, 10)) {
          addKw({
            keyword: s,
            level: 1,
            source: "autocomplete",
            category,
            newsCategory,
            parentTopic: topic,
          });
        }

        // Template supplement for Level 1
        const suffixes = SUFFIX_TEMPLATES[category] || [];
        for (const suffix of suffixes.slice(0, 5)) {
          addKw({
            keyword: `${topic} ${suffix}`,
            level: 1,
            source: "template",
            category,
            newsCategory,
            parentTopic: topic,
          });
        }

        // === Level 2: "그거 하다가 뭐에 막힐까?" (블루오션) ===
        for (let j = 0; j < intentSuffixes.length; j++) {
          const suffix = intentSuffixes[j];
          const l2Suggestions = l2SuggestionSets[j] || [];
          const expandQuery = `${baseKw} ${suffix}`;

          for (const s of l2Suggestions.slice(0, 7)) {
            if (s !== expandQuery) {
              addKw({
                keyword: s,
                level: 2,
                source: "autocomplete",
                category,
                newsCategory,
                parentTopic: topic,
                intentSuffix: suffix,
              });
            }
          }
        }

        // === Level 3: "이 사람이 또 뭘 검색할까?" (롱테일) ===
        const thirdLevel = catPatterns?.thirdLevel || [];
        for (const suffix of thirdLevel.slice(0, 3)) {
          addKw({
            keyword: `${topic} ${suffix}`,
            level: 3,
            source: "template",
            category,
            newsCategory,
            parentTopic: topic,
          });
        }

        return { topicObj, keywords };
      })
    );

    allExpanded.push(...batchResults);

    // Small delay between batches to avoid flooding
    if (i + 5 < topics.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return allExpanded;
}

// ═══════════════════════════════════════════════════════════
// Step 4: 점수화 및 필터링 (scoreAndFilter)
// 5가지 점수: 광고단가 / 검색의도 / 롱테일 / 연령적합 / 지속성
// ═══════════════════════════════════════════════════════════
function scoreKeyword(kw) {
  const { keyword, level, source, category, intentSuffix } = kw;

  // 1. 광고단가 (adValueScore) — CPC_SCORE_MAP[카테고리]
  const adValueScore = CPC_SCORE_MAP[category] || CPC_SCORE_MAP.general || 40;

  // 2. 검색의도 (intentScore) — INTENT_SCORE_MAP[접미사] 또는 패턴 추정
  let intentScore = 50;
  let intentMatched = false; // 명시적 매칭 여부
  if (intentSuffix && INTENT_SCORE_MAP[intentSuffix]) {
    intentScore = INTENT_SCORE_MAP[intentSuffix];
    intentMatched = true;
  } else {
    // Strategy 1: 키워드 끝부분이 INTENT_SCORE_MAP 키와 일치
    let bestMatch = null;
    let bestMatchLen = 0;
    for (const [suffix, score] of Object.entries(INTENT_SCORE_MAP)) {
      if (keyword.endsWith(suffix) || keyword.includes(` ${suffix}`)) {
        // 가장 긴 매칭 우선 (더 구체적인 접미사)
        if (suffix.length > bestMatchLen) {
          bestMatch = score;
          bestMatchLen = suffix.length;
        }
      }
    }
    // Strategy 2: 키워드의 마지막 단어가 MAP에 단독으로 존재
    const words = keyword.split(/\s+/);
    if (words.length >= 2) {
      const lastWord = words[words.length - 1];
      if (INTENT_SCORE_MAP[lastWord] && lastWord.length > bestMatchLen) {
        bestMatch = INTENT_SCORE_MAP[lastWord];
        bestMatchLen = lastWord.length;
      }
      const lastTwo = words.slice(-2).join(" ");
      if (INTENT_SCORE_MAP[lastTwo] && lastTwo.length > bestMatchLen) {
        bestMatch = INTENT_SCORE_MAP[lastTwo];
        bestMatchLen = lastTwo.length;
      }
    }
    // 매칭된 접미사가 있으면 그 점수를 사용 (저수익이든 고수익이든)
    if (bestMatch !== null) {
      intentScore = bestMatch;
      intentMatched = true;
    }
  }

  // 3. 롱테일 (longtailScore) — 3단어부터 급상승 (블루오션)
  const wordCount = keyword.split(/\s+/).length;
  let longtailScore;
  if (source === "template" && level >= 3) {
    // L3 템플릿: 기계적 접미사 붙이기는 진짜 롱테일이 아님 → 캡 60
    longtailScore = Math.min(60, wordCount * 15);
  } else {
    const wcMap = { 1: 10, 2: 35, 3: 70, 4: 90 };
    const baseWc = wcMap[Math.min(wordCount, 4)] || 90;
    longtailScore = Math.min(100, baseWc + (level >= 2 ? 15 : 0));
  }

  // 4. 연령적합 (ageScore) — AGE_SCORE_MAP[카테고리]
  const ageScore = AGE_SCORE_MAP[category] || AGE_SCORE_MAP.general || 55;

  // 5. 지속성 (durabilityScore) — DURABILITY_BASE_MAP + 조정
  let durabilityScore =
    DURABILITY_BASE_MAP[category] || DURABILITY_BASE_MAP.general || 45;
  if (intentScore >= 80) durabilityScore = Math.min(100, durabilityScore + 10);
  if (level >= 2) durabilityScore = Math.min(100, durabilityScore + 5);

  // 시즌/시한부 키워드 페널티
  for (const tier of SEASONAL_PENALTY_PATTERNS) {
    if (tier.patterns.some((p) => keyword.includes(p))) {
      durabilityScore = Math.max(0, durabilityScore - tier.penalty);
      break; // 가장 강한 매칭 하나만 적용
    }
  }

  // 가중 합산
  let monetizationScore = Math.round(
    adValueScore * 0.25 +
      intentScore * 0.3 +
      longtailScore * 0.2 +
      ageScore * 0.1 +
      durabilityScore * 0.15
  );

  // 의도 불명확 감점: 접미사 매칭 안 된 키워드는 의도가 모호 → -5
  if (!intentMatched) {
    monetizationScore = Math.max(0, monetizationScore - 5);
  }

  // 출처 기반 점수 조정: 자동완성(실제 검색어) +10, 템플릿(기계적 생성) -10
  if (source === "autocomplete") {
    monetizationScore = Math.min(100, monetizationScore + 10);
  } else if (source === "template") {
    monetizationScore = Math.max(0, monetizationScore - 15);
  }

  // 등급
  const grade =
    monetizationScore >= 85
      ? "S"
      : monetizationScore >= 70
        ? "A"
        : monetizationScore >= 55
          ? "B"
          : monetizationScore >= 40
            ? "C"
            : "D";

  // 이유 생성
  const catName = CATEGORIES[category]?.name || category;
  const levelLabel =
    level === 1
      ? "1차 확장"
      : level === 2
        ? "2차 확장(블루오션)"
        : "3차 확장(롱테일)";
  const parts = [`[${catName}] ${levelLabel}:`];
  if (intentScore >= 80) parts.push("행동 의도 높음");
  else if (intentScore >= 60) parts.push("구체적 정보 탐색");
  else parts.push("정보 조회");
  if (adValueScore >= 70) parts.push("광고단가 높은 카테고리");
  if (source === "autocomplete") parts.push("실제 검색어");

  return {
    ...kw,
    monetizationScore,
    grade,
    scoreBreakdown: {
      adValueScore,
      intentScore,
      longtailScore,
      ageScore,
      durabilityScore,
    },
    reasoning: parts.join(" "),
  };
}

function scoreAndFilter(expandedResults) {
  return expandedResults.map(({ topicObj, keywords }) => {
    const scored = keywords.map(scoreKeyword);
    scored.sort((a, b) => b.monetizationScore - a.monetizationScore);
    return { topicObj, keywords: scored };
  });
}

// ═══════════════════════════════════════════════════════════
// Step 5: 트렌드 검증 (verifyTrends)
// 상위 5개 키워드 DataLab 조회 → 상승 +5 / 하락 -5
// ═══════════════════════════════════════════════════════════
async function verifyTrends(scoredResults) {
  // Collect top keywords for trend verification
  const topKeywords = [];
  for (const { keywords } of scoredResults) {
    for (const kw of keywords.slice(0, 2)) {
      if (topKeywords.length < 5) {
        topKeywords.push(kw);
      }
    }
    if (topKeywords.length >= 5) break;
  }

  if (topKeywords.length === 0) return scoredResults;

  try {
    const keywordGroups = topKeywords.map((kw) => ({
      groupName: kw.keyword,
      keywords: [kw.keyword],
    }));

    const today = new Date();
    const endDate = fmtDate(today);
    const past = new Date(today);
    past.setMonth(past.getMonth() - 12);
    const startDate = fmtDate(past);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://openapi.naver.com/v1/datalab/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
      },
      body: JSON.stringify({
        startDate,
        endDate,
        timeUnit: "month",
        keywordGroups: keywordGroups.slice(0, 5),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return scoredResults;

    const data = await res.json();

    // Build trend map: keyword → change ratio
    const trendMap = new Map();
    for (const result of data.results || []) {
      const values = (result.data || []).map((d) => d.ratio);
      if (values.length < 2) continue;
      const recent = avg(values.slice(-3));
      const older = avg(values.slice(0, Math.max(1, values.length - 3)));
      const change = older > 0 ? (recent - older) / older : 0;
      trendMap.set(result.title, change);
    }

    // Apply trend adjustments
    for (const { keywords } of scoredResults) {
      for (const kw of keywords) {
        const trend = trendMap.get(kw.keyword);
        if (trend === undefined) continue;

        if (trend > 0.1) {
          kw.monetizationScore = Math.min(100, kw.monetizationScore + 5);
        } else if (trend < -0.2) {
          kw.monetizationScore = Math.max(0, kw.monetizationScore - 5);
        }

        // Recalculate grade
        kw.grade =
          kw.monetizationScore >= 85
            ? "S"
            : kw.monetizationScore >= 70
              ? "A"
              : kw.monetizationScore >= 55
                ? "B"
                : kw.monetizationScore >= 40
                  ? "C"
                  : "D";
      }
    }
  } catch {
    // Best-effort: skip on failure
  }

  return scoredResults;
}

// ═══════════════════════════════════════════════════════════
// 뉴스 전문용어 블랙리스트 (일반인이 검색하지 않는 뉴스 헤드라인 용어)
// ═══════════════════════════════════════════════════════════
const NEWS_JARGON = new Set([
  "예대금리차", "포용금융", "영끌족", "차주", "금리 셈법",
  "가산금리", "기준금리", "코픽스", "여신", "수신",
  "건전성", "자기자본비율", "유동성", "디레버리징",
  "실적", "영업이익", "매출액", "분기", "전년 대비",
]);

function containsJargon(keyword) {
  for (const jargon of NEWS_JARGON) {
    if (keyword.includes(jargon)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
// 의미적 중복 판별
// ═══════════════════════════════════════════════════════════
function isSemanticallyDuplicate(kwA, kwB) {
  const a = kwA.replace(/\s+/g, "");
  const b = kwB.replace(/\s+/g, "");

  // 1) 공백 제거 후 포함 관계 (최소 4자 이상일 때만)
  if (a.length >= 4 && b.length >= 4) {
    if (a.includes(b) || b.includes(a)) return true;
  }

  // 2) 연도 접두사 제거 후 비교
  const stripYear = (s) => s.replace(/^20\d{2}년?\s*/, "");
  const aStrip = stripYear(kwA).replace(/\s+/g, "");
  const bStrip = stripYear(kwB).replace(/\s+/g, "");
  if (aStrip.length >= 4 && bStrip.length >= 4) {
    if (aStrip === bStrip || aStrip.includes(bStrip) || bStrip.includes(aStrip)) return true;
  }

  // 3) 핵심어(첫 N글자) 공유 + 접미사만 다른 경우
  //    "문화복지카드 신청방법" vs "문화복지카드 온라인신청" → 핵심어 동일
  const wordsA = kwA.split(/\s+/);
  const wordsB = kwB.split(/\s+/);
  if (wordsA.length >= 2 && wordsB.length >= 2) {
    // 지역명 제거 후 첫 단어 비교
    const stripRegion = (w) => w.replace(/^(전남|전북|경남|경북|충남|충북|강원|제주|서울|부산|대구|인천|광주|대전|울산|세종|경기)/, "");
    const coreA = stripRegion(wordsA[0]);
    const coreB = stripRegion(wordsB[0]);
    // 핵심어가 4자 이상이고 동일하면 중복
    if (coreA.length >= 4 && coreA === coreB) return true;
    // 핵심어 포함 관계 (문화복지카드 ⊂ 청년문화복지카드)
    if (coreA.length >= 4 && coreB.length >= 4) {
      if (coreA.includes(coreB) || coreB.includes(coreA)) return true;
    }
  }

  return false;
}

// ═══════════════════════════════════════════════════════════
// 응답 빌드 (프론트엔드 계약 준수)
// ═══════════════════════════════════════════════════════════
function buildResponse(newsItems, scoredResults) {
  const results = [];
  const allScoredKeywords = [];

  for (const { topicObj, keywords } of scoredResults) {
    const relatedKeywords = keywords.map((kw) => ({
      keyword: kw.keyword,
      level: kw.level,
      source: kw.source,
      monetizationScore: kw.monetizationScore,
      grade: kw.grade,
      scoreBreakdown: kw.scoreBreakdown,
      reasoning: kw.reasoning,
    }));

    // moneyKeywords = relatedKeywords sorted by score descending
    const moneyKeywords = [...relatedKeywords].sort(
      (a, b) => b.monetizationScore - a.monetizationScore
    );

    results.push({
      newsTitle: topicObj.newsTitle,
      newsSource: topicObj.newsSource,
      newsCategory: topicObj.newsCategory,
      detectedCategory: topicObj.category,
      extractedKeyword: topicObj.topic,
      stats: null,
      relatedKeywords,
      moneyKeywords,
    });

    allScoredKeywords.push(...keywords);
  }

  // 자동완성 출처 키워드가 있는 토픽만 우선 추천 (자동완성 0개 = 품질 낮은 토픽)
  const topicsWithAuto = new Set();
  for (const kw of allScoredKeywords) {
    if (kw.source === "autocomplete") topicsWithAuto.add(kw.parentTopic);
  }

  // Recommended: 다양성 우선 선별
  // 제한: 카테고리당 4개, 토픽당 2개, 접미사당 2개, 베이스(첫2단어)당 1개
  // 자동완성 있는 토픽 우선, 없으면 나중에 채움
  allScoredKeywords.sort((a, b) => {
    // 1차: 자동완성 있는 토픽 우선
    const aHasAuto = topicsWithAuto.has(a.parentTopic) ? 1 : 0;
    const bHasAuto = topicsWithAuto.has(b.parentTopic) ? 1 : 0;
    if (bHasAuto !== aHasAuto) return bHasAuto - aHasAuto;
    // 2차: 점수순
    return b.monetizationScore - a.monetizationScore;
  });
  const catCount = new Map();   // 카테고리당 최대 4개 (느슨한 다양성)
  const topicCount = new Map(); // 토픽당 최대 2개
  const suffixCount = new Map(); // 접미사당 최대 2개
  const baseCount = new Map();  // 첫 2단어 동일 → 최대 1개
  const MAX_PER_CAT = 4;
  const MAX_PER_TOPIC = 2;
  const MAX_PER_SUFFIX = 2;
  const MAX_PER_BASE = 1;
  const recommendedKeywords = [];

  // S/A 등급 우선, 부족하면 B→C까지 확장 (드라마/인물 등 저CPC 카테고리 포함)
  const minGrades = ["S", "A", "B", "C"];
  for (const minG of minGrades) {
    for (const kw of allScoredKeywords) {
      if (minG === "S" && kw.grade !== "S") continue;
      if (minG === "A" && kw.grade !== "S" && kw.grade !== "A") continue;
      if (minG === "B" && kw.grade !== "S" && kw.grade !== "A" && kw.grade !== "B") continue;
      // 추천에는 자동완성이 검증된 토픽의 키워드만 허용
      if (!topicsWithAuto.has(kw.parentTopic)) continue;

      // 1단어 키워드 제외 (너무 모호하고 경쟁 높음)
      if (kw.keyword.split(/\s+/).length < 2) continue;

      // 뉴스 전문용어 제외 (일반인 검색 안 함)
      if (containsJargon(kw.keyword)) continue;

      // 저수익 검색어 제외: intentScore < 40 (나무위키, 주가, 순위, 뜻 등)
      if ((kw.scoreBreakdown?.intentScore || 50) < 40) continue;

      // 의미적 중복 체크 (기존 recSeen 문자열 일치 → 의미적 유사도로 교체)
      let isDup = false;
      for (const rec of recommendedKeywords) {
        if (isSemanticallyDuplicate(kw.keyword, rec.keyword)) {
          isDup = true;
          break;
        }
      }
      if (isDup) continue;

      const topic = kw.parentTopic || "unknown";
      const kwWords = kw.keyword.split(/\s+/);
      const suffix = kwWords[kwWords.length - 1];
      const base = kwWords.slice(0, 2).join(" ");

      const cat = kw.category || "general";

      // 제한 체크
      if ((catCount.get(cat) || 0) >= MAX_PER_CAT) continue;
      if ((topicCount.get(topic) || 0) >= MAX_PER_TOPIC) continue;
      if ((suffixCount.get(suffix) || 0) >= MAX_PER_SUFFIX) continue;
      if ((baseCount.get(base) || 0) >= MAX_PER_BASE) continue;

      catCount.set(cat, (catCount.get(cat) || 0) + 1);
      topicCount.set(topic, (topicCount.get(topic) || 0) + 1);
      suffixCount.set(suffix, (suffixCount.get(suffix) || 0) + 1);
      baseCount.set(base, (baseCount.get(base) || 0) + 1);
      recommendedKeywords.push({
        keyword: kw.keyword,
        grade: kw.grade,
        monetizationScore: kw.monetizationScore,
        newsCategory: kw.newsCategory || "",
        scoreBreakdown: kw.scoreBreakdown,
        reasoning: kw.reasoning,
      });
      if (recommendedKeywords.length >= 20) break;
    }
    if (recommendedKeywords.length >= 20) break;
  }

  return {
    analyzedAt: new Date().toISOString(),
    totalNews: newsItems.length,
    recommendedKeywords,
    results,
  };
}

// ═══════════════════════════════════════════════════════════
// /api/auto-analyze — 메인 파이프라인 (25초 하드 타임아웃)
// ═══════════════════════════════════════════════════════════
app.get("/api/auto-analyze", async (req, res) => {
  const HARD_TIMEOUT = 25000;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("파이프라인 타임아웃 (25초)")), HARD_TIMEOUT)
  );

  try {
    const result = await Promise.race([
      (async () => {
        console.log("[auto-analyze] Step 1: 뉴스 수집...");
        const newsItems = await fetchAllNews();
        console.log(`[auto-analyze] 뉴스 ${newsItems.length}건 수집`);

        if (newsItems.length === 0) {
          return {
            analyzedAt: new Date().toISOString(),
            totalNews: 0,
            recommendedKeywords: [],
            results: [],
          };
        }

        console.log("[auto-analyze] Step 2: 토픽 추출...");
        const topics = extractTopics(newsItems);
        console.log(`[auto-analyze] 토픽 ${topics.length}개 추출`);

        console.log("[auto-analyze] Step 3: 키워드 확장...");
        const expanded = await expandKeywords(topics);
        const kwCount = expanded.reduce((s, e) => s + e.keywords.length, 0);
        console.log(`[auto-analyze] 키워드 ${kwCount}개 확장`);

        console.log("[auto-analyze] Step 4: 점수화...");
        const scored = scoreAndFilter(expanded);

        console.log("[auto-analyze] Step 5: 트렌드 검증...");
        const verified = await verifyTrends(scored);

        console.log("[auto-analyze] 응답 빌드...");
        return buildResponse(newsItems, verified);
      })(),
      timeoutPromise,
    ]);

    res.json(result);
  } catch (err) {
    console.error("[auto-analyze] 오류:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// /api/news — 뉴스 검색 프록시
// ═══════════════════════════════════════════════════════════
app.get("/api/news", async (req, res) => {
  const { query, display = 10, sort = "date" } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });

  try {
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;
    const r = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
      },
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// /api/trends — DataLab 검색 트렌드 프록시
// ═══════════════════════════════════════════════════════════
app.post("/api/trends", async (req, res) => {
  const { keywordGroups, startDate, endDate, timeUnit, device, gender, ages } =
    req.body;

  if (!keywordGroups || !Array.isArray(keywordGroups)) {
    return res.status(400).json({ error: "keywordGroups 배열 필요" });
  }

  try {
    const body = {
      startDate: startDate || fmtDate(monthsAgo(12)),
      endDate: endDate || fmtDate(new Date()),
      timeUnit: timeUnit || "month",
      keywordGroups,
    };
    if (device) body.device = device;
    if (gender) body.gender = gender;
    if (ages) body.ages = ages;

    const r = await fetch("https://openapi.naver.com/v1/datalab/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// /api/keywords — 검색광고 API (미설정 시 503)
// ═══════════════════════════════════════════════════════════
app.get("/api/keywords", (req, res) => {
  res
    .status(503)
    .json({ error: "AD_API_NOT_CONFIGURED", message: "검색광고 API 미설정" });
});

// ═══════════════════════════════════════════════════════════
// /api/related — 연관 키워드 (미설정 시 503)
// ═══════════════════════════════════════════════════════════
app.get("/api/related", (req, res) => {
  res
    .status(503)
    .json({ error: "AD_API_NOT_CONFIGURED", message: "검색광고 API 미설정" });
});

// ═══════════════════════════════════════════════════════════
// 유틸리티
// ═══════════════════════════════════════════════════════════
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

function avg(arr) {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ═══════════════════════════════════════════════════════════
// 서버 시작
// ═══════════════════════════════════════════════════════════
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(
    `Preview: https://8080-${process.env.WEB_HOST || "localhost"}`
  );
});
