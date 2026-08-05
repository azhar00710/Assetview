/**
 * Flow direction, downstream sequencing, and isolation for smart-ident segments.
 *
 * Lines carry flow from geometry.points[fromIdx] → points[toIdx].
 * Child tags on a line are ranked by projection onto that flow axis:
 * closer to the origin = lower sequence number, farther downstream = higher number.
 */

const FLOW_EPS = 0.0001;

/** Default flow: first point → last point. */
export function defaultFlowDirection(points) {
  if (!points?.length) return { fromIdx: 0, toIdx: 0 };
  return { fromIdx: 0, toIdx: points.length - 1 };
}

export function getFlowDirection(segment) {
  const pts = segment?.geometry?.points || [];
  const stored = segment?.metadata?.flowDirection;
  if (stored && pts[stored.fromIdx] && pts[stored.toIdx]) return stored;
  return defaultFlowDirection(pts);
}

export function reverseFlowDirection(segment) {
  const dir = getFlowDirection(segment);
  return { fromIdx: dir.toIdx, toIdx: dir.fromIdx };
}

/** Geometry points ordered along flow (origin → end). Null if not a drawable line. */
export function orderedFlowPoints(segment) {
  const pts = segment?.geometry?.points || [];
  if (pts.length < 2) return null;
  const dir = getFlowDirection(segment);
  if (dir.fromIdx <= dir.toIdx) {
    return pts.slice(dir.fromIdx, dir.toIdx + 1);
  }
  return pts.slice(dir.toIdx, dir.fromIdx + 1).reverse();
}

export function segmentCentroid(segment) {
  const pts = segment?.geometry?.points || [];
  if (!pts.length) {
    const g = segment?.geometry || {};
    return { xPct: g.xPct || 0, yPct: g.yPct || 0 };
  }
  const sum = pts.reduce((a, p) => ({ xPct: a.xPct + p.xPct, yPct: a.yPct + p.yPct }), { xPct: 0, yPct: 0 });
  return { xPct: sum.xPct / pts.length, yPct: sum.yPct / pts.length };
}

/**
 * Project a point onto the line's flow axis. Returns 0 at flow origin, 1 at flow end.
 */
export function flowPositionOnLine(lineSegment, point) {
  const pts = lineSegment?.geometry?.points || [];
  if (pts.length < 2 || !point) return 0;

  const dir = getFlowDirection(lineSegment);
  const from = pts[dir.fromIdx];
  const to = pts[dir.toIdx];
  const dx = to.xPct - from.xPct;
  const dy = to.yPct - from.yPct;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < FLOW_EPS) return 0;

  const t = ((point.xPct - from.xPct) * dx + (point.yPct - from.yPct) * dy) / lenSq;
  return Math.max(0, Math.min(1, t));
}

/** Polyline: cumulative distance along path in flow direction. */
export function flowPositionOnPolyline(lineSegment, point) {
  const pts = lineSegment?.geometry?.points || [];
  if (pts.length < 2) return 0;

  const dir = getFlowDirection(lineSegment);
  const ordered =
    dir.fromIdx <= dir.toIdx
      ? pts.slice(dir.fromIdx, dir.toIdx + 1)
      : pts.slice(dir.toIdx, dir.fromIdx + 1).reverse();

  if (ordered.length < 2) return 0;

  let totalLen = 0;
  const segLens = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const dx = ordered[i + 1].xPct - ordered[i].xPct;
    const dy = ordered[i + 1].yPct - ordered[i].yPct;
    const len = Math.hypot(dx, dy);
    segLens.push(len);
    totalLen += len;
  }
  if (totalLen < FLOW_EPS) return 0;

  let bestDist = Infinity;
  let bestT = 0;
  let acc = 0;

  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];
    const dx = b.xPct - a.xPct;
    const dy = b.yPct - a.yPct;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > FLOW_EPS) {
      t = Math.max(0, Math.min(1, ((point.xPct - a.xPct) * dx + (point.yPct - a.yPct) * dy) / lenSq));
    }
    const px = a.xPct + t * dx;
    const py = a.yPct + t * dy;
    const dist = Math.hypot(point.xPct - px, point.yPct - py);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = (acc + t * segLens[i]) / totalLen;
    }
    acc += segLens[i];
  }
  return bestT;
}

