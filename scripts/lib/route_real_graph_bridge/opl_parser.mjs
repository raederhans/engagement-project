import { contentIdentity, fail } from '../route_graph_candidate/safe_data.mjs';
import { OPL_INGRESS_LIMITS } from './contracts.mjs';
import { preflightReviewedOplUtf8Text } from './primitive_ingress.mjs';

const DECIMAL_ID_PATTERN = /^[1-9][0-9]{0,18}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]{0,15}$/;
const COORDINATE_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,7})?$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const WAY_NODE_PATTERN =
  /^n([1-9][0-9]{0,18})x(-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,7})?)y(-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,7})?)$/;
const RELATION_MEMBER_PATTERN = /^([nwr])([1-9][0-9]{0,18})@(.+)$/u;

const WAY_TAG_ORDER = Object.freeze([
  'highway',
  'foot',
  'access',
  'oneway',
  'oneway:foot',
  'route',
  'construction',
  'foot:conditional',
  'access:conditional',
  'oneway:conditional',
  'oneway:foot:conditional',
]);
const WAY_TAG_INDEX = new Map(WAY_TAG_ORDER.map((key, index) => [key, index]));
const RELATION_TAG_ORDER = Object.freeze(['type', 'restriction', 'restriction:foot']);
const RELATION_TAG_INDEX = new Map(RELATION_TAG_ORDER.map((key, index) => [key, index]));
const RELATION_ROLES = new Set(['from', 'to', 'via']);

export function parseReviewedOsmiumOplText(oplText) {
  if (arguments.length !== 1) {
    fail('opl-arguments', 'OPL parsing accepts exactly one primitive text input');
  }
  const utf8ByteCount = preflightReviewedOplUtf8Text(oplText, 'osmium OPL');
  const preflight = preflightLines(oplText);
  const state = {
    phase: 0,
    lastIds: { n: null, w: null, r: null },
    nodeRecords: 0,
    wayRecords: 0,
    relationRecords: 0,
    edgeRecords: 0,
    tokens: 0,
    tags: 0,
    nodeReferences: 0,
    relationMembers: 0,
    geometryPoints: 0,
    nodes: new Map(),
    ways: [],
  };

  let start = 0;
  let lineNumber = 0;
  while (start < oplText.length) {
    const end = oplText.indexOf('\n', start);
    lineNumber += 1;
    parseLine(oplText.slice(start, end), lineNumber, state);
    start = end + 1;
  }
  if (lineNumber !== preflight.lineCount) {
    fail('opl-line-count-drift', 'OPL line count changed after preflight');
  }
  if (state.tokens !== preflight.tokenCount) {
    fail('opl-token-count-drift', 'OPL token count changed after preflight');
  }
  if (state.relationRecords !== 0) {
    fail(
      'relation-turn-restrictions-unavailable',
      'relation records and turn-restriction application are explicitly unavailable in RD-F',
    );
  }
  if (state.wayRecords === 0 || state.edgeRecords === 0) {
    fail('opl-no-walking-edges', 'OPL must contain at least one way with one consecutive node pair');
  }

  return {
    oplIdentity: contentIdentity(oplText),
    utf8ByteCount,
    nodes: state.nodes,
    ways: state.ways,
    audit: {
      lineCount: preflight.lineCount,
      tokenCount: state.tokens,
      tagCount: state.tags,
      nodeRecordCount: state.nodeRecords,
      wayRecordCount: state.wayRecords,
      relationRecordCount: state.relationRecords,
      nodeReferenceCount: state.nodeReferences,
      relationMemberCount: state.relationMembers,
      edgeRecordCount: state.edgeRecords,
      aggregateGeometryPointCount: state.geometryPoints,
      objectOrder: 'nodes-then-ways-then-relations-id-ascending',
      nodeLocations: 'all-way-references-present-and-token-identical',
      turnRestrictions: 'unavailable-not-applied-not-empty',
    },
  };
}

