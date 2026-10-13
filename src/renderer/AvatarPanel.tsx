import type { PresentationState } from './presentationState';

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
        <span className="panel-index">01 / COMPANION</span>
        <span className="panel-version">{version ? `V${version}` : 'LOCAL'}</span>
      </div>
      <div className="avatar-stage">
        <div className="avatar-halo" aria-hidden="true" />
        <div className="avatar-orbit avatar-orbit-one" aria-hidden="true" />
        <div className="avatar-orbit avatar-orbit-two" aria-hidden="true" />
        <div className="avatar-figure" role="img" aria-label="Temporary illustrated placeholder for Astra, with purple hair and a star hoodie">
          <span className="hair-back" />
          <span className="hair-bun" />
          <span className="hair-bun-detail" />
          <span className="hoodie-hood" />
          <span className="hoodie-body" />
          <span className="hoodie-collar" />
          <span className="hoodie-star">★</span>
          <span className="face" />
          <span className="hair-fringe" />
          <span className="eye eye-left" />
          <span className="eye eye-right" />
          <span className="cheek cheek-left" />
          <span className="cheek cheek-right" />
          <span className="smile" />
        </div>
        <span className="avatar-spark avatar-spark-one" aria-hidden="true">✦</span>
        <span className="avatar-spark avatar-spark-two" aria-hidden="true">✦</span>
      </div>
      <div className="avatar-panel-bottom">
        <p className="placeholder-label">Temporary character placeholder</p>
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