export function childFlowPosition(lineSegment, childSegment) {
  const pt = segmentCentroid(childSegment);
  const pts = lineSegment?.geometry?.points || [];
  if (pts.length > 2 || lineSegment?.metadata?.polyline) {
    return flowPositionOnPolyline(lineSegment, pt);
  }
  return flowPositionOnLine(lineSegment, pt);
}

/** Assign flowSequence to children of a line (1 = nearest origin, N = farthest downstream). */
export function rankChildrenByFlow(lineSegment, childSegments) {
  const ranked = childSegments.map((child) => ({
    segment: child,
    position: childFlowPosition(lineSegment, child),
  }));
  ranked.sort((a, b) => a.position - b.position);
  return ranked.map((item, idx) => ({
    ...item,
    flowSequence: idx + 1,
  }));
}

/** Recompute flowSequence for all children of every line segment in the session. */
export function recomputeAllFlowSequences(segments) {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const childrenOf = new Map();

  for (const seg of segments) {
    const pid = seg.parentSegmentId;
    if (pid && byId.has(pid)) {
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid).push(seg);
    }
  }

  const updates = new Map();
  for (const [parentId, children] of childrenOf) {
    const parent = byId.get(parentId);
    if (!parent || parent.segmentType !== 'line') continue;
    const ranked = rankChildrenByFlow(parent, children);
    for (const { segment, flowSequence } of ranked) {
      updates.set(segment.id, flowSequence);
    }
  }

  return segments.map((seg) => {
    const seq = updates.get(seg.id);
    if (seq == null) return seg;
    return {
      ...seg,
      metadata: { ...seg.metadata, flowSequence: seq },
    };
  });
}

/** Find the nearest line segment to attach as parent (within threshold %). */
export function findNearestLineParent(segments, childSegment, maxDistPct = 2.5) {
  const pt = segmentCentroid(childSegment);
  let best = null;
  let bestDist = Infinity;

  for (const seg of segments) {
    if (seg.id === childSegment.id) continue;
    if (seg.segmentType !== 'line') continue;
    const pos = childFlowPosition(seg, { geometry: { points: [pt] } });
    const dist = Math.abs(pos - 0.5) * 100; // rough proximity
    const c = segmentCentroid(seg);
    const directDist = Math.hypot(pt.xPct - c.xPct, pt.yPct - c.yPct);
    if (directDist < maxDistPct && directDist < bestDist) {
      bestDist = directDist;
      best = seg;
    }
  }
  return best;
}

/** Arrow geometry at ~75% along the flow path (stage coords). */
export function flowArrowPoints(segment, stageWidth, stageHeight) {
  const ordered = orderedFlowPoints(segment);
  if (!ordered || ordered.length < 2) return null;

  let totalLen = 0;
  const segLens = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const len = Math.hypot(ordered[i + 1].xPct - ordered[i].xPct, ordered[i + 1].yPct - ordered[i].yPct);
    segLens.push(len);
    totalLen += len;
  }
  if (totalLen < FLOW_EPS) return null;

  const target = totalLen * 0.72;
  let acc = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    if (acc + segLens[i] >= target) {
      const t = (target - acc) / segLens[i];
      const xPct = ordered[i].xPct + t * (ordered[i + 1].xPct - ordered[i].xPct);
      const yPct = ordered[i].yPct + t * (ordered[i + 1].yPct - ordered[i].yPct);
      const dx = ordered[i + 1].xPct - ordered[i].xPct;
      const dy = ordered[i + 1].yPct - ordered[i].yPct;
      const angle = Math.atan2(dy, dx);
      const cx = (xPct / 100) * stageWidth;
      const cy = (yPct / 100) * stageHeight;
      const size = Math.max(8, stageWidth * 0.012);
      return { cx, cy, angle, size };
    }
    acc += segLens[i];
  }
  return null;
}

