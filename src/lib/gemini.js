import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { sanitizarTelefonoChileno } from './sanitizer.js';
import catalogoProductos from '../productos.json' with { type: 'json' };

const apiKey = import.meta.env?.VITE_GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Esquema JSON estricto para estructuración nativa con Gemini
const schemaPedidos = {
  type: SchemaType.OBJECT,
  properties: {
    pedidos: {
      type: SchemaType.ARRAY,
      description: 'Lista ordenada de pedidos de despacho',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          cliente: {
            type: SchemaType.STRING,
            description: 'Día y rango horario exactamente como aparecen en el texto (ej: "Sábado 18. 08:00 a 09:00" o "Sin horario")'
          },
          nombre_cliente: {
            type: SchemaType.STRING,
            description: 'Nombre de la persona o cliente que recibe el pedido (ej: "Josefina Bilbao"). NUNCA incluir productos aquí ni duplicar el nombre en items.'
          },
          telefono: {
            type: SchemaType.STRING,
            description: 'Número de teléfono extraído o cadena vacía si no existe'
          },
          direccion: {
            type: SchemaType.STRING,
            description: 'Dirección completa (calle, número, depto, comuna)'
          },
          items: {
            type: SchemaType.ARRAY,
            description: 'Lista completa de productos o bultos a entregar en esta parada. No omitir ningún producto ni incluir el nombre del cliente.',
            items: {
              type: SchemaType.OBJECT,
              properties: {
                nombre: {
                  type: SchemaType.STRING,
                  description: 'Descripción íntegra del producto incluyendo prefijo numérico, notas especiales ("sin salmón", "solo crostinis de champiñón"), unidades totales ("120 crostinis champiñón") y sub-sabores agrupados con salto de línea.'
                },
                cantidad: {
                  type: SchemaType.INTEGER,
                  description: 'Cantidad numérica de CAJAS o BULTOS físicos (ej: 3 para "3-croissant", 1 para "1 caja postres (30 unid)", 1 cuando se expresa en unidades sueltas como "120 crostinis").'
                },
                textoOriginal: {
                  type: SchemaType.STRING,
                  description: 'Texto original íntegro del producto (incluyendo sub-líneas de sabores si las tiene)'
                }
              },
              required: ['nombre', 'cantidad']
            }
          }
        },
        required: ['cliente', 'nombre_cliente', 'telefono', 'direccion', 'items']
      }
    }
  },
  required: ['pedidos']
};

// Patrón léxico amplio del dominio gastronómico de Full Canapé
const PATRON_GASTRONOMICO = /(canap[eé]s?|croissants?|brochetas?|bolitas?|canastos?|canastitos?|quich[eé]s?|empanadas?|empanaditas?|postres?|tablas?|bollos?|dulces?|crostinis?|bocados?|bocaditos?|churrascos?|churrasquitos?|fricas?|picoteos?|mini\s+bocados?|mil\s*hojas|camar[oó]n(?:es)?|empanizados?|tapados?|tapaditos?|s[aá]ndwich(?:es)?|pan\s+de\s+molde|cajitas?|cajas?|pizzetas?|tartaletas?|tartas?|tortas?|pie\s+de\s+lim[oó]n|maracuy[aá]|manjar|tres\s+leches|tiramis[uú]|mousse|brownies?|alfajor(?:es)?|cuchufl[ií]s?|profiterol(?:es)?|macarons?|cheesecake|suspiro|merengue|frambuesa|chocolate|l[uú]cuma|salm[oó]n|champi[ñn][oó]n(?:es)?|pollo|\bave\b|carne|queso|jam[oó]n|palmito|palta|esp[aá]rragos?|choclo|choclillo|piment[oó]n|pimiento|caprese|ceviche|sopaipillas?|pebre|salsa|veggie|surtidos?|variados?|sin\s+salm[oó]n|sin\s+mariscos?|sin\s+carne|sin\s+jam[oó]n|sin\s+queso|sin\s+gluten|sin\s+lactosa|solo\s+crostinis?|s[oó]lo\s+crostinis?|solo\s+canap[eé]s?|unid(?:ades)?\b|unds?\b|bandejas?|bultos?|paquetes?|bolsas?)/i;

