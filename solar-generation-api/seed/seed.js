// Load this project's .env, then use plain pg queries and bcrypt password hashes.
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const provinces = [
  'Western', 'Central', 'Southern', 'Northern', 'Eastern',
  'North Western', 'North Central', 'Uva', 'Sabaragamuwa',
].map((name, index) => ({ id: `p-${String(index + 1).padStart(2, '0')}`, name: `${name} Province` }));

// All 25 Sri Lankan administrative districts, mapped to their provinces.
const districtProvince = [
  ['Colombo', 'Western'], ['Gampaha', 'Western'], ['Kalutara', 'Western'],
  ['Kandy', 'Central'], ['Matale', 'Central'], ['Nuwara Eliya', 'Central'],
  ['Galle', 'Southern'], ['Matara', 'Southern'], ['Hambantota', 'Southern'],
  ['Jaffna', 'Northern'], ['Kilinochchi', 'Northern'], ['Mannar', 'Northern'],
  ['Vavuniya', 'Northern'], ['Mullaitivu', 'Northern'],
  ['Trincomalee', 'Eastern'], ['Batticaloa', 'Eastern'], ['Ampara', 'Eastern'],
  ['Kurunegala', 'North Western'], ['Puttalam', 'North Western'],
  ['Anuradhapura', 'North Central'], ['Polonnaruwa', 'North Central'],
  ['Badulla', 'Uva'], ['Monaragala', 'Uva'],
  ['Ratnapura', 'Sabaragamuwa'], ['Kegalle', 'Sabaragamuwa'],
];

const provinceIdByName = new Map(provinces.map((province) => [province.name.replace(' Province', ''), province.id]));
const districts = districtProvince.map(([name, province], index) => ({
  id: `d-${String(index + 1).padStart(2, '0')}`,
  name,
  province_id: provinceIdByName.get(province),
}));

// One real-named substation per district gives 25 substations and full coverage.
const substations = districts.map((district, index) => ({
  id: `s-${String(index + 1).padStart(2, '0')}`,
  name: `${district.name} Grid Substation`,
  district_id: district.id,
}));

const installations = [];
for (const substation of substations) {
  for (let site = 1; site <= 10; site += 1) {
    const number = installations.length + 1;
    installations.push({
      id: `i-${String(number).padStart(4, '0')}`,
      site_name: `${substation.name.replace(' Grid Substation', '')} Solar Site ${String(site).padStart(2, '0')}`,
      meter_id: `MTR-${String(number).padStart(5, '0')}`,
      substation_id: substation.id,
    });
  }
}

// Insert rows in multi-value statements to keep database round trips low.
async function insertBatches(client, table, columns, rows, batchSize = 500) {
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const values = [];
    const tuples = batch.map((row) => `(${columns.map((column) => {
      values.push(row[column]);
      return `$${values.length}`;
    }).join(', ')})`);
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`;
    await client.query(sql, values);
  }
  console.log(`  ${table}: ${rows.length} rows ready`);
}

function readingPower(hour, capacity, weather) {
  // A smooth daylight curve: zero overnight, highest near noon.
  if (hour < 6 || hour >= 18.5) return 0;
  return Number((capacity * weather * Math.sin(Math.PI * (hour - 6) / 12.5)).toFixed(2));
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing from solar-generation-api/.env');
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // Apply the schema before inserting any data.
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);

    await insertBatches(client, 'provinces', ['id', 'name'], provinces);
    await insertBatches(client, 'districts', ['id', 'name', 'province_id'], districts);
    await insertBatches(client, 'grid_substations', ['id', 'name', 'district_id'], substations);
    await insertBatches(client, 'solar_installations', ['id', 'site_name', 'meter_id', 'substation_id'], installations);

    // A shared demo password is hashed once; only its bcrypt hash is stored.
    const demoPassword = 'SolarDemo2026!';
    const passwordHash = await bcrypt.hash(demoPassword, 10);
    const users = districts.map((district, index) => ({
      id: `analyst-${district.id}`,
      username: `analyst-${district.name.toLowerCase().replace(/\s+/g, '-')}`,
      password_hash: passwordHash,
      role: 'district',
      scope: 'analyst-read',
      jurisdiction_level: 'district',
      jurisdiction_id: district.id,
      installation_id: null,
    }));
    for (const installation of installations) {
      users.push({
        id: `device-${installation.id}`,
        username: `device-${installation.meter_id.toLowerCase()}`,
        password_hash: passwordHash,
        role: 'device',
        scope: 'installation-write',
        jurisdiction_level: null,
        jurisdiction_id: null,
        installation_id: installation.id,
      });
    }
    await insertBatches(client, 'users',
      ['id', 'username', 'password_hash', 'role', 'scope', 'jurisdiction_level', 'jurisdiction_id', 'installation_id'], users);

    // Generate seven days of 15-minute readings and insert in bounded batches.
    const readings = [];
    const intervalMs = 15 * 60 * 1000;
    const slots = 7 * 24 * 4;
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - 6);
    for (let siteIndex = 0; siteIndex < installations.length; siteIndex += 1) {
      const installation = installations[siteIndex];
      const capacity = 5 + ((siteIndex * 17) % 116); // varied 5–120 kW site capacity
      let cumulativeEnergy = 0;
      for (let slot = 0; slot < slots; slot += 1) {
        const timestamp = new Date(start.getTime() + slot * intervalMs);
        // Sri Lanka is UTC+5:30, so the daylight curve follows local clock time.
        const hour = (timestamp.getUTCHours() + timestamp.getUTCMinutes() / 60 + 5.5) % 24;
        const day = Math.floor(slot / 96);
        const weather = 0.76 + ((siteIndex * 13 + day * 7) % 25) / 100;
        const power = readingPower(hour, capacity, weather);
        cumulativeEnergy += power * 0.25;
        const voltage = Math.max(215, Math.min(245, 230 - power / capacity * 4 + ((slot + siteIndex) % 7 - 3) * 0.2));
        readings.push({
          id: `r-${installation.id}-${String(slot).padStart(3, '0')}`,
          installation_id: installation.id,
          timestamp: timestamp.toISOString(),
          power_kw: power,
          energy_kwh: Number(cumulativeEnergy.toFixed(3)),
          voltage: Number(voltage.toFixed(1)),
        });
      }
    }
    await insertBatches(client, 'generation_readings',
      ['id', 'installation_id', 'timestamp', 'power_kw', 'energy_kwh', 'voltage'], readings);
    console.log(`Seed complete: ${provinces.length} provinces, ${districts.length} districts, ${substations.length} substations, ${installations.length} installations, ${readings.length} readings, ${users.length} users.`);
    console.log(`Demo password for all seeded users: ${demoPassword}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Seed failed: ${error.message}`);
  process.exitCode = 1;
});
