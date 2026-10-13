import { memo, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { worldCameraFraming } from '../../shared/worldCamera';
import type { WorldFrameSample } from '../../shared/worldPerformance';
import { createLivingWorldScene } from './scene';

const ACTIVE_FRAME_MS = 1000 / 30;
const WATCHDOG_MS = 300;
const MAX_SAMPLES = 512;

interface DiagnosticViewport extends HTMLDivElement {
  worldSamples?: WorldFrameSample[];
}

export const LivingWorldViewport = memo(function LivingWorldViewport() {
  const containerRef = useRef<DiagnosticViewport>(null);
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
    const targetCamera = world.camera.position.clone();
    const targetLook = new THREE.Vector3(...worldCameraFraming(343, 261).target);
    const currentLook = targetLook.clone();
    const samples: WorldFrameSample[] = [];
    container.worldSamples = samples;
    let intersecting = true;
    let frameRequest: number | undefined;
    let disposed = false;
    let frameCount = 0;
    let sampleFrames = 0;
    let sampleStart = performance.now();
    const animationStart = performance.now();
    let lastIdleAt = 0;
    let lastFrameAt = 0;

    function render(source: 'idle' | 'resize') {
      if (disposed) return;
      const start = performance.now();
      renderer.render(world.scene, world.camera);
      const end = performance.now();
      samples.push({
        timeMs: end,
        intervalMs: source === 'idle' && lastIdleAt > 0 ? end - lastIdleAt : null,
        renderCpuMs: end - start,
        source,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      });
      if (samples.length > MAX_SAMPLES) samples.shift();
      if (source === 'idle') lastIdleAt = end;
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

    /** Read the preference fresh: a cached MediaQueryList can stay stale when the platform setting changes. */
    function prefersReducedMotion(): boolean {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function reason(): string {
      if (document.hidden) return 'hidden';
      if (!intersecting) return 'offscreen';
      if (pausedRef.current) return 'manual';
      if (prefersReducedMotion()) return 'reduced-motion';
      return 'running';
    }

    function tick(timestamp: number) {
      if (disposed || reason() !== 'running') return;
      if (!lastFrameAt || timestamp - lastFrameAt >= ACTIVE_FRAME_MS - 1) {
        world.camera.position.lerp(targetCamera, 0.18);
        currentLook.lerp(targetLook, 0.18);
        world.camera.lookAt(currentLook);
        world.updateIdle((timestamp - animationStart) / 1000);
        render('idle');
        lastFrameAt = timestamp;
      }
      frameRequest = window.requestAnimationFrame(tick);
    }

    function synchronize() {
      if (frameRequest !== undefined) window.cancelAnimationFrame(frameRequest);
      frameRequest = undefined;
      const state = reason();
      container!.dataset.worldState = state;
      if (state === 'running') tick(performance.now());
      else {
        lastFrameAt = 0;
        lastIdleAt = 0;
      }
    }
    synchronizeRef.current = synchronize;

    /** Media query change events are best effort; re-check periodically so a stopped scene can resume. */
    const watchdog = window.setInterval(() => {
      if (!disposed && container!.dataset.worldState !== reason()) synchronize();
    }, WATCHDOG_MS);

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      const framing = worldCameraFraming(width, height);
      world.camera.aspect = framing.aspect;
      world.camera.updateProjectionMatrix();
      targetCamera.set(...framing.position);
      targetLook.set(...framing.target);
      if (reason() !== 'running') {
        world.camera.position.copy(targetCamera);
        currentLook.copy(targetLook);
        world.camera.lookAt(currentLook);
      }
      renderer.setSize(width, height, false);
      render('resize');
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver((entries) => {
      intersecting = entries[0]?.isIntersecting ?? false;
      synchronize();
    });
    resizeObserver.observe(container);
    intersectionObserver.observe(container);
    document.addEventListener('visibilitychange', synchronize);
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', synchronize);
    resize();
    synchronize();
    setAvailability('ready');

    return () => {
      disposed = true;
      window.clearInterval(watchdog);
      if (frameRequest !== undefined) window.cancelAnimationFrame(frameRequest);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', synchronize);
      world.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      delete container.worldSamples;
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
});
