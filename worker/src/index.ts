/**
 * RTA Draft Lab — API Worker
 *
 * GET /api/player?player=174018&season=39[&full=1][&refresh=1]
 * GET /api/health[?browser=1]
 *
 * 為什麼需要 Browser Rendering：
 *   api.lucksack.gg 的 Cloudflare bot 防護擋的是 TLS 指紋（JA3），
 *   任何 Worker / Node / curl 的普通 fetch 都會拿到 403。
 *   雲端 Chrome 是唯一能在 Cloudflare 上取得資料的方式。
 *
 * 快取策略：
 *   KV（14 天）→ 30 分鐘內直接回 → 否則開一次瀏覽器做增量抓取。
 *   首次 limit=1000 一次就拿整季（S39 419 場約 3.7 秒），之後只抓最新 50 筆。
 *   瀏覽器 session 會重用（keep_alive 10 分鐘），避免 429 Rate limit。
 */
import puppeteer, { type Browser } from "@cloudflare/puppeteer";

export interface Env {
  BROWSER: Fetcher;
  MATCHES: KVNamespace;
  ALLOWED_ORIGINS?: string;
  WARM_PLAYERS?: string;
}

const API = "https://api.lucksack.gg";
const VERSION = 1;
/** KV 保留 14 天，讓「增量更新」永遠有基底可用 */
const KV_TTL_SECONDS = 60 * 60 * 24 * 14;
/** 60 分鐘內的回應直接從 KV 回，不開瀏覽器（省下免費方案的瀏覽器分鐘數） */
const FRESH_MS = 60 * 60 * 1000;
/** 增量抓取一次抓多少筆（每天最多 30 場，50 很夠） */
const INCREMENTAL_LIMIT = 50;
/** 增量筆數不夠覆蓋時（例如隔了很久）就整季重抓 */
const INCREMENTAL_GAP = 40;

// ────────────────────────────── types ──────────────────────────────

interface Match {
  battleId: number;
  time: string;
  won: boolean | null;
  firstPick: boolean;
  my: number[];
  myBan: number;
  myLeader: number;
  myScore: number | null;
  opp: number[];
  oppBan: number;
  oppLeader: number;
  oppScore: number | null;
  oppId: number | null;
  oppName: string;
  bracket: number | null;
  oppBracket: number | null;
}

interface DailyStat {
  date: string;
  played: number;
  won: number;
}

interface Summary {
  username: string;
  country: string;
  image: string;
  rank: number | null;
  score: number | null;
  peak: number | null;
  winRate: number | null;
  total: number | null;
  wins: number | null;
  draws: number | null;
  bestStreak: number | null;
  currentStreak: number | null;
  seasonStart: string | null;
  seasonEnd: string | null;
  daily: DailyStat[];
}

interface Payload {
  version: number;
  player: { id: number; username: string; country: string; image: string };
  season: number;
  fetchedAt: string;
  summary: Summary;
  matches: Match[];
  total: number;
}

// ──────────────────────────── normalizing ────────────────────────────

type Json = Record<string, unknown>;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const ids = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : [];

function normalizeMatch(raw: Json): Match {
  return {
    battleId: num(raw.battle_id) ?? 0,
    time: typeof raw.battle_time === "string" ? raw.battle_time : "",
    won: raw.won === true ? true : raw.won === false ? false : null,
    firstPick: raw.had_first_pick === true,
    my: ids(raw.my_monsters),
    myBan: num(raw.my_bans) ?? 0,
    myLeader: num(raw.my_leader) ?? 0,
    myScore: num(raw.my_score),
    opp: ids(raw.opponent_monsters),
    oppBan: num(raw.opponent_bans) ?? 0,
    oppLeader: num(raw.opponent_leader) ?? 0,
    oppScore: num(raw.opponent_score),
    oppId: num(raw.opponent_id),
    oppName: typeof raw.opponent_username === "string" ? raw.opponent_username : "",
    bracket: num(raw.my_rank_bracket),
    oppBracket: num(raw.opponent_rank_bracket),
  };
}

