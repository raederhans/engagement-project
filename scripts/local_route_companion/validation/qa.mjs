import { createHash } from 'node:crypto';

import { canonicalIdentity } from './canonical.mjs';

export const qaSelectionRank = (policyIdentity, segment) => createHash('sha256')
  .update(`${policyIdentity}\0${segment.routeIdentity}\0${segment.segmentIdentity}`)
  .digest('hex');

export const qaSampleId = (policyIdentity, segment) => canonicalIdentity({
  policyIdentity,
  routeIdentity: segment.routeIdentity,
  segmentIdentity: segment.segmentIdentity,
});

export const qaEligibleUniverseIdentity = (segments) => canonicalIdentity([...segments]
  .map((segment) => ({
    segmentIdentity: segment.segmentIdentity,
    routeIdentity: segment.routeIdentity,
    region: segment.region,
    distanceClass: segment.distanceClass,
    featureTags: [...segment.featureTags].sort(),
  }))
  .sort((left, right) => left.segmentIdentity.localeCompare(right.segmentIdentity)));

export function selectDeterministicQaSample(segments, policy) {
  if (!Array.isArray(segments)) throw new Error('segments must be an array');
  const seen = new Set();
  const groups = new Map();
  for (const segment of segments) {
    if (!segment?.segmentIdentity || !segment?.routeIdentity || seen.has(segment.segmentIdentity)) throw new Error('segments require unique segment and route identities');
    seen.add(segment.segmentIdentity);
    const tag = [...(segment.featureTags || [])].sort()[0] || 'untagged';
    const stratum = `${segment.region}|${segment.distanceClass}|${tag}`;
    const entries = groups.get(stratum) || [];
    entries.push({ segment, rank: qaSelectionRank(policy.identity, segment) });
    groups.set(stratum, entries);
  }
  for (const entries of groups.values()) entries.sort((left, right) => left.rank.localeCompare(right.rank));
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  const selected = [];
  for (let offset = 0; selected.length < policy.targetSegmentCount; offset += 1) {
    let added = false;
    for (const [, entries] of orderedGroups) {
      if (entries[offset]) {
        selected.push(entries[offset].segment);
        added = true;
        if (selected.length === policy.targetSegmentCount) break;
      }
    }
    if (!added) break;
  }
  return selected;
}
