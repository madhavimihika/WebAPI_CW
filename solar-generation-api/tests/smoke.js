#!/usr/bin/env node

/**
 * Standalone smoke checks for the deployed Solar Generation API.
 * Requires Node.js 18+ (built-in fetch); no external dependencies.
 *
 * Usage:
 *   API_URL=https://your-api.example node tests/smoke.js
 */

const BASE_URL = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');

const credentials = {
  device: {
    username: process.env.DEVICE_USER || 'device-1',
    password: process.env.DEVICE_PASS || 'device-pass-1',
  },
  district: {
    username: process.env.DISTRICT_USER || 'district-colombo',
    password: process.env.DISTRICT_PASS || 'district-pass-1',
  },
  provincial: {
    username: process.env.PROVINCIAL_USER || 'provincial-western',
    password: process.env.PROVINCIAL_PASS || 'provincial-pass-1',
  },
  national: {
    username: process.env.NATIONAL_USER || 'national-user',
    password: process.env.NATIONAL_PASS || 'national-pass-1',
  },
};

let passed = 0;
let failed = 0;

function report(label, ok, expected, actual) {
  if (ok) {
    passed += 1;
    console.log(`✅ PASS  ${label}  (${actual})`);
  } else {
    failed += 1;
    console.log(`❌ FAIL  ${label}  expected ${expected}, got ${actual}`);
  }
}

async function request(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: response.status, data };
}

async function check(label, expectedStatus, path, options = {}, validate = () => true, detail = '') {
  try {
    const result = await request(path, options);
    const valid = result.status === expectedStatus && validate(result.data);
    const expectation = detail ? `${expectedStatus} ${detail}` : String(expectedStatus);
    const actual = detail && result.status === expectedStatus
      ? `${result.status} (response did not match ${detail})`
      : String(result.status);
    report(label, valid, expectation, actual);
    return result;
  } catch (error) {
    report(label, false, detail ? `${expectedStatus} ${detail}` : String(expectedStatus), error.message);
    return { status: 0, data: undefined };
  }
}

async function login(role) {
  const { username, password } = credentials[role];
  try {
    const result = await request('/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    const token = result.data && result.data.token;
    report(`Login (${role})`, result.status === 200 && Boolean(token), '200 with token',
      token ? String(result.status) : `${result.status} without token`);
    return token || '';
  } catch (error) {
    report(`Login (${role})`, false, '200 with token', error.message);
    return '';
  }
}

async function main() {
  // Obtain all role tokens before exercising the API checks.
  const tokens = {};
  for (const role of ['device', 'district', 'provincial', 'national']) {
    tokens[role] = await login(role);
  }

  await check('GET /', 200, '/', {}, (data) => data && data.status === 'ok', 'status: ok');
  await check('GET /provinces without token', 401, '/provinces');
  await check('GET /provinces with district token', 200, '/provinces', { token: tokens.district });
  await check('GET /provinces/1 with district token', 200, '/provinces/1', { token: tokens.district });
  await check('GET /districts with provincial token (3 items)', 200, '/districts',
    { token: tokens.provincial }, (data) => data && Array.isArray(data.data) && data.data.length === 3, '3 items');
  await check('GET /districts with national token (25 items)', 200, '/districts',
    { token: tokens.national }, (data) => data && Array.isArray(data.data) && data.data.length === 25, '25 items');
  await check('GET /districts/1 with district token', 200, '/districts/1', { token: tokens.district });
  await check('GET /districts/2 with district token', 403, '/districts/2', { token: tokens.district });
  await check('GET /substations with national token', 200, '/substations', { token: tokens.national });
  await check('GET /installations with national token (200 items)', 200, '/installations',
    { token: tokens.national }, (data) => data && Array.isArray(data.data) && data.data.length === 200, '200 items');
  await check('GET /installations/1 with national token', 200, '/installations/1', { token: tokens.national });
  await check('GET /installations/1/last-known-reading with national token', 200,
    '/installations/1/last-known-reading', { token: tokens.national });
  await check('GET /installations/1/readings with pagination', 200, '/installations/1/readings?sort=timestamp:desc',
    { token: tokens.national }, (data) => data && Array.isArray(data.data) && data.pagination, 'pagination');
  await check('GET readings page 2 limit 10', 200, '/installations/1/readings?page=2&limit=10&sort=timestamp:desc',
    { token: tokens.national });
  await check('GET readings sorted ascending', 200, '/installations/1/readings?sort=timestamp:asc',
    { token: tokens.national });
  await check('GET readings with invalid sort', 400, '/installations/1/readings?sort=bogus',
    { token: tokens.national });

  const timestamp = new Date().toISOString();
  const reading = { timestamp, power_kw: 4.2, energy_kwh: 8.4, voltage: 230 };
  await check('POST reading without token', 401, '/installations/1/readings',
    { method: 'POST', body: reading });
  await check('POST reading with district token', 403, '/installations/1/readings',
    { method: 'POST', token: tokens.district, body: reading });
  await check('POST reading with device token (fresh timestamp)', 201, '/installations/1/readings',
    { method: 'POST', token: tokens.device, body: reading });
  await check('POST reading with device token (duplicate timestamp)', 409, '/installations/1/readings',
    { method: 'POST', token: tokens.device, body: reading });

  await check('GET /docs', 200, '/docs');
  await check('GET /openapi.yaml', 200, '/openapi.yaml');

  const total = passed + failed;
  console.log('='.repeat(16) + ` Total: ${total}    Passed: ${passed}    Failed: ${failed} ` + '='.repeat(16));
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`Smoke script error: ${error.message}`);
  process.exitCode = 1;
});
