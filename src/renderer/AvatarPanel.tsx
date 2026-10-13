import { lazy, Suspense } from 'react';
import type { PresentationState } from './presentationState';

const LivingWorldViewport = lazy(async () => {
  const module = await import('./world/LivingWorldViewport');
  return { default: module.LivingWorldViewport };
});

interface AvatarPanelProps {
  readonly state: PresentationState;
  readonly connectionLabel: string;
  readonly version?: string;
}

const stateCopy: Record<PresentationState, { label: string; description: string }> = {
  idle: { label: 'Present', description: 'Ready to talk when you are.' },
  listening: { label: 'Listening', description: 'Voice input will appear in a later phase.' },
  thinking: { label: 'Thinking', description: 'Putting a reply together locally.' },
  speaking: { label: 'Speaking', description: 'Voice output will appear in a later phase.' },
  error: { label: 'Connection issue', description: 'Check the local model connection.' },
};

export function AvatarPanel({ state, connectionLabel, version }: AvatarPanelProps) {
  const copy = stateCopy[state];

  return (
    <aside className="avatar-panel" aria-label="Astra character panel" data-presentation-state={state}>
      <div className="avatar-panel-top">
        <span className="panel-index">01 / LIVING WORLD</span>
        <span className="panel-version">{version ? `V${version}` : 'LOCAL'}</span>
      </div>
      <div className="avatar-stage"><Suspense fallback={<p className="world-loading">Preparing local 3D room…</p>}><LivingWorldViewport /></Suspense></div>
      <div className="avatar-panel-bottom">
        <p className="placeholder-label">Temporary 3D mannequin placeholder</p>
        <h2>Astra</h2>
        <p className="avatar-tagline">A little spark. A lot of curiosity.</p>
        <div className={`avatar-presence avatar-presence-${state}`} role="status" aria-live="polite">
          <span className="presence-light" aria-hidden="true" />
          <div><strong>{copy.label}</strong><span>{copy.description}</span></div>
        </div>
        <p className="avatar-connection">{connectionLabel}</p>
      </div>
    </aside>
  );
}
