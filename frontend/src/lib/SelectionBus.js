/**
 * SelectionBus — Shared event emitter for 2D↔3D selection sync.
 *
 * Event types:
 *   'tag:select'    { tag: string, source: '2d'|'3d', meta?: object }
 *   'tag:deselect'  { tag: string, source: '2d'|'3d' }
 *   'tag:hover'     { tag: string|null, source: '2d'|'3d' }
 *   'system:select' { systemId: string, source: '2d'|'3d' }
 *   'camera:flyto'  { position: {x,y,z}, target: {x,y,z} }
 *
 * Echo-loop prevention:
 *   Each event carries a `source` field ('2d' or '3d'). Listeners should
 *   ignore events that originate from their own view to prevent infinite
 *   select→highlight→select loops.
 *
 * Usage:
 *   import selectionBus from '../lib/SelectionBus';
 *   selectionBus.on('tag:select', ({ tag, source }) => { ... });
 *   selectionBus.emit('tag:select', { tag: 'CV-019S', source: '2d' });
 */

class SelectionBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    /** @type {{ tag: string, source: string } | null} */
    this._currentSelection = null;
    /** @type {{ tag: string, source: string } | null} */
    this._currentHover = null;
  }

  /**
   * Subscribe to an event type.
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} unsubscribe function
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    // Return unsubscribe function
    return () => {
      const set = this._listeners.get(event);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this._listeners.delete(event);
      }
    };
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} event
   * @param {object} payload — must include `source: '2d'|'3d'`
   */
  emit(event, payload) {
    // Track current selection / hover state
    if (event === 'tag:select') {
      this._currentSelection = { tag: payload.tag, source: payload.source };
    } else if (event === 'tag:deselect') {
      if (this._currentSelection?.tag === payload.tag) {
        this._currentSelection = null;
      }
    } else if (event === 'tag:hover') {
      this._currentHover = payload.tag
        ? { tag: payload.tag, source: payload.source }
        : null;
    }

    const set = this._listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[SelectionBus] Error in "${event}" listener:`, err);
      }
    }
  }

  /**
   * Remove a specific callback for an event, or all listeners for an event.
   * @param {string} event
   * @param {Function} [callback] — if provided, removes only that callback
   */
  off(event, callback) {
    if (callback) {
      const set = this._listeners.get(event);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this._listeners.delete(event);
      }
    } else if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  /**
   * Subscribe to an event once.
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} unsubscribe function
   */
  once(event, callback) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      callback(data);
    };
    return this.on(event, wrapper);
  }

  /** Clear all listeners. */
  clear() {
    this._listeners.clear();
  }

  /** Get current selected tag (if any). */
  get currentSelection() {
    return this._currentSelection;
  }

  /** Get current hovered tag (if any). */
  get currentHover() {
    return this._currentHover;
  }

  /** Clear selection state and notify listeners. */
  clearSelection(source = '2d') {
    if (this._currentSelection) {
      this.emit('tag:deselect', {
        tag: this._currentSelection.tag,
        source,
      });
    }
  }
}

// Singleton instance — shared across entire app
const selectionBus = new SelectionBus();
export default selectionBus;
