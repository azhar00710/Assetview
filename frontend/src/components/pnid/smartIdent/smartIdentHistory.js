import { useCallback, useRef, useState } from 'react';

const MAX_HISTORY = 50;

function mutateAsync(mutation, variables) {
  return new Promise((resolve, reject) => {
    mutation.mutate(variables, {
      onSuccess: (data) => resolve(data),
      onError: (err) => reject(err),
    });
  });
}

/**
 * Undo/redo stack for Smart Identification edits (create, delete, geometry, assign).
 */
export function useSmartIdentHistory() {
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [stackVersion, setStackVersion] = useState(0);

  const bump = useCallback(() => setStackVersion((v) => v + 1), []);

  const push = useCallback((command) => {
    if (!command?.undo || !command?.redo) return;
    undoStack.current.push(command);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    bump();
  }, [bump]);

  const undo = useCallback(async () => {
    const cmd = undoStack.current.pop();
    if (!cmd) return false;
    try {
      await cmd.undo();
      redoStack.current.push(cmd);
      bump();
      return true;
    } catch {
      undoStack.current.push(cmd);
      bump();
      return false;
    }
  }, [bump]);

  const redo = useCallback(async () => {
    const cmd = redoStack.current.pop();
    if (!cmd) return false;
    try {
      await cmd.redo();
      undoStack.current.push(cmd);
      bump();
      return true;
    } catch {
      redoStack.current.push(cmd);
      bump();
      return false;
    }
  }, [bump]);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    bump();
  }, [bump]);

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    stackVersion,
  };
}

export function buildCreateCommand({
  segment,
  payload,
  sessionId,
  addSmartSegment,
  deleteSmartSegment,
  setSegments,
  setSelected,
}) {
  let activeId = segment.id;
  return {
    label: 'Draw shape',
    undo: async () => {
      await mutateAsync(deleteSmartSegment, activeId);
      setSegments((prev) => prev.filter((s) => s.id !== activeId));
      setSelected((prev) => (prev?.id === activeId ? null : prev));
    },
    redo: async () => {
      const data = await mutateAsync(addSmartSegment, { sessionId, ...payload });
      activeId = data.segment.id;
      setSegments((prev) => [...prev, data.segment]);
    },
  };
}

export function buildDeleteCommand({
  segment,
  sessionId,
  addSmartSegment,
  deleteSmartSegment,
  setSegments,
  setSelected,
}) {
  let activeId = segment.id;
  const payload = {
    segmentType: segment.segmentType,
    geometry: segment.geometry,
    metadata: segment.metadata,
    displayColor: segment.displayColor,
  };
  return {
    label: 'Delete shape',
    undo: async () => {
      const data = await mutateAsync(addSmartSegment, { sessionId, ...payload });
      activeId = data.segment.id;
      setSegments((prev) => [...prev, data.segment]);
    },
    redo: async () => {
      await mutateAsync(deleteSmartSegment, activeId);
      setSegments((prev) => prev.filter((s) => s.id !== activeId));
      setSelected((prev) => (prev?.id === activeId ? null : prev));
    },
  };
}

export function buildGeometryCommand({
  segmentId,
  beforeGeometry,
  afterGeometry,
  updateSegmentGeometry,
  setSegments,
  setSelected,
}) {
  const apply = async (geometry) => {
    const data = await mutateAsync(updateSegmentGeometry, { segmentId, geometry });
    setSegments((prev) => prev.map((s) => (s.id === segmentId ? data.segment : s)));
    setSelected((prev) => (prev?.id === segmentId ? data.segment : prev));
  };
  return {
    label: 'Move shape',
    undo: () => apply(beforeGeometry),
    redo: () => apply(afterGeometry),
  };
}

export function buildAssignCommand({
  segmentId,
  before,
  after,
  assignSegment,
  setSegments,
  setSelected,
  syncFlowSequences,
}) {
  const apply = async (payload) => {
    const data = await mutateAsync(assignSegment, { segmentId, ...payload });
    setSegments((prev) => {
      let next = prev.map((s) => (s.id === segmentId ? data.segment : s));
      if (syncFlowSequences) {
        next = syncFlowSequences(next) || next;
      }
      return next;
    });
    setSelected((prev) => (prev?.id === segmentId ? data.segment : prev));
  };
  return {
    label: 'Assign tag',
    undo: () => apply(before),
    redo: () => apply(after),
  };
}
