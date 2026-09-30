require('dotenv').config();

const supertest = require('supertest');
const app = require('../src/app');
const pool = require('../src/db');

const API_BASE = process.env.API_URL || '';
const DEVICE = { username: 'device-1', password: 'device-pass-1' };
const DISTRICT = { username: 'district-colombo', password: 'district-pass-1' };
const PROVINCIAL = { username: 'provincial-western', password: 'provincial-pass-1' };
const NATIONAL = { username: 'national-user', password: 'national-pass-1' };

function api() {
  return API_BASE ? supertest(API_BASE) : supertest(app);
}

function withToken(token) {
  const auth = (test) => test.set('Authorization', `Bearer ${token}`);
  return {
    get: (path) => auth(api().get(path)),
    post: (path) => auth(api().post(path)),
    put: (path) => auth(api().put(path)),
    delete: (path) => auth(api().delete(path)),
  };
}

async function loginAs(username, password) {
  const response = await api().post('/auth/login').send({ username, password });
  if (response.status !== 200 || !response.body.token) {
    throw new Error(`Login failed for ${username}: HTTP ${response.status}`);
  }
  return response.body.token;
}

module.exports = {
  app,
  API_BASE,
  api,
  withToken,
  loginAs,
  pool,
  DEVICE,
  DISTRICT,
  PROVINCIAL,
  NATIONAL,
};
