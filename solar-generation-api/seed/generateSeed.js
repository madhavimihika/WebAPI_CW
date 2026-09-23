/**
 * generateSeed.js
 * ---------------------------------------------------------------------------
 * Generates a single seed object (provinces, districts, substations,
 * installations, readings) and writes it to seed.json in the project root.
 *
 * Run with:  node seed/generateSeed.js
 *
 * Readings: 7 days of quarter-hourly (15 min) samples per installation
 * = 7 * 96 = 672 readings per installation, 134,400 in total.
 * The power curve is a diurnal (daytime-only) solar generation curve: zero
 * before ~06:00 and after ~18:30, peaking around solar noon (12:00-13:00).
 *
 * All foreign keys are derived from the arrays that actually exist, so there
 * are no orphan records. A consistency check runs before the file is written.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Small deterministic PRNG (mulberry32) so re-running produces the same seed
// file, which keeps tests and screenshots reproducible.
// ---------------------------------------------------------------------------
function createRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20240921);

/** Random float in [min, max) rounded to `decimals` places. */
function randFloat(min, max, decimals = 2) {
  const value = min + random() * (max - min);
  return Number(value.toFixed(decimals));
}

/** Pick a random element of an array. */
function pick(array) {
  return array[Math.floor(random() * array.length)];
}

// ---------------------------------------------------------------------------
// Reference data: 9 provinces, 25 districts, 20 substations (real Sri Lankan
// province / district / grid substation names).
// ---------------------------------------------------------------------------
const PROVINCE_NAMES = [
  'Western',
  'Central',
  'Southern',
  'Northern',
  'Eastern',
  'North Western',
  'North Central',
  'Uva',
  'Sabaragamuwa',
];

// district name -> province name
const DISTRICT_PROVINCE = [
  ['Colombo', 'Western'],
  ['Gampaha', 'Western'],
  ['Kalutara', 'Western'],
  ['Kandy', 'Central'],
  ['Matale', 'Central'],
  ['Nuwara Eliya', 'Central'],
  ['Galle', 'Southern'],
  ['Matara', 'Southern'],
  ['Hambantota', 'Southern'],
  ['Jaffna', 'Northern'],
  ['Kilinochchi', 'Northern'],
  ['Mannar', 'Northern'],
  ['Vavuniya', 'Northern'],
  ['Mullaitivu', 'Northern'],
  ['Trincomalee', 'Eastern'],
  ['Batticaloa', 'Eastern'],
  ['Ampara', 'Eastern'],
  ['Kurunegala', 'North Western'],
  ['Puttalam', 'North Western'],
  ['Anuradhapura', 'North Central'],
  ['Polonnaruwa', 'North Central'],
  ['Badulla', 'Uva'],
  ['Monaragala', 'Uva'],
  ['Ratnapura', 'Sabaragamuwa'],
  ['Kegalle', 'Sabaragamuwa'],
];

// [substation name, district name]
const SUBSTATIONS = [
  ['Biyagama Grid Substation', 'Gampaha'],
  ['Kelaniya Grid Substation', 'Gampaha'],
  ['Pannipitiya Grid Substation', 'Colombo'],
  ['Kotugoda Grid Substation', 'Gampaha'],
  ['Panadura Grid Substation', 'Kalutara'],
  ['Upper Kotmale Power Station', 'Nuwara Eliya'],
  ['Victoria Grid Substation', 'Nuwara Eliya'],
  ['Galle Grid Substation', 'Galle'],
  ['Matara Grid Substation', 'Matara'],
  ['Hambantota Grid Substation', 'Hambantota'],
  ['Chunnakam Grid Substation', 'Jaffna'],
  ['Killinochchi Grid Substation', 'Kilinochchi'],
  ['Vavuniya Grid Substation', 'Vavuniya'],
  ['Trincomalee Grid Substation', 'Trincomalee'],
  ['Batticaloa Grid Substation', 'Batticaloa'],
  ['Ampara Grid Substation', 'Ampara'],
  ['Kurunegala Grid Substation', 'Kurunegala'],
  ['Anuradhapura Grid Substation', 'Anuradhapura'],
  ['Badulla Grid Substation', 'Badulla'],
  ['Ratnapura Grid Substation', 'Ratnapura'],
];

