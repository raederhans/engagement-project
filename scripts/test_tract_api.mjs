/**
 * Test script: Verify CARTO API can return tract-level crime data
 * Usage: node scripts/test_tract_api.mjs
 *
 * Tests three queries using ST_Intersects with tract geometry:
 * 1. Monthly time series
 * 2. Top-N offense types
 * 3. 7×24 heatmap
 */

import { readFile } from 'fs/promises';

const CARTO_BASE = 'https://phl.carto.com/api/v2/sql';
const START = '2024-01-01';
const END = '2024-07-01';

async function main() {
  console.log('='.repeat(80));
  console.log('TRACT-LEVEL DATA AVAILABILITY TEST');
  console.log('='.repeat(80));
  console.log(`Date Range: ${START} to ${END}`);
  console.log(`CARTO Endpoint: ${CARTO_BASE}`);
  console.log('');

  // Load tract geometry
  const tractsData = JSON.parse(await readFile('public/data/tracts_phl.geojson', 'utf8'));
  const testTract = tractsData.features[0]; // GEOID: 42101030100
  const geoid = testTract.properties.GEOID;
  const geomStr = JSON.stringify(testTract.geometry);

  console.log(`Test Tract: GEOID ${geoid}`);
  console.log(`  Name: ${testTract.properties.NAME}`);
  console.log(`  Land Area: ${testTract.properties.ALAND} sq meters`);
  console.log('');

  // Test 1: Monthly time series
  console.log('TEST 1: Monthly Time Series');
  console.log('-'.repeat(80));
  const sql1 = `
    SELECT
      TO_CHAR(DATE_TRUNC('month', dispatch_date_time), 'YYYY-MM') AS m,
      COUNT(*) AS n
    FROM incidents_part1_part2
    WHERE dispatch_date_time >= '${START}'
      AND dispatch_date_time < '${END}'
      AND ST_Intersects(
        the_geom,
        ST_SetSRID(ST_GeomFromGeoJSON('${geomStr.replace(/'/g, "''")}'), 4326)
      )
    GROUP BY 1
    ORDER BY 1
  `.trim();

  try {
    const url1 = `${CARTO_BASE}?q=${encodeURIComponent(sql1)}&format=json`;
    console.log(`Fetching: ${url1.slice(0, 120)}...`);
    const res1 = await fetch(url1);
    const data1 = await res1.json();

    if (data1.rows) {
      console.log(`✅ SUCCESS: ${data1.rows.length} months with data`);
      console.log('Sample:', JSON.stringify(data1.rows.slice(0, 3), null, 2));
    } else {
      console.log('❌ FAILED:', data1.error || 'No rows returned');
    }
  } catch (err) {
    console.log('❌ ERROR:', err.message);
  }
  console.log('');

  // Test 2: Top-N offense types
  console.log('TEST 2: Top-N Offense Types');
  console.log('-'.repeat(80));
  const sql2 = `
    SELECT
      text_general_code,
      COUNT(*) AS n
    FROM incidents_part1_part2
    WHERE dispatch_date_time >= '${START}'
      AND dispatch_date_time < '${END}'
      AND ST_Intersects(
        the_geom,
        ST_SetSRID(ST_GeomFromGeoJSON('${geomStr.replace(/'/g, "''")}'), 4326)
      )
    GROUP BY text_general_code
    ORDER BY n DESC
    LIMIT 10
  `.trim();

  try {
    const url2 = `${CARTO_BASE}?q=${encodeURIComponent(sql2)}&format=json`;
    console.log(`Fetching: ${url2.slice(0, 120)}...`);
    const res2 = await fetch(url2);
    const data2 = await res2.json();

    if (data2.rows) {
      console.log(`✅ SUCCESS: ${data2.rows.length} offense types found`);
      console.log('Top 5:', JSON.stringify(data2.rows.slice(0, 5), null, 2));
    } else {
      console.log('❌ FAILED:', data2.error || 'No rows returned');
    }
  } catch (err) {
    console.log('❌ ERROR:', err.message);
  }
  console.log('');

  // Test 3: 7×24 heatmap
  console.log('TEST 3: 7×24 Heatmap (Day-of-Week × Hour)');
  console.log('-'.repeat(80));
  const sql3 = `
    SELECT
      EXTRACT(DOW FROM dispatch_date_time)::INTEGER AS dow,
      EXTRACT(HOUR FROM dispatch_date_time)::INTEGER AS hr,
      COUNT(*) AS n
    FROM incidents_part1_part2
    WHERE dispatch_date_time >= '${START}'
      AND dispatch_date_time < '${END}'
      AND ST_Intersects(
        the_geom,
        ST_SetSRID(ST_GeomFromGeoJSON('${geomStr.replace(/'/g, "''")}'), 4326)
      )
    GROUP BY dow, hr
    ORDER BY dow, hr
  `.trim();

  try {
    const url3 = `${CARTO_BASE}?q=${encodeURIComponent(sql3)}&format=json`;
    console.log(`Fetching: ${url3.slice(0, 120)}...`);
    const res3 = await fetch(url3);
    const data3 = await res3.json();

    if (data3.rows) {
      console.log(`✅ SUCCESS: ${data3.rows.length} time slots with data (max 7×24=168)`);
      const sample = data3.rows.filter(r => r.n > 5).slice(0, 5);
      console.log('Sample (n > 5):', JSON.stringify(sample, null, 2));
    } else {
      console.log('❌ FAILED:', data3.error || 'No rows returned');
    }
  } catch (err) {
    console.log('❌ ERROR:', err.message);
  }
  console.log('');

  console.log('='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));
  console.log('If all three tests show ✅ SUCCESS, then:');
  console.log('  - Crime data EXISTS for census tracts (not just geometry)');
  console.log('  - ST_Intersects queries work correctly');
  console.log('  - Tract charts are implementable with ~2 hours of work');
  console.log('');
  console.log('If tests FAIL, check:');
  console.log('  - CARTO API endpoint availability');
  console.log('  - Network connectivity');
  console.log('  - GeoJSON geometry format compatibility with PostGIS');
}

main().catch(console.error);
