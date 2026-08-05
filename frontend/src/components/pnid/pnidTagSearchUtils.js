import { segmentLabel } from './smartIdent/segmentHierarchy';
import { sortChildrenByFlowSequence } from './smartIdent/flowDirection';

export const MIN_SEARCH_CHARS = 3;

export const ENTITY_COLORS_MAP = {
  equipment: '#4FE2B0',
  instrument: '#8AB4FF',
  line: '#FFB068',
};

/** Visual center of an overlay entity (matches OverlayLayer placement). */
function entityVisualCenter(entity) {
  if (!entity || entity.xPct == null || entity.yPct == null) return null;
  return {
    xPct: entity.wPct ? entity.xPct + entity.wPct / 2 : entity.xPct,
    yPct: entity.hPct ? entity.yPct + entity.hPct / 2 : entity.yPct,
  };
}

export function buildTagSearchIndex(linkable, overlay) {
  const positionMap = new Map();
  for (const eq of overlay?.equipment || []) {
    const center = entityVisualCenter(eq);
    if (center) positionMap.set(eq.id, { ...center, entityType: 'equipment' });
  }
  for (const inst of overlay?.instruments || []) {
    const center = entityVisualCenter(inst);
    if (center) positionMap.set(inst.id, { ...center, entityType: 'instrument' });
  }
  for (const ln of overlay?.lines || []) {
    const center = entityVisualCenter(ln);
    if (center) positionMap.set(ln.id, { ...center, entityType: 'line' });
  }

  const items = [];
  for (const eq of linkable?.equipment || []) {
    items.push({
      id: eq.id,
      tag: eq.tag,
      entityType: 'equipment',
      subType: eq.type || eq.equipmentType,
      description: eq.description,
      hasPosition: positionMap.has(eq.id),
      position: positionMap.get(eq.id) || null,
    });
  }
  for (const inst of linkable?.instruments || []) {
    items.push({
      id: inst.id,
      tag: inst.tag,
      entityType: 'instrument',
      subType: inst.type || inst.instrumentType,
      description: inst.description,
      hasPosition: positionMap.has(inst.id),
      position: positionMap.get(inst.id) || null,
    });
  }
  for (const ln of linkable?.lines || []) {
    items.push({
      id: ln.id,
      tag: ln.lineNumber || ln.line_number,
      entityType: 'line',
      subType: ln.service,
      description: [ln.nominalSize, ln.service].filter(Boolean).join(' · '),
      hasPosition: positionMap.has(ln.id),
      position: positionMap.get(ln.id) || null,
    });
  }
  return items;
}

export function filterTagSearch(index, query) {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_SEARCH_CHARS) return [];
  return index
    .filter((item) =>
      item.tag?.toLowerCase().includes(q)
      || item.subType?.toLowerCase().includes(q)
      || item.description?.toLowerCase().includes(q))
    .sort((a, b) => {
      const aExact = a.tag?.toLowerCase() === q ? 0 : 1;
      const bExact = b.tag?.toLowerCase() === q ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aPos = a.hasPosition ? 0 : 1;
      const bPos = b.hasPosition ? 0 : 1;
      if (aPos !== bPos) return aPos - bPos;
      return (a.tag || '').localeCompare(b.tag || '');
    })
    .slice(0, 12);
}

export function buildEntityTagLookup(linkable, overlay) {
  const map = new Map();
  for (const eq of linkable?.equipment || []) map.set(eq.id, eq.tag);
  for (const inst of linkable?.instruments || []) map.set(inst.id, inst.tag);
  for (const ln of linkable?.lines || []) map.set(ln.id, ln.lineNumber || ln.line_number);
  for (const eq of overlay?.equipment || []) map.set(eq.id, eq.tag);
  for (const inst of overlay?.instruments || []) map.set(inst.id, inst.tag);
  for (const ln of overlay?.lines || []) map.set(ln.id, ln.lineNumber || ln.line_number);
  return map;
}

function segmentDisplayLabel(segment, tagLookup) {
  if (segment?.linkedEntityId && tagLookup.has(segment.linkedEntityId)) {
    return tagLookup.get(segment.linkedEntityId);
  }
  return segmentLabel(segment);
}

export function resolveEntityRelations(entityId, entityType, segments, tagLookup = new Map()) {
  if (!segments?.length || !entityId) return null;

  const segment = segments.find(
    (s) => s.linkedEntityId === entityId
      && (!entityType || s.linkedEntityType === entityType),
  );
  if (!segment) return null;

  const byId = new Map(segments.map((s) => [s.id, s]));
  const parent = segment.parentSegmentId ? byId.get(segment.parentSegmentId) : null;
  const children = sortChildrenByFlowSequence(
    segments.filter((s) => s.parentSegmentId === segment.id),
  );

  const toRef = (seg) => {
    if (!seg) return null;
    return {
      segmentId: seg.id,
      entityId: seg.linkedEntityId || null,
      entityType: seg.linkedEntityType || null,
      label: segmentDisplayLabel(seg, tagLookup),
      flowSequence: seg.metadata?.flowSequence ?? null,
    };
  };

  return {
    segment,
    parent: toRef(parent),
    children: children.map(toRef).filter(Boolean),
  };
}

export function relatedEntityIdsFromRelations(relations) {
  if (!relations) return [];
  const ids = [];
  if (relations.parent?.entityId) ids.push(relations.parent.entityId);
  for (const child of relations.children || []) {
    if (child.entityId) ids.push(child.entityId);
  }
  return ids;
}

export function findEntityPosition(overlay, entityId) {
  if (!overlay || !entityId) return null;
  for (const eq of overlay.equipment || []) {
    if (eq.id === entityId) {
      const center = entityVisualCenter(eq);
      if (center) return center;
    }
  }
  for (const inst of overlay.instruments || []) {
    if (inst.id === entityId) {
      const center = entityVisualCenter(inst);
      if (center) return center;
    }
  }
  for (const ln of overlay.lines || []) {
    if (ln.id === entityId) {
      const center = entityVisualCenter(ln);
      if (center) return center;
    }
  }
  return null;
}