// Sabores típicos de postres o cóctel que suelen aparecer como desglose de una caja
const PATRON_SABOR_DESGLOSE = /(pie\s+de\s+lim[oó]n|lim[oó]n|maracuy[aá]|manjar|tres\s+leches|tiramis[uú]|mousse|brownies?|alfajor(?:es)?|cuchufl[ií]s?|profiterol(?:es)?|macarons?|cheesecake|suspiro|merengue|frambuesa|chocolate|l[uú]cuma|nuez|celestino|mil\s*hojas|berlines?|kuchen|tartaletas?|canastitos?\s+dulces?)/i;

/**
 * Calcula la cantidad de cajas/bultos físicos a partir de la línea principal de un ítem.
 * Distingue multiplicadores de cajas ("2-canapé", "1 caja postres (30 unid)")
 * frente a cantidades expresadas en unidades totales ("120 crostinis champiñón" -> 1 bulto).
 */
export function calcularCantidadBultos(primeraLinea, cantidadSugerida = null) {
  const linea = String(primeraLinea || '').trim();
  if (!linea) return 1;

  // 1. Contenedor físico explícito al inicio: "1 caja postres (30 unid)", "2 cajas...", "3 bandejas..."
  const matchContenedor = linea.match(/^(\d+)\s*(?:cajas?|cajitas?|bultos?|canastos?|canastitos?|tablas?|bandejas?|bolsas?|paquetes?|pks?)\b/i);
  if (matchContenedor) {
    return Math.max(1, parseInt(matchContenedor[1], 10) || 1);
  }

  // 2. Unidades explícitas al inicio: "120 unidades crostinis", "30 unid postres" -> 1 bulto
  if (/^(\d+)\s*(?:unidades?|unid\.?|unds?\.?|u\.?)\b/i.test(linea)) {
    return 1;
  }

  // 3. Prefijo multiplicador con separador explícito: "3-croissant", "2- canapé mix 3", "2x canapé"
  const matchSeparador = linea.match(/^(\d+)\s*(?:[-–—*]|[xX]\b|\.\s*)\s*(.+)$/);
  if (matchSeparador) {
    const num = parseInt(matchSeparador[1], 10) || 1;
    const resto = matchSeparador[2].trim();
    if (/^(?:unidades?|unid\.?|unds?\.?)\b/i.test(resto) || num > 20) {
      return 1;
    }
    return Math.max(1, num);
  }

  // 4. Número seguido de espacio y descripción: "120 crostinis champiñón" vs "2 croissant"
  const matchNumeroEspacio = linea.match(/^(\d+)\s+(.+)$/);
  if (matchNumeroEspacio) {
    const num = parseInt(matchNumeroEspacio[1], 10) || 1;
    const resto = matchNumeroEspacio[2].trim();
    // Si el número es >= 15 (ej: 30, 50, 100, 120 crostinis) o menciona unidades, representa unidades totales en 1 bulto
    if (num >= 15 || /^(?:unidades?|unid\.?|unds?\.?)\b/i.test(resto)) {
      return 1;
    }
    return Math.max(1, num);
  }

  // 5. Si viene una cantidad sugerida válida y moderada (< 15), respetarla
  const numSugerido = Number(cantidadSugerida);
  if (Number.isInteger(numSugerido) && numSugerido >= 1 && numSugerido < 15) {
    return numSugerido;
  }

  return 1;
}

/**
 * Normaliza saltos de línea cuando un ítem agrupado trae sub-ítems con guiones en una sola línea
 * (ej: "1 caja postres (30 unid): - 10 pie de limón - 10 maracuyá - 10 manjar")
 */
function normalizarFormatoSubItems(texto) {
  let limpio = String(texto || '').trim();
  if (!limpio) return '';

  // Si tiene ":" seguido de "- " en la misma línea, insertar salto de línea
  if (limpio.includes(':') && !limpio.includes('\n')) {
    limpio = limpio
      .replace(/:\s*[-–—•*]\s+/g, ':\n- ')
      .replace(/\s+[-–—•*]\s+(?=\d+\s+[A-Za-zÁÉÍÓÚáéíóúÑñ])/g, '\n- ');
  }

  return limpio;
}

