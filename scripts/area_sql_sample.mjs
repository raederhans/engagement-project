#!/usr/bin/env node
import * as Q from '../src/utils/sql.js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const outPath = process.argv[2] || path.join('logs', `area_sql_${new Date().toISOString().replace(/[:.]/g,'').slice(0,13)}.log`);
await mkdir(path.dirname(outPath), { recursive: true });

const s = '2023-01-01', e = '2023-07-01', d = '14';
const pts = Q.buildCrimePointsSQL({ start: s, end: e, types: ['THEFT'], bbox: { xmin: -8396000, ymin: 4854000, xmax: -8330000, ymax: 4890000 }, dc_dist: d });
const mon = Q.buildMonthlyCitySQL({ start: s, end: e, types: ['THEFT'], dc_dist: d });
const h = Q.buildHeatmap7x24DistrictSQL({ start: s, end: e, types: ['THEFT'], dc_dist: d });

const txt = `-- points\n${pts}\n\n-- monthly(district)\n${mon}\n\n-- 7x24(district)\n${h}\n`;
await writeFile(outPath, txt);
console.log('Wrote', outPath);
