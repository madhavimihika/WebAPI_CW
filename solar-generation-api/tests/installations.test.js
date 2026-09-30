const {
  api, withToken, loginAs, pool, DISTRICT, PROVINCIAL, NATIONAL,
} = require('./_helpers');

describe('installation endpoints and national CRUD', () => {
  let nationalToken;
  let districtToken;
  let provincialToken;
  let installations;
  let substations;
  let districts;
  let provinces;
  const createdIds = new Set();
  const readingIds = new Set();

  async function createInstallation(overrides = {}) {
    const response = await withToken(nationalToken).post('/installations').send({
      site_name: `Jest solar site ${Date.now()}`,
      meter_id: `JEST-METER-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      substation_id: substations[0].id,
      ...overrides,
    });
    if (response.status === 201) createdIds.add(response.body.id);
    return response;
  }

  beforeAll(async () => {
    [nationalToken, districtToken, provincialToken] = await Promise.all([
      loginAs(NATIONAL.username, NATIONAL.password),
      loginAs(DISTRICT.username, DISTRICT.password),
      loginAs(PROVINCIAL.username, PROVINCIAL.password),
    ]);
    const [installationResponse, substationResponse, districtResponse, provinceResponse] = await Promise.all([
      withToken(nationalToken).get('/installations'),
      withToken(nationalToken).get('/substations'),
      withToken(nationalToken).get('/districts'),
      withToken(nationalToken).get('/provinces'),
    ]);
    installations = installationResponse.body.data;
    substations = substationResponse.body.data;
    districts = districtResponse.body.data;
    provinces = provinceResponse.body.data;
  });

  afterAll(async () => {
    for (const readingId of readingIds) {
      await pool.query('DELETE FROM readings WHERE id = $1', [readingId]);
    }
    for (const id of createdIds) {
      await withToken(nationalToken).delete(`/installations/${id}`).catch(() => {});
    }
    await pool.end();
  });

  it('returns the full installation collection to a national user', async () => {
    const response = await withToken(nationalToken).get('/installations');
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(installations.length);
    expect(response.body.data.length).toBeGreaterThanOrEqual(250);
  });

  it('returns fewer installations to a provincial user', async () => {
    const response = await withToken(provincialToken).get('/installations');
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeLessThan(installations.length);
  });

  it('returns fewer installations to a district user than the whole fleet', async () => {
    const response = await withToken(districtToken).get('/installations');
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeLessThan(installations.length);
  });

  it('returns the collection total matching its data array', async () => {
    const response = await withToken(nationalToken).get('/installations');
    expect(response.body.total).toBe(response.body.data.length);
  });

  it('returns installation fields in the collection', async () => {
    expect(installations[0]).toEqual(expect.objectContaining({
      id: expect.any(String), site_name: expect.any(String), meter_id: expect.any(String), substation_id: expect.any(String),
    }));
  });

  it('returns the installation details with last_known_reading', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installations[0].id}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty('last_known_reading');
  });

  it('returns 404 for an unknown installation ID', async () => {
    const response = await withToken(nationalToken).get('/installations/not-an-installation');
    expect(response.status).toBe(404);
  });

  it('denies a district user an installation from another district', async () => {
    const outside = installations.find((item) => {
      const parent = substations.find((substation) => substation.id === item.substation_id);
      return parent && parent.district_id !== 'd-01';
    });
    expect(outside).toBeDefined();
    const response = await withToken(districtToken).get(`/installations/${outside.id}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('OUTSIDE_JURISDICTION');
  });

  it('filters installations by substation ID', async () => {
    const response = await withToken(nationalToken).get(`/installations?substation_id=${substations[0].id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.every((item) => item.substation_id === substations[0].id)).toBe(true);
  });

  it('filters installations by district ID', async () => {
    const response = await withToken(nationalToken).get(`/installations?district_id=${districts[0].id}`);
    expect(response.status).toBe(200);
    const substationIds = substations.filter((item) => item.district_id === districts[0].id).map((item) => item.id);
    expect(response.body.data.every((item) => substationIds.includes(item.substation_id))).toBe(true);
  });

  it('filters installations by province ID', async () => {
    const response = await withToken(nationalToken).get(`/installations?province_id=${provinces[0].id}`);
    expect(response.status).toBe(200);
    const provinceDistricts = districts.filter((item) => item.province_id === provinces[0].id).map((item) => item.id);
    const provinceSubstations = substations.filter((item) => provinceDistricts.includes(item.district_id)).map((item) => item.id);
    expect(response.body.data.every((item) => provinceSubstations.includes(item.substation_id))).toBe(true);
  });

  it('creates an installation for a national user', async () => {
    const response = await createInstallation();
    expect(response.status).toBe(201);
    expect(response.body.id).toMatch(/^i-\d{4,}$/);
  });

  it('returns a Location header for a created installation', async () => {
    const response = await createInstallation();
    expect(response.headers.location).toBe(`/installations/${response.body.id}`);
  });

  it('returns an ETag for a created installation', async () => {
    const response = await createInstallation();
    expect(response.headers.etag).toEqual(expect.any(String));
  });

  it('returns Last-Modified for a created installation', async () => {
    const response = await createInstallation();
    expect(response.headers['last-modified']).toEqual(expect.any(String));
  });

  it('rejects installation creation by a district user', async () => {
    const response = await withToken(districtToken).post('/installations').send({
      site_name: 'Forbidden site', meter_id: `FORBIDDEN-${Date.now()}`, substation_id: substations[0].id,
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_ROLE');
  });

  it('rejects a create body with a missing field', async () => {
    const response = await withToken(nationalToken).post('/installations').send({ site_name: 'Missing fields' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_BODY');
    expect(response.body.details).toEqual(expect.any(Array));
  });

  it('rejects a create body with a wrong field type', async () => {
    const response = await withToken(nationalToken).post('/installations').send({
      site_name: 12, meter_id: 'METER-TYPE', substation_id: substations[0].id,
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_BODY');
  });

  it('returns 404 when creating under a nonexistent substation', async () => {
    const response = await withToken(nationalToken).post('/installations').send({
      site_name: 'Unknown parent', meter_id: `UNKNOWN-${Date.now()}`, substation_id: 'missing-substation',
    });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Substation not found');
  });

  it('rejects a duplicate meter ID', async () => {
    const response = await withToken(nationalToken).post('/installations').send({
      site_name: 'Duplicate meter site', meter_id: installations[0].meter_id, substation_id: substations[0].id,
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DUPLICATE_METER_ID');
  });

  it('replaces all installation fields with PUT', async () => {
    const created = await createInstallation();
    const response = await withToken(nationalToken).put(`/installations/${created.body.id}`)
      .send({ site_name: 'Replacement name', meter_id: `REPLACED-${Date.now()}`, substation_id: substations[1].id });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: created.body.id, site_name: 'Replacement name', substation_id: substations[1].id });
  });

  it('rejects a PUT body with a missing replacement field', async () => {
    const created = await createInstallation();
    const response = await withToken(nationalToken).put(`/installations/${created.body.id}`)
      .send({ site_name: 'Incomplete replacement' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_BODY');
  });

  it('rejects a PUT with an incorrect If-Match value', async () => {
    const created = await createInstallation();
    const response = await withToken(nationalToken).put(`/installations/${created.body.id}`)
      .set('If-Match', '"wrong-etag"')
      .send({ site_name: 'Replacement', meter_id: `ETAG-${Date.now()}`, substation_id: substations[0].id });
    expect(response.status).toBe(412);
    expect(response.body.code).toBe('PRECONDITION_FAILED');
  });

  it('returns a fresh ETag and Last-Modified after a successful PUT', async () => {
    const created = await createInstallation();
    const response = await withToken(nationalToken).put(`/installations/${created.body.id}`)
      .set('If-Match', created.headers.etag)
      .send({ site_name: 'Updated with precondition', meter_id: `UPDATED-${Date.now()}`, substation_id: substations[0].id });
    expect(response.status).toBe(200);
    expect(response.headers.etag).toEqual(expect.any(String));
    expect(response.headers['last-modified']).toEqual(expect.any(String));
  });

  it('rejects a PUT that reuses another installation meter ID', async () => {
    const created = await createInstallation();
    const response = await withToken(nationalToken).put(`/installations/${created.body.id}`)
      .send({ site_name: 'Duplicate replacement', meter_id: installations[0].meter_id, substation_id: substations[0].id });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DUPLICATE_METER_ID');
  });

  it('returns 404 when replacing an installation under an unknown substation', async () => {
    const created = await createInstallation();
    const response = await withToken(nationalToken).put(`/installations/${created.body.id}`)
      .send({ site_name: 'Bad parent', meter_id: `BAD-PARENT-${Date.now()}`, substation_id: 'missing-substation' });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Substation not found');
  });

  it('deletes an installation and returns its removed record', async () => {
    const created = await createInstallation();
    const response = await withToken(nationalToken).delete(`/installations/${created.body.id}`);
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(created.body.id);
  });

  it('returns 404 when deleting the same installation a second time', async () => {
    const created = await createInstallation();
    await withToken(nationalToken).delete(`/installations/${created.body.id}`);
    const response = await withToken(nationalToken).delete(`/installations/${created.body.id}`);
    expect(response.status).toBe(404);
  });

  it('requires a token to delete an installation', async () => {
    const response = await api().delete(`/installations/${installations[0].id}`);
    expect(response.status).toBe(401);
  });

  it('rejects installation deletion by a district user', async () => {
    const response = await withToken(districtToken).delete(`/installations/${installations[0].id}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_ROLE');
  });

  it('keeps readings when deleting their installation', async () => {
    const created = await createInstallation();
    const readingId = `jest-reading-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    readingIds.add(readingId);
    await pool.query(
      `INSERT INTO readings (id, installation_id, timestamp, power_kw, energy_kwh, voltage)
       VALUES ($1, $2, NOW(), 1, 0.25, 230)`, [readingId, created.body.id]
    );

    const deletion = await withToken(nationalToken).delete(`/installations/${created.body.id}`);
    const { rows } = await pool.query('SELECT id, installation_id FROM readings WHERE id = $1', [readingId]);
    expect(deletion.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0].installation_id).toBeNull();
  });

  it('returns the latest reading or the documented no-reading 404', async () => {
    const response = await withToken(nationalToken).get(`/installations/${installations[0].id}/last-known-reading`);
    expect([200, 404]).toContain(response.status);
  });
});
