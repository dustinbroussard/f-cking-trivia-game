import { GoogleGenAI, Type } from "@google/genai";
import { TriviaQuestion } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const questionSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          question: { type: Type.STRING },
          choices: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          answerIndex: { type: Type.INTEGER },
          correctQuip: { type: Type.STRING },
          wrongAnswerQuips: {
            type: Type.OBJECT,
            properties: {
              "0": { type: Type.STRING },
              "1": { type: Type.STRING },
              "2": { type: Type.STRING },
              "3": { type: Type.STRING }
            }
          }
        },
        required: ["category", "question", "choices", "answerIndex", "correctQuip", "wrongAnswerQuips"]
      }
    }
  }
};

export async function generateQuestions(categories: string[], countPerCategory: number = 3): Promise<TriviaQuestion[]> {
  const prompt = `Generate ${countPerCategory} multiple choice trivia questions for each of the following categories: ${categories.join(", ")}. 
  The tone must be irreverent, sarcastic, and funny (like "You Don't Know Jack"). 
  Provide a smug/celebratory quip for the correct answer and a unique sarcastic roast for each wrong answer.
  Ensure the questions are interesting but not impossible.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: questionSchema as any
      }
    });

    const data = JSON.parse(response.text || '{"questions": []}');
    return data.questions.map((q: any, index: number) => ({
      ...q,
      id: `${Date.now()}-${index}`,
      used: false
    }));
  } catch (error) {
    console.error("Error generating questions:", error);
    return [];
  }
}
