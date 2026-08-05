import { useState, useCallback, useMemo, useEffect } from 'react';

const STORAGE_PREFIX = 'assetview-drafts-';

/**
 * useDraftingMode — manages entity filtering for drafting view.
 * Allows toggling individual entities or entire lines on/off.
 * Persists named drafts to localStorage.
 *
 * @param {string|null} systemId
 * @returns {{ isDrafting, selectedIds, toggleEntity, toggleLine, selectAll, deselectAllEntities, saveDraft, loadDraft, resetDraft, enterDraft, exitDraft, savedDrafts }}
 */
export default function useDraftingMode(systemId) {
  const [isDrafting, setIsDrafting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [savedDrafts, setSavedDrafts] = useState({});

  // Load saved drafts from localStorage on mount / systemId change
  useEffect(() => {
    if (!systemId) return;
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}${systemId}`);
      if (stored) setSavedDrafts(JSON.parse(stored));
    } catch { /* ignore */ }
  }, [systemId]);

  const enterDraft = useCallback(() => {
    setIsDrafting(true);
  }, []);

  const exitDraft = useCallback(() => {
    setIsDrafting(false);
    setSelectedIds(new Set());
  }, []);

  const toggleEntity = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleLine = useCallback((lineId, entityIds) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      // If all entities in this line are selected, deselect them; otherwise select all
      const allSelected = entityIds.every((id) => next.has(id));
      for (const id of entityIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids) => {
    setSelectedIds(new Set(ids));
  }, []);

  const deselectAllEntities = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const saveDraft = useCallback((name) => {
    if (!systemId || !name) return;
    const updated = { ...savedDrafts, [name]: [...selectedIds] };
    setSavedDrafts(updated);
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${systemId}`, JSON.stringify(updated));
    } catch { /* ignore */ }
  }, [systemId, selectedIds, savedDrafts]);

  const loadDraft = useCallback((name) => {
    const ids = savedDrafts[name];
    if (ids) {
      setSelectedIds(new Set(ids));
      setIsDrafting(true);
    }
  }, [savedDrafts]);

  const resetDraft = useCallback(() => {
    setSelectedIds(new Set());
    setIsDrafting(false);
  }, []);

  return {
    isDrafting,
    selectedIds,
    toggleEntity,
    toggleLine,
    selectAll,
    deselectAllEntities,
    saveDraft,
    loadDraft,
    resetDraft,
    enterDraft,
    exitDraft,
    savedDrafts,
  };
}
