#!/usr/bin/env node
import * as turf from '@turf/turf';

const snapKey = (lon, lat) => `${lon.toFixed(3)},${lat.toFixed(3)}`;

class MinHeap {
  constructor() {
    this.data = [];
  }
  push(item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  }
  pop() {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sink(0);
    }
    return top;
  }
  _bubbleUp(idx) {
    while (idx > 0) {
      const p = Math.floor((idx - 1) / 2);
      if (this.data[p].priority <= this.data[idx].priority) break;
      [this.data[p], this.data[idx]] = [this.data[idx], this.data[p]];
      idx = p;
    }
  }
  _sink(idx) {
    const n = this.data.length;
    while (true) {
      let smallest = idx;
      const l = idx * 2 + 1;
      const r = idx * 2 + 2;
      if (l < n && this.data[l].priority < this.data[smallest].priority) smallest = l;
      if (r < n && this.data[r].priority < this.data[smallest].priority) smallest = r;
      if (smallest === idx) break;
      [this.data[smallest], this.data[idx]] = [this.data[idx], this.data[smallest]];
      idx = smallest;
    }
  }
  get size() {
    return this.data.length;
  }
}

export class SegmentGraph {
  constructor(segments = [], { safetyBySegmentId = new Map() } = {}) {
    this.nodes = new Map(); // id -> {lon,lat}
    this.adj = new Map(); // id -> edges
    this.safety = safetyBySegmentId;
    this._build(segments);
  }

  _build(segments) {
    segments.forEach((seg) => {
      const coords = seg?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return;
      const a = coords[0];
      const b = coords[coords.length - 1];
      const fromId = snapKey(a[0], a[1]);
      const toId = snapKey(b[0], b[1]);
      if (!this.nodes.has(fromId)) this.nodes.set(fromId, { lon: a[0], lat: a[1] });
      if (!this.nodes.has(toId)) this.nodes.set(toId, { lon: b[0], lat: b[1] });
      const len = Number(seg.properties?.length_m) || turf.length(seg, { units: 'kilometers' }) * 1000;
      const cls = seg.properties?.class ?? 3;
      const id = seg.properties?.segment_id;
      const edge = { segment_id: id, from: fromId, to: toId, length_m: len, class: cls };
      this._addEdge(fromId, toId, edge);
      this._addEdge(toId, fromId, edge);
    });
  }

  _addEdge(fromId, toId, edge) {
    if (!this.adj.has(fromId)) this.adj.set(fromId, []);
    this.adj.get(fromId).push({ ...edge, from: fromId, to: toId });
  }

  findNearestNode(lon, lat, { maxRadiusM = 500 } = {}) {
    let best = null;
    let bestDist = Infinity;
    this.nodes.forEach((coord, id) => {
      // quick bbox reject
      if (Math.abs(coord.lon - lon) > 0.1 || Math.abs(coord.lat - lat) > 0.1) return;
      const d = turf.distance([lon, lat], [coord.lon, coord.lat], { units: 'kilometers' }) * 1000;
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    });
    if (best !== null && bestDist <= maxRadiusM) return best;
    return null;
  }

  _edgeCost(edge, { costKind = 'base', safetyPenaltyFactor = 1.0 } = {}) {
    if (costKind === 'alt') {
      const score = this.safety.get(edge.segment_id) ?? 3;
      return edge.length_m * (1 + safetyPenaltyFactor * (6 - score) / 5);
    }
    return edge.length_m;
  }

  findShortestPath(startNodeId, endNodeId, opts = {}) {
    if (!startNodeId || !endNodeId || !this.nodes.has(startNodeId) || !this.nodes.has(endNodeId)) {
      return null;
    }
    const dist = new Map();
    const prev = new Map();
    const prevEdge = new Map();
    const heap = new MinHeap();
    dist.set(startNodeId, 0);
    heap.push({ node: startNodeId, priority: 0 });
    while (heap.size > 0) {
      const { node: u } = heap.pop();
      if (u === endNodeId) break;
      const neighbors = this.adj.get(u) || [];
      for (const edge of neighbors) {
        const v = edge.to;
        const alt = (dist.get(u) || 0) + this._edgeCost(edge, opts);
        if (alt < (dist.get(v) ?? Infinity)) {
          dist.set(v, alt);
          prev.set(v, u);
          prevEdge.set(v, edge);
          heap.push({ node: v, priority: alt });
        }
      }
    }
    if (!dist.has(endNodeId)) return null;
    const nodePath = [];
    const segmentPath = [];
    let cur = endNodeId;
    while (cur) {
      nodePath.push(cur);
      const edge = prevEdge.get(cur);
      if (edge) segmentPath.push(edge.segment_id);
      cur = prev.get(cur);
    }
    nodePath.reverse();
    segmentPath.reverse();
    return {
      nodePath,
      segmentPath,
      totalLengthM: dist.get(endNodeId) || 0,
    };
  }
}

export function buildSegmentGraph(segments, options = {}) {
  return new SegmentGraph(segments, options);
}

// CLI sample (smoke test)
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const path = new URL('../data/segments_phl.network.geojson', import.meta.url);
  const fc = JSON.parse(fs.readFileSync(path, 'utf8'));
  const graph = buildSegmentGraph(fc.features || []);
  const nodes = Array.from(graph.nodes.keys());
  const a = nodes[0];
  const b = nodes[nodes.length - 1];
  const route = graph.findShortestPath(a, b, { costKind: 'base' });
  console.info('[Graph] nodes', graph.nodes.size, 'edges', Array.from(graph.adj.values()).reduce((s, arr) => s + arr.length, 0));
  if (route) {
    console.info('[Graph] sample path segments', route.segmentPath.length, 'len_m', route.totalLengthM.toFixed(1));
  } else {
    console.warn('[Graph] no sample path found');
  }
}
