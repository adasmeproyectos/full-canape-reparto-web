import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { sanitizarTelefonoChileno } from './sanitizer.js';

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
            description: 'Nombre de la persona o cliente que recibe el pedido (ej: "Josefina Bilbao"). Cadena vacía si no existe.'
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
            description: 'Lista de productos o bultos a entregar en esta parada con su cantidad',
            items: {
              type: SchemaType.OBJECT,
              properties: {
                nombre: {
                  type: SchemaType.STRING,
                  description: 'Nombre del producto manteniendo el prefijo de cantidad si existe (ej: "3-croissant", "2-canapé mix 3")'
                },
                cantidad: {
                  type: SchemaType.INTEGER,
                  description: 'Cantidad numérica de cajas o unidades para este producto (ej: 3 para "3-croissant", 1 por defecto)'
                },
                textoOriginal: {
                  type: SchemaType.STRING,
                  description: 'Línea de texto original tal como venía en el mensaje'
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

/**
 * Normaliza y extrae la cantidad numérica y descripción de un ítem de pedido.
 * Soporta entradas tanto en formato string como en objeto.
 */
export function extraerItemDetalle(item) {
  if (!item) {
    return { nombre: '1x Pedido', cantidad: 1, textoOriginal: '' };
  }

  if (typeof item === 'object') {
    const cantidad = Number(item.cantidad) > 0 ? Number(item.cantidad) : 1;
    let nombre = String(item.nombre || item.textoOriginal || 'Ítem').trim();
    const textoOriginal = String(item.textoOriginal || item.nombre || '').trim();

    const tienePrefijo = /^(\d+)\s*[-–—*xX.]/i.test(nombre) || /^\d+\s+/i.test(nombre);
    if (!tienePrefijo && cantidad > 1) {
      nombre = `${cantidad}x ${nombre}`;
    }

    return {
      nombre,
      cantidad,
      textoOriginal: textoOriginal || nombre
    };
  }

  const texto = String(item).trim();
  if (!texto) {
    return { nombre: '1x Pedido', cantidad: 1, textoOriginal: '' };
  }

  // Regex para prefijos de cantidad:
  // "3-croissant", "2x canapé mix 3", "2 x canapé", "3 cajas croissant", "2- canastos dulces", "3 croissant"
  const regexPrefijo = /^(\d+)\s*(?:[-–—*.]|[xX]\s*|(?:cajas?|unidades?|und?s?|paquetes?|pks?|bolsas?|bultos?)\s*(?:de\s+)?|\s+)\s*(.+)$/i;
  const match = texto.match(regexPrefijo);

  if (match) {
    const cantidad = parseInt(match[1], 10) || 1;
    return {
      nombre: texto,
      cantidad,
      textoOriginal: texto
    };
  }

  return {
    nombre: texto,
    cantidad: 1,
    textoOriginal: texto
  };
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
    const patronHora = /\b\d{1,2}[:.]\d{2}\s*(?:a|-|hrs|am|pm|\/)?/i;
    const patronPedido = /^pedido\s*#?\d+/i;
    return patronDia.test(linea) || (patronHora.test(linea) && !linea.toLowerCase().includes('canap')) || patronPedido.test(linea);
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
    const tieneIndicadorTel = /^(tel|fono|whatsapp|wsp|cel|\+56|569|9\d{8})/i.test(linea);
    return ((soloDigitos.length >= 8 && soloDigitos.length <= 13 && /^(56|9|\+56)/.test(linea.replace(/\s/g, ''))) || tieneIndicadorTel);
  };

  const esSinTelefono = (linea) => {
    return /^(sin\s+tel[eé]fono|no\s+tiene\s+tel[eé]fono|s\/t|sin\s+fono)\b/i.test(linea);
  };

  const esItemLinea = (linea) => {
    if (/^(\d+)\s*[-–—*xX.]/i.test(linea)) return true;
    if (/^\d+\s*(?:cajas?|unidades?|und?s?|paquetes?|pks?|bolsas?|bultos?)\b/i.test(linea)) return true;
    if (/(canap[eé]|croissant|brocheta|canasto|quiche|empanada|postre|tabla|bollo|dulce|crostini|bocado|churrasco|frica|picoteo|mini\s+bocado|mil\s+hojas|camar[oó]n|tapado|sandwich)/i.test(linea)) return true;
    return false;
  };

  const esDireccionLinea = (linea) => {
    const comunasYCalles = /(calle|avenida|av\.?|pasaje|psje\.?|condominio|depto\.?|dpto\.?|casa|las condes|vitacura|lo barnechea|providencia|la reina|ñuñoa|santiago|maip[uú]|peñalol[eé]n|la florida|macul|san miguel|huechuraba|recoleta|independencia|colina|chicureo|pudahuel|quilicura|estaci[oó]n central|cerrillos|lo prado|quinta normal|conchal[ií]|san joaqu[ií]n|la cisterna|san bernardo|puente alto)/i;
    if (comunasYCalles.test(linea)) return true;
    if (/[a-záéíóúñ\s]{3,}\s+\d{2,5}\b/i.test(linea)) return true;
    return false;
  };

  const esNombrePersona = (linea) => {
    if (esTelefono(linea) || esSinTelefono(linea) || esItemLinea(linea) || esDireccionLinea(linea) || esInicioPedido(linea)) {
      return false;
    }
    const soloLetrasYEspacios = /^[A-Za-zÁÉÍÓÚáéíóúÑñüÜ\s.'-]+$/;
    if (soloLetrasYEspacios.test(linea) && linea.length >= 3 && linea.length <= 50) {
      const palabras = linea.split(/\s+/).filter(Boolean);
      return palabras.length >= 1 && palabras.length <= 5;
    }
    return false;
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

      const matchEtiquetaCliente = linea.match(/^(?:cliente|nombre|contacto)\s*[:=-]\s*(.+)$/i);
      if (matchEtiquetaCliente) {
        nombreCliente = matchEtiquetaCliente[1].trim();
        continue;
      }

      const matchEtiquetaDir = linea.match(/^(?:direcci[oó]n|dir|destino)\s*[:=-]\s*(.+)$/i);
      if (matchEtiquetaDir) {
        direccion = matchEtiquetaDir[1].trim();
        continue;
      }

      if (esTelefono(linea)) {
        if (!telefono) {
          telefono = sanitizarTelefonoChileno(linea);
        }
        continue;
      }

      if (esItemLinea(linea)) {
        itemsRaw.push(linea);
        continue;
      }

      if (esDireccionLinea(linea) && !direccion) {
        direccion = linea;
        continue;
      }

      if (esNombrePersona(linea) && !nombreCliente) {
        nombreCliente = linea;
        continue;
      }

      if (!direccion) {
        direccion = linea;
      } else {
        itemsRaw.push(linea);
      }
    }

    const items = itemsRaw.length > 0
      ? itemsRaw.map(it => extraerItemDetalle(it))
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

/**
 * Procesa el texto de WhatsApp utilizando Gemini con Structured Outputs nativos.
 * Implementa timeout de 11 segundos y fallback determinista instantáneo.
 */
export async function procesarPedidos(textoWhatsApp) {
  if (!textoWhatsApp || typeof textoWhatsApp !== 'string') {
    return { pedidos: [] };
  }

  const prompt = `
    Eres el sistema logístico de despacho rápido de "Full Canapé" en Santiago, Chile.
    Convierte el siguiente texto de WhatsApp en un objeto JSON con la lista de pedidos en el MISMO ORDEN de aparición.

    REGLAS ESTRICTAS DE EXTRACCIÓN:
    1. SEPARACIÓN: Cada pedido inicia con un Día y Rango Horario (ej: "Sábado 18. 08:00 a 09:00"), un encabezado de pedido o el nombre del cliente.
    2. HORARIO: El campo "cliente" debe contener exactamente el Día y la Hora (ej: "Sábado 18. 08:00 a 09:00"). Si no se especifica horario, usa "Sin horario".
    3. NOMBRE DEL CLIENTE: Extrae el nombre de la persona o contacto (ej: "Josefina Bilbao") en el campo "nombre_cliente". Si no aparece ningún nombre de persona en el pedido, asigna cadena vacía "".
    4. DIRECCIÓN: La dirección completa (calle, número, depto, comuna). Si no aparece dirección, usa "Sin dirección".
    5. TELÉFONO: Extrae el número de teléfono móvil chileno. Si no contiene teléfono, asigna cadena vacía "".
    6. ITEMS: Lista de productos o bultos de la parada. Cada elemento debe ser un objeto:
       - "nombre": descripción del producto manteniendo el prefijo numérico visible (ej: "1-Canasto", "2-canapé mix 3", "3-croissant").
       - "cantidad": número entero con la cantidad de cajas o unidades (ej: 1, 2, 3). Si no se especifica número, asigna 1.
       - "textoOriginal": texto original tal como aparece en la línea.

    Texto a procesar:
    ${textoWhatsApp}
  `;

  // Si no hay cliente de Gemini configurado, ejecutar fallback determinista de inmediato
  if (!genAI) {
    console.warn('API Key de Gemini no detectada. Procesando con parser determinista.');
    const fallback = parsearPedidosDeterminista(textoWhatsApp);
    return normalizarPedidos(fallback);
  }

  try {
    // Modelo preferido: gemini-3.5-flash (baja latencia y soporte nativo de structured output)
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schemaPedidos,
        temperature: 0.1
      }
    });

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('TIMEOUT_GEMINI')), 11000);
    });

    let result;
    try {
      const aiPromise = model.generateContent(prompt);
      result = await Promise.race([aiPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }

    const response = await result.response;
    const jsonTexto = response.text();
    const parsedData = JSON.parse(jsonTexto);

    if (parsedData?.pedidos && Array.isArray(parsedData.pedidos) && parsedData.pedidos.length > 0) {
      return normalizarPedidos(parsedData);
    }

    throw new Error('RESPUESTA_VACIA_GEMINI');
  } catch (error) {
    console.warn('Fallo en procesamiento con Gemini AI (' + error.message + '). Ejecutando parser determinista de respaldo.');
    const fallback = parsearPedidosDeterminista(textoWhatsApp);
    return normalizarPedidos(fallback);
  }
}

/**
 * Normaliza y sanitiza los campos de los pedidos procesados
 */
export function normalizarPedidos(data) {
  if (!data || !Array.isArray(data.pedidos)) {
    return { pedidos: [] };
  }

  const pedidosNormalizados = data.pedidos.map(p => {
    const rawItems = Array.isArray(p.items) && p.items.length > 0 ? p.items : ['1 pedido'];
    const items = rawItems.map(it => extraerItemDetalle(it));

    return {
      cliente: p.cliente || 'Sin horario',
      nombre_cliente: (p.nombre_cliente || '').trim(),
      telefono: sanitizarTelefonoChileno(p.telefono || ''),
      direccion: p.direccion || 'Sin dirección',
      items
    };
  });

  return { pedidos: pedidosNormalizados };
}