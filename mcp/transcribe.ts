// Audio/video transcription for attachments (WhatsApp voice notes, recordings).
// Claude does not take audio from a connector, so the file goes to Gemini, the
// same provider the app already uses for meeting minutes. Enabled only when the
// GEMINI_API_KEY secret is configured on the connector.
import type { Transcriber } from "./documents.ts";

/** Gemini accepts up to 20 MB of inline data per request. */
const INLINE_LIMIT = 19 * 1024 * 1024;

const PROMPT = `Transcreva fielmente este arquivo em português do Brasil.
- Escreva exatamente o que é dito, sem resumir nem corrigir o conteúdo.
- Quando houver mais de uma pessoa falando, separe as falas (Pessoa 1, Pessoa 2…).
- Marque trechos inaudíveis como [inaudível].
- Se for vídeo, descreva também, entre colchetes e em poucas palavras, textos ou documentos que apareçam na tela.
- Se não houver fala, responda apenas [sem fala].`;

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

export function geminiTranscriber(apiKey: string, model = "gemini-3.5-flash"): Transcriber {
  return async (bytes, mimeType) => {
    if (bytes.length > INLINE_LIMIT)
      throw new Error("o arquivo passa de 19 MB, acima do limite de transcrição");
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { inline_data: { mime_type: mimeType, data: toBase64(bytes) } },
                  { text: PROMPT },
                ],
              },
            ],
          }),
        },
      );
      if (response.status === 503 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        continue;
      }
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "a cota do Gemini foi atingida"
            : `o Gemini respondeu com erro ${response.status}`,
        );
      const result = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = result.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!text) throw new Error("o Gemini não devolveu a transcrição");
      return text;
    }
    throw new Error("o Gemini está temporariamente sobrecarregado");
  };
}