/**
 * Normaliza y extrae la cantidad numérica de bultos y descripción íntegra de un ítem de pedido.
 * Soporta entradas tanto en formato string como en objeto.
 */
export function extraerItemDetalle(item) {
  if (!item) {
    return { nombre: '1x Pedido', cantidad: 1, textoOriginal: '' };
  }

  if (typeof item === 'object') {
    const rawNombre = String(item.nombre || item.textoOriginal || 'Ítem').trim();
    const rawOriginal = String(item.textoOriginal || item.nombre || '').trim();

    // Si Gemini separó un número de unidades grandes (ej: nombre="crostinis champiñón", cantidad=120, textoOriginal="120 crostinis champiñón"),
    // restaurar la etiqueta original íntegra sin el "120x" artificial.
    let baseTexto = rawNombre;
    if (rawOriginal && /^\d+\s+/.test(rawOriginal) && !/^\d+/.test(rawNombre)) {
      baseTexto = rawOriginal;
    }
    // Si tiene prefijo artificial "120x ..." generado para unidades (>= 15), limpiar la "x"
    baseTexto = baseTexto.replace(/^(\d{2,})[xX]\s+/, '$1 ');

    const nombreNormalizado = normalizarFormatoSubItems(baseTexto);
    const primeraLinea = nombreNormalizado.split(/\r?\n/)[0].trim();
    const cantidad = calcularCantidadBultos(primeraLinea, item.cantidad);

    let nombreFinal = nombreNormalizado;
    const tienePrefijoVisible = /^(\d+)\s*[-–—*xX.]/i.test(primeraLinea) || /^\d+\s+/i.test(primeraLinea);
    if (!tienePrefijoVisible && cantidad > 1) {
      const lineas = nombreNormalizado.split(/\r?\n/);
      lineas[0] = `${cantidad}x ${lineas[0]}`;
      nombreFinal = lineas.join('\n');
    }

    return {
      nombre: nombreFinal,
      cantidad,
      textoOriginal: rawOriginal || nombreFinal
    };
  }

  const texto = normalizarFormatoSubItems(String(item).trim());
  if (!texto) {
    return { nombre: '1x Pedido', cantidad: 1, textoOriginal: '' };
  }

  const primeraLinea = texto.split(/\r?\n/)[0].trim();
  const cantidad = calcularCantidadBultos(primeraLinea);

  return {
    nombre: texto,
    cantidad,
    textoOriginal: texto
  };
}

/**
 * Determina si una línea o ítem corresponde a un sub-sabor o nota dependiente del ítem anterior
 * (ej: "- 10 pie de limón", "- 10 maracuyá", "- 10 manjar" bajo "1 caja postres (30 unid):")
 */
function esSubItemDe(lineaActual, itemPadreTexto) {
  const actual = String(lineaActual || '').trim();
  const padre = String(itemPadreTexto || '').trim();
  if (!actual || !padre) return false;

  const primeraLineaPadre = padre.split(/\r?\n/)[0].trim();
  const padreTerminaEnDosPuntos = /:\s*$/.test(primeraLineaPadre);
  const padreDeclaraUnidades = /\(\s*\d+\s*(?:unid(?:ades)?|unds?|u\.?)\s*\)/i.test(primeraLineaPadre);
  const padreEsContenedorAgrupable = /(caja|cajita|canasto|canastito|tabla|mix|postres?|surtidos?|variados?|selecci[oó]n|bandeja)/i.test(primeraLineaPadre);

  // Si la línea actual declara explícitamente nuevas cajas o bultos independientes (ej: "2- canapé", "1 caja..."), NO es sub-ítem
  if (/^\d+\s*(?:[-–—*]|[xX]\b)/i.test(actual)) return false;
  if (/^\d+\s*(?:cajas?|cajitas?|bultos?|canastos?|tablas?|bandejas?|bolsas?|paquetes?)\b/i.test(actual)) return false;

  // Caso 1: Línea iniciada con viñeta o guion ("- 10 pie de limón", "• 10 maracuyá", "* 10 manjar")
  if (/^[-–—•*·]\s+.+/.test(actual)) {
    const sinVineta = actual.replace(/^[-–—•*·]\s+/, '').trim();
    // Si después del guion dice "1 caja..." o "2-...", es un ítem principal con viñeta
    if (/^\d+\s*(?:cajas?|cajitas?|bultos?|canastos?|tablas?)\b/i.test(sinVineta)) return false;
    if (padreTerminaEnDosPuntos || padreDeclaraUnidades || padreEsContenedorAgrupable) {
      return true;
    }
    // Nota aclaratoria con guion (ej: "- sin salmón", "- solo champiñón")
    if (/^(?:sin\b|solo\b|s[oó]lo\b|nota\b|obs\b)/i.test(sinVineta)) {
      return true;
    }
  }

  // Caso 2: Nota entre paréntesis en la línea inmediatamente inferior (ej: "(sin salmón)")
  if (/^\([^)]+\)$/.test(actual)) {
    return true;
  }

  // Caso 3: El padre termina en ":" o declara "(30 unid)" y la línea actual es un sabor con cantidad de unidades (ej: "10 pie de limón", "10x maracuyá")
  const actualSinX = actual.replace(/^(\d+)[xX]\s+/, '$1 ');
  if ((padreTerminaEnDosPuntos || padreDeclaraUnidades) && /^\d+\s+/.test(actualSinX) && PATRON_SABOR_DESGLOSE.test(actualSinX)) {
    return true;
  }

  return false;
}