function normalizeSummary(raw: Json | null): Summary {
  const sm = (raw?.summary ?? {}) as Json;
  const ui = (raw?.user_info ?? {}) as Json;
  const bounds = Array.isArray(raw?.season_bounds) ? (raw!.season_bounds as unknown[]) : [];
  const daily = Array.isArray(raw?.daily_stats) ? (raw!.daily_stats as Json[]) : [];

  return {
    username: typeof ui.username === "string" ? ui.username : "",
    country: typeof ui.country === "string" ? ui.country : "",
    image: typeof ui.image === "string" ? ui.image : "",
    rank: num(sm.current_rank),
    score: num(sm.current_score),
    peak: num(sm.peak_score),
    winRate: num(sm.overall_win_rate),
    total: num(sm.total_matches),
    wins: num(sm.total_wins),
    draws: num(sm.total_draws),
    bestStreak: num(sm.best_win_streak),
    currentStreak: num(sm.current_streak),
    seasonStart: typeof bounds[0] === "string" ? (bounds[0] as string) : null,
    seasonEnd: typeof bounds[1] === "string" ? (bounds[1] as string) : null,
    daily: daily
      .filter((d) => typeof d?.date === "string")
      .map((d) => ({
        date: String(d.date),
        played: num(d.match_played) ?? 0,
        won: num(d.match_won) ?? 0,
      })),
  };
}

/** 拿不到 /summary 時的退路：從對戰紀錄自己算 */
function deriveSummary(matches: Match[]): Summary {
  const decided = matches.filter((m) => m.won !== null);
  const wins = matches.filter((m) => m.won === true).length;
  const last = matches[0];
  return {
    username: "",
    country: "",
    image: "",
    rank: last?.bracket ?? null,
    score: last?.myScore ?? null,
    peak: null,
    winRate: decided.length ? Math.round((wins / decided.length) * 10000) / 100 : null,
    total: matches.length,
    wins,
    draws: matches.length - decided.length,
    bestStreak: null,
    currentStreak: null,
    seasonStart: null,
    seasonEnd: null,
    daily: [],
  };
}

function mergeMatches(base: Match[], fresh: Match[]): Match[] {
  const map = new Map<number, Match>();
  for (const m of base) if (m.battleId) map.set(m.battleId, m);
  for (const m of fresh) if (m.battleId) map.set(m.battleId, m);
  return [...map.values()].sort(
    (a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0),
  );
}

// ──────────────────────────── browser ────────────────────────────

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>;

/**
 * 閒置後保留 session 的時間。
 *
 * 注意：Browser Rendering 的免費額度（10 分鐘/天）算的是「session 存活時間」，
 * 不是指令執行時間。設 10 分鐘會讓一次抓取就吃掉整天額度（實測 615 秒）。
 * 15 秒足以吸收「連點兩下、cron 與請求撞在一起」這類突發，又幾乎不浪費額度。
 */
const KEEP_ALIVE_MS = 15_000;
/** 免費方案每天 600 秒；留一點緩衝，超過就別再開瀏覽器 */
const DAILY_BROWSER_BUDGET_SECONDS = 570;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (e: unknown) =>
  /429|rate limit|too many|concurren/i.test((e as Error)?.message ?? String(e));

interface Acquired {
  browser: Browser;
  /** true = 接上既有 session（沒有新開瀏覽器，不會撞 429） */
  reused: boolean;
}

/**
 * 取得瀏覽器：先重用既有 session，真的沒有才新開。
 *
 * Browser Rendering 對「新開瀏覽器」有速率限制（429 Rate limit exceeded），
 * 短時間內連續呼叫（例如使用者按重新整理、或 cron 與請求撞在一起）就會失敗。
 * 重用 session 完全不消耗這個額度，因此優先重用；新開失敗時依官方
 * `puppeteer.limits()` 建議的等待時間退避重試。
 */
