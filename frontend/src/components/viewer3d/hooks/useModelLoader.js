import { useState, useEffect, useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/**
 * Hook to load a glTF/glb model with progress tracking.
 *
 * @param {string|null} url  URL of the glTF/glb file
 * @returns {{ scene, progress, error, isLoading }}
 */
export default function useModelLoader(url) {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [scene, setScene] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const loaderRef = useRef(null);

  useEffect(() => {
    if (!url) {
      setScene(null);
      setProgress(0);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgress(0);

    const loader = new GLTFLoader();

    // Optional Draco decoder for compressed meshes
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACODecoder(draco);
    loaderRef.current = loader;

    loader.load(
      url,
      (gltf) => {
        setScene(gltf.scene);
        setProgress(100);
        setIsLoading(false);
      },
      (event) => {
        if (event.lengthComputable) {
          setProgress(Math.round((event.loaded / event.total) * 100));
        }
      },
      (err) => {
        console.error('[useModelLoader] Failed to load model:', err);
        setError(err?.message || 'Failed to load 3D model');
        setIsLoading(false);
      },
    );

    return () => {
      loaderRef.current = null;
    };
  }, [url]);

  return { scene, progress, error, isLoading };
}
