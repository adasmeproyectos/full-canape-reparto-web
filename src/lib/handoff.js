import { sanitizarTelefonoChileno } from './sanitizer';

/**
 * Disparo de retroalimentación háptica en dispositivos móviles compatibles
 */
export function dispararHaptico(duracionMs = 15) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(duracionMs);
    }
  } catch {
    // Silencioso en navegadores sin permisos de vibración
  }
}

/**
 * Reproduce un tono sutil de confirmación (120ms) mediante Web Audio API.
 * Diseñado con envolvente exponencial ultracorta y cierre inmediato del contexto
 * para no solicitar foco de audio multimedia ni interrumpir el Bluetooth del vehículo.
 */
export function reproducirTonoConfirmacion() {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const duracion = 0.12; // 120ms (dentro del rango estricto de 100-150ms)

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Micro-intervalo ascendente limpio (La5 -> Mi6) para confirmación táctil
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.055);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duracion);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duracion);

    osc.onended = () => {
      ctx.close().catch(() => {});
    };
  } catch {
    // Silencioso si el navegador bloquea la síntesis de audio
  }
}

/**
 * Abre enlaces externos (WhatsApp, Waze, Google Maps) previniendo que la PWA
 * quede atrapada en un webview huérfano con pantalla blanca y botón 'X'.
 */
export function abrirHandoffExterno(url) {
  if (!url) return;

  dispararHaptico(20);

  // Detección de ejecución en modo PWA Standalone (iOS Add to Home Screen o Android TWA)
  const isStandalone =
    (typeof window !== 'undefined' && window.navigator?.standalone === true) ||
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches);

  if (isStandalone) {
    window.location.href = url;
  } else {
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer';
    document.body.appendChild(enlace);
    enlace.click();
    setTimeout(() => {
      if (document.body.contains(enlace)) {
        document.body.removeChild(enlace);
      }
    }, 150);
  }
}

/**
 * Abre la conversación de WhatsApp con sanitización estricta de teléfono chileno.
 */
export function abrirWhatsApp({ telefono, mensaje = '' }) {
  const telLimpio = sanitizarTelefonoChileno(telefono);
  if (!telLimpio) return false;

  const query = mensaje ? `?text=${encodeURIComponent(mensaje)}` : '';
  const url = `https://wa.me/${telLimpio}${query}`;
  abrirHandoffExterno(url);
  return true;
}

/**
 * Abre Google Maps en modo navegación directa hacia la dirección destino.
 */
export function abrirNavegacion(direccion) {
  if (!direccion) return;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(direccion)}`;
  abrirHandoffExterno(url);
}