function preflightLines(text) {
  if (!text.endsWith('\n')) fail('opl-final-newline', 'OPL must end in exactly one LF-terminated record');
  let lineCount = 0;
  let lineLength = 0;
  let lineTokens = 1;
  let tokenCount = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x0d) fail('opl-carriage-return', 'OPL admits LF line endings only');
    if (code === 0x00) fail('opl-nul', 'OPL must not contain NUL');
    if (code === 0x09) fail('opl-tab', 'OPL fields must use one ASCII space, not tabs');
    if (code === 0x0a) {
      if (lineLength === 0) fail('opl-empty-line', 'OPL must not contain empty records');
      lineCount += 1;
      if (lineCount > OPL_INGRESS_LIMITS.maximumLines) {
        fail('opl-line-limit', `OPL exceeds ${OPL_INGRESS_LIMITS.maximumLines} lines`);
      }
      tokenCount += lineTokens;
      if (tokenCount > OPL_INGRESS_LIMITS.maximumTokens) {
        fail('opl-token-limit', `OPL exceeds ${OPL_INGRESS_LIMITS.maximumTokens} tokens`);
      }
      lineLength = 0;
      lineTokens = 1;
      continue;
    }
    if (code === 0x20) lineTokens += 1;
    lineLength += 1;
    if (lineLength > OPL_INGRESS_LIMITS.maximumLineCodeUnits) {
      fail(
        'opl-line-length-limit',
        `OPL line exceeds ${OPL_INGRESS_LIMITS.maximumLineCodeUnits} code units`,
      );
    }
  }
  return { lineCount, tokenCount };
}

function parseLine(line, lineNumber, state) {
  if (line.startsWith(' ') || line.endsWith(' ') || line.includes('  ')) {
    fail('opl-field-spacing', `OPL line ${lineNumber} must use exactly one space between fields`);
  }
  const tokens = line.split(' ');
  state.tokens += tokens.length;
  if (state.tokens > OPL_INGRESS_LIMITS.maximumTokens) {
    fail('opl-token-limit', `OPL exceeds ${OPL_INGRESS_LIMITS.maximumTokens} tokens`);
  }
  for (const token of tokens) {
    if (token.length > OPL_INGRESS_LIMITS.maximumTokenCodeUnits) {
      fail('opl-token-length-limit', `OPL line ${lineNumber} contains an oversized token`);
    }
  }
  const recordType = tokens[0]?.[0];
  if (recordType === 'n') return parseNode(tokens, lineNumber, state);
  if (recordType === 'w') return parseWay(tokens, lineNumber, state);
  if (recordType === 'r') return parseRelation(tokens, lineNumber, state);
  fail('opl-record-type', `OPL line ${lineNumber} contains an unsupported record type`);
}

function parseNode(tokens, lineNumber, state) {
  exactFieldSequence(tokens, ['n', 'v', 't', 'T', 'x', 'y'], lineNumber);
  enterRecord('n', tokens[0].slice(1), lineNumber, state);
  state.nodeRecords += 1;
  if (state.nodeRecords > OPL_INGRESS_LIMITS.maximumNodeRecords) {
    fail('opl-node-limit', `OPL exceeds ${OPL_INGRESS_LIMITS.maximumNodeRecords} node records`);
  }
  positiveInteger(tokens[1].slice(1), `OPL line ${lineNumber} node version`);
  exactOplTimestamp(tokens[2].slice(1), `OPL line ${lineNumber} node timestamp`);
  const tags = parseTags(tokens[3].slice(1), 'node', lineNumber, state);
  if (tags.size !== 0) {
    fail('opl-node-tags-unavailable', `OPL line ${lineNumber} tagged nodes are outside the RD-B subset`);
  }
  const longitude = coordinate(tokens[4].slice(1), 'longitude', lineNumber);
  const latitude = coordinate(tokens[5].slice(1), 'latitude', lineNumber);
  const id = tokens[0].slice(1);
  state.nodes.set(id, {
    id,
    longitude: longitude.value,
    latitude: latitude.value,
    longitudeToken: longitude.token,
    latitudeToken: latitude.token,
  });
}

function parseWay(tokens, lineNumber, state) {
  exactFieldSequence(tokens, ['w', 'v', 't', 'T', 'N'], lineNumber);
  enterRecord('w', tokens[0].slice(1), lineNumber, state);
  state.wayRecords += 1;
  if (state.wayRecords > OPL_INGRESS_LIMITS.maximumWayRecords) {
    fail('opl-way-limit', `OPL exceeds ${OPL_INGRESS_LIMITS.maximumWayRecords} way records`);
  }
  positiveInteger(tokens[1].slice(1), `OPL line ${lineNumber} way version`);
  exactOplTimestamp(tokens[2].slice(1), `OPL line ${lineNumber} way timestamp`);
  const tagMap = parseTags(tokens[3].slice(1), 'way', lineNumber, state);
  const refs = parseWayNodes(tokens[4].slice(1), lineNumber, state);
  state.ways.push({
    id: tokens[0].slice(1),
    refs,
    tags: rdBTags(tagMap),
  });
}

