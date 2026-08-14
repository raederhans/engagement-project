import {
  contentIdentity,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';

export const OSM_WALK_PROFILE_SCHEMA = 'route-real-graph-osm-walk-profile/v1';
export const OSM_WALK_PROFILE_ID = 'osm-walking-strict-candidate-v1';

export const OSM_WALK_PROFILE = freezeData({
  schema: OSM_WALK_PROFILE_SCHEMA,
  profileId: OSM_WALK_PROFILE_ID,
  sourceKind: 'osm',
  mode: 'walking',
  inputSchema: 'route-real-graph-osm-intermediate/v1',
  inputRecordSchema: 'route-real-graph-osm-edge-record/v1',
  outputRawSchema: 'route-graph-raw-candidate/v1',
  outputNormalizedSchema: 'route-graph-candidate/v1',
  decisions: {
    highway: {
      allowed: [
        'footway', 'living_street', 'path', 'pedestrian', 'primary', 'primary_link',
        'residential', 'secondary', 'secondary_link', 'service', 'steps', 'tertiary',
        'tertiary_link', 'track', 'unclassified',
      ],
      excluded: [
        'bridleway', 'construction', 'cycleway', 'motorway', 'motorway_link',
        'platform', 'proposed', 'raceway', 'trunk', 'trunk_link',
      ],
      missing: 'reject-unless-route-ferry',
      unknown: 'reject',
    },
    foot: {
      allowed: ['designated', 'official', 'permissive', 'yes'],
      excluded: ['customers', 'destination', 'no', 'private', 'use_sidepath'],
      missing: 'reject',
      unknown: 'reject',
    },
    access: {
      allowed: ['permissive', 'public', 'yes'],
      excluded: ['agricultural', 'customers', 'delivery', 'destination', 'forestry', 'no', 'private'],
      missing: 'reject',
      unknown: 'reject',
    },
    oneway: {
      footOverride: ['-1', 'no', 'yes'],
      general: ['-1', '0', '1', 'false', 'no', 'true', 'yes'],
      missingFootOverride: 'use-general-oneway',
      missingGeneral: 'bidirectional-profile-default',
      unknown: 'reject',
    },
    stairs: {
      selector: 'highway=steps',
      disposition: 'include-when-foot-and-access-are-explicitly-allowed',
      costAdjustment: 'none-distance-millimeters-only',
      accessibility: 'unavailable',
    },
    ferry: {
      selector: 'route=ferry',
      disposition: 'include-when-foot-and-access-are-explicitly-allowed',
      missingRoute: 'not-ferry',
      unknownRoute: 'reject',
    },
    construction: {
      selector: 'highway=construction-or-construction-tag-present',
      disposition: 'exclude',
      missingConstructionTag: 'not-construction-unless-highway-is-construction',
      unknownConstructionValue: 'exclude-not-pass',
    },
    conditional: {
      fields: ['access', 'foot', 'oneway', 'onewayFoot'],
      missing: 'no-conditional-expression-present',
      present: 'reject-unresolved',
      unknown: 'reject',
    },
    geometry: {
      coordinateOrder: 'longitude-latitude',
      inputUnit: 'decimal-degrees',
      rounding: 'nearest-1e-7-degrees-using-ecmascript-math-round',
      minimumPointCount: 2,
      maximumPointCount: 4096,
    },
    boundary: {
      clipping: 'extractor-preclipped-with-explicit-endpoint-markers',
      outsideInputPolicy: 'reject',
      unknownClipping: 'reject',
      crossBoundaryCorrectness: 'unavailable',
    },
    turnRestrictions: {
      status: 'unavailable',
      acceptedReason: 'not-extracted',
      interpretation: 'not-applied-and-not-treated-as-empty',
    },
    distanceAndCost: {
      inputDistanceUnit: 'integer-millimeters',
      outputCostUnit: 'integer-millimeters',
      conversion: 'identity',
      minimum: 1,
      maximum: 2_000_000_000,
    },
    identityAndOrder: {
      edgeRecordId: 'osm-way:{wayId}:segment:{segmentIndex}:part:{partIndex}',
      sourceNodeId: 'osm-node:{nodeId}',
      clippedNodeId: 'clip:{boundaryId}:{wayId}:{segmentIndex}:{partIndex}:{from|to}',
      outputOrder: 'ascending-code-unit-order-by-source-edge-id',
      downstreamIds: 'existing-candidate-sha256-stable-node-and-edge-identities',
    },
  },
  candidateProfile: {
    schema: 'route-graph-mode-profile/v1',
    profileId: OSM_WALK_PROFILE_ID,
    sourceKind: 'osm',
    mode: 'walking',
    fields: {
      sourceEdgeId: 'source_edge_id',
      fromNodeId: 'from_node_id',
      toNodeId: 'to_node_id',
      geometry: 'geometry_lon_lat_1e7',
      cost: 'cost_millimeters',
      oneway: 'walk_direction',
      access: 'walk_access',
      mode: 'mode',
    },
    oneway: {
      forward: ['forward'],
      reverse: ['reverse'],
      bidirectional: ['bidirectional'],
      missing: 'reject',
      unknown: 'reject',
    },
    access: {
      allowed: ['allowed'],
      denied: ['denied'],
      missing: 'reject',
      unknown: 'reject',
    },
    modeValues: {
      allowed: ['walking'],
      missing: 'reject',
      unknown: 'reject',
    },
    cost: {
      unit: 'integer',
      minimum: 1,
      maximum: 2_000_000_000,
    },
  },
  claims: {
    candidateOnly: true,
    accessibility: 'not-established',
    safety: 'not-established',
    completeness: 'not-established',
    cityCorrectness: 'not-established',
    productRouting: 'not-authorized',
    publication: 'not-authorized',
  },
}, 'OSM strict walking profile');

export const OSM_WALK_PROFILE_IDENTITY = contentIdentity(OSM_WALK_PROFILE);
