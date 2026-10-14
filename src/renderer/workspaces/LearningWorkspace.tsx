import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { learning, memory, type IntelligenceResult } from '../intelligence/client';
import type {
  KnowledgePassageView,
  KnowledgeSourceView,
  PersonalMemoryRecordView,
  PersonalMemorySummaryView,
  PersonalMemoryView,
} from '../../shared/intelligence';
import type { KnowledgeStats } from './types';

const MEMORY_CATEGORIES = [
  'preference',
  'project_fact',
  'decision',
  'correction',
  'development_note',
  'successful_approach',
  'failed_approach',
] as const;

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
  const [memoryList, setMemoryList] = useState<PersonalMemoryView[]>([]);
  const [memorySummary, setMemorySummary] = useState<PersonalMemorySummaryView | null>(null);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);
  const [category, setCategory] = useState('preference');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [statement, setStatement] = useState('');
  const learningBusy = useRef(false);

  const refresh = useCallback(async () => {
    const [s, st, m, summary, suggestions] = await Promise.all([
      learning.listSources(),
      learning.stats(),
      memory.listAll(),
      memory.summary(),
      memory.suggestions(),
    ]);
    if (s.ok) setSourceList(s.value as KnowledgeSourceView[]);
    if (st.ok) {
      const value = st.value as KnowledgeStats;
      setStats(`${value.sources} sources · ${value.documents} documents · ${value.chunks} passages`);
    }
    if (m.ok) setMemoryList(m.value as PersonalMemoryRecordView[]);
    if (summary.ok) setMemorySummary(summary.value);
    if (suggestions.ok) setSuggestionsEnabled(Boolean(suggestions.value));
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
    const saved = apply(
      await memory.remember({ statement: statement.trim(), category }),
      'Saved as a memory Karl asked Astra to keep.',
    );
    if (saved) setStatement('');
    await refresh();
  }

  async function saveEdit(id: number) {
    apply(await memory.update({ id, statement: editDraft.trim() }), 'Memory updated.');
    setEditingId(null);
    await refresh();
  }

  async function forgetMemory(id: number) {
    apply(await memory.forget(id), 'Memory forgotten. Astra will not use it again.');
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
          <h3>Personal memory</h3>
          <p className="muted">
            {memorySummary
              ? `${memorySummary.count} active memor${memorySummary.count === 1 ? 'y' : 'ies'} loaded from the local database at startup (${memorySummary.loadedAt.slice(0, 16).replace('T', ' ')}). Astra uses these in conversation. They are not model training.`
              : 'Loading personal memory…'}
          </p>
          <label className="memory-toggle">
            <input
              type="checkbox"
              checked={suggestionsEnabled}
              onChange={(event) => {
                const next = event.target.checked;
                setSuggestionsEnabled(next);
                void memory.setSuggestions(next).then(refresh);
              }}
            />
            <span>Suggest memories from conversation (nothing is saved without your confirmation)</span>
          </label>
          <form onSubmit={remember} className="stack">
            <label>
              <span>Something Astra should remember</span>
              <input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Karl prefers concise answers" required />
            </label>
            <label>
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {MEMORY_CATEGORIES.map((option) => <option key={option} value={option}>{option.replace('_', ' ')}</option>)}
              </select>
            </label>
            <button type="submit">Remember</button>
          </form>
          <ul className="source-list">
            {memoryList.map((entry) => (
              <li key={entry.id} className={entry.status === 'active' ? '' : 'muted'}>
                <div>
                  {editingId === entry.id ? (
                    <span className="memory-edit">
                      <input
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        aria-label={`Edit memory ${entry.id}`}
                      />
                      <button type="button" onClick={() => void saveEdit(entry.id)}>Save</button>
                      <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <strong>{entry.statement || '(text cleared)'}</strong>
                  )}
                  <span className="muted">
                    {entry.category.replace('_', ' ')} · {entry.origin.replace(/_/g, ' ')} · saved {entry.createdAt.slice(0, 10)} · updated {entry.updatedAt.slice(0, 10)}
                  </span>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(entry.id);
                      setEditDraft(entry.statement);
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="danger" onClick={() => void forgetMemory(entry.id)}>Forget</button>
                </div>
              </li>
            ))}
            {memoryList.length === 0 ? <li className="muted">No personal memories stored yet. Tell Astra in chat, or add one here.</li> : null}
          </ul>
        </div>
      </div>

      {status ? <p className={`workspace-status ${status.tone}`} role="status">{status.text}</p> : null}
    </section>
  );
}
