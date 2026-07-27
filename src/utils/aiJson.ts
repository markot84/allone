export function extractJsonObject(text: string): string | null {
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Continue with object extraction below.
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let candidate = cleaned.slice(start, end + 1);
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    // Gemini may occasionally emit literal line breaks inside JSON strings.
  }

  candidate = candidate.replace(/(?<=:\s*"[^"]*)\n/g, '\\n');
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export function parseJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(text: string): T | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}
