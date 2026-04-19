import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Suggests column mapping based on source headers and target fields.
 */
export async function suggestMapping(headers: string[], targetFields: any[]) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        Analyze the following CSV headers from a French accounting export (likely Sage 1000).
        Headers: ${JSON.stringify(headers)}
        
        Target FEC fields: ${JSON.stringify(targetFields.map(f => ({ key: f.key, label: f.label })))}
        
        Return a JSON object mapping EACH target FEC field key to the most likely source header name.
        If no header matches, use "__ignore__".
        Use your knowledge of French accounting terminology.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          additionalProperties: { type: Type.STRING }
        }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini Suggestion Error:", error);
    return null;
  }
}

/**
 * Analyzes anomalies found in a FEC file.
 */
export async function analyzeAnomalies(anomalies: any) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        You are a French accounting expert. Analyze the following anomalies found in a FEC file:
        ${JSON.stringify(anomalies)}
        
        Provide a concise, pedagogical analysis in French explaining:
        1. The potential risks for the company (fiscal, organizational).
        2. Immediate corrective actions.
        3. How to avoid these in Sage 1000 settings.
      `,
      config: {
        systemInstruction: "Tu es un expert-comptable français rigoureux et pédagogue.",
      }
    });

    return response.text;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Désolé, l'analyse automatique des anomalies a échoué.";
  }
}