const ISOLATION_ATTACH_TOLERANCE_PCT = 2.2;
const ISOLATION_CONNECT_TOLERANCE_PCT = 1.5;
const ISOLATION_POSITION_EPS = 0.005;

/**
 * Nearest point on a line, measured in the line's flow direction.
 * `position` is 0 at the flow origin and 1 at the flow end.
 */
function nearestPointOnFlowPath(lineSegment, point) {
  const ordered = orderedFlowPoints(lineSegment);
  if (!ordered || !point) return { position: 0, distance: Infinity };

  const lengths = [];
  let total = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    const length = Math.hypot(
      ordered[i + 1].xPct - ordered[i].xPct,
      ordered[i + 1].yPct - ordered[i].yPct,
    );
    lengths.push(length);
    total += length;
  }
  if (total < FLOW_EPS) return { position: 0, distance: Infinity };

  let bestDistance = Infinity;
  let bestPosition = 0;
  let traversed = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];
    const dx = b.xPct - a.xPct;
    const dy = b.yPct - a.yPct;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > FLOW_EPS
      ? Math.max(0, Math.min(1, ((point.xPct - a.xPct) * dx + (point.yPct - a.yPct) * dy) / lenSq))
      : 0;
    const x = a.xPct + t * dx;
    const y = a.yPct + t * dy;
    const distance = Math.hypot(point.xPct - x, point.yPct - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPosition = (traversed + t * lengths[i]) / total;
    }
    traversed += lengths[i];
  }
  return { position: bestPosition, distance: bestDistance };
}

function isValveCategory(seg) {
  const symbol = String(seg?.metadata?.symbolId || '');
  const label = String(seg?.metadata?.label || '');
  const valveSymbol = /(?:^|_)(?:valve|xv|hv|psv|sdv|esdv|bdv|gate|globe|ball|butterfly|plug|needle|pinch)(?:_|$)/i.test(symbol);
  const valveLabel = /\b(?:valve|xv|hv|psv|sdv|esdv|bdv|gate|globe|ball|butterfly|plug|needle|pinch)\b/i.test(label);
  return valveSymbol || valveLabel || (seg?.metadata?.category === 'valve' && !/controller|switch|actuator|solenoid/i.test(label));
}

function isClosedIsolationBoundary(seg) {
  const metadata = seg?.metadata || {};
  const symbol = String(metadata.symbolId || '');
  const label = String(metadata.label || '');
  const state = String(metadata.state || metadata.status || metadata.position || '');
  return metadata.isolationBoundary === true ||
    metadata.normallyClosed === true ||
    /\bclosed\b/i.test(state) ||
    /blind|spectacle|spade|cap(?:_|$)|plug(?:_|$)/i.test(`${symbol} ${label}`);
}

/**
 * Directed isolation analysis.
 *
 * Uses explicit parent links when available and safely infers missing
 * line/symbol attachments from geometry. Lines connect only from a downstream
 * point to another line's flow origin, so upstream items are not included.
 * Closed boundaries stop traversal; branches and cycles are handled safely.
 */
