import { useState, useEffect, useCallback, useRef } from 'react';
import selectionBus from '../lib/SelectionBus';

/**
 * useSelectionSync — React hook for 2D↔3D selection synchronization.
 *
 * Subscribes to SelectionBus events and provides:
 *   - selectedTag:  currently selected equipment tag
 *   - hoveredTag:   currently hovered equipment tag
 *   - selectTag():  emit selection from this view
 *   - hoverTag():   emit hover from this view
 *   - clearSelection(): clear current selection
 *
 * Echo-loop prevention:
 *   The hook tracks its own `source` ('2d' or '3d'). When it receives
 *   an event with the same source, it ignores it — preventing infinite
 *   select→highlight→select loops.
 *
 * @param {'2d'|'3d'} source — which view this hook represents
 * @param {object} [options]
 * @param {Function} [options.onSelect] — callback when tag is selected from the OTHER view
 * @param {Function} [options.onDeselect] — callback when tag is deselected from the OTHER view
 * @param {Function} [options.onHover] — callback when tag is hovered from the OTHER view
 * @param {Function} [options.onCameraFlyTo] — callback for camera fly-to requests
 */
export default function useSelectionSync(source, options = {}) {
  const [selectedTag, setSelectedTag] = useState(null);
  const [hoveredTag, setHoveredTag] = useState(null);

  // Use refs for callbacks to avoid re-subscribing on every render
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Subscribe to bus events
  useEffect(() => {
    const unsubs = [];

    unsubs.push(
      selectionBus.on('tag:select', (payload) => {
        // Always update local state
        setSelectedTag(payload.tag);
        // Only fire callback if event is from the OTHER view (echo prevention)
        if (payload.source !== source) {
          optionsRef.current.onSelect?.(payload);
        }
      })
    );

    unsubs.push(
      selectionBus.on('tag:deselect', (payload) => {
        setSelectedTag((prev) => (prev === payload.tag ? null : prev));
        if (payload.source !== source) {
          optionsRef.current.onDeselect?.(payload);
        }
      })
    );

    unsubs.push(
      selectionBus.on('tag:hover', (payload) => {
        setHoveredTag(payload.tag || null);
        if (payload.source !== source) {
          optionsRef.current.onHover?.(payload);
        }
      })
    );

    unsubs.push(
      selectionBus.on('camera:flyto', (payload) => {
        optionsRef.current.onCameraFlyTo?.(payload);
      })
    );

    return () => unsubs.forEach((fn) => fn());
  }, [source]);

  /**
   * Select a tag from this view. Emits to the bus so the other view syncs.
   */
  const selectTag = useCallback(
    (tag, meta) => {
      if (!tag) {
        selectionBus.clearSelection(source);
        return;
      }
      // Toggle: if same tag already selected, deselect
      if (selectionBus.currentSelection?.tag === tag) {
        selectionBus.emit('tag:deselect', { tag, source });
        return;
      }
      // Deselect previous first
      if (selectionBus.currentSelection) {
        selectionBus.emit('tag:deselect', {
          tag: selectionBus.currentSelection.tag,
          source,
        });
      }
      selectionBus.emit('tag:select', { tag, source, meta });
    },
    [source]
  );

  /**
   * Hover a tag from this view.
   */
  const hoverTag = useCallback(
    (tag) => {
      selectionBus.emit('tag:hover', { tag: tag || null, source });
    },
    [source]
  );

  /**
   * Clear selection from this view.
   */
  const clearSelection = useCallback(() => {
    selectionBus.clearSelection(source);
  }, [source]);

  return {
    selectedTag,
    hoveredTag,
    selectTag,
    hoverTag,
    clearSelection,
    bus: selectionBus,
  };
}