/**
 * Agrupa sub-ítems de sabores o especificaciones dentro de su ítem contenedor padre
 * para evitar que una caja con sabores desglosados se divida en múltiples checkboxes.
 */
export function agruparSubItems(items) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const resultado = [];

  for (const rawItem of items) {
    const textoItem = typeof rawItem === 'string'
      ? rawItem.trim()
      : String(rawItem?.textoOriginal || rawItem?.nombre || '').trim();

    if (!textoItem) continue;

    if (resultado.length > 0) {
      const ultimo = resultado[resultado.length - 1];
      if (esSubItemDe(textoItem, ultimo.nombre)) {
        const subLineaLimpia = textoItem
          .replace(/^(\d+)[xX]\s+/, '$1 ')
          .replace(/^(?!([-–—•*·]|\())\s*/, '- ');
        const nuevoTexto = `${ultimo.nombre}\n${subLineaLimpia}`;
        resultado[resultado.length - 1] = extraerItemDetalle({
          nombre: nuevoTexto,
          cantidad: ultimo.cantidad,
          textoOriginal: nuevoTexto
        });
        continue;
      }
    }

    resultado.push(extraerItemDetalle(rawItem));
  }

  return resultado;
}

/**
 * Verifica si una cadena corresponde estrictamente a una dirección física en Chile
 */
function esDireccionLinea(linea) {
  const texto = String(linea || '').trim();
  if (!texto) return false;

  // Nunca clasificar como dirección una línea que comienza con viñeta de sub-ítem
  if (/^[-–—•*·]\s+/.test(texto)) return false;

  // Nunca clasificar como dirección si empieza con multiplicador de producto ("2-canapé", "1 caja...")
  if (/^(\d+)\s*(?:[-–—*]|[xX]\b|cajas?\b|cajitas?\b|bultos?\b|canastos?\b|tablas?\b|bandejas?\b)/i.test(texto)) {
    return false;
  }

  const comunasYCalles = /\b(calle|avenida|av\.|av\b|pasaje|psje\.?|pje\.?|camino|condominio|parcela|depto\.?|dpto\.?|departamento|block|torre|oficina|las condes|vitacura|lo barnechea|providencia|la reina|ñuñoa|santiago|maip[uú]|peñalol[eé]n|la florida|macul|san miguel|huechuraba|recoleta|independencia|colina|chicureo|pudahuel|quilicura|estaci[oó]n central|cerrillos|lo prado|quinta normal|conchal[ií]|san joaqu[ií]n|la cisterna|san bernardo|puente alto|el bosque|la granja|la pintana|lo espejo|pedro aguirre cerda|cerro navia|renca|peñaflor|talagante|buin|paine|lampa|padre hurtado)\b/i;

  if (comunasYCalles.test(texto) && !PATRON_GASTRONOMICO.test(texto)) {
    return true;
  }

  // Si menciona comuna/calle explícita y no empieza con cantidad de producto
  if (comunasYCalles.test(texto) && !/^\d+/.test(texto)) {
    return true;
  }

  // Patrón de nombre de calle + numeración municipal (2 a 5 dígitos), siempre que NO sea un ítem gastronómico ni empiece con número
  if (!/^\d+/.test(texto) && !PATRON_GASTRONOMICO.test(texto) && /[A-Za-zÁÉÍÓÚáéíóúÑñ]{3,}\s+\d{2,5}\b/.test(texto)) {
    return true;
  }

  return false;
}