function parseRelation(tokens, lineNumber, state) {
  exactFieldSequence(tokens, ['r', 'v', 't', 'T', 'M'], lineNumber);
  enterRecord('r', tokens[0].slice(1), lineNumber, state);
  state.relationRecords += 1;
  if (state.relationRecords > OPL_INGRESS_LIMITS.maximumRelationRecords) {
    fail(
      'opl-relation-limit',
      `OPL exceeds ${OPL_INGRESS_LIMITS.maximumRelationRecords} relation records`,
    );
  }
  positiveInteger(tokens[1].slice(1), `OPL line ${lineNumber} relation version`);
  exactOplTimestamp(tokens[2].slice(1), `OPL line ${lineNumber} relation timestamp`);
  const tags = parseTags(tokens[3].slice(1), 'relation', lineNumber, state);
  if (tags.get('type') !== 'restriction') {
    fail('opl-relation-kind', `OPL line ${lineNumber} is not an exact restriction relation`);
  }
  parseRelationMembers(tokens[4].slice(1), lineNumber, state);
}

function exactFieldSequence(tokens, prefixes, lineNumber) {
  if (tokens.length !== prefixes.length) {
    fail(
      'opl-field-count',
      `OPL line ${lineNumber} must contain exactly ${prefixes.length} reviewed fields`,
    );
  }
  for (let index = 0; index < prefixes.length; index += 1) {
    if (!tokens[index].startsWith(prefixes[index])) {
      fail('opl-field-order', `OPL line ${lineNumber} field ${index} is unsupported or out of order`);
    }
    if (index !== 3 && tokens[index].length === prefixes[index].length) {
      fail('opl-field-empty', `OPL line ${lineNumber} field ${prefixes[index]} must not be empty`);
    }
  }
}

function enterRecord(type, id, lineNumber, state) {
  decimalId(id, `OPL line ${lineNumber} object id`);
  const phase = type === 'n' ? 0 : type === 'w' ? 1 : 2;
  if (phase < state.phase) {
    fail('opl-object-order', `OPL line ${lineNumber} object type is out of reviewed order`);
  }
  state.phase = phase;
  const last = state.lastIds[type];
  if (last !== null && BigInt(id) <= BigInt(last)) {
    fail('opl-id-order', `OPL line ${lineNumber} object id is duplicate or not strictly ascending`);
  }
  state.lastIds[type] = id;
}

function parseTags(text, recordType, lineNumber, state) {
  const result = new Map();
  if (text === '') return result;
  const entryCount = delimitedItemCount(text, ',');
  if (entryCount > OPL_INGRESS_LIMITS.maximumTagsPerRecord) {
    fail(
      'opl-tag-record-limit',
      `OPL line ${lineNumber} exceeds ${OPL_INGRESS_LIMITS.maximumTagsPerRecord} tags`,
    );
  }
  state.tags += entryCount;
  if (state.tags > OPL_INGRESS_LIMITS.maximumAggregateTags) {
    fail('opl-tag-limit', `OPL exceeds ${OPL_INGRESS_LIMITS.maximumAggregateTags} tags`);
  }
  const entries = text.split(',');
  if (entries.length !== entryCount) fail('opl-tag-count-drift', `OPL line ${lineNumber} tag count drifted`);
  const order = recordType === 'relation' ? RELATION_TAG_INDEX : WAY_TAG_INDEX;
  let lastOrder = -1;
  for (const entry of entries) {
    const delimiter = entry.indexOf('=');
    if (delimiter <= 0 || entry.indexOf('=', delimiter + 1) !== -1) {
      fail('opl-tag-syntax', `OPL line ${lineNumber} contains a malformed tag`);
    }
    const key = decodeOplComponent(entry.slice(0, delimiter), `OPL line ${lineNumber} tag key`);
    const value = decodeOplComponent(entry.slice(delimiter + 1), `OPL line ${lineNumber} tag value`);
    if (value.length === 0) fail('opl-tag-empty', `OPL line ${lineNumber} contains an empty tag value`);
    if (key.length > 160 || value.length > 500) {
      fail('opl-tag-text-limit', `OPL line ${lineNumber} contains an oversized decoded tag`);
    }
    const orderIndex = order.get(key);
    if (orderIndex === undefined) {
      fail('opl-tag-unknown', `OPL line ${lineNumber} contains unsupported tag ${key}`);
    }
    if (result.has(key)) fail('opl-tag-duplicate', `OPL line ${lineNumber} duplicates tag ${key}`);
    if (orderIndex <= lastOrder) {
      fail('opl-tag-order', `OPL line ${lineNumber} tag order drifted from the reviewed subset`);
    }
    lastOrder = orderIndex;
    result.set(key, value);
  }
  return result;
}

