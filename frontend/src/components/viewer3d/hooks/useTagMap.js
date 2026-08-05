import { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Build a { tag → THREE.Group } map from a loaded scene.
 *
 * Per insight N22: a functional tag (e.g. "CV-019S") maps to *multiple*
 * meshes in the 3D model (body, bonnet, handwheel, flanges).
 * We group all children under a common tag into a single Group reference.
 *
 * Strategy:
 *   1. Traverse scene → collect objects with userData.tag
 *   2. Group objects by tag → Map<string, Object3D[]>
 *   3. For each tag, if the nearest common ancestor already has name===tag,
 *      use that Group; otherwise collect the set of meshes.
 *
 * @param {THREE.Object3D|null} scene  The loaded glTF scene
 * @returns {Map<string, THREE.Object3D>}  tag → Object3D (Group or single mesh)
 */
export default function useTagMap(scene) {
  return useMemo(() => {
    const map = new Map();
    if (!scene) return map;

    // First try: find named groups in the hierarchy
    scene.traverse((obj) => {
      const tag = obj.userData?.tag || obj.name;
      if (!tag || tag === '' || tag === 'Scene' || tag === 'RootNode') return;

      // If this object has children (it's a group), or is a mesh with a tag
      if (!map.has(tag)) {
        map.set(tag, obj);
      }
    });

    // Second pass: collect orphan tagged meshes and ensure group mapping
    const meshesByTag = new Map();
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      const tag = obj.userData?.tag;
      if (!tag) return;
      if (!meshesByTag.has(tag)) meshesByTag.set(tag, []);
      meshesByTag.get(tag).push(obj);
    });

    // For tags that only mapped to a single mesh, make sure we have that mesh
    for (const [tag, meshes] of meshesByTag) {
      if (!map.has(tag)) {
        if (meshes.length === 1) {
          map.set(tag, meshes[0]);
        } else {
          // Find common parent
          const parent = findCommonParent(meshes);
          map.set(tag, parent || meshes[0]);
        }
      }
    }

    return map;
  }, [scene]);
}

function findCommonParent(objects) {
  if (objects.length === 0) return null;
  if (objects.length === 1) return objects[0].parent;

  // Get ancestor chain for first object
  const ancestors = new Set();
  let current = objects[0];
  while (current) {
    ancestors.add(current);
    current = current.parent;
  }

  // Walk up from second object, find first common ancestor
  current = objects[1];
  while (current) {
    if (ancestors.has(current)) return current;
    current = current.parent;
  }

  return null;
}
