import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { learning, memory, type IntelligenceResult } from '../intelligence/client';
import type { KnowledgePassageView, KnowledgeSourceView } from '../../shared/intelligence';
import type { KnowledgeStats, MemoryView } from './types';

type Status = { readonly tone: 'ok' | 'error' | 'busy'; readonly text: string } | null;

/**
 * Learning workspace.
 *
 * Shows what Astra has learned and where it came from. It is explicit about
 * the limit that matters: a completed fetch means pages were indexed, not that
 * the model has mastered the subject.
 */
export function LearningWorkspace({ onLearningActivityChange }: { onLearningActivityChange?: (running: boolean) => void } = {}) {
  const [sourceList, setSourceList] = useState<KnowledgeSourceView[]>([]);
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [passages, setPassages] = useState<KnowledgePassageView[]>([]);
  const [stats, setStats] = useState<string>('');
  const [status, setStatus] = useState<Status>(null);
  const [memoryList, setMemoryList] = useState<MemoryView[]>([]);
  const [statement, setStatement] = useState('');
  const learningBusy = useRef(false);

  const refresh = useCallback(async () => {
    const [s, st, m] = await Promise.all([learning.listSources(), learning.stats(), memory.list()]);
    if (s.ok) setSourceList(s.value as KnowledgeSourceView[]);
    if (st.ok) {
      const value = st.value as KnowledgeStats;
      setStats(`${value.sources} sources · ${value.documents} documents · ${value.chunks} passages`);
    }
    if (m.ok) setMemoryList(m.value as MemoryView[]);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = <T,>(result: IntelligenceResult<T>, okText: string): T | null => {
    if (!result.ok) {
      setStatus({ tone: 'error', text: result.error });
      return null;
    }
    setStatus({ tone: 'ok', text: okText });
    return result.value;
  };

  async function addSource(event: FormEvent) {
    event.preventDefault();
    setStatus({ tone: 'busy', text: 'Adding the source…' });
    const added = apply(await learning.addSource({ url: url.trim() }), 'Source approved. Select "Learn" to fetch it.');
    if (added) setUrl('');
    await refresh();
  }

  async function learn(id: number) {
    if (learningBusy.current) return;
    learningBusy.current = true;
    onLearningActivityChange?.(true);
    setStatus({ tone: 'busy', text: 'Fetching approved pages…' });
    try {
      const result = await learning.learnSource(id);
      if (!result.ok) setStatus({ tone: 'error', text: result.error });
      else {
        setStatus({
          tone: 'ok',
          text: `Indexed ${result.value.documents} page(s). ${result.value.errors.length} page(s) were skipped. This stores text for retrieval; it does not retrain any model.`,
        });
      }
      await refresh();
    } finally {
      learningBusy.current = false;
      onLearningActivityChange?.(false);
    }
  }

  async function revoke(id: number) {
    apply(await learning.revokeSource(id), 'Source revoked. Its stored pages remain available for inspection but are no longer used in answers.');
    await refresh();
  }

  async function remove(id: number) {
    apply(await learning.deleteSource(id), 'Stored knowledge for this source was deleted.');
    await refresh();
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const result = await learning.search(query.trim());
    if (!result.ok) {
      setStatus({ tone: 'error', text: result.error });
      return;
    }
    setPassages(result.value as KnowledgePassageView[]);
    setStatus({
      tone: result.value.length ? 'ok' : 'error',
      text: result.value.length ? `${result.value.length} passage(s) found.` : 'Nothing stored matches that yet. Astra has no answer from memory for this.',
    });
  }

  async function remember(event: FormEvent) {
    event.preventDefault();
    if (apply(await memory.remember(statement.trim()), 'Saved as a memory Karl asked Astra to keep.')) setStatement('');
    await refresh();
  }

  return (
    <section className="workspace" aria-label="Learning workspace">
      <header className="workspace-head">
        <h2>Learning</h2>
        <p className="workspace-sub">{stats || 'Loading stored knowledge…'}</p>
      </header>

      <div className="workspace-cards">
        <div className="workspace-card">
          <h3>Approved websites</h3>
          <form onSubmit={addSource} className="stack">
            <label>
              <span>Documentation URL (HTTPS only)</span>
              <input
                type="url"
                value={url}
                placeholder="https://react.dev/learn"
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </label>
            <button type="submit">Approve source</button>
          </form>
          <ul className="source-list">
            {(sourceList ?? []).map((source) => (
              <li key={source.id}>
                <div>
                  <strong>{source.label || source.host}</strong>
                  <span className="muted">{source.url}</span>
                  <span className="badge">
                    {source.approved ? source.status : 'revoked'} · {source.documentCount} page(s)
                  </span>
                  {source.lastError ? <span className="muted error-text">last error: {source.lastError}</span> : null}
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => void learn(source.id)} disabled={!source.approved}>Learn</button>
                  <button type="button" onClick={() => void revoke(source.id)}>{source.approved ? 'Revoke' : 'Reinstate'}</button>
                  <button type="button" className="danger" onClick={() => void remove(source.id)}>Delete knowledge</button>
                </div>
              </li>
            ))}
            {sourceList && sourceList.length === 0 ? <li className="muted">No sources approved yet.</li> : null}
          </ul>
        </div>

        <div className="workspace-card">
          <h3>Ask stored knowledge</h3>
          <form onSubmit={search} className="stack">
            <label>
              <span>Question</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="How do I revoke a source?" required />
            </label>
            <button type="submit">Search</button>
          </form>
          <ol className="passage-list">
            {passages.map((passage) => (
              <li key={passage.url}>
                <p>{passage.text}</p>
                <a href={passage.url} target="_blank" rel="noreferrer noopener">{passage.title}</a>
                <span className="muted">
                  {passage.sourceLabel} · fetched {new Date(passage.fetchedAt).toLocaleString()}
                  {passage.stale ? ' · may be out of date' : ''}
                </span>
              </li>
            ))}
          </ol>
          {passages.length > 0 ? (
            <p className="muted">Passages above are quoted source material. Anything Astra concludes beyond them is generated, not sourced.</p>
          ) : null}
        </div>

        <div className="workspace-card">
          <h3>Memory</h3>
          <form onSubmit={remember} className="stack">
            <label>
              <span>Something Astra should remember</span>
              <input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Karl prefers concise answers" required />
            </label>
            <button type="submit">Remember</button>
          </form>
          <ul className="source-list">
            {memoryList.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.statement}</strong>
                  <span className="muted">{entry.category}</span>
                </div>
                <div className="row-actions">
                  <button type="button" className="danger" onClick={() => void memory.forget(entry.id).then(refresh)}>Forget</button>
                </div>
              </li>
            ))}
            {memoryList.length === 0 ? <li className="muted">No memories stored yet. Astra does not keep ordinary conversation.</li> : null}
          </ul>
        </div>
      </div>

      {status ? <p className={`workspace-status ${status.tone}`} role="status">{status.text}</p> : null}
    </section>
  );
}