/**
 * Determina si una línea corresponde a un producto de catering o nota de producto
 */
function esItemLinea(linea) {
  const texto = String(linea || '').trim();
  if (!texto) return false;

  // Sub-ítem con guion o viñeta
  if (/^[-–—•*·]\s+\d+/.test(texto)) return true;

  // Prefijo numérico de cajas o unidades ("2-canapé", "1 caja...", "120 crostinis")
  if (/^(\d+)\s*[-–—*xX.]/i.test(texto) && !esDireccionLinea(texto)) return true;
  if (/^\d+\s*(?:cajas?|cajitas?|unidades?|unid\.?|und?s?|paquetes?|pks?|bolsas?|bultos?|canastos?|tablas?|bandejas?)\b/i.test(texto)) return true;

  // Cualquier coincidencia con el léxico gastronómico o catálogo de Full Canapé (si no es dirección)
  if (PATRON_GASTRONOMICO.test(texto) && !esDireccionLinea(texto)) return true;

  // Cantidad numérica al inicio seguida de texto que no es dirección ni teléfono
  if (/^\d+\s+[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(texto) && !esDireccionLinea(texto)) return true;

  // Coincidencia directa con nombres del catálogo productos.json
  if (Array.isArray(catalogoProductos)) {
    const lower = texto.toLowerCase();
    if (catalogoProductos.some(prod => lower.includes(prod.toLowerCase()))) {
      return true;
    }
  }

  return false;
}

/**
 * Determina si una línea es estrictamente el nombre de una persona (cliente)
 * y NUNCA un producto de catering, dirección ni instrucción.
 */
function esNombrePersona(linea) {
  const texto = String(linea || '').trim().replace(/[:,-]+$/, '').trim();
  if (!texto || texto.length < 3 || texto.length > 55) return false;

  // Jamás es nombre de persona si contiene términos gastronómicos, direcciones o números
  if (PATRON_GASTRONOMICO.test(texto)) return false;
  if (esItemLinea(texto) || esDireccionLinea(texto)) return false;
  if (/\d/.test(texto)) return false;

  // Excluir instrucciones operativas comunes que no son nombres de personas
  if (/\b(conserjer[ií]a|recepci[oó]n|timbre|port[oó]n|llamar|avisar|entregar|dejar|edificio|condominio|casa|depto|departamento|sin\s+horario|sin\s+tel[eé]fono|pedido)\b/i.test(texto)) {
    return false;
  }

  const soloLetrasYEspacios = /^[A-Za-zÁÉÍÓÚáéíóúÑñüÜ\s.'()-]+$/;
  if (soloLetrasYEspacios.test(texto)) {
    const palabras = texto.split(/\s+/).filter(Boolean);
    return palabras.length >= 1 && palabras.length <= 5;
  }
  return false;
}

function limpiarNombrePersona(linea) {
  return String(linea || '')
    .trim()
    .replace(/^(?:cliente|nombre|contacto|recibe|para)\s*[:=-]\s*/i, '')
    .replace(/[:,-]+$/, '')
    .trim();
}

/**
 * Parser determinista secundario basado en expresiones regulares.
 * Opera como fallback instantáneo y sin conexión si la llamada a la API
 * de Gemini supera el límite de tiempo (11s), no dispone de clave o falla la red.
 */
export function parsearPedidosDeterminista(textoWhatsApp) {
  if (!textoWhatsApp || typeof textoWhatsApp !== 'string') {
    return { pedidos: [] };
  }

  const lineas = textoWhatsApp.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lineas.length === 0) return { pedidos: [] };

  const esInicioPedido = (linea) => {
    const patronDia = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i;
    const patronHora = /\b\d{1,2}[:.]\d{2}\s*(?:a|al|-|–|—|hrs|am|pm)\b/i;
    const patronPedido = /^pedido\s*#?\d+/i;
    return patronDia.test(linea) || (patronHora.test(linea) && !PATRON_GASTRONOMICO.test(linea)) || patronPedido.test(linea);
  };

  const bloques = [];
  let bloqueActual = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (esInicioPedido(linea) && bloqueActual.length > 0) {
      bloques.push(bloqueActual);
      bloqueActual = [linea];
    } else {
      bloqueActual.push(linea);
    }
  }
  if (bloqueActual.length > 0) {
    bloques.push(bloqueActual);
  }

  const esTelefono = (linea) => {
    const soloDigitos = linea.replace(/\D/g, '');
    const tieneIndicadorTel = /\b(tel|fono|whatsapp|wsp|cel)\b|(\+56\s*9|56\s*9\d{4}|(?<!\d)9\s*\d{4}\s*\d{4})/i.test(linea);
    return ((soloDigitos.length >= 8 && soloDigitos.length <= 13 && /^(56|9|\+56)/.test(linea.replace(/\s/g, ''))) || tieneIndicadorTel);
  };

  const esSinTelefono = (linea) => {
    return /^(sin\s+tel[eé]fono|no\s+tiene\s+tel[eé]fono|s\/t|sin\s+fono)\b/i.test(linea);
  };

  const esComplementoDireccion = (linea) => {
    return /^(?:depto\.?|dpto\.?|departamento|casa|torre|block|oficina|of\.?|piso|condominio|lote|parcela)\b/i.test(linea) && !PATRON_GASTRONOMICO.test(linea);
  };

  const pedidos = [];

  for (const bloque of bloques) {
    if (bloque.length === 0) continue;

    let horario = '';
    let nombreCliente = '';
    let direccion = '';
    let telefono = '';
    const itemsRaw = [];

    const lineasRestantes = [...bloque];

    if (esInicioPedido(lineasRestantes[0])) {
      horario = lineasRestantes.shift();
    }

    for (let idx = 0; idx < lineasRestantes.length; idx++) {
      const linea = lineasRestantes[idx];

      if (esSinTelefono(linea)) {
        continue;
      }

      // 1. Etiquetas explícitas de cliente o dirección
      const matchEtiquetaCliente = linea.match(/^(?:cliente|nombre|contacto|recibe)\s*[:=-]\s*(.+)$/i);
      if (matchEtiquetaCliente) {
        nombreCliente = limpiarNombrePersona(matchEtiquetaCliente[1]);
        continue;
      }

      const matchEtiquetaDir = linea.match(/^(?:direcci[oó]n|dir|destino)\s*[:=-]\s*(.+)$/i);
      if (matchEtiquetaDir) {
        direccion = matchEtiquetaDir[1].trim();
        continue;
      }

      // 2. Si ya hay un ítem previo y esta línea es un sub-sabor o nota ("- 10 pie de limón", "(sin salmón)"), agruparlo de inmediato
      if (itemsRaw.length > 0 && esSubItemDe(linea, itemsRaw[itemsRaw.length - 1])) {
        const subLinea = linea.replace(/^(?!([-–—•*·]|\())\s*/, '- ');
        itemsRaw[itemsRaw.length - 1] = `${itemsRaw[itemsRaw.length - 1]}\n${subLinea}`;
        continue;
      }

      // 3. Detección de teléfono (incluyendo líneas mixtas "Nombre + Teléfono")
      if (esTelefono(linea)) {
        if (!telefono) {
          telefono = sanitizarTelefonoChileno(linea);
        }
        // Verificar si en la misma línea venía el nombre del cliente junto al teléfono
        const restoSinTel = linea
          .replace(/(?:tel[eé]fono|tel|fono|whatsapp|wsp|cel)\s*[:=-]?\s*/gi, '')
          .replace(/\+?\d[\d\s()-]{6,}\d/g, '')
          .replace(/^[\s,:/-]+|[\s,:/-]+$/g, '')
          .trim();

        if (restoSinTel) {
          if (!direccion && esDireccionLinea(restoSinTel)) {
            direccion = restoSinTel;
          } else if (!nombreCliente && esNombrePersona(restoSinTel)) {
            nombreCliente = limpiarNombrePersona(restoSinTel);
          }
        }
        continue;
      }

      // 4. Detección prioritaria de ítems gastronómicos (nunca se pierden ni se confunden con nombre o dirección)
      if (esItemLinea(linea)) {
        itemsRaw.push(linea);
        continue;
      }

      // 5. Detección de dirección o complemento de dirección
      if (esDireccionLinea(linea)) {
        if (!direccion) {
          direccion = linea;
        } else if (esComplementoDireccion(linea)) {
          direccion = `${direccion}, ${linea}`;
        } else {
          itemsRaw.push(linea);
        }
        continue;
      }

      if (direccion && esComplementoDireccion(linea)) {
        direccion = `${direccion}, ${linea}`;
        continue;
      }

      // 6. Detección estricta de nombre de cliente (nunca se agrega como ítem de checklist)
      if (esNombrePersona(linea)) {
        if (!nombreCliente) {
          nombreCliente = limpiarNombrePersona(linea);
        }
        continue;
      }

      // 7. Fallback seguro: si aún no hay dirección y no parece producto, asignar a dirección; de lo contrario preservar como ítem
      if (!direccion) {
        direccion = linea;
      } else {
        itemsRaw.push(linea);
      }
    }

    const itemsAgrupados = agruparSubItems(itemsRaw);
    const items = itemsAgrupados.length > 0
      ? itemsAgrupados
      : [extraerItemDetalle('1 pedido')];

    pedidos.push({
      cliente: horario || 'Sin horario',
      nombre_cliente: nombreCliente || '',
      telefono: sanitizarTelefonoChileno(telefono),
      direccion: direccion || 'Sin dirección',
      items
    });
  }

  return { pedidos };
}

// Jerarquía secuencial de modelos para ingesta de ruta (Tier 1: Pro -> Tier 2: Flash -> Tier 3: Determinista)
const MODELOS_CASCADA_GEMINI = ['gemini-2.5-pro', 'gemini-3.5-flash'];

/**
 * Procesa el texto de WhatsApp mediante una arquitectura en cascada secuencial:
 * - Tier 1 (Primario): `gemini-2.5-pro` con salida JSON estructurada para máxima comprensión semántica.
 * - Tier 2 (Secundario): `gemini-3.5-flash` si el modelo Pro retorna error de API o no está disponible.
 * - Tier 3 (Respaldo Local): `parsearPedidosDeterminista` basado en expresiones regulares si fallan ambos niveles remotos.
 * Se ejecuta de forma estrictamente secuencial ante errores explícitos, sin timeouts prematuros ni llamadas concurrentes.
 */
export async function procesarPedidos(textoWhatsApp) {
  if (!textoWhatsApp || typeof textoWhatsApp !== 'string') {
    return { pedidos: [] };
  }

  const prompt = `
    Eres el sistema logístico de despacho rápido de "Full Canapé" en Santiago, Chile.
    Convierte el siguiente texto de WhatsApp en un objeto JSON con la lista de pedidos en el MISMO ORDEN de aparición.

    REGLAS ESTRICTAS DE EXTRACCIÓN (FIDELIDAD 100%):
    1. SEPARACIÓN: Cada pedido inicia con un Día y Rango Horario (ej: "Sábado 18. 08:00 a 09:00"), un encabezado de pedido o los datos del cliente.
    2. HORARIO: El campo "cliente" debe contener exactamente el Día y la Hora (ej: "Sábado 18. 08:00 a 09:00"). Si no se especifica horario, usa "Sin horario".
    3. NOMBRE DEL CLIENTE (PROHIBIDO COMO ITEM): Extrae el nombre de la persona que recibe (ej: "Josefina Bilbao") exclusivamente en "nombre_cliente". JAMÁS agregues el nombre del cliente dentro del arreglo "items". Si no hay nombre de persona, usa "".
    4. DIRECCIÓN: La dirección completa (calle, número, depto, comuna). Si no aparece dirección, usa "Sin dirección".
    5. TELÉFONO: Extrae el número de teléfono móvil chileno. Si no contiene teléfono, asigna "".
    6. ITEMS (PROHIBIDO OMITIR PRODUCTOS): Incluye TODOS los productos de catering del pedido sin excepción.
       - Especificaciones especiales: Conserva notas como "canapé sin salmón", "solo crostinis de champiñón", etc. íntegramente dentro de "nombre".
       - Cantidades en unidades totales: Si un ítem se indica en unidades totales (ej: "120 crostinis champiñón"), NO lo descartes ni separes el número: guarda la etiqueta completa "120 crostinis champiñón" en "nombre" y asigna "cantidad": 1 (1 bulto).
       - Agrupación de postres y sub-sabores: Cuando un producto tenga sub-sabores listados debajo con guiones o viñetas (ej: "1 caja postres (30 unid):" seguido de "- 10 pie de limón", "- 10 maracuyá", "- 10 manjar"), agrúpalo SIEMPRE como UN SOLO elemento en "items" con "cantidad": 1 y pon el título principal y los sabores separados por saltos de línea ("\\n") dentro de "nombre". NUNCA dividas los sabores de una misma caja en ítems separados.

    Texto a procesar:
    ${textoWhatsApp}
  `;

  if (!genAI) {
    console.warn('API Key de Gemini no detectada. Ejecutando Nivel 3 (parser determinista local).');
    const fallback = parsearPedidosDeterminista(textoWhatsApp);
    return normalizarPedidos(fallback);
  }

  for (let i = 0; i < MODELOS_CASCADA_GEMINI.length; i++) {
    const nombreModelo = MODELOS_CASCADA_GEMINI[i];
    try {
      const model = genAI.getGenerativeModel({
        model: nombreModelo,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schemaPedidos,
          temperature: 0.1
        }
      });

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const jsonTexto = response.text();
      const parsedData = JSON.parse(jsonTexto);

      if (parsedData?.pedidos && Array.isArray(parsedData.pedidos) && parsedData.pedidos.length > 0) {
        return normalizarPedidos(parsedData);
      }

      throw new Error(`RESPUESTA_VACIA_${nombreModelo}`);
    } catch (error) {
      console.warn(`Nivel ${i + 1} (${nombreModelo}) no disponible o con error (${error.message}). Avanzando al siguiente nivel de ingesta.`);
    }
  }

  console.warn('Todos los niveles remotos de Gemini fallaron. Ejecutando Nivel 3 (parser determinista local).');
  const fallback = parsearPedidosDeterminista(textoWhatsApp);
  return normalizarPedidos(fallback);
}

