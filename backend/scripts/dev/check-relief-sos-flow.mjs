import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const statePath = new URL('../../../test-artifacts/relief-sos-flow-2026-11-19.json', import.meta.url);
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { suffix: Date.now().toString(36) };
const base = {
  identity: 'http://127.0.0.1:3001/api/v1/identity',
  response: 'http://127.0.0.1:3002/api/v1/response',
  logistics: 'http://127.0.0.1:3003/api/v1/logistics',
};
const tokens = new Map();
const save = () => writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

async function login(username) {
  if (tokens.has(username)) return tokens.get(username);
  const result = await request('identity', 'auth/login', { method: 'POST', body: {
    username, password: process.env.SEED_PASSWORD, client_kind: 'NATIVE',
  } });
  tokens.set(username, result.access_token);
  return result.access_token;
}

async function request(service, path, { method = 'GET', body, actor } = {}) {
  const response = await fetch(`${base[service]}/${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(actor ? { Authorization: `Bearer ${await login(actor)}` } : {}),
      ...(method === 'GET' ? {} : { 'Idempotency-Key': randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const responseText = await response.text();
  const value = responseText ? JSON.parse(responseText) : { status: response.status };
  if (!response.ok) throw new Error(`${method} ${service}/${path}: ${response.status} ${JSON.stringify(value).slice(0, 700)}`);
  return value;
}

async function step(name, run) {
  if (state[name]) return state[name];
  const value = await run();
  state[name] = value;
  save();
  console.log(name, JSON.stringify(value).slice(0, 500));
  return value;
}

const location = { type: 'Point', coordinates: [105.65, 21.03] };
const waterId = '00000000-0000-4000-8000-0000000a1004';

try {
  const warehouse = await step('warehouse', () => request('logistics', 'warehouses', { method: 'POST', actor: 'ops_mgr', body: {
    name: `Kho thử luồng SOS ${state.suffix}`, location, location_public: false, service_radius_m: 30_000,
  } }));
  const drive = await step('initialDrive', () => request('logistics', 'donation-drives', { method: 'POST', actor: 'ops_mgr', body: {
    title: `Quyên góp kiểm thử SOS ${state.suffix}`, intake_warehouse_id: warehouse.id,
    items: [{ item_id: waterId, target_quantity: '1' }],
  } }));
  const opened = await step('initialDriveOpen', () => request('logistics', `donation-drives/${drive.id}/open`, {
    method: 'POST', actor: 'ops_mgr', body: { expected_version: drive.version },
  }));
  const donation = await step('donation', () => request('logistics', `public/donation-drives/${drive.id}/deliveries`, {
    method: 'POST', actor: 'citizen1', body: {
      donor_name: 'Người quyên góp kiểm thử', donor_phone: '+84901234567',
      lines: [{ item_id: waterId, declared_quantity: '1' }],
    },
  }));
  const receipt = await step('receipt', () => request('logistics', 'donation-receipts', {
    method: 'POST', actor: 'ops_seed', body: { delivery_id: donation.id, warehouse_id: warehouse.id },
  }));
  const counted = await step('counted', () => request('logistics', `donation-receipts/${receipt.id}/counts`, {
    method: 'POST', actor: 'ops_seed', body: { expected_version: receipt.version,
      lines: [{ item_id: waterId, counted_quantity: '1', accepted_quantity: '1', held_quantity: '0', rejected_quantity: '0' }],
    },
  }));
  const reviewed = await step('reviewed', () => request('logistics', `donation-receipts/${receipt.id}/review`, {
    method: 'POST', actor: 'reviewer1', body: { expected_version: counted.version,
      count_revision: counted.count.revision, declaration_revision: counted.count.declaration_revision, decision: 'APPROVE',
    },
  }));
  await step('posted', () => request('logistics', `donation-receipts/${receipt.id}/post`, {
    method: 'POST', actor: 'reviewer1', body: { expected_version: reviewed.version },
  }));
  await step('campaignPrimary', () => request('logistics', 'campaigns/00000000-0000-4000-8000-0000000000c1/primary-warehouse', {
    method: 'PUT', actor: 'ops_mgr', body: { warehouse_id: warehouse.id, expected_version: 0,
      reason: 'Chọn kho thử trong vùng chiến dịch để kiểm tra thiếu hụt từ SOS.',
    },
  }));
  const teamId = '00000000-0000-4000-8000-0000000000a9';
  await step('teamPosition', () => request('response', `teams/${teamId}/position`, {
    method: 'PUT', actor: 'vol_leader3', body: {
      location: { ...location, source: 'MANUAL_PIN' }, captured_at: new Date().toISOString(),
      note: 'Tín hiệu vị trí cho ca kiểm thử SOS.',
    },
  }));
  const sos = await step('sos', () => request('response', 'requests', {
    method: 'POST', actor: 'citizen1', body: {
      incident_category_code: 'FLOOD',
      description: 'Gia đình mười người đang bị cô lập do ngập lụt. Cần đội xuồng cứu hộ và nước uống.',
      people_affected: 10, children_count: 2, elderly_count: 1,
      needs_rescue: true, needs_relief_supplies: true, relief_items_text: 'Cần nước uống đóng can cho mười người.',
      location: { ...location, source: 'MANUAL_PIN' },
    },
  }));
  const sosId = sos.id;
  const detail = () => request('response', `requests/${sosId}`, { actor: 'coord_seed' });
  await step('verificationStarted', async () => {
    const current = await detail();
    return request('response', `requests/${sosId}/start-verification`, {
      method: 'POST', actor: 'coord_seed', body: { expected_version: current.version },
    });
  });
  await step('verified', async () => {
    const current = await detail();
    return request('response', `requests/${sosId}/verify`, {
      method: 'POST', actor: 'coord_seed', body: { expected_version: current.version, basis: 'EVIDENCE_REVIEWED',
        reason: 'Đã đối chiếu vị trí và nội dung ca thử, xác nhận nhu cầu cứu hộ và nước uống.',
      },
    });
  });
  await step('triaged', async () => {
    const current = await detail();
    return request('response', `requests/${sosId}/triage`, {
      method: 'POST', actor: 'coord_seed', body: { expected_version: current.version,
        priority: 'P2', priority_basis: 'COMPLETE', reason: 'Đánh giá thủ công ca ngập lụt có người cần hỗ trợ.',
      },
    });
  });
  await step('mission', async () => {
    const current = await detail();
    return request('response', `requests/${sosId}/missions`, {
      method: 'POST', actor: 'coord_seed', body: { expected_version: current.version, team_id: teamId,
        override_reason: 'Đội có vị trí mới và kỹ năng xuồng phù hợp ca kiểm thử.',
      },
    });
  });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const proposals = await request('logistics', 'need-proposals', { actor: 'ops_mgr' });
    const group = proposals.items.find((item) => item.request_id === sosId);
    if (group) { state.proposal = group; save(); console.log('proposal', JSON.stringify(group).slice(0, 1000)); break; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!state.proposal) throw new Error('No need proposal appeared for verified SOS');
  console.log('DONE', JSON.stringify({ warehouse_id: warehouse.id, drive_id: drive.id, sos_id: sosId }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
