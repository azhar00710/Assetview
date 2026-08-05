/**
 * Deep-link helpers for opening AssetView P&ID focused on a tag/entity.
 *
 * Supported URL forms (hash-based):
 *   #/pnid/<pnidId>?entityId=<uuid>&entityType=equipment
 *   #/pnid/<pnidId>?tag=PV-101
 *   #/tag/PV-101?platformId=<uuid>
 *   #/tag/PV-101&entityType=equipment
 *   #pnid=<pnidId>&tag=PV-101&entityId=<uuid>&entityType=equipment
 *
 * External apps should open one of these URLs in the browser.
 */

import { authFetch } from './authApi.js';

const API = '/api/v1';

async function fetchJson(url) {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status} for ${url}`);
  return res.json();
}

/**
 * Parse location.hash into a deep-link intent, or null if not a deep link.
 * @returns {{ kind: 'pnid'|'tag', pnidId?: string, entityId?: string, entityType?: string, tag?: string, platformId?: string, drawing?: string } | null}
 */
export function parseDeepLink(hash = window.location.hash) {
  const raw = (hash || '').replace(/^#/, '').trim();
  if (!raw || raw === 'admin') return null;

  // Flat query form: pnid=...&tag=...
  if (!raw.startsWith('/') && raw.includes('=')) {
    const params = new URLSearchParams(raw);
    const pnidId = params.get('pnid') || params.get('pnidId') || undefined;
    const tag = params.get('tag') || undefined;
    const entityId = params.get('entityId') || params.get('entity') || undefined;
    const entityType = normalizeEntityType(params.get('entityType') || params.get('type'));
    const platformId = params.get('platformId') || params.get('platform') || undefined;
    const drawing = params.get('drawing') || params.get('drawingNumber') || undefined;
    if (!pnidId && !tag && !entityId && !drawing) return null;
    return {
      kind: pnidId || drawing ? 'pnid' : 'tag',
      pnidId,
      entityId,
      entityType,
      tag,
      platformId,
      drawing,
    };
  }

  // Path form: /pnid/<id>?...  or  /tag/<tag>?...
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const params = new URLSearchParams(queryPart.replace(/^&/, ''));

  const pnidMatch = path.match(/^\/pnid\/([^/]+)\/?$/i);
  if (pnidMatch) {
    return {
      kind: 'pnid',
      pnidId: decodeURIComponent(pnidMatch[1]),
      entityId: params.get('entityId') || params.get('entity') || undefined,
      entityType: normalizeEntityType(params.get('entityType') || params.get('type')),
      tag: params.get('tag') || undefined,
      platformId: params.get('platformId') || params.get('platform') || undefined,
      drawing: params.get('drawing') || undefined,
    };
  }

  const tagMatch = path.match(/^\/tag\/([^/]+)\/?$/i);
  if (tagMatch) {
    return {
      kind: 'tag',
      tag: decodeURIComponent(tagMatch[1]),
      entityId: params.get('entityId') || params.get('entity') || undefined,
      entityType: normalizeEntityType(params.get('entityType') || params.get('type')),
      platformId: params.get('platformId') || params.get('platform') || undefined,
      pnidId: params.get('pnid') || params.get('pnidId') || undefined,
    };
  }

  return null;
}

export function normalizeEntityType(value) {
  if (!value) return undefined;
  const v = String(value).toLowerCase();
  if (v === 'equipment' || v === 'eq' || v === 'equip') return 'equipment';
  if (v === 'instrument' || v === 'inst') return 'instrument';
  if (v === 'line' || v === 'pipe') return 'line';
  return undefined;
}

/**
 * Build a hash deep-link string (without leading origin).
 */
export function buildDeepLink({ pnidId, entityId, entityType, tag, platformId }) {
  if (pnidId) {
    const params = new URLSearchParams();
    if (entityId) params.set('entityId', entityId);
    if (entityType) params.set('entityType', entityType);
    if (tag) params.set('tag', tag);
    if (platformId) params.set('platformId', platformId);
    const qs = params.toString();
    return `#/pnid/${encodeURIComponent(pnidId)}${qs ? `?${qs}` : ''}`;
  }
  if (tag) {
    const params = new URLSearchParams();
    if (entityId) params.set('entityId', entityId);
    if (entityType) params.set('entityType', entityType);
    if (platformId) params.set('platformId', platformId);
    const qs = params.toString();
    return `#/tag/${encodeURIComponent(tag)}${qs ? `?${qs}` : ''}`;
  }
  return '';
}

function pickBestPnid(pnids = [], preferredPnidId) {
  if (!pnids.length) return null;
  if (preferredPnidId) {
    const preferred = pnids.find((p) => (p.pnidId || p.id) === preferredPnidId);
    if (preferred) return preferred;
  }
  const positioned = pnids.find((p) => p.hasPosition || p.annotationPosition?.xPct != null);
  return positioned || pnids[0];
}

function scoreTagMatch(candidateTag, query) {
  const a = (candidateTag || '').toLowerCase();
  const b = (query || '').toLowerCase();
  if (!a || !b) return 99;
  if (a === b) return 0;
  if (a.startsWith(b) || b.startsWith(a)) return 1;
  if (a.includes(b)) return 2;
  return 3;
}