function parseWayNodes(text, lineNumber, state) {
  if (text === '') fail('opl-way-nodes', `OPL line ${lineNumber} way node list must not be empty`);
  const entryCount = delimitedItemCount(text, ',');
  if (entryCount < 2) fail('opl-way-nodes', `OPL line ${lineNumber} way requires at least two nodes`);
  if (entryCount > OPL_INGRESS_LIMITS.maximumNodeReferencesPerWay) {
    fail(
      'opl-way-node-limit',
      `OPL line ${lineNumber} exceeds ${OPL_INGRESS_LIMITS.maximumNodeReferencesPerWay} node refs`,
    );
  }
  state.nodeReferences += entryCount;
  if (state.nodeReferences > OPL_INGRESS_LIMITS.maximumAggregateNodeReferences) {
    fail(
      'opl-node-reference-limit',
      `OPL exceeds ${OPL_INGRESS_LIMITS.maximumAggregateNodeReferences} node refs`,
    );
  }
  const addedEdges = entryCount - 1;
  state.edgeRecords += addedEdges;
  state.geometryPoints += addedEdges * 2;
  if (state.edgeRecords > OPL_INGRESS_LIMITS.maximumEdgeRecords) {
    fail('opl-edge-limit', `OPL exceeds ${OPL_INGRESS_LIMITS.maximumEdgeRecords} edge records`);
  }
  if (state.geometryPoints > OPL_INGRESS_LIMITS.maximumAggregateGeometryPoints) {
    fail(
      'opl-geometry-limit',
      `OPL exceeds ${OPL_INGRESS_LIMITS.maximumAggregateGeometryPoints} geometry points`,
    );
  }
  const entries = text.split(',');
  if (entries.length !== entryCount) {
    fail('opl-way-node-count-drift', `OPL line ${lineNumber} node ref count drifted`);
  }
  const refs = [];
  for (const entry of entries) {
    const match = entry.match(WAY_NODE_PATTERN);
    if (!match) {
      fail('opl-way-node-location', `OPL line ${lineNumber} requires exact node refs with locations`);
    }
    const [, id, longitudeToken, latitudeToken] = match;
    const longitude = coordinate(longitudeToken, 'longitude', lineNumber);
    const latitude = coordinate(latitudeToken, 'latitude', lineNumber);
    const node = state.nodes.get(id);
    if (!node) fail('opl-missing-node', `OPL line ${lineNumber} references missing node ${id}`);
    if (
      node.longitudeToken !== longitude.token
      || node.latitudeToken !== latitude.token
      || node.longitude !== longitude.value
      || node.latitude !== latitude.value
    ) {
      fail('opl-node-location-drift', `OPL line ${lineNumber} node ${id} location drifted`);
    }
    refs.push(node);
  }
  for (let index = 1; index < refs.length; index += 1) {
    if (refs[index - 1].id === refs[index].id) {
      fail('opl-consecutive-node-duplicate', `OPL line ${lineNumber} repeats a consecutive node`);
    }
  }
  return refs;
}

