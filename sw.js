// ─── RunWhere Service Worker ─────────────────────────────────────────────────
// キャッシュ名（バージョンアップ時は変更してください）
const CACHE_NAME = 'runwhere-v1';
const STATIC_CACHE = 'runwhere-static-v1';
const DYNAMIC_CACHE = 'runwhere-dynamic-v1';

// オフラインでキャッシュするリソース（必須アセット）
const STATIC_ASSETS = [
  './RunWhere_Web_v1_0.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&display=swap',
];

// ─── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing RunWhere Service Worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static assets');
      // フォントは失敗しても続行（ネットワーク依存のため）
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Cache miss:', url, err))
        )
      );
    }).then(() => {
      console.log('[SW] Installation complete');
      return self.skipWaiting();
    })
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      console.log('[SW] Activated. Claiming clients.');
      return self.clients.claim();
    })
  );
});

// ─── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Google Maps API・外部APIはキャッシュしない（常にネットワーク）
  if (
    url.hostname.includes('maps.googleapis.com') ||
    url.hostname.includes('maps.gstatic.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTMLファイル → Network First（最新を優先、オフライン時はキャッシュ）
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  // その他のローカルリソース → Cache First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 上記以外 → Network First with fallback
  event.respondWith(networkFirst(request));
});

// ─── STRATEGIES ───────────────────────────────────────────────────────────────

/**
 * Cache First: キャッシュにあればそれを返す。なければネットワークから取得してキャッシュ。
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.warn('[SW] Network failed for:', request.url);
    return offlineFallback(request);
  }
}

/**
 * Network First: ネットワークを優先。失敗したらキャッシュ。
 */
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) {
      console.log('[SW] Serving from cache (offline):', request.url);
      return cached;
    }
    return offlineFallback(request);
  }
}

/**
 * オフラインフォールバック
 */
async function offlineFallback(request) {
  if (request.destination === 'document' || request.mode === 'navigate') {
    const cached = await caches.match('./RunWhere_Web_v1_0.html');
    if (cached) return cached;
  }

  // 最小限のオフラインページを返す
  return new Response(
    `<!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>オフライン - RunWhere</title>
      <style>
        body { font-family: 'Inter', sans-serif; display: flex; align-items: center;
               justify-content: center; height: 100vh; margin: 0;
               background: #f5f6fa; color: #111827; text-align: center; }
        .wrap { padding: 40px; }
        h1 { font-size: 24px; font-weight: 700; margin-bottom: 12px; }
        p  { color: #6b7280; font-size: 14px; line-height: 1.7; }
        .icon { font-size: 64px; margin-bottom: 20px; }
        button {
          margin-top: 24px; padding: 12px 28px;
          background: linear-gradient(135deg,#6366f1,#8b5cf6);
          color: white; border: none; border-radius: 12px;
          font-size: 14px; font-weight: 600; cursor: pointer;
        }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="icon">📡</div>
        <h1>オフラインです</h1>
        <p>インターネット接続を確認してください。<br>Google Mapsの利用にはネットワーク接続が必要です。</p>
        <button onclick="location.reload()">再試行</button>
      </div>
    </body>
    </html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
  );
}

// ─── BACKGROUND SYNC（ルート履歴の保護） ────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-routes') {
    console.log('[SW] Background sync: routes');
    // localStorage は SW からは直接アクセスできないが、
    // メッセージング経由で将来的に実装可能
  }
});

// ─── PUSH NOTIFICATIONS（将来の拡張用） ─────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'RunWhere', {
      body: data.body || 'ルートが準備できました！',
      icon: './icons/icon-192.png',
      badge: './icons/icon-72.png',
      tag: 'runwhere-notification',
      renotify: true,
    })
  );
});

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
