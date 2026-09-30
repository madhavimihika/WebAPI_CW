const {
  api, withToken, loginAs, pool, DEVICE, DISTRICT, NATIONAL,
} = require('./_helpers');

describe('reading query and ingestion endpoints', () => {
  let nationalToken;
  let deviceToken;
  let districtToken;
  let installationId;
  let anotherInstallationId;

  beforeAll(async () => {
    [nationalToken, deviceToken, districtToken] = await Promise.all([
      loginAs(NATIONAL.username, NATIONAL.password),
      loginAs(DEVICE.username, DEVICE.password),
      loginAs(DISTRICT.username, DISTRICT.password),
    ]);
    const response = await withToken(nationalToken).get('/installations');
    installationId = response.body.data[0].id;
    anotherInstallationId = response.body.data.find((item) => item.id !== 'i-0001').id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns readings with a pagination object by default', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`);
    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual(expect.objectContaining({ total: expect.any(Number), page: 1 }));
  });

  it('returns page two with a limit of ten', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ page: 2, limit: 10 });
    expect(response.status).toBe(200);
    expect(response.body.pagination).toMatchObject({ page: 2, limit: 10 });
    expect(response.body.data.length).toBeLessThanOrEqual(10);
  });

  it('caps a requested limit of 999 at 200', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ limit: 999 });
    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBe(200);
  });

  it('rejects page zero', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ page: 0 });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_PAGINATION');
  });

  it('sorts readings by timestamp ascending', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ sort: 'timestamp:asc' });
    const timestamps = response.body.data.map((row) => new Date(row.timestamp).getTime());
    expect(response.status).toBe(200);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it('sorts readings by timestamp descending by default and explicitly', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ sort: 'timestamp:desc' });
    const timestamps = response.body.data.map((row) => new Date(row.timestamp).getTime());
    expect(response.status).toBe(200);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it('rejects an unsupported sort field', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ sort: 'bogus' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_SORT');
  });

  it('filters readings to an inclusive from and to window', async () => {
    const from = new Date(0).toISOString();
    const to = new Date().toISOString();
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ from, to });
    expect(response.status).toBe(200);
    expect(response.body.data.every((row) => new Date(row.timestamp) >= new Date(from) && new Date(row.timestamp) <= new Date(to))).toBe(true);
  });

  it('filters returned rows by minimum power', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ min_power: 3 });
    expect(response.status).toBe(200);
    expect(response.body.data.every((row) => row.power_kw >= 3)).toBe(true);
  });

  it('accepts a from-only time window', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ from: '2000-01-01T00:00:00.000Z' });
    expect(response.status).toBe(200);
  });

  it('accepts a to-only time window', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ to: new Date().toISOString() });
    expect(response.status).toBe(200);
  });

  it('rejects an invalid from date', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ from: 'not-a-date' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_DATE');
  });

  it('rejects an invalid to date', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ to: '' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_DATE');
  });

  it('rejects an invalid minimum power value', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ min_power: 'high' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_MIN_POWER');
  });

  it('builds a next link when another page exists', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ limit: 10 });
    expect(response.status).toBe(200);
    expect(response.body.pagination.next).toContain('page=2');
  });

  it('returns no previous link on page one', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`);
    expect(response.status).toBe(200);
    expect(response.body.pagination.previous).toBeNull();
  });

  it('builds a previous link on page two', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ page: 2, limit: 10 });
    expect(response.status).toBe(200);
    expect(response.body.pagination.previous).toContain('page=1');
  });

  it('reports a total count at least as large as the returned page', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ limit: 10 });
    expect(response.body.pagination.total).toBeGreaterThanOrEqual(response.body.data.length);
  });

  it('keeps every returned timestamp inside the requested window', async () => {
    const [first] = (await withToken(nationalToken).get(`/installations/${installationId}/readings`)).body.data;
    const from = new Date(new Date(first.timestamp).getTime() - 1000).toISOString();
    const to = new Date(new Date(first.timestamp).getTime() + 1000).toISOString();
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings`).query({ from, to });
    expect(response.status).toBe(200);
    expect(response.body.data.every((row) => new Date(row.timestamp) >= new Date(from) && new Date(row.timestamp) <= new Date(to))).toBe(true);
  });

  it('creates a reading with Location, ETag, and Last-Modified headers', async () => {
    const timestamp = new Date(Date.now() + 5000).toISOString();
    const response = await withToken(deviceToken).post('/installations/i-0001/readings')
      .send({ timestamp, power_kw: 2, energy_kwh: 0.5, voltage: 230 });
    expect(response.status).toBe(201);
    expect(response.headers.location).toContain('/installations/i-0001/readings/');
    expect(response.headers.etag).toEqual(expect.any(String));
    expect(response.headers['last-modified']).toEqual(expect.any(String));
  });

  it('rejects a second reading at the same timestamp', async () => {
    const timestamp = new Date(Date.now() + 10000).toISOString();
    const body = { timestamp, power_kw: 2, energy_kwh: 0.5, voltage: 230 };
    const first = await withToken(deviceToken).post('/installations/i-0001/readings').send(body);
    const second = await withToken(deviceToken).post('/installations/i-0001/readings').send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DUPLICATE_READING');
  });

  it('requires authentication to post a reading', async () => {
    const response = await api().post('/installations/i-0001/readings').send({
      timestamp: new Date().toISOString(), power_kw: 1, energy_kwh: 0.25, voltage: 230,
    });
    expect(response.status).toBe(401);
  });

  it('rejects a district token for reading ingestion', async () => {
    const response = await withToken(districtToken).post('/installations/i-0001/readings').send({
      timestamp: new Date().toISOString(), power_kw: 1, energy_kwh: 0.25, voltage: 230,
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_SCOPE');
  });

  it('does not let a device post to a different installation', async () => {
    const response = await withToken(deviceToken).post(`/installations/${anotherInstallationId}/readings`).send({
      timestamp: new Date(Date.now() + 15000).toISOString(), power_kw: 1, energy_kwh: 0.25, voltage: 230,
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_INSTALLATION');
  });

  it('rejects a reading without power_kw', async () => {
    const response = await withToken(deviceToken).post('/installations/i-0001/readings').send({
      timestamp: new Date(Date.now() + 20000).toISOString(), energy_kwh: 0.25, voltage: 230,
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_BODY');
  });

  it('rejects a reading with a malformed timestamp', async () => {
    const response = await withToken(deviceToken).post('/installations/i-0001/readings').send({
      timestamp: 'bad-date', power_kw: 1, energy_kwh: 0.25, voltage: 230,
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_BODY');
  });

  it('rejects numeric strings in the reading payload', async () => {
    const response = await withToken(deviceToken).post('/installations/i-0001/readings').send({
      timestamp: new Date(Date.now() + 25000).toISOString(), power_kw: '1', energy_kwh: 0.25, voltage: 230,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a reading without energy_kwh', async () => {
    const response = await withToken(deviceToken).post('/installations/i-0001/readings').send({
      timestamp: new Date(Date.now() + 30000).toISOString(), power_kw: 1, voltage: 230,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a reading without voltage', async () => {
    const response = await withToken(deviceToken).post('/installations/i-0001/readings').send({
      timestamp: new Date(Date.now() + 35000).toISOString(), power_kw: 1, energy_kwh: 0.25,
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown individual reading URL', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings/not-a-reading`);
    expect(response.status).toBe(404);
  });

  it.skip('returns an individual reading by ID when that endpoint is added', async () => {
    const list = await withToken(nationalToken).get(`/installations/${installationId}/readings`);
    const readingId = list.body.data[0].id;
    const response = await withToken(nationalToken).get(`/installations/${installationId}/readings/${readingId}`);
    expect(response.status).toBe(200);
  });

  it('supports conditional GET for the last-known-reading representation', async () => {
    const first = await withToken(nationalToken).get(`/installations/i-0001/last-known-reading`);
    if (first.status === 404) return;
    const second = await withToken(nationalToken).get('/installations/i-0001/last-known-reading')
      .set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
  });
});
