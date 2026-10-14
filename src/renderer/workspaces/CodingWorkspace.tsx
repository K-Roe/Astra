import { useCallback, useEffect, useRef, useState } from 'react';
import { projects, type IntelligenceResult } from '../intelligence/client';
import type { CodingTaskView } from '../../shared/intelligence';
import type { CharacterEvent } from '../../shared/characterStateMachine';
import { useCodingSession } from '../intelligence/codingSession';

type Status = { readonly tone: 'ok' | 'error' | 'busy'; readonly text: string } | null;

/**
 * The Coding workspace.
 *
 * Reads the *same* task state the conversation drives — there is one engine in
 * main, and this is a view of it. Nothing here starts or advances a task on
 * its own beyond calling the approve/reject/cancel controls, which is exactly
 * the set of decisions Karl is allowed to make.
 */
export function CodingWorkspace({
  onActivity,
  tellCharacter,
}: {
  onActivity?: (message: string) => void;
  tellCharacter?: (event: CharacterEvent) => void;
}) {
  const [task, setTask] = useState<CodingTaskView | null>(null);
  const [repos, setRepos] = useState<{ name: string; root: string; branch: string | null; clean: boolean }[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [history, setHistory] = useState<{ id: number; objective: string; state: string }[]>([]);
  const session = useCodingSession();
  const announce = useRef(onActivity);
  announce.current = onActivity;
  const character = useRef(tellCharacter);
  character.current = tellCharacter;
  const tellCharacterSafe = useCallback((event: CharacterEvent) => character.current?.(event), []);

  const refresh = useCallback(async () => {
    const result = await session.snapshot();
    if (result.ok) {
      setTask(result.value);
      if (result.value.repository) setSelected(result.value.repository);
    } else {
      setStatus({ tone: 'error', text: result.error });
    }
    const tasks = await session.listTasks();
    if (tasks.ok) setHistory(tasks.value);
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void projects.list().then((list) => {
      if (list.ok) setRepos(list.value.map((p) => ({ name: p.name, root: p.root, branch: p.branch ?? null, clean: p.clean ?? false })));
    });
  }, []);

  useEffect(() => {
    // Tool activity from the conversation shows here too, so both views agree.
    return session.onChange(() => {
      void refresh();
    });
  }, [session, refresh]);

  useEffect(() => {
    // Mirror the task phase into the character. Presentation only: the event
    // reaches the animation controller and can never authorise a tool call.
    const phase = task?.phase;
    if (!phase) return;
    if (phase === 'investigating' || phase === 'planning') tellCharacterSafe('coding_investigating');
    else if (phase === 'implementing' || phase === 'testing') tellCharacterSafe('coding_working');
    else if (phase === 'completed') tellCharacterSafe('coding_complete');
    else if (phase === 'failed') tellCharacterSafe('coding_failed');
  }, [task?.phase, tellCharacterSafe]);

  async function run<T>(work: () => Promise<IntelligenceResult<T>>, okText: string): Promise<T | null> {
    setStatus({ tone: 'busy', text: 'Working…' });
    const result = await work();
    if (!result.ok) {
      setStatus({ tone: 'error', text: result.error });
      return null;
    }
    setStatus({ tone: 'ok', text: okText });
    await refresh();
    return result.value;
  }

  async function choose(root: string) {
    await run(() => session.selectRepository(root), `Selected ${root}.`);
  }

  async function decide(kind: 'approve' | 'reject' | 'confirm') {
    const ok = await run(
      () => session.decide(kind),
      kind === 'approve' ? 'Plan approved. Astra may now make the approved changes.' : kind === 'reject' ? 'Plan rejected. Nothing was changed.' : 'Task resumed.',
    );
    if (ok && kind === 'approve' && announce.current) announce.current('Plan approved. Applying the approved changes.');
  }

  const plan = task?.plan;
  const pendingApproval = task?.phase === 'awaiting_approval' && !task.approval.approved;

  return (
    <section className="workspace" aria-label="Coding workspace">
      <header className="workspace-head">
        <h2>Coding</h2>
        <p className="workspace-sub">
          One task engine, shared with the conversation. Astra never commits, pushes or installs anything on her own.
        </p>
      </header>

      <div className="workspace-cards">
        <div className="workspace-card">
          <h3>Repository</h3>
          <label>
            <span>Selected repository</span>
            <select value={selected} onChange={(e) => void choose(e.target.value)}>
              <option value="">Choose a repository…</option>
              {repos.map((repo) => (
                <option key={repo.root} value={repo.root}>{repo.name} · {repo.branch ?? 'unknown branch'} · {repo.clean ? 'clean' : 'dirty'}</option>
              ))}
            </select>
          </label>
          {task?.repository ? (
            <dl className="detail-list">
              <dt>Path</dt><dd>{task.repository}</dd>
              <dt>Branch</dt><dd>{task.workingTree?.branch ?? 'unknown'}</dd>
              <dt>Tree</dt>
              <dd>
                {task.workingTree
                  ? task.workingTree.clean
                    ? 'clean'
                    : `${task.workingTree.staged} staged, ${task.workingTree.unstaged} modified, ${task.workingTree.untracked} untracked`
                  : 'unknown'}
              </dd>
            </dl>
          ) : (
            <p className="muted">No repository selected. Ask Astra in chat, or choose one here.</p>
          )}
        </div>

        <div className="workspace-card">
          <h3>Current task</h3>
          {task && task.taskId ? (
            <>
              <p><strong>{task.objective}</strong></p>
              <p className="badge">
                state: {task.phase}
                {task.requiresConfirmation ? ' · awaiting your confirmation' : ''}
              </p>
              {task.requiresConfirmation ? (
                <div className="row-actions">
                  <button type="button" onClick={() => void decide('confirm')}>Resume this task</button>
                  <button type="button" className="danger" onClick={() => void session.cancel('cancelled from the workspace')}>Cancel</button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted">No active task. Ask Astra in the conversation to investigate, fix or create something.</p>
          )}
          {history.length > 0 ? (
            <ul className="source-list">
              {history.map((entry) => (
                <li key={entry.id}>
                  <div><strong>{entry.objective}</strong><span className="muted">{entry.state}</span></div>
                  <div className="row-actions">
                    <button type="button" onClick={() => void run(() => session.restore(entry.id), `Restored task #${entry.id}. Nothing resumed.`)}>Review</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="workspace-card">
          <h3>Plan</h3>
          {plan ? (
            <>
              <dl className="detail-list">
                <dt>Objective</dt><dd>{plan.objective}</dd>
                <dt>Files</dt><dd>{plan.filesToChange.join(', ') || 'none'}</dd>
                <dt>Commands</dt>
                <dd>{plan.commands.map((c) => `${c.executable} ${c.args.join(' ')}`).join(', ') || 'none'}</dd>
                <dt>Branch</dt><dd>{plan.branch ?? 'current branch'}</dd>
                <dt>Risks</dt><dd>{plan.risks.join(' ')}</dd>
              </dl>
              {plan.patches?.length ? <details><summary>Proposed patch</summary><pre className="diff-view">{plan.patches.map((patch) => `${patch.file}\n${patch.hunks.map((h) => `- ${h.find}\n+ ${h.replace}`).join('\n')}`).join('\n\n')}</pre></details> : null}
              {plan.newRepository ? <details><summary>Scaffold files</summary><pre className="diff-view">{Object.entries(plan.newRepository.files).map(([file, content]) => `${file}\n${content}`).join('\n\n')}</pre></details> : null}
              {pendingApproval ? (
                <div className="row-actions">
                  <button type="button" onClick={() => void decide('approve')}>Approve plan</button>
                  <button type="button" className="danger" onClick={() => void decide('reject')}>Reject</button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted">No plan yet.</p>
          )}
        </div>

        <div className="workspace-card">
          <h3>Changes and tests</h3>
          {task && task.changes.length > 0 ? (
            <ul className="source-list">
              {task.changes.map((change, index) => (
                <li key={index}><div><strong>{change.file ?? change.action}</strong><span className="muted">{change.action}</span></div></li>
              ))}
            </ul>
          ) : (
            <p className="muted">No files modified.</p>
          )}
          {task && task.testResults.length > 0 ? (
            <ul className="source-list">
              {task.testResults.map((result, index) => (
                <li key={index}>
                  <div>
                    <strong>{result.command}</strong>
                    <span className="badge">{result.status === 'skipped' ? 'skipped' : result.ok ? 'passed' : `failed (exit ${result.exitCode})`}</span>
                    <span className="muted">{result.summary}</span>
                    {result.durationMs !== undefined ? <span className="muted">{result.durationMs} ms · {result.cwd}</span> : null}
                    {result.output ? <pre className="diff-view">{result.output}</pre> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No tests have been run for this task.</p>
          )}
        </div>

        <div className="workspace-card">
          <h3>Tool activity</h3>
          {task && task.events.length > 0 ? (
            <ol className="audit-list">
              {[...task.events].reverse().slice(0, 25).map((event) => (
                <li key={event.id}>
                  <span className="muted">{new Date(event.at).toLocaleTimeString()}</span>
                  <strong className={event.ok ? '' : 'error-text'}>{event.kind}</strong>
                  <span>{event.label}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No tool activity yet.</p>
          )}
        </div>

        <div className="workspace-card">
          <h3>Git diff</h3>
          {task?.diff && task.diff.filesChanged > 0 ? (
            <>
              <p className="muted">{task.diff.filesChanged} file(s), +{task.diff.insertions}/-{task.diff.deletions}</p>
              <pre className="diff-view">{task.diff.diff.slice(0, 4000)}</pre>
              <div className="row-actions">
                <button type="button" onClick={() => void run(() => session.review(), 'Diff refreshed.')}>Refresh diff</button>
                {task.phase !== 'cancelled' ? (
                  <button type="button" onClick={() => void run(() => session.complete('completed from the workspace'), 'Task marked complete.')}>Mark complete</button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="muted">No diff to show.</p>
          )}
        </div>
      </div>
      {status ? <p className={`workspace-status ${status.tone}`} role="status">{status.text}</p> : null}
    </section>
  );
}
