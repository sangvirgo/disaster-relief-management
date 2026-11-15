import { getGeminiApiKeys, hasGeminiApiKeys } from '../src/ai/gemini-api-keys';

describe('Gemini API key configuration', () => {
  it('reads and de-duplicates a JSON key array in its configured order', () => {
    expect(getGeminiApiKeys({ GEMINI_API_KEYS: '[" key-a ","key-b","key-a"]', GEMINI_API_KEY: 'legacy' }))
      .toEqual(['key-a', 'key-b']);
  });

  it('uses the legacy single key when the array is empty or absent', () => {
    expect(getGeminiApiKeys({ GEMINI_API_KEYS: '[]', GEMINI_API_KEY: 'legacy' })).toEqual(['legacy']);
    expect(getGeminiApiKeys({ GEMINI_API_KEY: ' legacy ' })).toEqual(['legacy']);
    expect(getGeminiApiKeys({})).toEqual([]);
  });

  it('rejects malformed arrays without exposing key contents', () => {
    expect(() => getGeminiApiKeys({ GEMINI_API_KEYS: '["private-key",3]' })).toThrow(/JSON array/u);
    expect(hasGeminiApiKeys({ GEMINI_API_KEYS: '["private-key",3]' })).toBe(false);
  });
});
