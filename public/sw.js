// ============================================================
// Full Canapé — Service Worker v1.0
// Maneja eventos push y clicks de notificación.
// Compatible: Chrome/Android (Baseline), iOS 16.4+ (PWA instalada)
// ============================================================

const CACHE_NAME = 'full-canape-sw-v1';

// ── Instalación ──────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Activar inmediatamente sin esperar pestañas anteriores
  self.skipWaiting();
});

// ── Activación ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── Evento PUSH ──────────────────────────────────────────────
// Recibe la notificación desde el servidor (Supabase Edge Function)
// y la muestra al usuario aunque la app esté en segundo plano.
self.addEventListener('push', (event) => {
  let payload = {
    titulo: 'Full Canapé 🚚',
    cuerpo: 'Actualización de ruta',
    icono: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    url: '/'
  };

  // El payload puede venir como JSON o como texto plano
  if (event.data) {
    try {
      const data = event.data.json();
      payload = { ...payload, ...data };
    } catch {
      payload.cuerpo = event.data.text();
    }
  }

  const opciones = {
    body: payload.cuerpo,
    icon: payload.icono,
    badge: payload.badge,
    // vibration: patrón corto-largo para alertar al admin en silencio
    vibrate: [100, 50, 200],
    // tag único por ruta para que notifs nuevas reemplacen a las anteriores
    // en lugar de apilarse sin control
    tag: 'fc-ruta-update',
    renotify: true,
    // Mantener visible hasta que el admin interactúe (no se auto-descarta)
    requireInteraction: false,
    data: { url: payload.url }
  };

  event.waitUntil(
    self.registration.showNotification(payload.titulo, opciones)
  );
});

// ── Evento NOTIFICATIONCLICK ─────────────────────────────────
// Al hacer tap en la notificación, enfocar la app o abrirla.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una pestaña abierta de la app, enfocarla
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no, abrir una nueva
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
