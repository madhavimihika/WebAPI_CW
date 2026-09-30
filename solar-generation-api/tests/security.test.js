const jwt = require('jsonwebtoken');
const {
  api, withToken, loginAs, pool, DEVICE, DISTRICT, PROVINCIAL, NATIONAL,
} = require('./_helpers');

describe('authentication, scope, and jurisdiction security', () => {
  let deviceToken;
  let districtToken;
  let provincialToken;
  let nationalToken;
  let installationId;
  let otherInstallationId;
  let districtId;
  let otherDistrictId;
  let provinceId;
  let otherProvinceDistrictId;
  let substationId;

  beforeAll(async () => {
    [deviceToken, districtToken, provincialToken, nationalToken] = await Promise.all([
      loginAs(DEVICE.username, DEVICE.password),
      loginAs(DISTRICT.username, DISTRICT.password),
      loginAs(PROVINCIAL.username, PROVINCIAL.password),
      loginAs(NATIONAL.username, NATIONAL.password),
    ]);
    const [installationResponse, districtResponse, provinceResponse, substationResponse] = await Promise.all([
      withToken(nationalToken).get('/installations'),
      withToken(nationalToken).get('/districts'),
      withToken(nationalToken).get('/provinces'),
      withToken(nationalToken).get('/substations'),
    ]);
    installationId = installationResponse.body.data[0].id;
    otherInstallationId = installationResponse.body.data.find((item) => item.id !== 'i-0001').id;
    districtId = 'd-01';
    otherDistrictId = districtResponse.body.data.find((item) => item.id !== districtId).id;
    provinceId = 'p-01';
    otherProvinceDistrictId = districtResponse.body.data.find((item) => item.province_id !== provinceId).id;
    substationId = substationResponse.body.data[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  const protectedPaths = [
    ['GET', '/provinces'],
    ['GET', '/districts'],
    ['GET', '/substations'],
    ['GET', '/installations'],
    ['GET', '/provinces/p-01'],
    ['GET', '/provinces/p-01/districts'],
    ['GET', '/districts/d-01'],
    ['GET', '/districts/d-01/substations'],
    ['GET', '/substations/s-01'],
    ['GET', '/substations/s-01/installations'],
    ['GET', '/installations/i-0001'],
    ['GET', '/installations/i-0001/last-known-reading'],
    ['GET', '/installations/i-0001/readings'],
  ];

  it.each(protectedPaths)('%s %s rejects requests without a token and sends a challenge', async (method, path) => {
    const response = await api()[method.toLowerCase()](path);
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer realm="solar-api"');
  });

  it('does not allow a device token to read provinces', async () => {
    const response = await withToken(deviceToken).get('/provinces');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_SCOPE');
  });

  it('does not allow a device token to read districts', async () => {
    const response = await withToken(deviceToken).get('/districts');
    expect(response.status).toBe(403);
  });

  it('does not allow a device token to read substations', async () => {
    const response = await withToken(deviceToken).get('/substations');
    expect(response.status).toBe(403);
  });

  it('does not allow a device token to read installations', async () => {
    const response = await withToken(deviceToken).get('/installations');
    expect(response.status).toBe(403);
  });

  it('does not allow a district analyst to post readings', async () => {
    const response = await withToken(districtToken).post('/installations/i-0001/readings').send({});
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_SCOPE');
  });

  it('does not allow a district analyst to create installations', async () => {
    const response = await withToken(districtToken).post('/installations').send({});
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_ROLE');
  });

  it('does not allow a provincial analyst to create installations', async () => {
    const response = await withToken(provincialToken).post('/installations').send({});
    expect(response.status).toBe(403);
  });

  it('allows a district analyst to read their own district', async () => {
    const response = await withToken(districtToken).get(`/districts/${districtId}`);
    expect(response.status).toBe(200);
  });

  it('denies a district analyst access to another district', async () => {
    const response = await withToken(districtToken).get(`/districts/${otherDistrictId}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('OUTSIDE_JURISDICTION');
  });

  it('allows a provincial analyst to list their province districts', async () => {
    const response = await withToken(provincialToken).get('/districts');
    expect(response.status).toBe(200);
    expect(response.body.data.every((district) => district.province_id === provinceId)).toBe(true);
  });

  it('denies a provincial analyst access to another province district', async () => {
    const response = await withToken(provincialToken).get(`/districts/${otherProvinceDistrictId}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('OUTSIDE_JURISDICTION');
  });

  it('allows a national analyst to read the full province collection', async () => {
    const response = await withToken(nationalToken).get('/provinces');
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(9);
  });

  it('allows a national analyst to read substations and installations', async () => {
    const [substations, installations] = await Promise.all([
      withToken(nationalToken).get('/substations'),
      withToken(nationalToken).get('/installations'),
    ]);
    expect(substations.status).toBe(200);
    expect(installations.status).toBe(200);
    expect(installations.body.data.length).toBeGreaterThan(0);
  });

  it('rejects an invalid signed token with an authentication challenge', async () => {
    const response = await api().get('/provinces').set('Authorization', 'Bearer invalid-token');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_TOKEN');
    expect(response.headers['www-authenticate']).toBe('Bearer realm="solar-api"');
  });

  it('rejects an expired token with INVALID_TOKEN', async () => {
    const expiredToken = jwt.sign({ sub: 'expired-user', role: 'national', scope: 'analyst-read' },
      process.env.JWT_SECRET, { expiresIn: -60 });
    const response = await api().get('/provinces').set('Authorization', `Bearer ${expiredToken}`);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects a non-Bearer authorization scheme', async () => {
    const response = await api().get('/provinces').set('Authorization', `Basic ${nationalToken}`);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_AUTH_HEADER');
  });

  it('rejects an authorization header without the Bearer prefix', async () => {
    const response = await api().get('/provinces').set('Authorization', nationalToken);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_AUTH_HEADER');
  });

  it('includes error and code properties in an invalid-sort response', async () => {
    const response = await withToken(nationalToken)
      .get(`/installations/${installationId}/readings`).query({ sort: 'invalid-sort' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.objectContaining({ error: expect.any(String), code: 'INVALID_SORT' }));
  });

  it('does not allow a device to access another installation', async () => {
    const response = await withToken(deviceToken).post(`/installations/${otherInstallationId}/readings`).send({
      timestamp: new Date(Date.now() + 60000).toISOString(), power_kw: 1, energy_kwh: 0.25, voltage: 230,
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_INSTALLATION');
  });

  it('allows national users to access a discovered installation', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}`);
    expect(response.status).toBe(200);
  });

  it('requires authentication for installation creation', async () => {
    const response = await api().post('/installations').send({});
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer realm="solar-api"');
  });

  it('does not grant district users national role on installation replacement', async () => {
    const response = await withToken(districtToken).put(`/installations/${installationId}`).send({});
    expect(response.status).toBe(403);
  });

  it('uses the discovered substation ID for installation authorization context', async () => {
    const response = await withToken(nationalToken).get(`/substations/${substationId}`);
    expect(response.status).toBe(200);
  });
});
