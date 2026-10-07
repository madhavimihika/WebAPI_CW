#!/usr/bin/env node

// API smoke checks using only Node's built-in fetch.
const API_URL = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');

const credentials = {
  device: { username: 'device-1', password: 'device-pass-1' },
  district: { username: 'district-colombo', password: 'district-pass-1' },
  provincial: { username: 'provincial-western', password: 'provincial-pass-1' },
  national: { username: 'national-user', password: 'national-pass-1' },
};

let passed = 0;
let failed = 0;

function report(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`✅ PASS ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`❌ FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function request(path, options = {}) {
  const headers = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: response.status, data };
}

async function check(label, expectedStatus, path, options = {}, validate = () => true, detail = '') {
  try {
    const result = await request(path, options);
    const valid = result.status === expectedStatus && validate(result.data);
    report(label, valid, valid
      ? `${result.status}${detail ? `; ${detail}` : ''}`
      : `expected ${expectedStatus}${detail ? ` and ${detail}` : ''}, got ${result.status}`);
    return result;
  } catch (error) {
    report(label, false, error.message);
    return { status: 0, data: undefined };
  }
}

async function loginAll() {
  const tokens = {};
  const results = {};
  for (const [role, login] of Object.entries(credentials)) {
    try {
      const response = await request('/auth/login', { method: 'POST', body: login });
      results[role] = response;
      tokens[role] = response.data && response.data.token;
    } catch (error) {
      results[role] = { status: 0, data: undefined, error };
      tokens[role] = '';
    }
  }
  const ok = Object.values(results).every((result) => result.status === 200 && result.data && result.data.token);
  const details = Object.entries(results)
    .map(([role, result]) => `${role}=${result.status}${result.data && result.data.token ? '+token' : ''}`)
    .join(', ');
  report('1. Login all four demo users', ok, details);
  return { tokens, results };
}

async function getSetupData(path, token) {
  try {
    const result = await request(path, { token });
    if (result.status !== 200 || !result.data || !Array.isArray(result.data.data)) return [];
    return result.data.data;
  } catch {
    return [];
  }
}

async function main() {
  const { tokens, results: loginResults } = await loginAll();
  const nationalUser = loginResults.national.data && loginResults.national.data.user;
  const districtUser = loginResults.district.data && loginResults.district.data.user;
  const deviceUser = loginResults.device.data && loginResults.device.data.user;

  // Discover endpoint IDs from the live API rather than assuming numeric IDs.
  const [provinces, districts, installations] = await Promise.all([
    getSetupData('/provinces', tokens.national),
    getSetupData('/districts', tokens.national),
    getSetupData('/installations', tokens.national),
  ]);
  const firstProvinceId = provinces[0] && provinces[0].id;
  const firstDistrictId = districts[0] && districts[0].id;
  const firstInstallationId = installations[0] && installations[0].id;
  const ownDistrictId = districtUser && districtUser.jurisdiction_id;
  const ownDistrict = districts.find((district) => String(district.id) === String(ownDistrictId));
  const otherDistrict = districts.find((district) => String(district.id) !== String(ownDistrictId));
  const ownIdForPath = (ownDistrict && ownDistrict.id) || 'missing-district';
  const otherIdForPath = (otherDistrict && otherDistrict.id) || 'missing-district';
  const firstProvincePathId = firstProvinceId || 'missing-province';
  const firstInstallationPathId = firstInstallationId || 'missing-installation';

  await check('2. GET /', 200, '/', {}, (data) => data && data.status === 'ok', 'status is ok');
  await check('3. GET /provinces without token', 401, '/provinces');
  await check('4. GET /provinces with district token', 200, '/provinces', { token: tokens.district });
  await check('5. GET first province with district token', 200,
    `/provinces/${firstProvincePathId}`, { token: tokens.district },
    () => Boolean(firstProvinceId), 'province ID discovered dynamically');

  await check('6. GET /districts with provincial token', 200, '/districts', { token: tokens.provincial },
    (data) => data && Array.isArray(data.data) && data.data.length < 25,
    `count=${(await getSetupData('/districts', tokens.provincial)).length}; expected fewer than 25`);
  await check('7. GET /districts with national token', 200, '/districts', { token: tokens.national },
    (data) => data && Array.isArray(data.data) && data.data.length === 25,
    `count=${districts.length}; expected 25`);
  await check('8. GET district owned by district user', 200,
    `/districts/${ownIdForPath}`, { token: tokens.district },
    () => Boolean(ownDistrict), `user jurisdiction_id=${ownDistrictId || 'missing'}`);
  await check('9. GET district outside district user jurisdiction', 403,
    `/districts/${otherIdForPath}`, { token: tokens.district },
    () => Boolean(otherDistrict), `other district ID=${otherDistrict ? otherDistrict.id : 'missing'}`);
  await check('10. GET /substations with national token', 200, '/substations', { token: tokens.national });
  await check('11. GET /installations with national token', 200, '/installations', { token: tokens.national });
  await check('12. GET first installation with national token', 200,
    `/installations/${firstInstallationPathId}`, { token: tokens.national },
    () => Boolean(firstInstallationId), 'installation ID discovered dynamically');
  await check('13. GET first installation last-known-reading', 200,
    `/installations/${firstInstallationPathId}/last-known-reading`, { token: tokens.national },
    () => Boolean(firstInstallationId), 'installation ID discovered dynamically');
  await check('14. GET first installation readings with pagination', 200,
    `/installations/${firstInstallationPathId}/readings`, { token: tokens.national },
    (data) => Boolean(firstInstallationId && data && data.pagination), 'pagination field exists');
  await check('15. GET readings page 2 limit 10', 200,
    `/installations/${firstInstallationPathId}/readings?page=2&limit=10`, { token: tokens.national },
    () => Boolean(firstInstallationId));
  await check('16. GET readings sorted by ascending timestamp', 200,
    `/installations/${firstInstallationPathId}/readings?sort=timestamp:asc`, { token: tokens.national },
    () => Boolean(firstInstallationId));
  await check('17. GET readings with invalid sort', 400,
    `/installations/${firstInstallationPathId}/readings?sort=bogus`, { token: tokens.national },
    () => Boolean(firstInstallationId));

  const timestamp = new Date().toISOString();
  const reading = { timestamp, power_kw: 4.2, energy_kwh: 8.4, voltage: 230 };
  await check('18. POST reading without token', 401,
    `/installations/${firstInstallationPathId}/readings`, { method: 'POST', body: reading },
    () => Boolean(firstInstallationId));
  await check('19. POST reading with district token', 403,
    `/installations/${firstInstallationPathId}/readings`, { method: 'POST', token: tokens.district, body: reading },
    () => Boolean(firstInstallationId));
  const deviceInstallationId = deviceUser && deviceUser.installation_id;
  const deviceReadingPath = `/installations/${deviceInstallationId || 'missing-installation'}/readings`;
  await check('20. POST fresh reading with device token', 201, deviceReadingPath,
    { method: 'POST', token: tokens.device, body: reading });
  await check('21. POST duplicate timestamp with device token', 409, deviceReadingPath,
    { method: 'POST', token: tokens.device, body: reading });
  await check('22. GET /docs', 200, '/docs');
  await check('23. GET /openapi.yaml', 200, '/openapi.yaml');

  console.log(`Total: ${passed + failed} Passed: ${passed} Failed: ${failed}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`Smoke script error: ${error.message}`);
  process.exitCode = 1;
});
