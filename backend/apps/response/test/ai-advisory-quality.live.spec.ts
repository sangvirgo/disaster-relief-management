/** Opt-in provider check: synthetic narratives only, no database writes or personal data. */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { DataSource } from 'typeorm';
import { AiAdvisoryService } from '../src/ai/ai-advisory.service';
import { buildAiAssessmentInput } from '../src/ai/ai-risk';

const enabled = process.env.C48_AI_LIVE_CHECK === '1';
if (enabled) config({ path: '.env', quiet: true });
const cases = [
  { id: 'stable-supplies', description: 'Bốn người lớn đang ở nơi khô ráo, nước ngoài ngõ đã rút. Chúng tôi còn thức ăn nhưng hết nước uống, cần được tiếp tế.',
    total: 4, children: 0, elderly: 0, rescue: false, supplies: true, priority: ['P3', 'P4'], forbidden: /ôxy|máy thở|khó thở|mắc kẹt/iu },
  { id: 'rising-water', description: 'Nước vẫn đang dâng, lối ra tầng trệt đã ngập. Cả nhà 12 người đang mắc kẹt trên gác, có 3 trẻ và 2 người cao tuổi. Một cụ không tự đi được, những người còn lại vẫn di chuyển được. Cần thuyền đến đón và nước uống.',
    total: 12, children: 3, elderly: 2, rescue: true, supplies: true, priority: ['P1'], forbidden: /ôxy|máy thở|khó thở/iu },
  { id: 'unknown', description: 'Ở đây có chuyện rồi, nhờ giúp với. Tôi chưa rõ có bao nhiêu người cần giúp hay tình hình cụ thể.',
    total: null, children: null, elderly: null, rescue: false, supplies: false, priority: [null], forbidden: /ôxy|máy thở|khó thở|bất tỉnh/iu },
  { id: 'danger-checkbox-omitted', description: 'Nhà vừa sập, hai người đang bị kẹt dưới đống đổ nát, không thể tự thoát ra ngoài. Xin cử đội cứu hộ gấp.',
    total: 2, children: 0, elderly: 0, rescue: true, supplies: false, priority: ['P1'], forbidden: /ôxy|máy thở/iu },
  { id: 'oxygen-source', description: 'Nhà có 4 người, gồm 1 trẻ và 1 cụ cao tuổi. Cụ không tự di chuyển được và bình ôxy của cụ gần hết; chưa biết có khó thở hay không. Trẻ cần đồ ăn. Cần đội hỗ trợ đưa cụ ra ngoài và tiếp tế đồ ăn cho trẻ.',
    total: 4, children: 1, elderly: 1, rescue: true, supplies: true, priority: ['P1', 'P2'], forbidden: /mắc kẹt|cả (?:nhà|4 người).{0,30}khó thở/iu },
  { id: 'corrected-negative', description: 'Xin đính chính: 5 người đã ra khỏi nhà an toàn, không còn ai mắc kẹt, không ai bị thương. Hiện chỉ cần chăn để nghỉ tạm tại điểm sơ tán.',
    total: 5, children: 0, elderly: 0, rescue: false, supplies: true, priority: ['P3', 'P4'], forbidden: /ôxy|máy thở|khó thở/iu },
  { id: 'forecast-not-observation', description: 'Nước vẫn đang dâng, lối ra tầng trệt đã ngập. Cả nhà 4 người lớn đang bị kẹt trên gác, cần thuyền đến đón.',
    total: 4, children: 0, elderly: 0, rescue: true, supplies: false, priority: ['P1'], forbidden: /ôxy|máy thở|khó thở/iu,
    weather: { source: 'Open-Meteo', period: 'next_24_hours', rain_24h_mm: 120, peak_rain_1h_mm: 20, max_gust_kmh: 25, temperature_c: 27, stale: false, alerts: [] } },
  { id: 'calm-forecast-keeps-current-danger', description: 'Nước đang dâng, lối thoát đã bị ngập, 2 người lớn đang mắc kẹt trên gác không thể ra ngoài, cần cứu hộ.',
    total: 2, children: 0, elderly: 0, rescue: true, supplies: false, priority: ['P1'], forbidden: /ôxy|máy thở|khó thở/iu,
    weather: { source: 'Open-Meteo', period: 'next_24_hours', rain_24h_mm: 1, peak_rain_1h_mm: 0.5, max_gust_kmh: 10, temperature_c: 25, stale: false, alerts: [] } },
];
const results: Array<Record<string, unknown>> = [];

(enabled ? describe : describe.skip)('Live coordinator SOS advisory quality (synthetic)', () => {
  afterAll(() => {
    mkdirSync('../test-artifacts/uiux-2026-11-28', { recursive: true });
    writeFileSync('../test-artifacts/uiux-2026-11-28/ai-advisory-quality.json', JSON.stringify({ prompt_version: 'v20', checked_at: new Date().toISOString(), results }, null, 2));
  });
  it.each(cases)('$id retains source meaning', async (sample) => {
    const worker = new AiAdvisoryService({} as DataSource);
    const facts = { incidentCategoryCode: 'FLOOD', description: sample.description, peopleAffected: sample.total,
      childrenCount: sample.children, elderlyCount: sample.elderly, reporterDeclaredDanger: false, needsRescue: sample.rescue, needsReliefSupplies: sample.supplies };
    const weather = 'weather' in sample ? sample.weather : null;
    const input = JSON.stringify({ sos: buildAiAssessmentInput(facts), weather });
    try {
      const value = await worker['extract']({ ...facts, model: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite' } as never, input);
      results.push({ id: sample.id, input: JSON.parse(input), output: value });
      expect(sample.priority).toContain(value.suggested_priority);
      expect(String(value.summary)).not.toMatch(sample.forbidden);
      if (!weather) expect(value.weather_impact).toBe('Chưa có dữ liệu thời tiết phù hợp.');
      else {
        expect(String(value.weather_impact)).toMatch(/24\s*giờ tới/iu);
        expect(String(value.weather_impact)).not.toMatch(/24\s*giờ qua|bão/iu);
        expect(String(value.weather_impact).length).toBeLessThanOrEqual(450);
      }
    } catch (error) {
      if (!results.some(result => result.id === sample.id)) results.push({ id: sample.id, error: error instanceof Error ? error.message : 'AI_CHECK_FAILED' });
      throw error;
    }
  }, 90_000);
});
