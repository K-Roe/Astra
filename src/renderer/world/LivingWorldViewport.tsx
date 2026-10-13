import { memo, useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { worldCameraFraming } from '../../shared/worldCamera';
import type { WorldFrameSample } from '../../shared/worldPerformance';
import type { CharacterSignal } from '../../shared/characterStateMachine';

import { createLivingWorldScene } from './scene';
import { loadCharacterAsset } from './characterAsset';
import { CharacterController } from './characterController';

const ACTIVE_FRAME_MS = 1000 / 30;
const WATCHDOG_MS = 300;
const MAX_SAMPLES = 512;

type CharacterStatus = 'loading' | 'ready' | 'fallback';

interface DiagnosticViewport extends HTMLDivElement {
  worldSamples?: WorldFrameSample[];
  astraDiagnostics?: {
    state: string;
    clip: string | null;
    destination: string | null;
    waypoint: string;
    x: number;
    z: number;
    asset: CharacterStatus;
  };
}

export interface LivingWorldViewportProps {
  /** Chat lifecycle events forwarded to the character controller. */
  readonly chatSignal: CharacterSignal;
  /** Master switch for the autonomous idle scheduler. */
  readonly idleEnabled?: boolean;
  readonly onWaveRequest?: () => void;
  readonly onCentreRequest?: () => void;
}

export const LivingWorldViewport = memo(function LivingWorldViewport({
  chatSignal,
  idleEnabled = true,
  onWaveRequest,
  onCentreRequest,
}: LivingWorldViewportProps) {
  const containerRef = useRef<DiagnosticViewport>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<CharacterController | null>(null);
  const [userPaused, setUserPaused] = useState(false);
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [characterStatus, setCharacterStatus] = useState<CharacterStatus>('loading');
  const pausedRef = useRef(false);
  const synchronizeRef = useRef<() => void>(() => {});

  const togglePaused = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setUserPaused(pausedRef.current);
    synchronizeRef.current();
  }, []);

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
    let previousTime = performance.now();
    // Declared up front: publishDiagnostics runs from the very first tick.
    const characterStatusRef = { current: 'loading' as CharacterStatus };
    const idleEnabledRef = { current: idleEnabled };
    let cancelled = false;

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

    /** Read the preference fresh: a cached MediaQueryList can stay stale. */
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
        const elapsed = (timestamp - animationStart) / 1000;
        world.updateIdle(elapsed);
        const delta = Math.min((timestamp - previousTime) / 1000, 0.1);
        previousTime = timestamp;
        controllerRef.current?.update(delta);
        trackCharacter();
        render('idle');
        lastFrameAt = timestamp;
        publishDiagnostics();
      }
      frameRequest = window.requestAnimationFrame(tick);
    }

    function trackCharacter(): void {
  const controller = controllerRef.current;
  if (!controller) return;
  const position = controller.getDiagnostics().position;
  // Re-aim so she stays fully in frame wherever she walks. Blending the aim
  // point keeps the camera from snapping when a journey starts or ends.
  const framing = worldCameraFraming(canvas!.clientWidth, canvas!.clientHeight, position.x, position.z);
  const desired = new THREE.Vector3(...framing.position);
  const desiredLook = new THREE.Vector3(...framing.target);
      // Lag the follow slightly so movement reads as a gentle pan, not a snap.
      targetCamera.lerp(desired, 0.05);
      targetLook.lerp(desiredLook, 0.05);
    }

    function publishDiagnostics() {
      const controller = controllerRef.current;
      const diagnostics = controller?.getDiagnostics();
      container!.astraDiagnostics = {
        state: diagnostics?.state ?? 'idle',
        clip: diagnostics?.clip ?? null,
        destination: diagnostics?.destination ?? null,
        waypoint: diagnostics?.waypoint ?? 'centre',
        x: diagnostics?.position.x ?? 0,
        z: diagnostics?.position.z ?? 0,
        asset: characterStatusRef.current,
      };
    }

    function synchronize() {
      if (frameRequest !== undefined) window.cancelAnimationFrame(frameRequest);
      frameRequest = undefined;
      const state = reason();
      container!.dataset.worldState = state;
      if (state === 'running') {
        previousTime = performance.now();
        tick(performance.now());
      } else {
        lastFrameAt = 0;
        lastIdleAt = 0;
      }
    }
    synchronizeRef.current = synchronize;

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

    // Media query change events are best effort; re-check periodically so a
    // stopped scene can resume when the preference is cleared.
    const watchdog = window.setInterval(() => {
      if (!disposed && container!.dataset.worldState !== reason()) synchronize();
    }, WATCHDOG_MS);
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', synchronize);

    resize();
    synchronize();
    setAvailability('ready');

    void loadCharacterAsset().then((result) => {
      if (cancelled || disposed) {
        if (result.status === 'ready') result.asset.dispose();
        return;
      }
      if (result.status === 'failed') {
        world.useFallback();
        characterStatusRef.current = 'fallback';
        setCharacterStatus('fallback');
        container!.dataset.characterAsset = 'fallback';
        container!.dataset.characterError = result.reason.slice(0, 120);
        return;
      }
      const controller = new CharacterController(result.asset);
      controllerRef.current = controller;
      controller.setIdleEnabled(idleEnabledRef.current);
      world.characterAnchor.add(result.asset.object);
      characterStatusRef.current = 'ready';
      setCharacterStatus('ready');
      container!.dataset.characterAsset = 'ready';
    });

    return () => {
      disposed = true;
      cancelled = true;
      window.clearInterval(watchdog);
      if (frameRequest !== undefined) window.cancelAnimationFrame(frameRequest);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', synchronize);
      window.matchMedia('(prefers-reduced-motion: reduce)').removeEventListener('change', synchronize);
      controllerRef.current?.dispose();
      controllerRef.current = null;
      world.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      delete container.worldSamples;
      delete container.astraDiagnostics;
      synchronizeRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.send(chatSignal.event);
  }, [chatSignal]);

  useEffect(() => {
    controllerRef.current?.setIdleEnabled(idleEnabled);
  }, [idleEnabled]);

  return (
    <div className="world-viewport" ref={containerRef} data-world-state="loading" data-frame-count="0" data-fps="0" aria-label="Astra in her room">
      <canvas ref={canvasRef} aria-label="Astra standing in her room" />
      {availability === 'unavailable' && <p className="world-unavailable" role="status">3D is unavailable on this display. Chat remains available.</p>}
      {availability === 'ready' && (
        <div className="world-controls">
          <button className="world-pause" type="button" onClick={togglePaused} aria-label={userPaused ? 'Resume 3D scene' : 'Pause 3D scene'}>
            {userPaused ? 'Resume scene' : 'Pause scene'}
          </button>
          <button className="world-action" type="button" onClick={onWaveRequest} disabled={characterStatus !== 'ready'} aria-label="Make Astra wave">
            Wave
          </button>
          <button className="world-action" type="button" onClick={onCentreRequest} disabled={characterStatus !== 'ready'} aria-label="Bring Astra to the centre of the room">
            Centre
          </button>
          {characterStatus === 'loading' && <span className="world-status">Loading Astra…</span>}
          {characterStatus === 'fallback' && <span className="world-status">Placeholder character</span>}
        </div>
      )}
    </div>
  );
});