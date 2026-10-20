export async function generateGeminiContent({
  systemInstruction,
  parts,
  responseMimeType = "text/plain",
  maxOutputTokens,
}: any) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("Configure GEMINI_API_KEY nos secrets do Supabase.");
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType, ...(maxOutputTokens ? { maxOutputTokens } : {}) },
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
          ? "A cota do Gemini foi atingida."
          : `O Gemini não concluiu a solicitação (${response.status}).`,
      );
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text ?? "")
      .join("");
    if (!text) throw new Error("A API do Gemini respondeu sem conteúdo.");
    return text;
  }
  throw new Error("O Gemini está temporariamente sobrecarregado.");
}
