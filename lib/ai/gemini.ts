import { GoogleGenAI } from '@google/genai';

export const CHAT_MODEL = 'gemini-2.5-flash';
export const EMBED_MODEL = 'gemini-embedding-001';

export type GenerateArgs = {
  system: string;
  user: string;
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * Gemini 2.5 models reason before answering, and those thinking tokens count
   * against maxOutputTokens. Left enabled with a modest cap, thinking consumes
   * the whole budget and the visible answer arrives truncated mid-sentence.
   *
   * Default 0 (disabled): summarization and grounded extraction are not tasks
   * that benefit from long deliberation, and disabling it is both faster and
   * cheaper. Only 2.5 Flash accepts 0; Pro has a minimum budget.
   */
  thinkingBudget?: number;
};
export type Generate = (args: GenerateArgs) => Promise<string>;

let client: GoogleGenAI | null = null;

export function getAi(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function isRetryable(error: unknown): boolean {
  const probe = String(
    (error as { status?: unknown })?.status ?? (error as Error)?.message ?? error,
  );
  return /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE/i.test(probe);
}

/** Exponential backoff with jitter. The free tier rate-limits aggressively. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts - 1) throw error;
      const delay = 600 * 2 ** attempt + Math.random() * 400;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export const geminiGenerate: Generate = ({
  system, user, maxOutputTokens = 2048, temperature = 0.2, thinkingBudget = 0,
}) =>
  withRetry(async () => {
    const response = await getAi().models.generateContent({
      model: CHAT_MODEL,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      config: {
        systemInstruction: system,
        temperature,
        maxOutputTokens,
        thinkingConfig: { thinkingBudget },
      },
    });

    // Truncation is silent otherwise: the response still resolves, just cut off
    // mid-sentence. Surfacing it makes a too-small budget a visible bug.
    const finish = response.candidates?.[0]?.finishReason;
    if (finish && finish !== 'STOP') {
      console.warn(`Gemini finished with reason ${finish}; output may be incomplete`);
    }

    return (response.text ?? '').trim();
  });
