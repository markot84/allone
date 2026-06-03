import { getAuth } from 'firebase/auth';
import { FUNCTIONS_BASE_URL, getAppCheckHeader } from '../config/firebase';

const PROXY_URL = `${FUNCTIONS_BASE_URL.replace(/\/$/, '')}/geminiProxy`;

export interface GeminiChatTurn {
  role: 'user' | 'model';
  text: string;
}

export interface GeminiProxyParams {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  /** Ιστορικό συνομιλίας για multi-turn (η Nilia). Το πρώτο 'user' turn ορίζει την έναρξη. */
  history?: GeminiChatTurn[];
  /** Ενεργό brand — για per-brand λογιστική κόστους (ai_usage) στον server. */
  brandId?: string;
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
  const appCheck = await getAppCheckHeader();

  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...appCheck,
    },
    body: JSON.stringify(params),
  });

  if (response.status === 429) {
    const err = await response.json().catch(() => ({ error: 'Too many requests' }));
    throw new Error((err as { error?: string }).error ?? 'Rate limit exceeded — δοκίμασε ξανά σε λίγο.');
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((err as { error?: string }).error ?? 'Gemini proxy error');
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}
