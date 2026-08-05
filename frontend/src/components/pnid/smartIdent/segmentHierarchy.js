/**
 * Build parent-child tree from smart_ident segments.
 */

import { sortChildrenByFlowSequence } from './flowDirection';

export function segmentLabel(segment) {
  if (!segment) return 'Unknown';
  if (segment.metadata?.label) return segment.metadata.label;
  if (segment.metadata?.symbolId) {
    const sym = segment.metadata.symbolId.replace(/^sym_/, '').replace(/_/g, ' ');
    return segment.metadata.label || sym;
  }
  const type = segment.segmentType || 'shape';
  const cat = segment.metadata?.category;
  if (cat) return `${cat} · ${type}`;
  return `${type}`;
}

export function segmentSubtitle(segment) {
  const parts = [];
  if (segment.linkedEntityType) parts.push(segment.linkedEntityType);
  else parts.push('unassigned');
  if (segment.segmentType) parts.push(segment.segmentType);
  if (segment.metadata?.category && segment.metadata.category !== segment.linkedEntityType) {
    parts.push(segment.metadata.category);
  }
  if (segment.metadata?.flowSequence != null) {
    parts.push(`#${segment.metadata.flowSequence} downstream`);
  }
  return parts.join(' · ');
}

function sortSegments(segments) {
  return [...segments].sort((a, b) => {
    const aAssigned = a.linkedEntityId ? 0 : 1;
    const bAssigned = b.linkedEntityId ? 0 : 1;
    if (aAssigned !== bAssigned) return aAssigned - bAssigned;
    return segmentLabel(a).localeCompare(segmentLabel(b));
  });
}

export function buildSegmentHierarchy(segments) {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const childrenOf = new Map();

  for (const seg of segments) {
    const pid = seg.parentSegmentId;
    if (pid && byId.has(pid)) {
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid).push(seg);
    }
  }

  const hasParent = new Set(
    segments.filter((s) => s.parentSegmentId && byId.has(s.parentSegmentId)).map((s) => s.id)
  );
  const roots = segments.filter((s) => !hasParent.has(s.id));

  function buildNode(seg) {
    const kids = sortChildrenByFlowSequence(childrenOf.get(seg.id) || []);
    return { segment: seg, children: kids.map(buildNode) };
  }

  return sortSegments(roots).map(buildNode);
}

export function hierarchyStats(segments) {
  const assigned = segments.filter((s) => s.linkedEntityId).length;
  const withParent = segments.filter((s) => s.parentSegmentId).length;
  const roots = buildSegmentHierarchy(segments).length;
  return { total: segments.length, assigned, withParent, roots };
}