async function acquireBrowser(env: Env): Promise<Acquired> {
  try {
    const sessions = await puppeteer.sessions(env.BROWSER);
    for (const s of sessions) {
      try {
        const browser = await puppeteer.connect(env.BROWSER, s.sessionId);
        return { browser, reused: true };
      } catch {
        /* session 剛好過期，換下一個 */
      }
    }
  } catch {
    /* 查不到 session 清單就直接開新的 */
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const browser = await puppeteer.launch(env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
      return { browser, reused: false };
    } catch (e) {
      lastError = e;
      if (!isRateLimit(e) || attempt === 3) throw e;

      // 官方會告知還要等多久才能再開一個瀏覽器
      let wait = 3000 * (attempt + 1);
      try {
        const limits = await puppeteer.limits(env.BROWSER);
        const t = Number(limits?.timeUntilNextAllowedBrowserAcquisition ?? 0);
        if (t > 0) wait = Math.min(Math.max(t + 500, 2000), 25_000);
      } catch {
        /* 拿不到就用預設退避 */
      }
      await sleep(wait);
    }
  }
  throw lastError;
}

/** 用完只斷線、不關閉：keep_alive 讓瀏覽器留著給下一次抓取重用 */
async function releaseBrowser({ browser }: Acquired): Promise<void> {
  try {
    await browser.disconnect();
  } catch {
    /* 已經斷了就算了 */
  }
}

/**
 * 今日已用掉的瀏覽器時間（秒）。
 * 額度用完時新開瀏覽器只會拿到誤導性的 429，因此先問一次再決定要不要抓。
 */
async function usedBrowserSeconds(env: Env): Promise<number | null> {
  try {
    const limits = (await puppeteer.limits(env.BROWSER)) as unknown as {
      usedBrowserTimeSeconds?: number;
    };
    const used = Number(limits.usedBrowserTimeSeconds);
    return Number.isFinite(used) ? used : null;
  } catch {
    return null;
  }
}

/** 把底層錯誤翻成使用者看得懂的話 */
function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/429|rate limit|too many/i.test(msg)) {
    return "雲端瀏覽器暫時無法使用（速率限制或每日額度已滿），請稍後再試；已有快取的玩家仍可查看舊資料";
  }
  return msg;
}

async function readJson(page: Page, url: string): Promise<Json> {
  const res = await page.evaluate(async (u: string) => {
    const r = await fetch(u, { headers: { accept: "application/json" } });
    return { status: r.status, text: await r.text() };
  }, url);

  if (res.status >= 400) {
    throw new Error(`lucksack ${res.status}: ${res.text.slice(0, 200)}`);
  }
  return JSON.parse(res.text) as Json;
}

/** 直接導覽到 API（真 Chrome 一定過得了），再從頁面文字解析 JSON */
async function navigateJson(page: Page, url: string): Promise<Json> {
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
  const status = resp?.status() ?? 0;

  if (status >= 400) {
    const body = await page
      .evaluate(() => {
        const d = (globalThis as unknown as { document?: { body?: { innerText?: string } } }).document;
        return String(d?.body?.innerText ?? "").slice(0, 200);
      })
      .catch(() => "");
    throw new Error(`lucksack ${status}: ${body}`);
  }

  const text = await page.evaluate(() => {
    const d = (
      globalThis as unknown as {
        document?: {
          body?: { innerText?: string; textContent?: string };
          documentElement?: { innerText?: string };
        };
      }
    ).document;
    const b = d?.body;
    return String(b?.innerText || b?.textContent || d?.documentElement?.innerText || "").trim();
  });

  if (text) {
    try {
      return JSON.parse(text) as Json;
    } catch {
      /* 落到下面的同源 fetch */
    }
  }
  return readJson(page, url);
}

interface RawMatches {
  total: number;
  matches: Match[];
}

async function loadMatches(
  page: Page,
  playerId: number,
  season: number,
  limit: number,
): Promise<RawMatches> {
  const url = `${API}/players/${playerId}/matches?season=${season}&limit=${limit}&offset=0`;
  const json = await navigateJson(page, url);
  const list = Array.isArray(json.matches) ? (json.matches as Json[]) : [];
  return { total: num(json.total) ?? list.length, matches: list.map(normalizeMatch) };
}

