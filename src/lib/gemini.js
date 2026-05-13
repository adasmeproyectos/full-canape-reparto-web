import { GoogleGenerativeAI } from "@google/generative-ai";

// Ahora lee la llave desde el archivo .env seguro
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

export async function procesarPedidos(textoWhatsApp) {
// ... el resto de tu código queda exactamente igual
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Usamos flash para máxima velocidad

  const prompt = `
    Eres el sistema de despacho rápido de "Full Canapé".
    Convierte el siguiente texto de WhatsApp en un JSON con la lista de pedidos en el MISMO ORDEN en el que aparecen.

    REGLAS ESTRICTAS DE EXTRACCIÓN (NUEVO FORMATO SIN NOMBRES):
    1. SEPARACIÓN: Los pedidos están separados por espacios en blanco. Cada pedido inicia con un Día y Rango Horario (Ej: "Sábado 18. 08:00 a 09:00").
    2. HORARIO COMO CLIENTE: Como ya no se proveen nombres de clientes, debes poner el Día y la Hora exactamente como aparecen en el texto dentro del campo "cliente".
    3. DIRECCIÓN: La dirección es SIEMPRE la primera línea de texto que aparece justo debajo del horario. Cópiala completa (calle, número, depto, comuna).
    4. TELÉFONO: Extrae el número de teléfono incluyendo el codigo de país (ej: "56912345678"). Si un pedido NO TIENE teléfono, deja el campo vacío "".
    5. ITEMS: Todo lo que esté debajo del teléfono (o debajo de la dirección si no hay teléfono) son los productos. Si un producto tiene subtipos o sabores en las líneas de abajo, agrúpalos en una sola línea.

    Responde ÚNICAMENTE el JSON puro con esta estructura:
    {
      "pedidos": [ 
        { 
          "cliente": "string (Día y Horario)", 
          "telefono": "string",
          "direccion": "string", 
          "items": ["string"] 
        } 
      ]
    }

    Texto a procesar: ${textoWhatsApp}
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    const inicioJSON = text.indexOf('{');
    const finJSON = text.lastIndexOf('}') + 1;
    
    if (inicioJSON === -1 || finJSON === 0) {
      throw new Error("Gemini no devolvió un JSON válido.");
    }

    const jsonLimpio = text.substring(inicioJSON, finJSON);
    return JSON.parse(jsonLimpio);
    
  } catch (error) {
    console.error("Error crítico en Gemini:", error);
    return { pedidos: [] };
  }
}