const INSTALLATIONS_PER_SUBSTATION = 10; // 20 * 10 = 200 installations
const DAYS_OF_READINGS = 7;
const INTERVAL_MINUTES = 15;
const READINGS_PER_DAY = (24 * 60) / INTERVAL_MINUTES; // 96

// ---------------------------------------------------------------------------
// 1. Provinces
// ---------------------------------------------------------------------------
const provinces = PROVINCE_NAMES.map((name, index) => ({
  id: index + 1,
  name: `${name} Province`,
}));

const provinceIdByName = new Map(provinces.map((p) => [p.name, p.id]));

// ---------------------------------------------------------------------------
// 2. Districts (each with a province_id that exists in `provinces`)
// ---------------------------------------------------------------------------
const districts = DISTRICT_PROVINCE.map(([name, provinceName], index) => {
  const province_id = provinceIdByName.get(`${provinceName} Province`);
  if (!province_id) {
    throw new Error(`Unknown province "${provinceName}" for district "${name}"`);
  }
  return { id: index + 1, name, province_id };
});

const districtIdByName = new Map(districts.map((d) => [d.name, d.id]));

// ---------------------------------------------------------------------------
// 3. Substations (each with a district_id that exists in `districts`)
// ---------------------------------------------------------------------------
const substations = SUBSTATIONS.map(([name, districtName], index) => {
  const district_id = districtIdByName.get(districtName);
  if (!district_id) {
    throw new Error(`Unknown district "${districtName}" for substation "${name}"`);
  }
  return { id: index + 1, name, district_id };
});

// ---------------------------------------------------------------------------
// 4. Installations (each with a substation_id that exists in `substations`)
// ---------------------------------------------------------------------------
const SITE_TYPES = [
  'Rooftop Solar',
  'Ground Mount Solar',
  'Solar Farm',
  'Community Solar',
  'Commercial Rooftop Solar',
  'Industrial Solar',
];

const installations = [];
let installationId = 1;

for (const substation of substations) {
  for (let i = 1; i <= INSTALLATIONS_PER_SUBSTATION; i += 1) {
    const type = pick(SITE_TYPES);
    installations.push({
      id: installationId,
      site_name: `${substation.name.replace(' Grid Substation', '').replace(' Power Station', '')} ${type} ${String(i).padStart(2, '0')}`,
      meter_id: `MTR-${String(installationId).padStart(5, '0')}`,
      substation_id: substation.id,
    });
    installationId += 1;
  }
}

// ---------------------------------------------------------------------------
// 5. Readings - one week at 15 minute resolution per installation
//    (672 readings each, 134,400 total).
// ---------------------------------------------------------------------------

/**
 * Fraction of rated capacity produced at a given time of day.
 * Sunrise ~06:00, sunset ~18:30, peak around 12:30 (diurnal curve).
 */
function solarFactor(hourOfDay) {
  const sunrise = 6.0;
  const sunset = 18.5;
  if (hourOfDay <= sunrise || hourOfDay >= sunset) return 0;
  const dayLength = sunset - sunrise;
  const progress = (hourOfDay - sunrise) / dayLength; // 0 -> 1
  return Math.sin(Math.PI * progress);
}

/**
 * Clear-sky factor for a given day of the week: Sri Lanka gets passing cloud
 * and occasional monsoon rain, so some days are cloudier than others.
 */
const dayWeatherFactor = Array.from({ length: DAYS_OF_READINGS }, () =>
  Number((0.7 + random() * 0.3).toFixed(2))
);

