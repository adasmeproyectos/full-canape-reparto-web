// ============================================================
// Full Canapé — Web Push Client v1.0
// Gestiona el ciclo completo de notificaciones push del lado cliente:
//   1. Registro del Service Worker
//   2. Solicitud de permiso al usuario
//   3. Suscripción VAPID y guardado en Supabase
//   4. Disparo de notificaciones via Supabase Edge Function
//
// REQUISITOS DE PRODUCCIÓN:
//   - VITE_VAPID_PUBLIC_KEY en .env (clave pública VAPID)
//   - Supabase Edge Function "push-notify" desplegada
//   - La app debe servirse sobre HTTPS (obligatorio para SW)
//   - En iOS: la app debe estar instalada como PWA (Add to Home Screen)
//             y el usuario debe estar en iOS 16.4+
// ============================================================

import { supabase } from './supabase';

// ── Constantes ───────────────────────────────────────────────
const SW_URL = '/sw.js';
// La clave pública VAPID se lee del entorno para no hardcodearla.
// Si no está definida, el módulo degrada graciosamente (sin push).
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || null;

// ── Detección de soporte ─────────────────────────────────────
export const pushEsSoportado = () => {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
};

// ── Convertir la clave VAPID base64url → Uint8Array ─────────
// Requerido por la spec de PushManager.subscribe()
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
}

// ── 1. Registrar el Service Worker ───────────────────────────
export async function registrarServiceWorker() {
  if (!pushEsSoportado()) {
    console.warn('⚠️ Push no soportado en este navegador/dispositivo.');
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, {
      scope: '/'
    });
    console.log('✅ Service Worker registrado:', registration.scope);
    return registration;
  } catch (err) {
    console.error('❌ Error al registrar Service Worker:', err);
    return null;
  }
}

// ── 2. Solicitar permiso de notificaciones ───────────────────
// Retorna: 'granted' | 'denied' | 'default' | 'unsupported'
export async function solicitarPermisoPush() {
  if (!pushEsSoportado()) return 'unsupported';
  try {
    const permiso = await Notification.requestPermission();
    console.log(`🔔 Permiso de notificaciones: ${permiso}`);
    return permiso;
  } catch (err) {
    console.error('❌ Error solicitando permiso:', err);
    return 'denied';
  }
}

// ── 3. Suscribir al admin y guardar en Supabase ──────────────
// Llama a PushManager.subscribe() con la VAPID key y persiste
// el endpoint en la tabla 'push_subscriptions' de Supabase.
export async function suscribirAdmin() {
  if (!VAPID_PUBLIC_KEY) {
    console.warn('⚠️ VITE_VAPID_PUBLIC_KEY no configurada. Push desactivado.');
    return null;
  }
  if (!pushEsSoportado() || Notification.permission !== 'granted') {
    console.warn('⚠️ Sin permiso o soporte. Abortando suscripción.');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true, // Obligatorio para Chrome/Android
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    const subJson = subscription.toJSON();
    console.log('✅ Suscripción push creada:', subJson.endpoint?.substring(0, 60) + '…');

    // Persistir en Supabase para que el backend sepa a dónde enviar
    if (supabase) {
      const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: subJson.endpoint,
        p256dh: subJson.keys?.p256dh,
        auth: subJson.keys?.auth,
        user_agent: navigator.userAgent.substring(0, 200),
        actualizado_en: new Date().toISOString()
      }, { onConflict: 'endpoint' });

      if (error) {
        console.error('❌ Error guardando suscripción en Supabase:', error.message);
      } else {
        console.log('✅ Suscripción guardada en Supabase.');
      }
    }

    return subscription;
  } catch (err) {
    console.error('❌ Error al suscribirse a push:', err);
    return null;
  }
}

// ── 4. Disparar notificación via Supabase Edge Function ──────
// En desarrollo o sin VAPID key, muestra un console.log y no falla.
// En producción, llama a la Edge Function que usa 'web-push' en el server.
//
// NOTA: La Edge Function 'push-notify' debe:
//   - Leer todas las suscripciones de 'push_subscriptions'
//   - Enviar el payload a cada endpoint usando web-push y las VAPID keys secretas
//   - Las VAPID keys PRIVADAS viven SOLO en el entorno del server (Supabase Secrets),
//     nunca en el cliente.
export async function dispararNotificacionPush(titulo, cuerpo) {
  // Siempre loguear localmente para debugging
  console.log(`🔔 PUSH: [${titulo}] ${cuerpo}`);

  if (!supabase || !VAPID_PUBLIC_KEY) {
    // En desarrollo, notificación local como fallback visual
    if (Notification.permission === 'granted') {
      new Notification(titulo, {
        body: cuerpo,
        icon: '/apple-touch-icon.png'
      });
    }
    return;
  }

  try {
    // Invoca la Edge Function de Supabase que reenvía a todos los admins suscritos
    const { error } = await supabase.functions.invoke('push-notify', {
      body: { titulo, cuerpo }
    });
    if (error) {
      console.error('❌ Error invocando Edge Function push-notify:', error.message);
    }
  } catch (err) {
    console.error('❌ Error de red al disparar push:', err);
  }
}
