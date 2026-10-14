import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type UIEvent } from 'react';
import type { AppInfo, ChatMessage, ChatStatus } from '../shared/contracts';
import type { CharacterEvent, CharacterSignal } from '../shared/characterStateMachine';
import { AvatarPanel } from './AvatarPanel';
import { MessageContent } from './MessageContent';
import { CodingWorkspace } from './workspaces/CodingWorkspace';
import { ProjectsWorkspace } from './workspaces/Workspaces';
import { LearningWorkspace } from './workspaces/LearningWorkspace';
import { presentationForChatPhase, type ChatPhase } from './presentationState';
import type { CodingTaskView } from '../shared/intelligence';
import { worldActivityFor } from '../shared/worldActivity';

type WorkspaceId = 'conversation' | 'learning' | 'projects' | 'coding';

const WORKSPACES: readonly { readonly id: WorkspaceId; readonly label: string }[] = [
  { id: 'conversation', label: 'Chat' },
  { id: 'learning', label: 'Learning' },
  { id: 'projects', label: 'Projects' },
  { id: 'coding', label: 'Coding' },
];

export function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState('');
  const [phase, setPhase] = useState<ChatPhase>('connecting');
  const [detail, setDetail] = useState('Checking the local model…');
  const [scrolledUp, setScrolledUp] = useState(false);
  const [memorySuggestion, setMemorySuggestion] = useState<{ text: string; subject: string } | null>(null);
  const [memoryCount, setMemoryCount] = useState(0);
  const [memoryNotice, setMemoryNotice] = useState('');
  const [idleEnabled, setIdleEnabled] = useState(true);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('conversation');
  // Tool activity is shown as a distinct stream, never as a chat message, so a
  // tool action can never be mistaken for something Astra said.
  const [toolActivity, setToolActivity] = useState<{ id: number; kind: string; label: string; ok: boolean }[]>([]);
  const [codingTask, setCodingTask] = useState<CodingTaskView | null>(null);
  const [learningRunning, setLearningRunning] = useState(false);
  const [characterSignal, setCharacterSignal] = useState<CharacterSignal>({ event: 'chat_interrupted', nonce: 0 });
  const requestId = useRef(0);
  const lastCodingNotice = useRef('');
  const conversationRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);

