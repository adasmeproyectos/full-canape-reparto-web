// ============================================================
// Full Canapé — Web Push Client v1.1
// Gestiona el ciclo completo de notificaciones push del lado cliente:
//   1. Registro del Service Worker
//   2. Solicitud de permiso al usuario
//   3. Suscripción VAPID y guardado en Supabase
//   4. Disparo de notificaciones via Supabase Edge Function
// ============================================================

import { supabase } from './supabase';

const SW_URL = '/sw.js';
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || null;

export const pushEsSoportado = () => {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
};

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
}

export async function registrarServiceWorker() {
  if (!pushEsSoportado()) {
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, {
      scope: '/'
    });
    return registration;
  } catch (err) {
    console.error('Error al registrar Service Worker:', err);
    return null;
  }
}

export async function solicitarPermisoPush() {
  if (!pushEsSoportado()) return 'unsupported';
  try {
    const permiso = await Notification.requestPermission();
    return permiso;
  } catch (err) {
    console.error('Error solicitando permiso de notificaciones:', err);
    return 'denied';
  }
}

export async function suscribirAdmin() {
  if (!VAPID_PUBLIC_KEY) {
    return null;
  }
  if (!pushEsSoportado() || Notification.permission !== 'granted') {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    const subJson = subscription.toJSON();

    if (supabase) {
      const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: subJson.endpoint,
        p256dh: subJson.keys?.p256dh,
        auth: subJson.keys?.auth,
        user_agent: navigator.userAgent.substring(0, 200),
        actualizado_en: new Date().toISOString()
      }, { onConflict: 'endpoint' });

      if (error) {
        console.error('Error guardando suscripción en Supabase:', error.message);
      }
    }

    return subscription;
  } catch (err) {
    console.error('Error al suscribirse a push:', err);
    return null;
  }
}

export async function dispararNotificacionPush(titulo, cuerpo) {
  if (!supabase || !VAPID_PUBLIC_KEY) {
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(titulo, {
          body: cuerpo,
          icon: '/apple-touch-icon.png'
        });
      }
    } catch {
      // En Android Chrome el constructor directo de Notification no está permitido; ignorar silenciosamente
    }
    return;
  }

  try {
    const { error } = await supabase.functions.invoke('push-notify', {
      body: { titulo, cuerpo }
    });
    if (error) {
      console.error('Error invocando Edge Function push-notify:', error.message);
    }
  } catch (err) {
    console.error('Error de red al disparar push:', err);
  }
}
