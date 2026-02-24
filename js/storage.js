// ═══════════════════════════════════════════════════════════
// localStorage 영속성 관리
// ═══════════════════════════════════════════════════════════

const PREFIX = "kw_strategy_";

/** localStorage에 값 저장 */
export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // localStorage 용량 초과 시 무시
  }
}

/** localStorage에서 값 로드 */
export function load(key, defaultValue = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/** localStorage에서 값 삭제 */
export function remove(key) {
  localStorage.removeItem(PREFIX + key);
}

// ─── API 설정 저장/로드 ─────────────────────────────────────

export function saveApiSettings(settings) {
  save("api_settings", settings);
}

export function loadApiSettings() {
  return load("api_settings", {
    apiBase: "",
    naverClientId: "",
    naverClientSecret: "",
    adLicense: "",
    adSecret: "",
    adCustomerId: "",
  });
}

// ─── 세션 데이터 저장/로드 ──────────────────────────────────

export function saveSession(data) {
  save("session", {
    ...data,
    savedAt: Date.now(),
  });
}

export function loadSession() {
  return load("session", null);
}

// ─── 키워드 히스토리 ────────────────────────────────────────

export function addToHistory(keyword, category) {
  const history = load("history", []);
  // 중복 제거 후 앞에 추가
  const filtered = history.filter((h) => h.keyword !== keyword);
  filtered.unshift({ keyword, category, ts: Date.now() });
  // 최대 50개 유지
  save("history", filtered.slice(0, 50));
}

export function getHistory() {
  return load("history", []);
}
