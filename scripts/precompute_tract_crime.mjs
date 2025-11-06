#!/usr/bin/env node
// Generate last-12-months tract crime totals snapshot

import fs from 'node:fs/promises';
import path from 'node:path';

const CARTO = 'https://phl.carto.com/api/v2/sql';
const OUT = path.join('src','data','tract_crime_counts_last12m.json');
const LOG_DIR = 'logs';
const ts = new Date().toISOString().replace(/[:.]/g,'').slice(0,15);
const LOG = path.join(LOG_DIR, `precompute_tract_crime_${ts}.log`);

async function log(line){ await fs.mkdir(LOG_DIR,{recursive:true}); await fs.appendFile(LOG, `[${new Date().toISOString()}] ${line}\n`); }

function roundGeom(g){ const r6=n=>Math.round(n*1e6)/1e6; const rc=c=>Array.isArray(c[0])?c.map(rc):[r6(c[0]),r6(c[1])]; if(g.type==='Polygon')return{type:'Polygon',coordinates:rc(g.coordinates)}; if(g.type==='MultiPolygon')return{type:'MultiPolygon',coordinates:g.coordinates.map(rc)}; return g; }
function bbox4326(g){ let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity; const visit=c=>{ if(!Array.isArray(c))return; if(typeof c[0]==='number'){ const x=c[0],y=c[1]; if(x<minx)minx=x; if(y<miny)miny=y; if(x>maxx)maxx=x; if(y>maxy)maxy=y; } else { for(const n of c) visit(n); } }; if(g.type==='Polygon')visit(g.coordinates); else if(g.type==='MultiPolygon')visit(g.coordinates); if(!Number.isFinite(minx))return null; return [minx,miny,maxx,maxy]; }

function toSQL(geom, start, end){ const gj = JSON.stringify(geom).replace(/'/g,"''"); const bb=bbox4326(geom); const env = bb?`\n  AND the_geom && ST_Transform(ST_MakeEnvelope(${bb[0]},${bb[1]},${bb[2]},${bb[3]},4326),3857)`:''; return `SELECT COUNT(*)::int AS n FROM incidents_part1_part2\nWHERE dispatch_date_time >= '${start}'\n  AND dispatch_date_time <  '${end}'${env}\n  AND ST_Intersects(the_geom, ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${gj}'),4326),3857))`; }

async function postSQL(sql){ for (let i=0;i<3;i++){ const controller = new AbortController(); const timer=setTimeout(()=>controller.abort(), 20000); try { const res=await fetch(CARTO,{ method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:`q=${encodeURIComponent(sql)}`, signal:controller.signal}); if(!res.ok) throw new Error(`HTTP ${res.status}`); const json=await res.json(); clearTimeout(timer); const n = Number(json?.rows?.[0]?.n)||0; return n; } catch(e){ clearTimeout(timer); const back=[1000,2000,4000][Math.min(i,2)]; await log(`postSQL attempt ${i+1} failed: ${e?.message||e}`); if(i===2) throw e; await new Promise(r=>setTimeout(r, back)); } } }

async function main(){
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  const endD = new Date(); endD.setHours(0,0,0,0); const startD = new Date(endD); startD.setMonth(startD.getMonth()-12);
  const end = new Date(endD.getTime()+24*3600*1000).toISOString().slice(0,10);
  const start = startD.toISOString().slice(0,10);
  await log(`window=[${start}, ${end})`);
  // Load tracts from public cache or fallback URL
  let tracts; try { tracts = JSON.parse(await fs.readFile(path.join('public','data','tracts_phl.geojson'),'utf8')); } catch { const url = 'http://localhost:4173/data/tracts_phl.geojson'; try { const r=await fetch(url); tracts = await r.json(); } catch(e){ await log(`Failed to load tracts: ${e?.message||e}`); throw e; } }
  const rows = [];
  let done=0;
  for (const ft of tracts.features || []){
    const p = ft.properties || {}; const geoid = String(p.GEOID || p.GEOID20 || (p.STATE&&p.COUNTY&&p.TRACT?(String(p.STATE).padStart(2,'0')+String(p.COUNTY).padStart(3,'0')+String(p.TRACT).padStart(6,'0')):''));
    if (!geoid) continue;
    const geom = roundGeom(ft.geometry);
    const sql = toSQL(geom, start, end);
    try {
      const n = await postSQL(sql);
      rows.push({ geoid, n });
      if (++done % 25 === 0) await log(`progress ${done}/${(tracts.features||[]).length}`);
    } catch(e){ await log(`FAIL ${geoid}: ${e?.message||e}`); }
  }
  const out = { meta: { start, end, generated_at: new Date().toISOString() }, rows };
  await fs.writeFile(OUT, JSON.stringify(out));
  await log(`DONE rows=${rows.length} saved to ${OUT}`);
  console.log(`Saved ${OUT}`);
}

main().catch(async (e)=>{ await log(`FATAL ${e?.message||e}`); process.exit(1); });