/**
 * Resolve a parsed deep-link into pnid + focus payload ready for PnidViewer.
 * @returns {Promise<{ pnid: { id, drawingNumber, title }, focus: { entityId, entityType, tag } }>}
 */
export async function resolveDeepLink(link, { defaultPlatformId } = {}) {
  if (!link) throw new Error('No deep link');

  let { pnidId, entityId, entityType, tag, platformId, drawing } = link;
  platformId = platformId || defaultPlatformId || undefined;

  // Resolve by drawing number if needed
  if (!pnidId && drawing && platformId) {
    const data = await fetchJson(`${API}/pnids?platform_id=${platformId}`);
    const match = (data.pnids || []).find(
      (p) => String(p.drawingNumber || '').toLowerCase() === String(drawing).toLowerCase(),
    );
    if (!match) throw new Error(`P&ID drawing not found: ${drawing}`);
    pnidId = match.id;
  }

  // Resolve tag → entity (+ pnid) via annotation search
  if ((!entityId || !pnidId) && tag) {
    const params = new URLSearchParams({ q: tag });
    if (platformId) params.set('platform_id', platformId);
    if (pnidId) params.set('pnid_id', pnidId);
    const data = await fetchJson(`${API}/annotations/search?${params}`);
    const results = (data.results || [])
      .filter((r) => !entityType || r.entityType === entityType)
      .sort((a, b) => {
        const tagDiff = scoreTagMatch(a.tag, tag) - scoreTagMatch(b.tag, tag);
        if (tagDiff !== 0) return tagDiff;
        const aPos = (a.pnids || []).some((p) => p.hasPosition) ? 0 : 1;
        const bPos = (b.pnids || []).some((p) => p.hasPosition) ? 0 : 1;
        return aPos - bPos;
      });

    const best = results[0];
    if (!best) throw new Error(`Tag not found: ${tag}`);
    entityId = entityId || best.id;
    entityType = entityType || best.entityType;
    tag = best.tag || tag;

    if (!pnidId) {
      const junction = pickBestPnid(best.pnids || []);
      if (!junction) throw new Error(`Tag ${tag} is not linked to any P&ID`);
      pnidId = junction.pnidId;
    }
  }

  // Resolve entity → pnid when entityId known but pnid missing
  if (entityId && !pnidId) {
    if (entityType === 'instrument') {
      const data = await fetchJson(`${API}/instruments/${entityId}/detail`);
      const junction = pickBestPnid(
        (data.pnids || []).map((p) => ({
          id: p.id,
          pnidId: p.id,
          hasPosition: p.annotationPosition?.xPct != null,
          annotationPosition: p.annotationPosition,
          drawingNumber: p.drawingNumber,
        })),
      );
      if (!junction) throw new Error('Instrument is not linked to any P&ID');
      pnidId = junction.id || junction.pnidId;
      tag = tag || data.instrument?.tag;
    } else if (entityType === 'line') {
      const data = await fetchJson(`${API}/lines/${entityId}`);
      const pnids = data.pnids || data.line?.pnids || [];
      const junction = pickBestPnid(
        pnids.map((p) => ({
          id: p.id,
          pnidId: p.id,
          hasPosition: p.annotationPosition?.xPct != null || p.xPct != null,
          drawingNumber: p.drawingNumber,
        })),
      );
      if (!junction) throw new Error('Line is not linked to any P&ID');
      pnidId = junction.id || junction.pnidId;
      tag = tag || data.line?.lineNumber || data.lineNumber;
    } else {
      // Default: equipment
      const data = await fetchJson(`${API}/equipment/${entityId}`);
      const junction = pickBestPnid(
        (data.pnids || []).map((p) => ({
          id: p.id,
          pnidId: p.id,
          hasPosition: p.annotationPosition?.xPct != null,
          annotationPosition: p.annotationPosition,
          drawingNumber: p.drawingNumber,
        })),
      );
      if (!junction) throw new Error('Equipment is not linked to any P&ID');
      pnidId = junction.id || junction.pnidId;
      tag = tag || data.equipment?.tag;
      entityType = entityType || 'equipment';
    }
  }

  if (!pnidId) throw new Error('Could not resolve P&ID for deep link');

  const pnidData = await fetchJson(`${API}/pnids/${pnidId}`);
  const pnid = {
    id: pnidData.pnid?.id || pnidId,
    drawingNumber: pnidData.pnid?.drawingNumber || drawing || '',
    title: pnidData.pnid?.title || '',
  };

  // If we have tag but not entityId, try to match on this P&ID's annotations
  if (!entityId && tag) {
    const eq = (pnidData.annotations?.equipment || []).find(
      (e) => String(e.tag).toLowerCase() === String(tag).toLowerCase(),
    );
    const inst = (pnidData.annotations?.instruments || []).find(
      (i) => String(i.tag).toLowerCase() === String(tag).toLowerCase(),
    );
    if (eq) {
      entityId = eq.equipmentId;
      entityType = 'equipment';
    } else if (inst) {
      entityId = inst.instrumentId;
      entityType = 'instrument';
    }
  }

  return {
    pnid,
    focus: entityId
      ? {
          entityId,
          entityType: entityType || 'equipment',
          tag: tag || null,
        }
      : null,
  };
}

/**
 * True when hash is reserved for admin (not a deep link).
 */
export function isAdminHash(hash = window.location.hash) {
  return (hash || '').replace(/^#/, '') === 'admin';
}
