/*
 * RTA Draft Lab service worker
 *
 * 目標：手機「加到主畫面」後可以像 App 一樣開，而且斷網／沒額度時仍能看到
 *       已存在瀏覽器（IndexedDB）的對戰紀錄。
 *
 * 策略：
 *  - 導覽請求（HTML）：網路優先，失敗時回快取的 index.html
 *  - 同源靜態資源（JS/CSS/圖示）：快取優先，背景更新
 *  - API（不同網域）：一律走網路，不經過 SW（資料由 IndexedDB 負責）
 *
 * 改版時把 CACHE 版本 +1，舊快取會在 activate 時清掉。
 */
const CACHE = "rta-draft-lab-v2";
const CORE = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        for (const url of CORE) {
          try {
            await cache.add(url);
          } catch {
            /* 個別檔案失敗不影響安裝 */
          }
        }
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 只用一個固定 key 存 app shell，避免每個 ?query 都留一份
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          return (
            (await caches.match("./index.html")) ||
            (await caches.match("./")) ||
            new Response("離線中，請先連線開啟一次", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })
          );
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
