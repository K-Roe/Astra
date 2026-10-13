import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createLivingWorldScene } from './scene';

const IDLE_FRAME_MS = 1000 / 12;

export function LivingWorldViewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [userPaused, setUserPaused] = useState(false);
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const pausedRef = useRef(false);
  const synchronizeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    } catch {
      setAvailability('unavailable');
      container.dataset.worldState = 'unavailable';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const world = createLivingWorldScene();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let intersecting = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let frameCount = 0;
    let sampleFrames = 0;
    let sampleStart = performance.now();
    const animationStart = performance.now();

    function render() {
      if (disposed) return;
      renderer.render(world.scene, world.camera);
      frameCount++;
      sampleFrames++;
      container!.dataset.frameCount = String(frameCount);
      const now = performance.now();
      if (now - sampleStart >= 1000) {
        container!.dataset.fps = (sampleFrames * 1000 / (now - sampleStart)).toFixed(1);
        sampleFrames = 0;
        sampleStart = now;
      }
    }

    function reason(): string {
      if (document.hidden) return 'hidden';
      if (!intersecting) return 'offscreen';
      if (pausedRef.current) return 'manual';
      if (reducedMotion.matches) return 'reduced-motion';
      return 'running';
    }

    function tick() {
      if (disposed || reason() !== 'running') return;
      world.updateIdle((performance.now() - animationStart) / 1000);
      render();
      timeout = setTimeout(tick, IDLE_FRAME_MS);
    }

    function synchronize() {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
      const state = reason();
      container!.dataset.worldState = state;
      if (state === 'running') tick();
    }
    synchronizeRef.current = synchronize;

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      world.camera.aspect = width / height;
      world.camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      render();
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver((entries) => {
      intersecting = entries[0]?.isIntersecting ?? false;
      synchronize();
    });
    resizeObserver.observe(container);
    intersectionObserver.observe(container);
    document.addEventListener('visibilitychange', synchronize);
    reducedMotion.addEventListener('change', synchronize);
    resize();
    synchronize();
    setAvailability('ready');

    return () => {
      disposed = true;
      if (timeout) clearTimeout(timeout);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', synchronize);
      reducedMotion.removeEventListener('change', synchronize);
      world.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      synchronizeRef.current = () => {};
    };
  }, []);

  function togglePaused(): void {
    pausedRef.current = !pausedRef.current;
    setUserPaused(pausedRef.current);
    synchronizeRef.current();
  }

  return (
    <div className="world-viewport" ref={containerRef} data-world-state="loading" data-frame-count="0" data-fps="0" aria-label="Temporary 3D room and articulated Astra mannequin">
      <canvas ref={canvasRef} aria-label="Procedural living room with temporary full-body Astra mannequin" />
      {availability === 'unavailable' && <p className="world-unavailable" role="status">3D is unavailable on this display. Chat remains available.</p>}
      {availability === 'ready' && <button className="world-pause" type="button" onClick={togglePaused} aria-label={userPaused ? 'Resume 3D scene' : 'Pause 3D scene'}>{userPaused ? 'Resume scene' : 'Pause scene'}</button>}
    </div>
  );
}
