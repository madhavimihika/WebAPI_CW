const {
  api, withToken, loginAs, pool, DISTRICT, PROVINCIAL, NATIONAL,
} = require('./_helpers');

describe('geographic hierarchy endpoints', () => {
  let districtToken;
  let provincialToken;
  let nationalToken;
  let provinces;
  let districts;
  let substations;
  let installations;

  beforeAll(async () => {
    [districtToken, provincialToken, nationalToken] = await Promise.all([
      loginAs(DISTRICT.username, DISTRICT.password),
      loginAs(PROVINCIAL.username, PROVINCIAL.password),
      loginAs(NATIONAL.username, NATIONAL.password),
    ]);
    const [provinceResponse, districtResponse, substationResponse, installationResponse] = await Promise.all([
      withToken(nationalToken).get('/provinces'),
      withToken(nationalToken).get('/districts'),
      withToken(nationalToken).get('/substations'),
      withToken(nationalToken).get('/installations'),
    ]);
    provinces = provinceResponse.body.data;
    districts = districtResponse.body.data;
    substations = substationResponse.body.data;
    installations = installationResponse.body.data;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('requires authentication for the provinces collection', async () => {
    const response = await api().get('/provinces');
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBeDefined();
  });

  it('returns all nine provinces to a national user', async () => {
    const response = await withToken(nationalToken).get('/provinces');
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(9);
  });

  it('allows a district user to view the province collection', async () => {
    const response = await withToken(districtToken).get('/provinces');
    expect(response.status).toBe(200);
  });

  it('returns the first province by its discovered ID', async () => {
    const response = await withToken(nationalToken).get(`/provinces/${provinces[0].id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(provinces[0].id);
  });

  it('returns 404 for an unknown province ID', async () => {
    const response = await withToken(nationalToken).get('/provinces/not-a-province');
    expect(response.status).toBe(404);
  });

  it('returns districts for a discovered province', async () => {
    const response = await withToken(nationalToken).get(`/provinces/${provinces[0].id}/districts`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.any(Array));
  });

  it('returns only districts belonging to the requested province', async () => {
    const response = await withToken(nationalToken).get(`/provinces/${provinces[0].id}/districts`);
    expect(response.body.data.every((district) => district.province_id === provinces[0].id)).toBe(true);
  });

  it('reports nine provinces in the collection', async () => {
    const response = await withToken(nationalToken).get('/provinces');
    expect(response.body.total).toBe(9);
  });

  it('returns province objects with ID and name fields', async () => {
    expect(provinces.every((province) => typeof province.id === 'string' && typeof province.name === 'string')).toBe(true);
  });

  it('returns all twenty-five districts to a national user', async () => {
    const response = await withToken(nationalToken).get('/districts');
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(25);
  });

  it('returns fewer than twenty-five districts to a provincial user', async () => {
    const response = await withToken((await loginAs(PROVINCIAL.username, PROVINCIAL.password))).get('/districts');
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeLessThan(25);
  });

  it('returns district objects with ID, name, and province ID', async () => {
    expect(districts.every((district) => typeof district.id === 'string' &&
      typeof district.name === 'string' && typeof district.province_id === 'string')).toBe(true);
  });

  it('reports twenty-five districts in the national collection', async () => {
    const response = await withToken(nationalToken).get('/districts');
    expect(response.body.total).toBe(25);
  });

  it('returns a discovered district by ID', async () => {
    const response = await withToken(nationalToken).get(`/districts/${districts[0].id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(districts[0].id);
  });

  it('returns 404 for an unknown district ID', async () => {
    const response = await withToken(nationalToken).get('/districts/not-a-district');
    expect(response.status).toBe(404);
  });

  it('allows a district user to view their own district', async () => {
    const district = districts.find((item) => item.id === 'd-01');
    const response = await withToken(districtToken).get(`/districts/${district.id}`);
    expect(response.status).toBe(200);
  });

  it('denies a district user access to another district', async () => {
    const other = districts.find((item) => item.id !== 'd-01');
    const response = await withToken(districtToken).get(`/districts/${other.id}`);
    expect(response.status).toBe(403);
  });

  it('returns substations for a discovered district', async () => {
    const response = await withToken(nationalToken).get(`/districts/${districts[0].id}/substations`);
    expect(response.status).toBe(200);
  });

  it('returns substations linked to the requested district', async () => {
    const response = await withToken(nationalToken).get(`/districts/${districts[0].id}/substations`);
    expect(response.body.data.every((item) => item.district_id === districts[0].id)).toBe(true);
  });

  it('returns 404 for substations under an unknown district', async () => {
    const response = await withToken(nationalToken).get('/districts/not-a-district/substations');
    expect(response.status).toBe(404);
  });

  it('returns the national substation collection', async () => {
    const response = await withToken(nationalToken).get('/substations');
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  it('returns substations with ID, name, and district ID', async () => {
    expect(substations.every((item) => typeof item.id === 'string' &&
      typeof item.name === 'string' && typeof item.district_id === 'string')).toBe(true);
  });

  it('returns a discovered substation by ID', async () => {
    const response = await withToken(nationalToken).get(`/substations/${substations[0].id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(substations[0].id);
  });

  it('returns 404 for an unknown substation ID', async () => {
    const response = await withToken(nationalToken).get('/substations/not-a-substation');
    expect(response.status).toBe(404);
  });

  it('returns installations for a discovered substation', async () => {
    const response = await withToken(nationalToken).get(`/substations/${substations[0].id}/installations`);
    expect(response.status).toBe(200);
  });

  it('returns only installations assigned to the requested substation', async () => {
    const response = await withToken(nationalToken).get(`/substations/${substations[0].id}/installations`);
    expect(response.body.data.every((item) => item.substation_id === substations[0].id)).toBe(true);
  });

  it('returns the national installation collection', async () => {
    const response = await withToken(nationalToken).get('/installations');
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBe(installations.length);
  });
});