async function scrape(
  env: Env,
  playerId: number,
  season: number,
  base: Payload | null,
): Promise<Payload> {
  const acquired = await acquireBrowser(env);
  const context = await acquired.browser.createBrowserContext();

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(25_000);

    // 第一次請求先暖身：直接導覽到 API 讓 Cloudflare 完成 TLS/JS 檢查，
    // 後續同源請求就走頁面內的 fetch（快很多）。
    const incremental = !!base && base.matches.length > 0;
    let result = await loadMatches(
      page,
      playerId,
      season,
      incremental ? INCREMENTAL_LIMIT : 1000,
    );

    // 距離上次太久（新增超過門檻）就整季重抓；上游總數變少（賽季重置／資料被清）也重抓
    let merged: Match[];
    if (incremental) {
      const diff = result.total - base!.matches.length;
      if (diff > INCREMENTAL_GAP || diff < -10) {
        result = await loadMatches(page, playerId, season, 1000);
        merged = result.matches;
      } else {
        merged = mergeMatches(base!.matches, result.matches);
      }
    } else {
      merged = result.matches;
    }

    let summary: Summary;
    try {
      const raw = await readJson(page, `${API}/players/${playerId}/summary?season=${season}`);
      summary = normalizeSummary(raw);
    } catch {
      summary = base?.summary ?? deriveSummary(merged);
    }
    if (!summary.total) summary.total = merged.length;

    const player = {
      id: playerId,
      username: summary.username || base?.player.username || "",
      country: summary.country || base?.player.country || "",
      image: summary.image || base?.player.image || "",
    };

    return {
      version: VERSION,
      player,
      season,
      fetchedAt: new Date().toISOString(),
      summary,
      matches: merged,
      total: merged.length,
    };
  } finally {
    // context 關掉才不會讓分頁累積；瀏覽器本身留著重用
    await context.close().catch(() => {});
    await releaseBrowser(acquired);
  }
}

// ──────────────────────────── http helpers ────────────────────────────

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const list = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allow = list.includes("*") ? "*" : list.includes(origin) ? origin : (list[0] ?? "*");

  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
    "cache-control": "no-store",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

// ──────────────────────────── handlers ────────────────────────────

async function handlePlayer(request: Request, env: Env, url: URL): Promise<Response> {
  const cors = corsHeaders(request, env);

  const playerId = Number(url.searchParams.get("player"));
  const season = Number(url.searchParams.get("season") ?? "39");

  if (!Number.isInteger(playerId) || playerId <= 0) {
    return json({ error: "缺少或無效的 player 參數" }, 400, cors);
  }
  if (!Number.isInteger(season) || season <= 0) {
    return json({ error: "缺少或無效的 season 參數" }, 400, cors);
  }

  const key = `m:${playerId}:${season}`;
  const refresh = url.searchParams.get("refresh") === "1";
  const full = url.searchParams.get("full") === "1";

  let cached: Payload | null = null;
  try {
    // 即使是 refresh=1 也要讀舊資料：抓取失敗時才有東西可以退回
    cached = (await env.MATCHES.get(key, "json")) as Payload | null;
  } catch {
    cached = null;
  }

  if (cached && !refresh) {
    const age = Date.now() - Date.parse(cached.fetchedAt);
    if (Number.isFinite(age) && age >= 0 && age < FRESH_MS) {
      return json({ ...cached, cached: true, ageSeconds: Math.round(age / 1000) }, 200, cors);
    }
  }

  try {
    // 額度快用完就先別開瀏覽器：新開只會拿到 429，不如直接回舊資料
    const used = await usedBrowserSeconds(env);
    if (used !== null && used >= DAILY_BROWSER_BUDGET_SECONDS) {
      if (cached) {
        const age = Math.round((Date.now() - Date.parse(cached.fetchedAt)) / 1000);
        return json(
          {
            ...cached,
            cached: true,
            stale: true,
            ageSeconds: Number.isFinite(age) ? age : null,
            warning: "今日雲端瀏覽器額度已用完（免費方案 10 分鐘／天），先顯示快取資料",
          },
          200,
          cors,
        );
      }
      return json(
        {
          error:
            "今日雲端瀏覽器額度已用完（免費方案 10 分鐘／天，UTC 00:00 重置）；已有快取的玩家仍可查看",
        },
        429,
        cors,
      );
    }

    const payload = await scrape(env, playerId, season, full ? null : cached);
    await env.MATCHES.put(key, JSON.stringify(payload), { expirationTtl: KV_TTL_SECONDS });
    return json({ ...payload, cached: false, ageSeconds: 0 }, 200, cors);
  } catch (e) {
    // 抓取失敗時，寧可回舊資料也不要讓使用者看到空白
    if (cached) {
      const age = Math.round((Date.now() - Date.parse(cached.fetchedAt)) / 1000);
      return json(
        {
          ...cached,
          cached: true,
          stale: true,
          ageSeconds: Number.isFinite(age) ? age : null,
          warning: friendlyError(e),
        },
        200,
        cors,
      );
    }
    throw e;
  }
}

