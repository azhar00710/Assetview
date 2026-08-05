/**
 * coordinateUtils — Coordinate conversion between 2D canvas and 3D world space.
 *
 * The 2D system canvas (React Flow) uses screen coordinates (px),
 * while the 3D viewer (Three.js) uses world coordinates (meters).
 *
 * These utilities handle mapping between the two coordinate systems
 * using a tag-based lookup approach: both views maintain their own
 * spatial representation, and sync happens via equipment tags, not
 * raw coordinate translation.
 */

/**
 * Build a tag→position map from React Flow nodes.
 * @param {Array} nodes — React Flow nodes with data.tag
 * @returns {Map<string, {x: number, y: number, width: number, height: number}>}
 */
export function buildTagPositionMap2D(nodes) {
  const map = new Map();
  for (const node of nodes) {
    const tag = node.data?.tag;
    if (!tag) continue;
    map.set(tag, {
      x: node.position?.x ?? 0,
      y: node.position?.y ?? 0,
      width: node.measured?.width ?? node.width ?? 160,
      height: node.measured?.height ?? node.height ?? 80,
    });
  }
  return map;
}

/**
 * Get the center position of a node by tag in the 2D map.
 * @param {Map} tagMap — from buildTagPositionMap2D
 * @param {string} tag
 * @returns {{ x: number, y: number } | null}
 */
export function getNodeCenter2D(tagMap, tag) {
  const pos = tagMap.get(tag);
  if (!pos) return null;
  return {
    x: pos.x + pos.width / 2,
    y: pos.y + pos.height / 2,
  };
}

/**
 * Build a tag→Object3D map from a Three.js scene.
 * Traverses the scene and groups meshes by userData.tag.
 *
 * Per insight N22: a functional tag maps to multiple meshes (1:N),
 * so we map tag → parent Group/Object3D.
 *
 * @param {object} scene — Three.js Scene
 * @returns {Map<string, object>} tag → Object3D
 */
export function buildTagMap3D(scene) {
  const map = new Map();
  if (!scene) return map;

  scene.traverse((obj) => {
    const tag = obj.userData?.tag || obj.name;
    if (tag && !map.has(tag)) {
      map.set(tag, obj);
    }
  });
  return map;
}

/**
 * Compute the bounding box center of a Three.js Object3D group.
 * @param {object} obj — Three.js Object3D
 * @returns {{ x: number, y: number, z: number } | null}
 */
export function getObjectCenter3D(obj) {
  if (!obj) return null;
  // If Three.js Box3 is available on the object
  if (obj.geometry?.boundingBox) {
    const box = obj.geometry.boundingBox;
    return {
      x: (box.min.x + box.max.x) / 2,
      y: (box.min.y + box.max.y) / 2,
      z: (box.min.z + box.max.z) / 2,
    };
  }
  // Fallback: use object world position
  if (obj.position) {
    return {
      x: obj.position.x ?? 0,
      y: obj.position.y ?? 0,
      z: obj.position.z ?? 0,
    };
  }
  return null;
}

/**
 * Clamp a value between min and max.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Linear interpolation between two values.
 * @param {number} a — start
 * @param {number} b — end
 * @param {number} t — progress (0–1)
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Calculate camera fly-to position for 3D viewer.
 * Places camera at an offset from the target looking at the target center.
 *
 * @param {{ x: number, y: number, z: number }} target — center to look at
 * @param {number} distance — distance from target (default: 10m)
 * @param {number} elevationAngle — radians above horizontal (default: π/6 = 30°)
 * @returns {{ position: { x, y, z }, target: { x, y, z } }}
 */
export function computeFlyToCamera(target, distance = 10, elevationAngle = Math.PI / 6) {
  if (!target) return null;
  return {
    position: {
      x: target.x + distance * Math.cos(elevationAngle),
      y: target.y + distance * Math.sin(elevationAngle),
      z: target.z + distance * Math.cos(elevationAngle),
    },
    target,
  };
}
