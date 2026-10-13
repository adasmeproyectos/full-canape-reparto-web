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
    // En modo standalone, invocar directamente la URL mediante location.href.
    // El sistema operativo transfiere el control a la aplicación nativa (WhatsApp o Maps)
    // sin crear un Safari View Controller satélite que queda en blanco al regresar.
    window.location.href = url;
  } else {
    // En navegadores móviles regulares, abrir con un ancla con noopener y noreferrer.
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
