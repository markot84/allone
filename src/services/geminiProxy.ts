import { getAuth } from 'firebase/auth';

const PROXY_URL =
  'https://europe-west1-performance-plus-4a5b2.cloudfunctions.net/geminiProxy';

export interface GeminiProxyParams {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
}

/**
 * Calls the server-side Gemini proxy Cloud Function.
 * The Gemini API key never leaves the server.
 */
export async function callGemini(params: GeminiProxyParams): Promise<string> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');

  const idToken = await user.getIdToken();

  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((err as { error?: string }).error ?? 'Gemini proxy error');
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}
