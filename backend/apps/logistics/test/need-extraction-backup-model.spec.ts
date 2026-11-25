import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { needExtractionGemini } from '../src/need-extraction/need-extraction-sweep.service';

const modelOf = (url: unknown) => /\/models\/([^:]+):generateContent/u.exec(decodeURIComponent(String(url)))?.[1];
const ok = (value: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }));

describe('need extraction Gemini backup model', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks the backup model when the primary model is rate-limited', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      modelOf(url) === 'primary' ? new Response('{}', { status: 429 }) : ok({ items: [] }));
    const gemini = needExtractionGemini({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'primary', GEMINI_BACKUP_MODEL: 'backup' });
    await expect(gemini!.call('p', {})).resolves.toEqual({ items: [] });
    expect(fetch.mock.calls.map(([url]) => modelOf(url))).toEqual(['primary', 'backup']);
  });

  it('calls one model when no backup is set or it equals the primary', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }));
    for (const backup of [undefined, '', 'primary']) {
      fetch.mockClear();
      const gemini = needExtractionGemini({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'primary', GEMINI_BACKUP_MODEL: backup });
      await expect(gemini!.call('p', {})).rejects.toMatchObject({ kind: 'QUOTA' });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});