export function computeDownstreamIsolation(segments, shutdownSegmentId) {
  const validSegments = (segments || []).filter((seg) => seg?.id);
  const byId = new Map(validSegments.map((seg) => [seg.id, seg]));
  const shutdown = byId.get(shutdownSegmentId);
  const emptyResult = {
    affectedIds: [],
    boundaryIds: [],
    shutdownSegment: shutdown || null,
    affectedSegments: [],
    boundarySegments: [],
    diagnostics: {
      lineCount: 0,
      inferredAttachmentCount: 0,
      traversedLineCount: 0,
      warnings: shutdown ? [] : ['Shutdown segment was not found.'],
    },
  };
  if (!shutdown) return emptyResult;

  const lines = validSegments.filter(
    (seg) => seg.segmentType === 'line' && orderedFlowPoints(seg)?.length >= 2,
  );
  const childrenOf = new Map();
  for (const seg of validSegments) {
    if (!seg.parentSegmentId || !byId.has(seg.parentSegmentId)) continue;
    if (!childrenOf.has(seg.parentSegmentId)) childrenOf.set(seg.parentSegmentId, []);
    childrenOf.get(seg.parentSegmentId).push(seg);
  }

  const attachmentsByLine = new Map(lines.map((line) => [line.id, []]));
  const attachmentBySegment = new Map();
  let inferredAttachmentCount = 0;

  // Attach symbols/equipment to their explicit parent line, or infer the
  // nearest line when old drawings do not contain parentSegmentId.
  for (const seg of validSegments) {
    if (seg.segmentType === 'line') continue;
    let line = byId.get(seg.parentSegmentId);
    let inferred = false;
    if (line?.segmentType !== 'line') {
      const anchor = segmentCentroid(seg);
      let nearest = null;
      for (const candidate of lines) {
        const projection = nearestPointOnFlowPath(candidate, anchor);
        if (!nearest || projection.distance < nearest.projection.distance) {
          nearest = { line: candidate, projection };
        }
      }
      if (nearest?.projection.distance <= ISOLATION_ATTACH_TOLERANCE_PCT) {
        line = nearest.line;
        inferred = true;
      }
    }
    if (line?.segmentType !== 'line') continue;

    const projection = nearestPointOnFlowPath(line, segmentCentroid(seg));
    const attachment = {
      segment: seg,
      line,
      position: projection.position,
      distance: projection.distance,
      inferred,
    };
    attachmentsByLine.get(line.id)?.push(attachment);
    attachmentBySegment.set(seg.id, attachment);
    if (inferred) inferredAttachmentCount += 1;
  }
  for (const attachments of attachmentsByLine.values()) {
    attachments.sort((a, b) => a.position - b.position);
  }

  // A directed transition starts where another line's flow origin touches
  // this line. This supports endpoint continuation and tee branches.
  const transitionsByLine = new Map(lines.map((line) => [line.id, []]));
  for (const target of lines) {
    const targetStart = orderedFlowPoints(target)?.[0];
    if (!targetStart) continue;

    const explicitParent = byId.get(target.parentSegmentId);
    if (explicitParent?.segmentType === 'line' && transitionsByLine.has(explicitParent.id)) {
      const projection = nearestPointOnFlowPath(explicitParent, targetStart);
      transitionsByLine.get(explicitParent.id).push({
        line: target,
        position: projection.position,
        inferred: false,
      });
      continue;
    }

    let bestSource = null;
    for (const source of lines) {
      if (source.id === target.id) continue;
      const projection = nearestPointOnFlowPath(source, targetStart);
      if (projection.distance > ISOLATION_CONNECT_TOLERANCE_PCT) continue;
      if (!bestSource || projection.distance < bestSource.projection.distance) {
        bestSource = { line: source, projection };
      }
    }
    if (bestSource) {
      transitionsByLine.get(bestSource.line.id).push({
        line: target,
        position: bestSource.projection.position,
        inferred: true,
      });
    }
  }
  for (const transitions of transitionsByLine.values()) {
    transitions.sort((a, b) => a.position - b.position);
  }

  const affectedIds = new Set();
  const boundaryIds = new Set();
  const visitedHierarchy = new Set();
  const visitedLinePosition = new Map();
  const queue = [];

  function enqueueLine(line, position = 0, includeLine = true) {
    if (!line || line.segmentType !== 'line') return;
    queue.push({
      line,
      position: Math.max(0, Math.min(1, position)),
      includeLine,
    });
  }

  function propagateHierarchy(seg) {
    if (!seg || visitedHierarchy.has(seg.id)) return;
    visitedHierarchy.add(seg.id);
    for (const child of childrenOf.get(seg.id) || []) {
      if (child.segmentType === 'line') {
        enqueueLine(child, 0, true);
      } else if (isClosedIsolationBoundary(child)) {
        boundaryIds.add(child.id);
      } else {
        affectedIds.add(child.id);
        propagateHierarchy(child);
      }
    }
  }

  const shutdownIsValve = isValveCategory(shutdown);
  if (shutdown.segmentType === 'line') {
    enqueueLine(shutdown, 0, false);
  } else {
    if (shutdownIsValve || isClosedIsolationBoundary(shutdown)) {
      boundaryIds.add(shutdown.id);
    } else {
      affectedIds.add(shutdown.id);
    }

    const attachment = attachmentBySegment.get(shutdown.id);
    if (attachment) {
      enqueueLine(attachment.line, attachment.position, false);
    }
    propagateHierarchy(shutdown);
  }

  while (queue.length > 0) {
    const { line, position, includeLine } = queue.shift();
    const previousPosition = visitedLinePosition.get(line.id);
    // A lower start position covers more of the line. Ignore equal/narrower
    // revisits, which also prevents recursion on cyclic drawings.
    if (previousPosition != null && previousPosition <= position + ISOLATION_POSITION_EPS) continue;
    visitedLinePosition.set(line.id, position);
    if (includeLine) affectedIds.add(line.id);

    let stopPosition = 1 + ISOLATION_POSITION_EPS;
    const downstreamAttachments = (attachmentsByLine.get(line.id) || [])
      .filter((item) => item.position > position + ISOLATION_POSITION_EPS);

    for (const attachment of downstreamAttachments) {
      if (isClosedIsolationBoundary(attachment.segment)) {
        boundaryIds.add(attachment.segment.id);
        stopPosition = Math.min(stopPosition, attachment.position);
        break;
      }
      affectedIds.add(attachment.segment.id);
      propagateHierarchy(attachment.segment);
    }

    for (const transition of transitionsByLine.get(line.id) || []) {
      if (transition.position <= position + ISOLATION_POSITION_EPS) continue;
      if (transition.position >= stopPosition - ISOLATION_POSITION_EPS) continue;
      enqueueLine(transition.line, 0, true);
    }
  }

  // Boundaries are never part of the affected set.
  for (const id of boundaryIds) affectedIds.delete(id);
  if (shutdownIsValve) affectedIds.delete(shutdown.id);

  const warnings = [];
  if (lines.length === 0) warnings.push('No directed lines are available for isolation analysis.');
  if (shutdown.segmentType !== 'line' && !attachmentBySegment.has(shutdown.id)) {
    warnings.push('The shutdown point is not attached to a nearby process line.');
  }
  const unassignedFlowCount = lines.filter((line) => !line.metadata?.flowDirection).length;
  if (unassignedFlowCount > 0) {
    warnings.push(`${unassignedFlowCount} line(s) use their drawn direction because no flow direction was assigned.`);
  }

  const affectedSegments = [...affectedIds].map((id) => byId.get(id)).filter(Boolean);
  const boundarySegments = [...boundaryIds].map((id) => byId.get(id)).filter(Boolean);
  return {
    shutdownSegment: shutdown,
    affectedIds: [...affectedIds],
    boundaryIds: [...boundaryIds],
    affectedSegments,
    boundarySegments,
    diagnostics: {
      lineCount: lines.length,
      inferredAttachmentCount,
      traversedLineCount: visitedLinePosition.size,
      warnings,
    },
  };
}

export function sortChildrenByFlowSequence(children) {
  return [...children].sort((a, b) => {
    const sa = a.metadata?.flowSequence ?? 999;
    const sb = b.metadata?.flowSequence ?? 999;
    if (sa !== sb) return sa - sb;
    return (a.metadata?.label || '').localeCompare(b.metadata?.label || '');
  });
}
