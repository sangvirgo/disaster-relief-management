export function getGeminiApiKeys(env: Record<string, string | undefined> = process.env): string[] {
  const configuredKeys = env.GEMINI_API_KEYS?.trim();
  if (configuredKeys) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configuredKeys) as unknown;
    } catch {
      throw new Error('GEMINI_API_KEYS must be a JSON array of non-empty strings.');
    }
    if (!Array.isArray(parsed) || parsed.some((key) => typeof key !== 'string' || !key.trim())) {
      throw new Error('GEMINI_API_KEYS must be a JSON array of non-empty strings.');
    }
    const keys = [...new Set(parsed.map((key: string) => key.trim()))];
    if (keys.length) return keys;
  }

  const legacyKey = env.GEMINI_API_KEY?.trim();
  return legacyKey ? [legacyKey] : [];
}

export function hasGeminiApiKeys(env: Record<string, string | undefined> = process.env): boolean {
  try {
    return getGeminiApiKeys(env).length > 0;
  } catch {
    return false;
  }
}
