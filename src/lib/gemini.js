import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI("AIzaSyCfYSvl5U8Dd5Q8PfXwHal2tc_bR5rqRGg");

export async function procesarPedidos(textoWhatsApp) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // Prompt ultraligero: Solo lectura y extracción, sin razonamiento geográfico.
  const prompt = `
    Eres el sistema de despacho rápido de "Full Canapé".
    Convierte este texto en un JSON con la lista de pedidos exactamente en el MISMO ORDEN en el que aparecen.

    REGLAS ESTRICTAS:
    1. TELÉFONO COMO CLIENTE: Extrae el número de teléfono del cliente. Si el texto dice "Direccionales dada" o no hay un nombre claro, usa el número de teléfono en el campo "cliente".
    2. FORMATO TELÉFONO: Crea un campo "telefono" solo con números (ej: "56912345678"). Si no encuentras teléfono, déjalo vacío "".
    3. ITEMS: Agrupa SIEMPRE el producto principal con sus sabores en UNA SOLA LÍNEA dentro del array 'items'. NUNCA separes los sabores en items distintos.
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

    const inicio = text.indexOf('{');
    const fin = text.lastIndexOf('}') + 1;
    const jsonLimpio = text.substring(inicio, fin);
    
    return JSON.parse(jsonLimpio);
  } catch (error) {
    console.error("Error en Gemini:", error);
    throw error;
  }
}