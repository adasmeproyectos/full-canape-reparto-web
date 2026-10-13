import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { sanitizarTelefonoChileno } from './sanitizer';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
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
            description: 'Día y rango horario exactamente como aparecen en el texto'
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
            description: 'Lista de productos o canapés a entregar en esta parada',
            items: {
              type: SchemaType.STRING
            }
          }
        },
        required: ['cliente', 'telefono', 'direccion', 'items']
      }
    }
  },
  required: ['pedidos']
};

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

  const bloques = [];
  let bloqueActual = [];

  // Expresión para identificar el inicio de un pedido (Día de la semana o rango horario)
  const esInicioPedido = (linea) => {
    const patronDia = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i;
    const patronHora = /\b\d{1,2}[:.]\d{2}\s*(?:a|-|hrs|am|pm|\/)?/i;
    const patronPedido = /^pedido\s*#?\d+/i;
    return patronDia.test(linea) || (patronHora.test(linea) && !linea.toLowerCase().includes('canap')) || patronPedido.test(linea);
  };

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

  const pedidos = [];

  for (const bloque of bloques) {
    if (bloque.length === 0) continue;
    const cliente = bloque[0]; // Día y Horario
    let direccion = '';
    let telefono = '';
    const items = [];

    let idx = 1;
    if (idx < bloque.length) {
      direccion = bloque[idx];
      idx++;
    }

    while (idx < bloque.length) {
      const linea = bloque[idx];

      // Descartar anotaciones explícitas de falta de teléfono
      const esSinTelefono = /^(sin\s+tel[eé]fono|no\s+tiene\s+tel[eé]fono|s\/t|sin\s+fono)\b/i.test(linea);
      if (esSinTelefono) {
        idx++;
        continue;
      }

      const soloDigitos = linea.replace(/\D/g, '');
      const tieneIndicadorTel = /^(tel|fono|whatsapp|wsp|cel|\+56|569|9\d{8})/i.test(linea);

      if ((soloDigitos.length >= 8 && soloDigitos.length <= 13 && /^(56|9|\+56)/.test(linea.replace(/\s/g, ''))) || tieneIndicadorTel) {
        telefono = sanitizarTelefonoChileno(linea);
      } else {
        items.push(linea);
      }
      idx++;
    }

    if (direccion || items.length > 0) {
      pedidos.push({
        cliente: cliente || 'Sin horario',
        telefono: sanitizarTelefonoChileno(telefono),
        direccion: direccion || 'Sin dirección',
        items: items.length > 0 ? items : ['1 pedido']
      });
    }
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
    1. SEPARACIÓN: Cada pedido inicia con un Día y Rango Horario (ej: "Sábado 18. 08:00 a 09:00").
    2. HORARIO COMO CLIENTE: El campo "cliente" debe contener exactamente el Día y la Hora.
    3. DIRECCIÓN: La primera línea justo debajo del horario es siempre la dirección completa (calle, número, depto, comuna).
    4. TELÉFONO: Extrae el número de teléfono móvil chileno. Si no contiene teléfono, asigna cadena vacía "".
    5. ITEMS: Cada producto solicitado bajo el teléfono o dirección. Agrupa subtipos y sabores en una sola línea.

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
function normalizarPedidos(data) {
  if (!data || !Array.isArray(data.pedidos)) {
    return { pedidos: [] };
  }

  const pedidosNormalizados = data.pedidos.map(p => ({
    cliente: p.cliente || 'Sin horario',
    telefono: sanitizarTelefonoChileno(p.telefono || ''),
    direccion: p.direccion || 'Sin dirección',
    items: Array.isArray(p.items) && p.items.length > 0 ? p.items : ['1 pedido']
  }));

  return { pedidos: pedidosNormalizados };
}