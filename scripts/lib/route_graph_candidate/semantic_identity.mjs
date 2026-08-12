import { contentIdentity, freezeData } from './safe_data.mjs';

export function candidateSemanticProjection(source, profile, graph, audit) {
  return freezeData({
    sourceContractSchema: source.schema,
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    owner: source.owner,
    transport: source.transport,
    license: source.license,
    attribution: source.attribution,
    coverage: source.coverage,
    sourceAsOf: source.clocks.sourceAsOf,
    sourceContentIdentity: source.acquisition.contentIdentity,
    profile,
    graphSchema: graph.schema,
    dataClassification: graph.dataClassification,
    topologyIdentity: graph.topologyIdentity,
    geometryIdentity: graph.geometryIdentity,
    counts: graph.counts,
    auditStatus: audit.status,
  }, 'candidate semantic projection');
}

export function candidateSemanticIdentity(source, profile, graph, audit) {
  return contentIdentity(candidateSemanticProjection(source, profile, graph, audit));
}
