const jwt = require('jsonwebtoken');
const { api, loginAs, pool, DEVICE, DISTRICT, PROVINCIAL, NATIONAL } = require('./_helpers');

const users = [
  [DEVICE, 'device', 'installation-write'],
  [DISTRICT, 'district', 'analyst-read'],
  [PROVINCIAL, 'provincial', 'analyst-read'],
  [NATIONAL, 'national', 'analyst-read'],
];

describe('authentication endpoint', () => {
  let tokens;

  beforeAll(async () => {
    tokens = await Promise.all(users.map(([user]) => loginAs(user.username, user.password)));
  });

  afterAll(async () => {
    await pool.end();
  });

  it.each(users)('logs in %s with its expected role and scope', async (user, role, scope) => {
    const response = await api().post('/auth/login').send(user);
    expect(response.status).toBe(200);
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.user).toMatchObject({ role, scope });
  });

  it('rejects a wrong password with the authentication challenge', async () => {
    const response = await api().post('/auth/login').send({ ...DEVICE, password: 'wrong-password' });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_CREDENTIALS');
    expect(response.headers['www-authenticate']).toBe('Bearer realm="solar-api"');
  });

  it('returns the same error body for an unknown username and wrong password', async () => {
    const wrongPassword = await api().post('/auth/login').send({ ...DEVICE, password: 'wrong-password' });
    const unknownUser = await api().post('/auth/login').send({ username: 'not-a-user', password: 'wrong-password' });
    expect(unknownUser.status).toBe(401);
    expect(unknownUser.body).toEqual(wrongPassword.body);
  });

  it('requires a username', async () => {
    const response = await api().post('/auth/login').send({ password: DEVICE.password });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_BODY');
  });

  it('requires a password', async () => {
    const response = await api().post('/auth/login').send({ username: DEVICE.username });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_BODY');
  });

  it('rejects an empty JSON body', async () => {
    const response = await api().post('/auth/login').send({});
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_BODY');
  });

  it('places subject, role, and scope claims in a device token', () => {
    const payload = jwt.decode(tokens[0]);
    expect(payload).toMatchObject({ sub: expect.any(String), role: 'device', scope: 'installation-write' });
  });

  it('places subject, role, and scope claims in a district token', () => {
    const payload = jwt.decode(tokens[1]);
    expect(payload).toMatchObject({ sub: expect.any(String), role: 'district', scope: 'analyst-read' });
  });

  it('places subject, role, and scope claims in a provincial token', () => {
    const payload = jwt.decode(tokens[2]);
    expect(payload).toMatchObject({ sub: expect.any(String), role: 'provincial', scope: 'analyst-read' });
  });

  it('places subject, role, and scope claims in a national token', () => {
    const payload = jwt.decode(tokens[3]);
    expect(payload).toMatchObject({ sub: expect.any(String), role: 'national', scope: 'analyst-read' });
  });

  it('sets token lifetime to one hour', async () => {
    const response = await api().post('/auth/login').send(NATIONAL);
    expect(response.body.expires_in).toBe(3600);
  });

  it('returns Bearer as the token type', async () => {
    const response = await api().post('/auth/login').send(NATIONAL);
    expect(response.body.token_type).toBe('Bearer');
  });

  it('includes an issued-at claim in the signed token', () => {
    expect(jwt.decode(tokens[3]).iat).toEqual(expect.any(Number));
  });

  it('rejects malformed JSON with a client error', async () => {
    const response = await api().post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"username":');
    expect([400, 415]).toContain(response.status);
  });

  it('rejects a request whose content type is not JSON', async () => {
    const response = await api().post('/auth/login')
      .set('Content-Type', 'text/plain')
      .send('username=device-1&password=device-pass-1');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_BODY');
  });

  it('ignores extra login body properties', async () => {
    const response = await api().post('/auth/login').send({ ...NATIONAL, ignored: true });
    expect(response.status).toBe(200);
    expect(response.body.token).toEqual(expect.any(String));
  });

  it('returns the authenticated account profile', async () => {
    const response = await api().post('/auth/login').send(DISTRICT);
    expect(response.body.user).toMatchObject({ username: DISTRICT.username, role: 'district', scope: 'analyst-read' });
  });

  it('does not include the password hash in the user response', async () => {
    const response = await api().post('/auth/login').send(DEVICE);
    expect(response.body.user).not.toHaveProperty('password_hash');
  });
});
