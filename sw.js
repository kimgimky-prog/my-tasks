// =====================================================================
// sw.js : 서비스 워커 (앱 파일을 폰에 보관해서 인터넷 없이도 열리게 해줘요)
// ---------------------------------------------------------------------
// ▶ 앱 파일을 고친 뒤에는 아래 VERSION 숫자를 하나 올려 주세요.
//   그래야 폰에 보관된 옛날 파일 대신 새 파일을 받아요.
// =====================================================================
const VERSION = "mytasks-v8";
const FILES = [
  "./", "index.html", "style.css", "mailbox.js", "app.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 우편함(GitHub API)은 절대 보관하지 않아요. 항상 새로 받아야 하고, 열쇠가 들어간 요청이라서요.
  if (url.hostname === "api.github.com") return;
  const sameOrigin = url.origin === self.location.origin;
  // 카톡에서 '공유'로 들어온 주소(?share_text=...)도 index.html로 열어요
  const key = sameOrigin && url.search ? new Request(url.origin + url.pathname) : req;
  event.respondWith(
    fetch(req, sameOrigin ? { cache: "no-cache" } : undefined)
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || caches.match("index.html")))
  );
});

// ---------------------------------------------------------------------
// 폰 알림: 우편함(GitHub)이 보낸 알림을 받아서 화면에 띄워요
// 보내는 쪽 내용 모양: {"title": "...", "body": "...", "tag": "...", "url": "/my-tasks/"}
// ---------------------------------------------------------------------
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || "나의 과제", {
    body: d.body || "새 소식이 있어요.",
    tag: d.tag || undefined,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    data: { url: d.url || "./" },
  }));
});

// 알림을 누르면 앱을 열어요 (이미 열려 있으면 그 창으로)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.startsWith(self.registration.scope)) return c.focus();
      return self.clients.openWindow(url);
    })
  );
});