/**
 * Chat lifecycle drives Astra's animation. The model never issues animation
   * commands: the renderer's chat state maps onto fixed, approved clips here.
   * The nonce guarantees the same event twice in a row still reaches the scene.
   */
  const tellCharacter = useCallback((event: CharacterEvent) => {
    setCharacterSignal((previous) => ({ event, nonce: previous.nonce + 1 }));
  }, []);

  function applyStatus(status: ChatStatus): void {
    setMessages(status.messages);
    setPhase(status.state);
    setDetail(status.detail);
    setMemorySuggestion(status.memorySuggestion ?? null);
    setMemoryCount(status.memoryCount ?? 0);
  }

  /**
   * Accepting a suggested memory is an explicit, typed operation. Nothing is
   * stored until Karl presses this, and a failure is shown rather than hidden.
   */
  async function acceptMemorySuggestion(): Promise<void> {
    if (!memorySuggestion) return;
    try {
      const { memory } = await import('./intelligence/client');
      const result = await memory.remember({ statement: memorySuggestion.text, subject: memorySuggestion.subject });
      setMemorySuggestion(null);
      setMemoryNotice(result.ok ? `Saved: ${result.value.statement}` : `Not saved: ${result.error}`);
      setMemoryCount((count) => (result.ok ? count + 1 : count));
    } catch (error) {
      setMemoryNotice(`Not saved: ${error instanceof Error ? error.message : 'memory service unavailable'}`);
    }
  }

  useEffect(() => {
    let mounted = true;
    void Promise.all([window.astra.getAppInfo(), window.astra.getChatStatus()])
      .then(([info, status]) => {
        if (!mounted) return;
        setAppInfo(info);
        applyStatus(status);
      })
      .catch(() => {
        if (!mounted) return;
        setPhase('error');
        setDetail('Astra could not connect to its local desktop service.');
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation && followLatest.current) conversation.scrollTop = conversation.scrollHeight;
  }, [messages, pending, phase]);

  useEffect(() => {
    const onResize = () => {
      const shouldFollow = followLatest.current;
      if (!shouldFollow) return;
      window.requestAnimationFrame(() => {
        const conversation = conversationRef.current;
        if (conversation) conversation.scrollTop = conversation.scrollHeight;
        followLatest.current = true;
        setScrolledUp(false);
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function onConversationScroll(event: UIEvent<HTMLDivElement>): void {
    const element = event.currentTarget;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
    followLatest.current = nearBottom;
    setScrolledUp(!nearBottom);
  }

  function jumpToLatest(): void {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
    followLatest.current = true;
    setScrolledUp(false);
  }

  async function refresh(): Promise<void> {
    setPhase('connecting');
    setDetail('Checking the local model…');
    try { applyStatus(await window.astra.getChatStatus()); }
    catch {
      setPhase('error');
      setDetail('Astra could not connect to its local desktop service.');
    }
  }

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const content = draft.trim();
    if (!content || phase === 'connecting' || phase === 'generating') return;
    const id = ++requestId.current;
    setPending(content);
    setDraft('');
    setPhase('generating');
    setDetail('Astra is generating a reply locally…');
    tellCharacter('chat_generating');
    try {
      const status = await window.astra.sendMessage(content);
      if (id !== requestId.current) return;
      setPending('');
      applyStatus(status);
      tellCharacter('chat_reply');
    } catch {
      if (id !== requestId.current) return;
      setPending('');
      setDraft(content);
      const status = await window.astra.getChatStatus().catch(() => null);
      if (id !== requestId.current) return;
      setPhase('error');
      setDetail(status?.state === 'error' ? status.detail : 'The local model could not complete the reply. Try again.');
      tellCharacter('chat_error');
    }
  }

  async function clearConversation(): Promise<void> {
    ++requestId.current;
    setPending('');
    setDraft('');
    setPhase('connecting');
    followLatest.current = true;
    setScrolledUp(false);
    tellCharacter('chat_interrupted');
    try {
      await window.astra.clearConversation();
      applyStatus(await window.astra.getChatStatus());
    } catch {
      setPhase('error');
      setDetail('Could not clear the current conversation.');
    }
  }

  async function cancelCurrentRequest(): Promise<void> {
    try { await window.astra.cancelCurrentRequest(); }
    catch { setDetail('Could not cancel the current request.'); }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
      return;
    }
    // Starting to type tells Astra someone is talking to her.
    tellCharacter('chat_typing');
  }

  const statusLabel = phase === 'connecting' ? 'Connecting' : phase === 'generating' ? 'Generating' : phase === 'ready' ? 'Ready' : 'Error';
  const connectionLabel = phase === 'error' ? 'LOCAL MODEL NEEDS ATTENTION' : phase === 'connecting' ? 'CONNECTING TO OLLAMA' : 'GEMMA 3 4B · LOCAL OLLAMA';
  const presentationState = presentationForChatPhase(phase);
  const worldActivity = worldActivityFor(codingTask?.phase ?? null, learningRunning);

  // Coding tool activity mirrors the authoritative task state, so it appears in
  // chat and in the Coding workspace from one source.
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let lastApplied = 0;
    let sequence = 0;
    const poll = async () => {
      // Overlapping polls could land out of order and leave the approval control
      // showing a previous task, so only the newest response is ever applied.
      if (inFlight) return;
      inFlight = true;
      const request = ++sequence;
      try {
        const snapshot = await window.astraIntelligence.codingSnapshot();
        if (!active || request !== lastApplied + 1) return;
        lastApplied = request;
        setCodingTask(snapshot);
        const notice = `${snapshot.taskId}:${snapshot.phase}:${snapshot.plan?.correctionAttempt ?? 0}`;
        if (snapshot.taskId && notice !== lastCodingNotice.current && (['completed', 'failed'].includes(snapshot.phase) || (snapshot.phase === 'awaiting_approval' && snapshot.plan?.correctionAttempt))) {
          lastCodingNotice.current = notice;
          void window.astra.getChatStatus().then((status) => { if (active) setMessages(status.messages); }).catch(() => undefined);
        }
        setToolActivity(
          snapshot.events.slice(-12).map((event) => ({
            id: event.id,
            kind: event.kind,
            label: event.label,
            ok: event.ok,
          })),
        );
      } catch {
        // The bridge is unavailable before main finishes starting; retry.
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 900);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <main className="shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <section className="app-frame" aria-labelledby="app-title">
        <header className="app-header">
          <div className="brand"><span className="brand-symbol" aria-hidden="true">✦</span><div><p className="brand-kicker">YOUR LOCAL COMPANION</p><h1 id="app-title">ASTRA</h1></div></div>
          <div className="header-meta"><span className="session-label">SESSION ONLY</span><span className="header-divider" aria-hidden="true" /><span className="header-model">GEMMA 3 4B</span></div>
        </header>

        <div className="workspace-grid">
          <AvatarPanel
            state={presentationState}
            connectionLabel={connectionLabel}
            version={appInfo?.version}
            chatSignal={characterSignal}
            activity={worldActivity}
            idleEnabled={idleEnabled}
            onIdleEnabledChange={setIdleEnabled}
            onWaveRequest={() => tellCharacter('user_wave')}
            onCentreRequest={() => tellCharacter('user_center')}
          />

          <section className="conversation-panel" aria-labelledby="conversation-title">
            <header className="conversation-header">
              <div><p className="panel-index">02 / CONVERSATION</p><h2 id="conversation-title">Talk with Astra</h2></div>
              <div className={`status status-${phase}`} role="status" aria-live="polite"><span className="status-dot" aria-hidden="true" />{statusLabel}</div>
            </header>

            <nav className="workspace-tabs" aria-label="Astra workspaces">
              {WORKSPACES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={activeWorkspace === entry.id ? 'active' : ''}
                  aria-pressed={activeWorkspace === entry.id}
                  onClick={() => setActiveWorkspace(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </nav>

            {activeWorkspace === 'conversation' ? (
              <>
            <div className="conversation-wrap">
              <div className="conversation" ref={conversationRef} onScroll={onConversationScroll} aria-label="Conversation" aria-live="polite">
                {messages.length === 0 && !pending && <div className="welcome"><span className="welcome-symbol" aria-hidden="true">✦</span><h3>Hi, Karl.</h3><p>I'm here and ready to talk. What's on your mind?</p><small>This conversation stays in this session. I don't have personal memory yet.</small></div>}
                {messages.map((message, index) => <article className={`message-row message-${message.role}`} key={index}><span className="message-avatar" aria-hidden="true">{message.role === 'user' ? 'K' : '✦'}</span><div className="message-bubble"><p className="message-label">{message.role === 'user' ? 'You' : 'Astra'}</p><MessageContent content={message.content} /></div></article>)}
                {pending && <article className="message-row message-user"><span className="message-avatar" aria-hidden="true">K</span><div className="message-bubble"><p className="message-label">You</p><MessageContent content={pending} /></div></article>}
                {phase === 'generating' && <div className="typing" aria-label="Astra is thinking"><span className="typing-dot" aria-hidden="true" />Astra is thinking…</div>}
              </div>
              {scrolledUp && <button type="button" className="jump-latest" onClick={jumpToLatest}>Jump to latest ↓</button>}
            </div>

              <div className="conversation-bottom">
              {memorySuggestion ? (
                <div className="memory-suggestion" role="group" aria-label="Suggested personal memory">
                  <strong>Worth remembering?</strong>
                  <p>{memorySuggestion.text}</p>
                  <button type="button" onClick={() => void acceptMemorySuggestion()}>Remember this</button>
                  <button type="button" onClick={() => setMemorySuggestion(null)}>Not now</button>
                </div>
              ) : null}
              {memoryNotice ? <p className="memory-notice" role="status">{memoryNotice}</p> : null}
              {codingTask?.taskId && codingTask.phase === 'awaiting_approval' && !codingTask.requiresConfirmation ? (
                <div className="coding-chat-control" role="group" aria-label="Coding plan decision" data-task-id={codingTask.taskId}>
                  <strong>Plan awaiting approval for {codingTask.repository}</strong>
                  <p>{codingTask.objective}</p>
                  <p>Files: {codingTask.plan?.filesToChange.join(', ') || 'none'} · Commands: {codingTask.plan?.commands.map((c) => `${c.executable} ${c.args.join(' ')}`).join(', ') || 'none'}</p>
                  <button type="button" onClick={() => void window.astraIntelligence.codingDecide({ decision: 'approve' })}>Approve plan</button>
                  <button type="button" onClick={() => void window.astraIntelligence.codingDecide({ decision: 'reject' })}>Reject</button>
                </div>
              ) : null}
              {codingTask?.taskId && ['implementing', 'testing', 'reviewing'].includes(codingTask.phase) ? (
                <div className="coding-chat-control" role="status">Coding task: {codingTask.phase}. <button type="button" onClick={() => void window.astraIntelligence.codingCancel('cancelled in chat')}>Cancel task</button></div>
              ) : null}
              {codingTask?.taskId && ['completed', 'failed', 'cancelled'].includes(codingTask.phase) ? (
                <div className="coding-chat-control" role="status">Coding task {codingTask.phase}. {codingTask.error ?? codingTask.testResults.at(-1)?.summary ?? 'Review the diff and activity in Coding.'}</div>
              ) : null}
              {toolActivity.length > 0 ? (
                <div className="tool-activity" aria-label="Astra's tool activity" aria-live="polite">
                  {toolActivity.slice(-4).map((event) => (
                    <p key={event.id} className={`tool-line${event.ok ? '' : ' tool-line-error'}`}>
                      <span className="tool-kind">{event.kind}</span>
                      <span>{event.label}</span>
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="status-line" data-phase={phase}><p role="status">{detail}</p><div className="actions">{phase === 'error' && <button type="button" className="text-button" onClick={() => void refresh()}>Retry connection</button>}{phase === 'generating' && <button type="button" className="text-button" onClick={() => void cancelCurrentRequest()}>Cancel request</button>}<button type="button" className="text-button" onClick={() => void clearConversation()} disabled={messages.length === 0 && !pending}>Clear conversation</button></div></div>
              <form className="composer" onSubmit={(event) => void send(event)}><label htmlFor="message-input" className="sr-only">Message Astra</label><textarea id="message-input" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder="Message Astra…" rows={2} maxLength={8000} disabled={phase === 'connecting' || phase === 'generating'} /><button type="submit" className="send-button" disabled={!draft.trim() || phase === 'connecting' || phase === 'generating'}>Send <span aria-hidden="true">↗</span></button></form>
              <div className="conversation-footer"><div className="voice-reserved" aria-label="Future voice controls"><button type="button" disabled aria-label="Microphone unavailable">Mic unavailable</button><button type="button" disabled aria-label="Audio unavailable">Audio unavailable</button></div><span>LOCAL CHAT · {memoryCount} PERSONAL MEMORIES ON DISK</span></div>
            </div>
              </>
            ) : null}

            {activeWorkspace === 'learning' ? <LearningWorkspace onLearningActivityChange={setLearningRunning} /> : null}
            {activeWorkspace === 'projects' ? <ProjectsWorkspace /> : null}
            {activeWorkspace === 'coding' ? <CodingWorkspace tellCharacter={tellCharacter} /> : null}
          </section>
        </div>
      </section>
    </main>
  );
}
