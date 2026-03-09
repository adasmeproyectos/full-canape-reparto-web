import { GoogleGenerativeAI } from "@google/generative-ai";

// Ahora lee la llave desde el archivo .env seguro
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

export async function procesarPedidos(textoWhatsApp) {
// ... el resto de tu código queda exactamente igual
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Usamos flash para máxima velocidad

  const prompt = `
    Eres el sistema de despacho rápido de "Full Canapé".
    Convierte este texto en un JSON con la lista de pedidos exactamente en el MISMO ORDEN en el que aparecen.

    REGLAS ESTRICTAS DE EXTRACCIÓN:
    1. TELÉFONO COMO CLIENTE: Extrae el número de teléfono del cliente (solo números). Si el texto dice "Direccionales dada" o no hay un nombre claro, usa el número de teléfono en el campo "cliente".
    2. FORMATO TELÉFONO: Crea un campo "telefono" solo con números, incluyendo código de país (ej: "56912345678"). Si no encuentras teléfono, déjalo vacío "".
    3. ITEMS: Agrupa SIEMPRE el producto principal con sus sabores en UNA SOLA LÍNEA dentro del array 'items'.
       - Ejemplo CORRECTO: ["100 canapés surtidos (50 ave pimiento, 50 choclillo)"]

    Responde ÚNICAMENTE el JSON puro con esta estructura:
    {
      "pedidos": [ 
        { 
          "cliente": "string (Nombre o Teléfono)", 
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

    // 🛡️ SOLUCIÓN AL ERROR DE USO: Limpiador robusto de JSON
    // Buscamos el primer '{' y el último '}' para ignorar cualquier texto extra (como ```json)
    const inicioJSON = text.indexOf('{');
    const finJSON = text.lastIndexOf('}') + 1;
    
    if (inicioJSON === -1 || finJSON === 0) {
      throw new Error("Gemini no devolvió un JSON válido.");
    }

    const jsonLimpio = text.substring(inicioJSON, finJSON);
    
    return JSON.parse(jsonLimpio);
  } catch (error) {
    console.error("Error crítico en Gemini:", error);
    // Devolvemos una estructura vacía para evitar que la app explote
    return { pedidos: [] };
  }
}