async function handleHealth(request: Request, env: Env, url: URL): Promise<Response> {
  const cors = corsHeaders(request, env);
  const out: Record<string, unknown> = {
    ok: true,
    now: new Date().toISOString(),
    version: VERSION,
  };

  try {
    await env.MATCHES.get("__health");
    out.kv = "ok";
  } catch (e) {
    out.kv = `error: ${(e as Error).message}`;
    out.ok = false;
  }

  out.browser = env.BROWSER ? "configured" : "missing";

  if (url.searchParams.get("browser") === "1") {
    const started = Date.now();

    const used = await usedBrowserSeconds(env);
    out.usedBrowserSeconds = used;
    if (used !== null && used >= DAILY_BROWSER_BUDGET_SECONDS) {
      out.browserTest = {
        error: "今日瀏覽器額度已用完（免費方案 10 分鐘／天，UTC 00:00 重置）",
        ms: Date.now() - started,
      };
      out.ok = false;
      return json(out, 503, cors);
    }

    try {
      const acquired = await acquireBrowser(env);
      try {
        const context = await acquired.browser.createBrowserContext();
        try {
          const page = await context.newPage();
          const status = (await page.goto(`${API}/players/174018/matches?season=38&limit=1&offset=0`, {
            waitUntil: "domcontentloaded",
            timeout: 25_000,
          }))?.status();
          out.browserTest = { status, ms: Date.now() - started, reused: acquired.reused };
          out.ok = status === 200;
        } finally {
          await context.close().catch(() => {});
        }
      } finally {
        await releaseBrowser(acquired);
      }
    } catch (e) {
      out.browserTest = { error: (e as Error).message, ms: Date.now() - started };
      out.ok = false;
    }

    try {
      out.browserLimits = await puppeteer.limits(env.BROWSER);
    } catch {
      /* 不影響健康檢查結果 */
    }
  }

  return json(out, out.ok ? 200 : 503, cors);
}

async function warm(env: Env): Promise<void> {
  const list = (env.WARM_PLAYERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const entry of list) {
    const [p, s] = entry.split(":");
    const playerId = Number(p);
    const season = Number(s ?? 39);
    if (!Number.isInteger(playerId) || playerId <= 0) continue;

    try {
      const key = `m:${playerId}:${season}`;
      const cached = (await env.MATCHES.get(key, "json")) as Payload | null;
      const payload = await scrape(env, playerId, season, cached);
      await env.MATCHES.put(key, JSON.stringify(payload), { expirationTtl: KV_TTL_SECONDS });
    } catch (e) {
      console.error(`warm ${entry} failed:`, (e as Error).message);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method not allowed" }, 405, corsHeaders(request, env));
    }

    try {
      if (url.pathname === "/api/health" || url.pathname === "/health") {
        return await handleHealth(request, env, url);
      }
      if (url.pathname === "/api/player" || url.pathname === "/player") {
        return await handlePlayer(request, env, url);
      }
      return json(
        {
          error: "not found",
          routes: ["/api/player?player=<id>&season=<n>", "/api/health"],
        },
        404,
        corsHeaders(request, env),
      );
    } catch (e) {
      return json(
        { error: friendlyError(e) },
        502,
        corsHeaders(request, env),
      );
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(warm(env));
  },
};
