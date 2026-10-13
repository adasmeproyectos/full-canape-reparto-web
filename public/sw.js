// ============================================================
// Full Canapé — Service Worker v1.1
// Maneja eventos push, clicks de notificación y ciclo de vida de PWA.
// Compatible: Chrome/Android (Baseline), iOS 16.4+ (PWA instalada)
// ============================================================

// ── Instalación ──────────────────────────────────────────────
self.addEventListener('install', () => {
  // Activar inmediatamente sin esperar pestañas anteriores
  self.skipWaiting();
});

// ── Activación ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Evento PUSH ──────────────────────────────────────────────
// Recibe la notificación desde el servidor (Supabase Edge Function)
// y la muestra al usuario aunque la app esté en segundo plano.
self.addEventListener('push', (event) => {
  let payload = {
    titulo: 'Full Canapé',
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
    vibrate: [100, 50, 200],
    tag: 'fc-ruta-update',
    renotify: true,
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
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