function parseRelationMembers(text, lineNumber, state) {
  if (text === '') fail('opl-relation-members', `OPL line ${lineNumber} relation members are missing`);
  const entryCount = delimitedItemCount(text, ',');
  if (entryCount > OPL_INGRESS_LIMITS.maximumRelationMembers) {
    fail(
      'opl-relation-member-limit',
      `OPL line ${lineNumber} exceeds ${OPL_INGRESS_LIMITS.maximumRelationMembers} members`,
    );
  }
  state.relationMembers += entryCount;
  if (state.relationMembers > OPL_INGRESS_LIMITS.maximumAggregateRelationMembers) {
    fail(
      'opl-relation-member-limit',
      `OPL exceeds ${OPL_INGRESS_LIMITS.maximumAggregateRelationMembers} relation members`,
    );
  }
  const entries = text.split(',');
  if (entries.length !== entryCount) {
    fail('opl-relation-member-count-drift', `OPL line ${lineNumber} member count drifted`);
  }
  for (const entry of entries) {
    const match = entry.match(RELATION_MEMBER_PATTERN);
    if (!match) fail('opl-relation-member', `OPL line ${lineNumber} relation member is malformed`);
    decimalId(match[2], `OPL line ${lineNumber} relation member id`);
    const role = decodeOplComponent(match[3], `OPL line ${lineNumber} relation member role`);
    if (!RELATION_ROLES.has(role)) {
      fail('opl-relation-role', `OPL line ${lineNumber} relation member role is unsupported`);
    }
  }
}

function rdBTags(tagMap) {
  return {
    highway: tagMap.get('highway') ?? null,
    foot: tagMap.get('foot') ?? null,
    access: tagMap.get('access') ?? null,
    oneway: tagMap.get('oneway') ?? null,
    onewayFoot: tagMap.get('oneway:foot') ?? null,
    route: tagMap.get('route') ?? null,
    construction: tagMap.get('construction') ?? null,
    conditional: {
      foot: tagMap.get('foot:conditional') ?? null,
      access: tagMap.get('access:conditional') ?? null,
      oneway: tagMap.get('oneway:conditional') ?? null,
      onewayFoot: tagMap.get('oneway:foot:conditional') ?? null,
    },
  };
}

function decodeOplComponent(text, label) {
  let result = '';
  for (let index = 0; index < text.length;) {
    const code = text.codePointAt(index);
    const character = String.fromCodePoint(code);
    if (character === '%') {
      const closing = text.indexOf('%', index + 1);
      if (closing === -1) fail('opl-escape', `${label} contains an unterminated percent escape`);
      const hex = text.slice(index + 1, closing);
      if (!/^[0-9A-Fa-f]{1,6}$/.test(hex)) fail('opl-escape', `${label} contains an invalid percent escape`);
      const decodedCode = Number.parseInt(hex, 16);
      if (decodedCode > 0x10ffff || (decodedCode >= 0xd800 && decodedCode <= 0xdfff)) {
        fail('opl-escape', `${label} contains an invalid Unicode code point`);
      }
      result += String.fromCodePoint(decodedCode);
      index = closing + 1;
      if (text[index] === '%') fail('opl-escape', `${label} contains ambiguous adjacent percent escapes`);
      continue;
    }
    if (code < 0x20 || code === 0x7f || [' ', '\n', '\r', '\t', ',', '=', '@'].includes(character)) {
      fail('opl-unescaped-text', `${label} contains a character that must be percent encoded`);
    }
    result += character;
    index += character.length;
  }
  return result;
}

function coordinate(token, axis, lineNumber) {
  if (!COORDINATE_PATTERN.test(token) || /^-0(?:\.0+)?$/.test(token)) {
    fail('opl-coordinate-token', `OPL line ${lineNumber} ${axis} token is not canonical`);
  }
  const value = Number(token);
  const minimum = axis === 'longitude' ? -180 : -90;
  const maximum = axis === 'longitude' ? 180 : 90;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail('opl-coordinate-range', `OPL line ${lineNumber} ${axis} is outside its valid range`);
  }
  return { token, value };
}

function exactOplTimestamp(value, label) {
  if (!TIMESTAMP_PATTERN.test(value)) fail('opl-timestamp', `${label} is not exact OPL UTC text`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value.replace('Z', '.000Z')) {
    fail('opl-timestamp', `${label} is not a real UTC instant`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!POSITIVE_INTEGER_PATTERN.test(value) || !Number.isSafeInteger(Number(value))) {
    fail('opl-positive-integer', `${label} must be a positive safe integer`);
  }
  return Number(value);
}

function decimalId(value, label) {
  if (!DECIMAL_ID_PATTERN.test(value)) fail('opl-decimal-id', `${label} must be a positive OSM id`);
  return value;
}

function delimitedItemCount(value, delimiter) {
  let count = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === delimiter) count += 1;
  }
  return count;
}
