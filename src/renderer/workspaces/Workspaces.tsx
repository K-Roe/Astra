import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { approvals, audit, coding, projects, type IntelligenceResult } from '../intelligence/client';
import type { ProjectView } from '../../shared/intelligence';
import type { ApprovalView, AuditView, CodingBenchmarkView } from './types';

type Status = { readonly tone: 'ok' | 'error' | 'busy'; readonly text: string } | null;
type TaskView = { id: number; objective: string; state: string; requiresConfirm: boolean; repo: string };

/**
 * Projects workspace: discovery and inspection of repositories under the
 * approved root. Read-only; it never triggers code execution.
 */
export function ProjectsWorkspace() {
  const [list, setList] = useState<ProjectView[]>([]);
  const [selected, setSelected] = useState<ProjectView | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const refresh = useCallback(async () => {
    const result = await projects.list();
    if (result.ok) setList(result.value);
    else setStatus({ tone: 'error', text: result.error });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function inspect(project: ProjectView) {
    const result = await projects.inspect(project.root);
    if (result.ok) setSelected(result.value);
    else setStatus({ tone: 'error', text: result.error });
  }

  return (
    <section className="workspace" aria-label="Projects workspace">
      <header className="workspace-head">
        <h2>Projects</h2>
        <p className="workspace-sub">Repositories discovered under the approved root. Reading a project never runs its code.</p>
      </header>
      <div className="workspace-cards">
        <div className="workspace-card">
          <h3>Discovered repositories</h3>
          <button type="button" onClick={() => void refresh()}>Refresh</button>
          <ul className="source-list">
            {list.map((project) => (
              <li key={project.root}>
                <div>
                  <strong>{project.name}</strong>
                  <span className="muted">{project.root}</span>
                  <span className="badge">
                    {project.hasGit ? 'git' : 'no git'} · {project.languages.join(', ') || 'unknown language'}
                    {project.testCommands.length ? ` · tests: ${project.testCommands.join(', ')}` : ''}
                  </span>
                  {project.description ? <span className="muted">{project.description}</span> : null}
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => void inspect(project)}>Inspect</button>
                </div>
              </li>
            ))}
            {list.length === 0 ? <li className="muted">No repositories found under the approved root.</li> : null}
          </ul>
        </div>

        <div className="workspace-card">
          <h3>Selected project</h3>
          {selected ? (
            <dl className="detail-list">
              <dt>Name</dt><dd>{selected.name}</dd>
              <dt>Root</dt><dd>{selected.root}</dd>
              <dt>Languages</dt><dd>{selected.languages.join(', ') || 'unknown'}</dd>
              <dt>Frameworks</dt><dd>{selected.frameworks.join(', ') || 'none detected'}</dd>
              <dt>Test commands</dt><dd>{selected.testCommands.join(', ') || 'none detected'}</dd>
              <dt>Indexable files</dt><dd>{selected.fileCount}</dd>
            </dl>
          ) : (
            <p className="muted">Select a repository to inspect it.</p>
          )}
        </div>
      </div>
      {status ? <p className={`workspace-status ${status.tone}`} role="status">{status.text}</p> : null}
    </section>
  );
}

/**
 * Coding workspace: tasks, approvals and the audit trail.
 *
 * Every privileged step is shown with its exact scope and stays blocked until
 * an approval record exists. Nothing here commits, pushes or deletes on its own.
 */
export function CodingWorkspace() {
  const [objective, setObjective] = useState('');
  const [repo, setRepo] = useState('');
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [pending, setPending] = useState<ApprovalView[]>([]);
  const [log, setLog] = useState<AuditView[]>([]);
  const [benchmark, setBenchmark] = useState<CodingBenchmarkView | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const refresh = useCallback(async () => {
    const [a, au, b, t] = await Promise.all([approvals.list(), audit.list(40), coding.benchmark(), coding.listTasks()]);
    if (a.ok) setPending((a.value as ApprovalView[]).filter((item) => item.status === 'pending'));
    if (au.ok) setLog(au.value as AuditView[]);
    if (b.ok) setBenchmark(b.value as CodingBenchmarkView);
    if (t.ok) setTasks(t.value as TaskView[]);
  }, []);

  useEffect(() => {
    void refresh();
    void projects.list().then((result) => {
      if (result.ok && result.value.length > 0) setRepo((current) => current || result.value[0].root);
    });
  }, [refresh]);

  function apply<T>(result: IntelligenceResult<T>, okText: string): T | null {
    if (!result.ok) {
      setStatus({ tone: 'error', text: result.error });
      return null;
    }
    setStatus({ tone: 'ok', text: okText });
    return result.value;
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    apply(await coding.createTask(repo, objective), 'Task recorded as a draft. Nothing will run until you approve a specific action.');
    setObjective('');
    await refresh();
  }

  async function decide(id: number, approve: boolean) {
    apply(
      await approvals.decide(id, approve),
      approve ? 'Approved. The scope recorded with this approval is the only thing it permits.' : 'Refused and recorded in the audit log.',
    );
    await refresh();
  }

  return (
    <section className="workspace" aria-label="Coding workspace">
      <header className="workspace-head">
        <h2>Coding</h2>
        <p className="workspace-sub">Bounded, approval-gated repository work. Astra will not commit, push or install anything on her own.</p>
      </header>

      {benchmark ? (
        <p className="workspace-status ok">
          Coding model {benchmark.model} measured at {(benchmark.reliability * 100).toFixed(0)}% reliability. {benchmark.note}
        </p>
      ) : null}

      <div className="workspace-cards">
        <div className="workspace-card">
          <h3>New task</h3>
          <form onSubmit={createTask} className="stack">
            <label>
              <span>Repository</span>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="C:\Users\karlr\repos\MyProject" required />
            </label>
            <label>
              <span>Objective</span>
              <textarea value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Fix the failing authentication test" required />
            </label>
            <button type="submit">Create task</button>
          </form>

          <ul className="source-list">
            {tasks.map((task) => (
              <li key={task.id}>
                <div>
                  <strong>{task.objective}</strong>
                  <span className="muted">{task.repo}</span>
                  <span className="badge">
                    {task.state}
                    {task.requiresConfirm ? ' · awaiting your confirmation' : ''}
                  </span>
                </div>
                <div className="row-actions">
                  {task.requiresConfirm ? (
                    <button type="button" onClick={() => void coding.confirmTask(task.id).then(refresh)}>Resume</button>
                  ) : null}
                  <button type="button" className="danger" onClick={() => void coding.cancelTask(task.id).then(refresh)}>Cancel</button>
                </div>
              </li>
            ))}
            {tasks.length === 0 ? <li className="muted">No coding tasks yet.</li> : null}
          </ul>
        </div>

        <div className="workspace-card">
          <h3>Approvals</h3>
          <ul className="source-list">
            {pending.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.action}</strong>
                  {item.risk ? <span className="muted">{item.risk}</span> : null}
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => void decide(item.id, true)}>Approve</button>
                  <button type="button" className="danger" onClick={() => void decide(item.id, false)}>Refuse</button>
                </div>
              </li>
            ))}
            {pending.length === 0 ? <li className="muted">Nothing is waiting for approval.</li> : null}
          </ul>
        </div>

        <div className="workspace-card">
          <h3>Audit trail</h3>
          <ul className="audit-list">
            {log.map((entry) => (
              <li key={`${entry.at}-${entry.action}-${entry.actor}`}>
                <span className="muted">{new Date(entry.at).toLocaleTimeString()}</span>
                <strong>{entry.actor}</strong>
                <span>{entry.action}</span>
                {entry.result !== 'ok' ? <span className="error-text">{entry.result}</span> : null}
              </li>
            ))}
            {log.length === 0 ? <li className="muted">No recorded actions yet.</li> : null}
          </ul>
        </div>
      </div>
      {status ? <p className={`workspace-status ${status.tone}`} role="status">{status.text}</p> : null}
    </section>
  );
}