/**
 * Normaliza y sanitiza los campos de los pedidos procesados.
 * Garantiza que el nombre del cliente nunca se filtre como ítem y que los sub-sabores queden agrupados.
 */
export function normalizarPedidos(data) {
  if (!data || !Array.isArray(data.pedidos)) {
    return { pedidos: [] };
  }

  const pedidosNormalizados = data.pedidos.map(p => {
    let nombreCliente = limpiarNombrePersona(p.nombre_cliente || '');
    const rawItems = Array.isArray(p.items) && p.items.length > 0 ? p.items : [];

    // Filtrar cualquier ítem que sea en realidad el nombre del cliente
    const itemsSinCliente = [];
    for (const rawIt of rawItems) {
      const textoIt = typeof rawIt === 'string'
        ? rawIt.trim()
        : String(rawIt?.textoOriginal || rawIt?.nombre || '').trim();
      const textoSinPrefijo = textoIt.replace(/^1[xX]\s+/i, '').trim();

      if (!textoSinPrefijo) continue;

      if (nombreCliente && textoSinPrefijo.toLowerCase() === nombreCliente.toLowerCase()) {
        continue;
      }

      if (!nombreCliente && esNombrePersona(textoSinPrefijo) && rawItems.length > 1) {
        nombreCliente = limpiarNombrePersona(textoSinPrefijo);
        continue;
      }

      itemsSinCliente.push(rawIt);
    }

    const itemsAgrupados = agruparSubItems(itemsSinCliente);
    const items = itemsAgrupados.length > 0
      ? itemsAgrupados
      : [extraerItemDetalle('1 pedido')];

    return {
      cliente: p.cliente || 'Sin horario',
      nombre_cliente: nombreCliente,
      telefono: sanitizarTelefonoChileno(p.telefono || ''),
      direccion: p.direccion || 'Sin dirección',
      items
    };
  });

  return { pedidos: pedidosNormalizados };
}