const readings = [];
let readingId = 1;

// Week starts Monday 2024-09-02 at 00:00 local time.
const START = new Date('2024-09-02T00:00:00.000Z');

for (const installation of installations) {
  const capacityKw = randFloat(4, 120, 1); // rated DC capacity
  const cloudiness = randFloat(0.9, 1.05, 2); // site-specific derate

  for (let day = 0; day < DAYS_OF_READINGS; day += 1) {
    const weather = dayWeatherFactor[day];
    let dayEnergy = 0; // kWh accumulated over the day, used for energy_kwh

    for (let slot = 0; slot < READINGS_PER_DAY; slot += 1) {
      const timestamp = new Date(START.getTime() + (day * READINGS_PER_DAY + slot) * INTERVAL_MINUTES * 60 * 1000);
      const hourOfDay = (slot * INTERVAL_MINUTES) / 60;

      const solar = solarFactor(hourOfDay);
      let powerKw = solar * capacityKw * weather * cloudiness;
      powerKw *= randFloat(0.92, 1.08, 3); // short-term panel/cloud noise
      powerKw = Math.max(0, Number(powerKw.toFixed(2)));

      // Night-time samples stay exactly 0 with a realistic inverter standby voltage.
      if (powerKw < 0.05) powerKw = 0;

      const energyKwh = Number(((powerKw * INTERVAL_MINUTES) / 60).toFixed(3));
      dayEnergy += energyKwh;

      // AC voltage sits near 230 V, sagging slightly under high output.
      const loadDrop = (powerKw / (capacityKw || 1)) * 4;
      const voltage = Number((230 - loadDrop + randFloat(-1.5, 1.5, 2)).toFixed(1));

      readings.push({
        id: readingId,
        installation_id: installation.id,
        timestamp: timestamp.toISOString(),
        power_kw: powerKw,
        energy_kwh: energyKwh,
        voltage: Math.min(245, Math.max(215, voltage)),
      });
      readingId += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Consistency check: every foreign key must resolve to a real parent id.
// ---------------------------------------------------------------------------
function assertNoOrphans({ provinces, districts, substations, installations, readings }) {
  const provinceIds = new Set(provinces.map((p) => p.id));
  const districtIds = new Set(districts.map((d) => d.id));
  const substationIds = new Set(substations.map((s) => s.id));
  const installationIds = new Set(installations.map((i) => i.id));

  for (const d of districts) {
    if (!provinceIds.has(d.province_id)) throw new Error(`Orphan district ${d.id} -> province ${d.province_id}`);
  }
  for (const s of substations) {
    if (!districtIds.has(s.district_id)) throw new Error(`Orphan substation ${s.id} -> district ${s.district_id}`);
  }
  for (const i of installations) {
    if (!substationIds.has(i.substation_id)) throw new Error(`Orphan installation ${i.id} -> substation ${i.substation_id}`);
  }
  for (const r of readings) {
    if (!installationIds.has(r.installation_id)) throw new Error(`Orphan reading ${r.id} -> installation ${r.installation_id}`);
  }
}

const seed = { provinces, districts, substations, installations, readings };
assertNoOrphans(seed);

// ---------------------------------------------------------------------------
// Write to seed.json in the project root (parent of this script's folder).
// ---------------------------------------------------------------------------
const outputPath = path.join(__dirname, '..', 'seed.json');
fs.writeFileSync(outputPath, JSON.stringify(seed, null, 2));

console.log(`seed.json written to ${outputPath}`);
console.log(`  provinces:     ${provinces.length}`);
console.log(`  districts:     ${districts.length}`);
console.log(`  substations:   ${substations.length}`);
console.log(`  installations: ${installations.length}`);
console.log(`  readings:      ${readings.length} (${DAYS_OF_READINGS} days x ${READINGS_PER_DAY} per day x ${installations.length} installations)`);
console.log('  all foreign keys validated - no orphan records');
