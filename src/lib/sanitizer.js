/**
 * Normalizador estricto de números de teléfono móviles de Chile.
 * Formato canónico requerido para WhatsApp: 569XXXXXXXX (11 dígitos).
 */
export function sanitizarTelefonoChileno(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return '';

  // 1. Descartar cualquier carácter que no sea numérico
  let digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';

  // 2. Manejar prefijos internacionales con ceros: '0056' -> '56', o '09' -> '9'
  if (digits.startsWith('0056')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // 3. Descartar prefijos de país duplicados (ej: '56569...')
  while (digits.startsWith('5656')) {
    digits = digits.slice(2);
  }

  // 4. Procesamiento si comienza con código de país 56
  if (digits.startsWith('56')) {
    const resto = digits.slice(2);
    // Caso óptimo: 56 + 9 dígitos comenzando en 9 (569XXXXXXXX = 11 dígitos)
    if (resto.length === 9 && resto.startsWith('9')) {
      return digits;
    }
    // Caso con 8 dígitos (omitió el 9 móvil chileno): 56 + 8 dígitos -> 569XXXXXXXX
    if (resto.length === 8) {
      return `569${resto}`;
    }
    // Caso con 10 dígitos y 99 repetido (ej: 5699XXXXXXXX)
    if (resto.length === 10 && resto.startsWith('99')) {
      return `569${resto.slice(2)}`;
    }
    // Si contiene una subsecuencia válida de 9 dígitos móviles
    const matchMovil = resto.match(/9\d{8}/);
    if (matchMovil) {
      return `56${matchMovil[0]}`;
    }
    return digits;
  }

  // 5. Procesamiento si NO comienza con código 56:
  // Si tiene 9 dígitos y comienza con 9 (ej: 988589058) -> anteponer 56
  if (digits.length === 9 && digits.startsWith('9')) {
    return `56${digits}`;
  }

  // Si tiene 8 dígitos (ej: 88589058) -> anteponer 569
  if (digits.length === 8) {
    return `569${digits}`;
  }

  // 6. Búsqueda por coincidencia de patrones en cadenas largas o formateadas
  const match569 = digits.match(/569\d{8}/);
  if (match569) return match569[0];

  const match9 = digits.match(/9\d{8}/);
  if (match9) return `56${match9[0]}`;

  return digits;
}

/**
 * Formatea un número sanitizado para visualización legible (+56 9 XXXX XXXX)
 */
export function formatearTelefonoVisual(phone) {
  const limpio = sanitizarTelefonoChileno(phone);
  if (!limpio) return '';
  if (limpio.length === 11 && limpio.startsWith('569')) {
    return `+56 9 ${limpio.slice(3, 7)} ${limpio.slice(7)}`;
  }
  return `+${limpio}`;
}
