import { quantileBreaks } from '../map/style_helpers.js';

export function computeBreaks(values, { method = 'quantile', bins = 5, custom = [] } = {}) {
  const nums = (values || []).map(Number).filter((v) => Number.isFinite(v));
  if (nums.length === 0) return [];
  bins = clamp(Math.floor(bins || 5), 2, 9);

  if (method === 'custom') {
    const arr = Array.isArray(custom) ? custom.map(Number).filter(Number.isFinite).sort((a,b)=>a-b) : [];
    return uniqueAsc(arr);
  }

  if (method === 'equal') {
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    if (min === max) return [];
    const step = (max - min) / bins;
    const br = [];
    for (let i = 1; i < bins; i++) br.push(Number((min + step * i).toFixed(2)));
    return br;
  }

  // default quantile
  return quantileBreaks(nums, bins);
}

export function makePalette(name = 'Blues', bins = 5) {
  const PALETTES = {
    Blues: ['#f1eef6', '#bdc9e1', '#74a9cf', '#2b8cbe', '#045a8d'],
    YlGnBu: ['#ffffcc', '#c2e699', '#78c679', '#31a354', '#006837'],
    OrRd: ['#feedde', '#fdbe85', '#fd8d3c', '#e6550d', '#a63603'],
    PuBuGn: ['#f6eff7', '#bdc9e1', '#67a9cf', '#1c9099', '#016c59'],
    Greens: ['#edf8e9', '#bae4b3', '#74c476', '#31a354', '#006d2c'],
    Purples: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'],
    BuGn: ['#f7fcfd', '#ccece6', '#66c2a4', '#238b45', '#005824'],
    BuPu: ['#f7fcfd', '#b3cde3', '#8c96c6', '#8856a7', '#810f7c'],
    GnBu: ['#f7fcf0', '#ccebc5', '#7bccc4', '#2b8cbe', '#08589e'],
    YlOrRd: ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'],
    RdBu: ['#b2182b', '#ef8a62', '#fddbc7', '#67a9cf', '#2166ac'], // diverging
  };
  const base = PALETTES[name] || PALETTES.Blues;
  // Create a palette of length == bins (breaks.length+1)
  return interpolatePalette(base, bins);
}

export function toMapLibreStep(breaks, colors, { opacity = 0.75 } = {}) {
  const stepExpr = ['step', ['coalesce', ['get', 'value'], 0], colors[0]];
  for (let i = 0; i < (breaks || []).length; i++) {
    stepExpr.push(breaks[i], colors[Math.min(i + 1, colors.length - 1)]);
  }
  return { paintProps: { 'fill-color': stepExpr, 'fill-opacity': opacity } };
}

function interpolatePalette(base, bins) {
  if (bins <= base.length) return base.slice(0, bins);
  const out = [];
  for (let i = 0; i < bins; i++) {
    const t = i / Math.max(1, bins - 1);
    const idx = t * (base.length - 1);
    const a = Math.floor(idx), b = Math.min(base.length - 1, a + 1);
    out.push(mixHex(base[a], base[b], idx - a));
  }
  return out;
}

function mixHex(h1, h2, t) {
  const c1 = hexToRgb(h1), c2 = hexToRgb(h2);
  const m = (a,b)=> Math.round(a*(1-t)+b*t);
  return rgbToHex(m(c1[0],c2[0]), m(c1[1],c2[1]), m(c1[2],c2[2]));
}

function hexToRgb(h) {
  const s = h.replace('#','');
  const n = s.length === 3 ? s.split('').map(ch=>ch+ch).join('') : s;
  return [parseInt(n.slice(0,2),16), parseInt(n.slice(2,4),16), parseInt(n.slice(4,6),16)];
}
function rgbToHex(r,g,b){ return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function uniqueAsc(a){ const out=[]; for(const v of a){ if(!out.includes(v)) out.push(v);} return out; }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

