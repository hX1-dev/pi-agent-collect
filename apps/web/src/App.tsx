import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode
} from "react";
import type {
  Agent,
  Approval,
  CreateDirectiveInput,
  DashboardSnapshot,
  Task,
  TaskStatus,
  Team
} from "@private-ai-org/core";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Command,
  FileText,
  Gauge,
  GitBranch,
  Inbox,
  LayoutDashboard,
  LoaderCircle,
  MessageSquareText,
  Network,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
  X
} from "lucide-react";
import { api } from "./api";

type View = "board" | "work" | "studios" | "organization" | "approvals" | "activity";

const nav: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "board", label: "Board", icon: LayoutDashboard },
  { id: "work", label: "Work", icon: BriefcaseBusiness },
  { id: "studios", label: "Studios", icon: Building2 },
  { id: "organization", label: "Organization", icon: Network },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "activity", label: "Activity", icon: Activity }
];

const statusLabels: Record<TaskStatus, string> = {
  inbox: "Inbox",
  planned: "Planned",
  queued: "Queued",
  in_progress: "In progress",
  review: "Review",
  awaiting_approval: "Approval",
  done: "Done",
  blocked: "Blocked",
  failed: "Failed",
  cancelled: "Cancelled"
};

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function relativeTime(date: string | null): string {
  if (!date) return "Not active yet";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function AgentAvatar({ agent, size = "medium" }: { agent: Agent; size?: "small" | "medium" | "large" }) {
  return (
    <div
      className={`agent-avatar avatar-${size}`}
      style={{ background: agent.accent }}
      title={`${agent.name}, ${agent.title}`}
    >
      {agent.initials}
      <span className={`presence presence-${agent.status}`} />
    </div>
  );
}

function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function Sidebar({ view, onView, pendingApprovals }: { view: View; onView: (view: View) => void; pendingApprovals: number }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Sparkles size={18} strokeWidth={1.7} /></div>
        <div>
          <strong>Northstar</strong>
          <span>Private organization</span>
        </div>
      </div>
      <div className="nav-label">Company</div>
      <nav>
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              className={classNames("nav-item", view === item.id && "active")}
              onClick={() => onView(item.id)}
              aria-label={item.label}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.id === "approvals" && pendingApprovals > 0 && <b>{pendingApprovals}</b>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-spacer" />
      <div className="system-card">
        <div className="system-card-head">
          <span className="system-pulse" />
          Local organization
        </div>
        <p>Identity stays here. Employee runtimes wake only for assigned work.</p>
      </div>
      <button type="button" className="nav-item muted" disabled title="Settings are coming in the next milestone" aria-label="Settings, coming soon">
        <Settings size={18} strokeWidth={1.8} />
        <span>Settings</span>
      </button>
      <div className="board-identity">
        <div className="board-avatar">B</div>
        <div>
          <strong>Board Director</strong>
          <span>Owner</span>
        </div>
      </div>
    </aside>
  );
}

function DirectiveComposer({ snapshot, onCreated }: { snapshot: DashboardSnapshot; onCreated: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [studioId, setStudioId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const input: CreateDirectiveInput = {
        title,
        brief,
        studioId: studioId || null,
        priority: "normal",
        risk: "green"
      };
      await api.createDirective(input);
      setTitle("");
      setBrief("");
      setStudioId("");
      setExpanded(false);
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <button type="button" className="directive-collapsed" onClick={() => setExpanded(true)}>
        <div className="chief-mini">AV</div>
        <span>Give Avery a new board directive…</span>
        <Command size={17} />
      </button>
    );
  }

  return (
    <form className="directive-form" onSubmit={submit}>
      <div className="directive-form-head">
        <div>
          <span className="eyebrow">Board directive</span>
          <strong>Avery will choose the smallest effective Studio</strong>
        </div>
        <button type="button" className="icon-button" onClick={() => setExpanded(false)} aria-label="Close directive composer"><X size={17} /></button>
      </div>
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="What outcome do you want?"
        aria-label="Directive outcome"
        required
      />
      <textarea
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        placeholder="Add context, boundaries, or what a good result looks like…"
        aria-label="Directive context and boundaries"
        required
      />
      <div className="directive-actions">
        <select value={studioId} onChange={(event) => setStudioId(event.target.value)}>
          <option value="">Let Chief route it</option>
          {snapshot.studios.map(({ studio }) => (
            <option key={studio.id} value={studio.id}>{studio.name}</option>
          ))}
        </select>
        {error && <span className="form-error">{error}</span>}
        <button className="primary-button" disabled={submitting}>
          {submitting ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
          Issue directive
        </button>
      </div>
    </form>
  );
}

function TaskRow({ task, agents, teams, studios, onDispatch, dispatching, onReview, reviewing, onOpen, blockedByChildren }: {
  task: Task;
  agents: Agent[];
  teams: Team[];
  studios: DashboardSnapshot["studios"];
  onDispatch?: (taskId: string) => void;
  dispatching?: boolean;
  onReview?: (taskId: string, decision: "accepted" | "rework") => void;
  reviewing?: boolean;
  onOpen?: (taskId: string) => void;
  blockedByChildren?: boolean;
}) {
  const owner = agents.find((agent) => agent.id === task.ownerAgentId);
  const team = teams.find((item) => item.id === task.teamId);
  const studio = studios.find((item) => item.studio.id === task.studioId)?.studio;
  const dispatchable = !blockedByChildren && ["planned", "queued", "blocked", "failed"].includes(task.status);
  return (
    <div className="task-row">
      <div className={`risk-mark risk-${task.risk}`} title={`${task.risk} risk`} />
      <div className="task-main">
        <div className="task-title-line">
          <strong>{task.title}</strong>
          <span className={`status-pill status-${task.status}`}>{statusLabels[task.status]}</span>
        </div>
        <div className="task-meta">
          {studio
            ? <span><i style={{ background: "#6d7f78" }} />{studio.name}</span>
            : team && <span><i style={{ background: team.color }} />{team.name}</span>}
          {owner && <span>{owner.name}</span>}
          <span>{task.progress}%</span>
        </div>
      </div>
      <div className="progress-track"><span style={{ width: `${task.progress}%` }} /></div>
      {owner && <AgentAvatar agent={owner} size="small" />}
      {onDispatch && dispatchable && (
        <button type="button" className="run-button" onClick={() => onDispatch(task.id)} disabled={dispatching}>
          {dispatching ? <LoaderCircle className="spin" size={15} /> : <Play size={15} fill="currentColor" />}
          Dispatch
        </button>
      )}
      {onReview && task.status === "review" && (
        <div className="review-actions">
          <button type="button" className="mini-button" onClick={() => onReview(task.id, "rework")} disabled={reviewing}>Rework</button>
          <button type="button" className="mini-button accept" onClick={() => onReview(task.id, "accepted")} disabled={reviewing}>Accept</button>
        </div>
      )}
      {onOpen && (
        <button type="button" className="row-open" onClick={() => onOpen(task.id)} aria-label={`Open details for ${task.title}`}>
          <ChevronRight size={17} />
        </button>
      )}
    </div>
  );
}

function DepartmentCard({ team, agents, tasks }: { team: Team; agents: Agent[]; tasks: Task[] }) {
  const members = agents.filter((agent) => agent.teamId === team.id);
  const activeTasks = tasks.filter((task) => task.teamId === team.id && !["done", "cancelled"].includes(task.status));
  const lead = agents.find((agent) => agent.id === team.leadAgentId);
  return (
    <div className="department-card" style={{ "--team-color": team.color } as CSSProperties}>
      <div className="department-accent" />
      <div className="department-head">
        <div>
          <span className="department-kicker">Department · {members.length} people</span>
          <h3>{team.name}</h3>
        </div>
        {lead && <AgentAvatar agent={lead} />}
      </div>
      <p>{team.purpose}</p>
      <div className="member-stack">
        {members.map((agent) => <AgentAvatar key={agent.id} agent={agent} size="small" />)}
        <span>{activeTasks.length} active {activeTasks.length === 1 ? "item" : "items"}</span>
      </div>
    </div>
  );
}

function CompanyPulse({ snapshot, onApprovalView }: { snapshot: DashboardSnapshot; onApprovalView: () => void }) {
  const activeAgents = snapshot.agents.filter((agent) => ["working", "queued", "review", "blocked"].includes(agent.status));
  const pendingApprovals = snapshot.approvals.filter((approval) => approval.status === "pending");
  return (
    <aside className="pulse-rail">
      <div className="pulse-title">
        <div><span className="live-dot" />Company pulse</div>
        <span>5s refresh</span>
      </div>
      <section className="pulse-section">
        <div className="pulse-section-title"><UsersRound size={15} />Active now <b>{activeAgents.length}</b></div>
        <div className="active-agent-list">
          {activeAgents.slice(0, 5).map((agent) => {
            const task = snapshot.tasks.find((item) => item.id === agent.currentTaskId);
            return (
              <div className="active-agent" key={agent.id}>
                <AgentAvatar agent={agent} size="small" />
                <div><strong>{agent.name}</strong><span>{task?.title ?? agent.status}</span></div>
                <span className={`tiny-status tiny-${agent.status}`}>{agent.status}</span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="pulse-section">
        <div className="pulse-section-title"><ShieldCheck size={15} />Decisions <b>{pendingApprovals.length}</b></div>
        {pendingApprovals.length > 0 ? (
          <button type="button" className="approval-callout" onClick={onApprovalView}>
            <span>{pendingApprovals[0]?.title}</span>
            <ArrowRight size={16} />
          </button>
        ) : <p className="empty-note">Nothing needs board attention.</p>}
      </section>
      <section className="pulse-section usage-panel">
        <div className="pulse-section-title"><Gauge size={15} />Execution pool</div>
        <div className="usage-head">
          <strong>{snapshot.usage.activeRuns} / {snapshot.usage.maxConcurrency}</strong>
          <span>active slots</span>
        </div>
        <div className="slot-track">
          {Array.from({ length: snapshot.usage.maxConcurrency }).map((_, index) => (
            <span key={index} className={index < snapshot.usage.activeRuns ? "filled" : ""} />
          ))}
        </div>
        <div className="usage-meta">
          <span>{snapshot.usage.source === "chatgpt" ? "ChatGPT login" : snapshot.usage.source}</span>
          <span>{snapshot.usage.taskTokensToday.toLocaleString()} tracked tokens</span>
        </div>
        <p>Shared capacity, separate employee sessions, controlled by one Run Broker.</p>
      </section>
    </aside>
  );
}

function BoardView({ snapshot, refresh, onView }: { snapshot: DashboardSnapshot; refresh: () => void; onView: (view: View) => void }) {
  const openTasks = snapshot.tasks.filter((task) => !["done", "cancelled"].includes(task.status)).slice(0, 4);
  return (
    <div className="board-layout">
      <main className="board-main">
        <div className="welcome-line">
          <div>
            <span className="eyebrow">Board room · {new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</span>
            <h1>Good morning, Director.</h1>
            <p>Your organization is awake where it needs to be—and quiet everywhere else.</p>
          </div>
          <button type="button" className="icon-button refresh" onClick={refresh} title="Refresh"><RefreshCw size={17} /></button>
        </div>
        <DirectiveComposer snapshot={snapshot} onCreated={refresh} />
        <section className="brief-card">
          <div className="brief-topline">
            <div className="chief-lockup">
              <div className="chief-avatar">AV</div>
              <div><strong>Avery</strong><span>Chief of Staff · Board brief</span></div>
            </div>
            <span>{relativeTime(snapshot.agents.find((agent) => agent.id === "agent-avery")?.lastActiveAt ?? null)}</span>
          </div>
          <div className="brief-copy">
            <h2>{snapshot.brief.headline}</h2>
            <p>{snapshot.brief.summary}</p>
          </div>
          <div className="brief-columns">
            <div>
              <span className="brief-label"><Check size={14} />Progress</span>
              {snapshot.brief.wins.map((win) => <p key={win}>{win}</p>)}
            </div>
            <div>
              <span className="brief-label attention"><Bell size={14} />Needs attention</span>
              {snapshot.brief.attention.map((item) => <p key={item}>{item}</p>)}
            </div>
          </div>
        </section>
        <section className="departments-section">
          <SectionTitle eyebrow="Portfolio" title="Your departments" action={<button type="button" className="text-button" onClick={() => onView("organization")}>View organization <ArrowRight size={15} /></button>} />
          <div className="department-grid">
            {snapshot.teams.map((team) => (
              <DepartmentCard key={team.id} team={team} agents={snapshot.agents} tasks={snapshot.tasks} />
            ))}
          </div>
        </section>
        <section className="work-section">
          <SectionTitle eyebrow="Execution" title="Work moving now" action={<button type="button" className="text-button" onClick={() => onView("work")}>Open work board <ArrowRight size={15} /></button>} />
          <div className="task-list">
            {openTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                agents={snapshot.agents}
                teams={snapshot.teams}
                studios={snapshot.studios}
              />
            ))}
          </div>
        </section>
      </main>
      <CompanyPulse snapshot={snapshot} onApprovalView={() => onView("approvals")} />
    </div>
  );
}

function TaskDrawer({ task, snapshot, onClose }: { task: Task; snapshot: DashboardSnapshot; onClose: () => void }) {
  const owner = snapshot.agents.find((agent) => agent.id === task.ownerAgentId);
  const reviewer = snapshot.agents.find((agent) => agent.id === task.reviewerAgentId);
  const team = snapshot.teams.find((item) => item.id === task.teamId);
  const studio = snapshot.studios.find((item) => item.studio.id === task.studioId)?.studio;
  const runs = snapshot.runs.filter((run) => run.taskId === task.id);
  const orchestration = snapshot.orchestrations.find((item) => item.rootTaskId === task.id);
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="task-drawer" role="dialog" aria-modal="true" aria-label={`Task details: ${task.title}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div><span className="eyebrow">Task record</span><h2>{task.title}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close task details"><X size={18} /></button>
        </div>
        <div className="drawer-status-line">
          <span className={`status-pill status-${task.status}`}>{statusLabels[task.status]}</span>
          <span className={`risk-label risk-text-${task.risk}`}>{task.risk} risk</span>
          <span>{task.progress}% complete</span>
        </div>
        <section className="drawer-section">
          <span className="drawer-label"><FileText size={14} />Board brief</span>
          <p>{task.brief}</p>
        </section>
        <section className="drawer-section drawer-people">
          <div><span>Accountable owner</span>{owner ? <><AgentAvatar agent={owner} size="small" /><strong>{owner.name}</strong><small>{owner.title}</small></> : <em>Unassigned</em>}</div>
          <div><span>Reviewer</span>{reviewer ? <><AgentAvatar agent={reviewer} size="small" /><strong>{reviewer.name}</strong><small>{reviewer.title}</small></> : <em>Policy only</em>}</div>
        </section>
        <section className="drawer-section">
          <span className="drawer-label"><GitBranch size={14} />Execution context</span>
          <dl className="context-grid">
            <div>
              <dt>Studio</dt>
              <dd>{studio?.name ?? team?.name ?? "Executive office"}</dd>
            </div>
            <div><dt>Task ID</dt><dd>{task.id}</dd></div>
          </dl>
        </section>
        {orchestration && (
          <section className="drawer-section">
            <span className="drawer-label"><Network size={14} />Company plan</span>
            <p>{orchestration.summary ?? "Avery and the department managers are preparing the work plan."}</p>
            {orchestration.plan && (
              <dl className="context-grid">
                {orchestration.plan.planningModel === "studio-v1" ? (
                  <>
                    <div><dt>Studios</dt><dd>{orchestration.plan.studios.length}</dd></div>
                    <div>
                      <dt>Temporary workers</dt>
                      <dd>{orchestration.plan.studios.reduce(
                        (count, item) => count + item.temporaryWorkers.length,
                        0
                      )}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div><dt>Legacy departments</dt><dd>{orchestration.plan.departments.length}</dd></div>
                    <div>
                      <dt>Legacy specialists</dt>
                      <dd>{orchestration.plan.departments.reduce(
                        (count, department) => count + department.workerAssignments.length,
                        0
                      )}</dd>
                    </div>
                  </>
                )}
              </dl>
            )}
          </section>
        )}
        <section className="drawer-section">
          <span className="drawer-label"><Clock3 size={14} />Agent run history</span>
          {runs.length === 0 ? <p className="empty-note">No execution session has been recorded yet.</p> : (
            <div className="run-history">
              {runs.map((run) => (
                <article key={run.id}>
                  <div><strong>{run.provider === "mock" ? "Mock rehearsal" : run.provider === "hermes" ? "Hermes session" : "Codex session"}</strong><span className={`status-pill status-${run.status}`}>{run.status}</span></div>
                  <p>{run.summary ?? "Execution is still in progress."}</p>
                  <small>{run.providerThreadId ? `Session ${run.providerThreadId}` : "Session ID pending"} · {(run.inputTokens + run.outputTokens).toLocaleString()} tracked tokens</small>
                </article>
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function WorkView({ snapshot, refresh }: { snapshot: DashboardSnapshot; refresh: () => void }) {
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const groups: Array<{ title: string; statuses: TaskStatus[] }> = [
    { title: "Needs routing", statuses: ["inbox", "planned", "blocked", "failed"] },
    { title: "In motion", statuses: ["queued", "in_progress"] },
    { title: "Review & decisions", statuses: ["review", "awaiting_approval"] },
    { title: "Completed", statuses: ["done"] }
  ];

  async function dispatch(taskId: string) {
    setDispatching(taskId);
    setActionError(null);
    try {
      await api.dispatchTask(taskId);
      refresh();
      window.setTimeout(refresh, 700);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDispatching(null);
    }
  }

  async function review(taskId: string, decision: "accepted" | "rework") {
    setReviewing(taskId);
    setActionError(null);
    try {
      await api.reviewTask(taskId, decision);
      refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setReviewing(null);
    }
  }

  const selectedTask = snapshot.tasks.find((task) => task.id === selectedTaskId) ?? null;

  return (
    <PageShell eyebrow="Company work" title="Every item has one accountable owner." description="The organization can look hierarchical without forcing every task through every layer.">
      {actionError && <div className="action-error" role="alert">{actionError}</div>}
      <div className="work-groups">
        {groups.map((group) => {
          const tasks = snapshot.tasks.filter((task) => group.statuses.includes(task.status));
          return (
            <section className="work-group" key={group.title}>
              <div className="work-group-title"><h3>{group.title}</h3><span>{tasks.length}</span></div>
              <div className="task-list">
                {tasks.length > 0
                  ? tasks.map((task) => <TaskRow
                    key={task.id}
                    task={task}
                    agents={snapshot.agents}
                    teams={snapshot.teams}
                    studios={snapshot.studios}
                    onDispatch={dispatch}
                    dispatching={dispatching === task.id}
                    onReview={review}
                    reviewing={reviewing === task.id}
                    onOpen={setSelectedTaskId}
                    blockedByChildren={snapshot.tasks.some((child) => (
                      child.parentTaskId === task.id && !["done", "cancelled"].includes(child.status)
                    ))}
                  />)
                  : <p className="empty-note padded">No items here.</p>}
              </div>
            </section>
          );
        })}
      </div>
      {selectedTask && <TaskDrawer task={selectedTask} snapshot={snapshot} onClose={() => setSelectedTaskId(null)} />}
    </PageShell>
  );
}

function OrganizationView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const chief = snapshot.agents.find((agent) => agent.managerAgentId === null && agent.title === "Chief of Staff");
  return (
    <PageShell eyebrow="Organization directory" title="A hierarchy for responsibility, not bureaucracy." description="Managers own routing and reporting. Employees wake only when their work requires it.">
      {chief && (
        <div className="org-root">
          <div className="org-chief-card">
            <AgentAvatar agent={chief} size="large" />
            <div><span className="eyebrow">Executive office</span><h2>{chief.name}</h2><p>{chief.title}</p></div>
            <span className={`agent-state state-${chief.status}`}>{chief.status}</span>
          </div>
          <div className="org-trunk" />
          <div className="org-team-grid">
            {snapshot.teams.map((team) => {
              const members = snapshot.agents.filter((agent) => agent.teamId === team.id);
              const lead = members.find((agent) => agent.id === team.leadAgentId);
              const reports = members.filter((agent) => agent.id !== team.leadAgentId);
              return (
                <section className="org-team" key={team.id} style={{ "--team-color": team.color } as CSSProperties}>
                  <div className="org-team-header"><span className="team-dot" /><div><h3>{team.name}</h3><p>{team.purpose}</p></div></div>
                  {lead && (
                    <div className="person-card lead-card">
                      <AgentAvatar agent={lead} />
                      <div><strong>{lead.name}</strong><span>{lead.title}</span></div>
                      <span className={`agent-state state-${lead.status}`}>{lead.status}</span>
                    </div>
                  )}
                  <div className="report-line" />
                  <div className="report-list">
                    {reports.map((agent) => (
                      <div className="person-card" key={agent.id}>
                        <AgentAvatar agent={agent} size="small" />
                        <div><strong>{agent.name}</strong><span>{agent.title}</span></div>
                        <span className={`agent-state state-${agent.status}`}>{agent.status}</span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </PageShell>
  );
}

function StudiosView({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <PageShell
      eyebrow="Runtime boundaries"
      title="Durable Studios, replaceable machines."
      description="A Studio is the organizational identity. VM instances and heartbeats are operational evidence, never the identity itself."
    >
      {snapshot.studios.length === 0 ? (
        <div className="studio-empty">
          <Building2 size={23} />
          <div>
            <strong>No Studio contract has been configured yet.</strong>
            <p>Create the first Studio through the local Controller API before connecting a VM.</p>
          </div>
        </div>
      ) : (
        <div className="studio-grid">
          {snapshot.studios.map(({ studio, instances, health }) => {
            const currentInstance = instances.find((instance) => instance.status !== "revoked");
            const components = [
              ["VM", health.components.vm],
              ["northstar-host", health.components.northstarHost],
              ["Hermes", health.components.hermes],
              ["Sandbox", health.components.sandbox]
            ] as const;
            return (
              <article className="studio-card" key={studio.id}>
                <header>
                  <div className="studio-card-icon"><Building2 size={18} /></div>
                  <div>
                    <span className="eyebrow">{studio.key}</span>
                    <h2>{studio.name}</h2>
                  </div>
                  <span className={`health-badge health-${health.overall}`}>{health.overall}</span>
                </header>
                <p>{studio.purpose}</p>
                <dl className="studio-facts">
                  <div><dt>Studio state</dt><dd>{studio.status}</dd></div>
                  <div><dt>Current instance</dt><dd>{currentInstance ? `Generation ${currentInstance.generation}` : "Not created"}</dd></div>
                  <div><dt>Instance state</dt><dd>{currentInstance?.status ?? "Unavailable"}</dd></div>
                  <div><dt>VM lifecycle</dt><dd>{health.vmLifecycle}</dd></div>
                  <div><dt>Last heartbeat</dt><dd>{relativeTime(health.lastHeartbeatAt)}</dd></div>
                  <div><dt>Host version</dt><dd>{health.hostVersion ?? "Unknown"}</dd></div>
                </dl>
                <div className="studio-components">
                  {components.map(([label, status]) => (
                    <div key={label}>
                      <span className={`component-dot health-${status}`} />
                      <strong>{label}</strong>
                      <small>{status}</small>
                    </div>
                  ))}
                </div>
                <footer>
                  <span>{health.queue.activeJobs} active · {health.queue.waitingJobs} waiting</span>
                  <span>{instances.length} instance record{instances.length === 1 ? "" : "s"}</span>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

function ApprovalCard({ approval, snapshot, onDecision, pending }: {
  approval: Approval;
  snapshot: DashboardSnapshot;
  onDecision: (id: string, decision: "approved" | "rejected") => void;
  pending: boolean;
}) {
  const agent = snapshot.agents.find((item) => item.id === approval.requestedByAgentId);
  const task = snapshot.tasks.find((item) => item.id === approval.taskId);
  return (
    <article className="approval-card">
      <div className="approval-icon"><ShieldCheck size={20} /></div>
      <div className="approval-content">
        <div className="approval-topline">
          <span className="approval-kind">{approval.type.replaceAll("_", " ")}</span>
          <span>{relativeTime(approval.createdAt)}</span>
        </div>
        <h3>{approval.title}</h3>
        <p>{approval.rationale}</p>
        <div className="impact-box"><strong>Proposed impact</strong><span>{approval.impact}</span></div>
        <div className="approval-footer">
          <div className="requested-by">
            {agent && <AgentAvatar agent={agent} size="small" />}
            <span>Requested by <strong>{agent?.name ?? "Agent"}</strong> · {task?.title}</span>
          </div>
          {approval.status === "pending" ? (
            <div className="decision-buttons">
              <button type="button" className="secondary-button danger" onClick={() => onDecision(approval.id, "rejected")} disabled={pending}><X size={15} />Reject</button>
              <button type="button" className="primary-button" onClick={() => onDecision(approval.id, "approved")} disabled={pending}><Check size={15} />Record approval</button>
            </div>
          ) : <span className={`status-pill status-${approval.status}`}>{approval.status}</span>}
        </div>
      </div>
    </article>
  );
}

function ApprovalsView({ snapshot, refresh }: { snapshot: DashboardSnapshot; refresh: () => void }) {
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  async function decide(id: string, decision: "approved" | "rejected") {
    setPending(true);
    setActionError(null);
    try {
      await api.decideApproval(id, decision);
      refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }
  const ordered = [...snapshot.approvals].sort((a, b) => Number(a.status !== "pending") - Number(b.status !== "pending"));
  return (
    <PageShell eyebrow="Board authority" title="Irreversible actions stop here." description="This MVP records the board's decision but does not execute an external action. Connectors will sit behind this gate in a later milestone.">
      {actionError && <div className="action-error" role="alert">{actionError}</div>}
      <div className="approval-list">
        {ordered.map((approval) => <ApprovalCard key={approval.id} approval={approval} snapshot={snapshot} onDecision={decide} pending={pending} />)}
      </div>
    </PageShell>
  );
}

function ActivityView({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <PageShell eyebrow="Company record" title="A readable trail of what actually happened." description="Runtime events are evidence under a task—not separate personalities or extra chat rooms.">
      <div className="activity-ledger">
        {snapshot.activity.map((event, index) => {
          const agent = snapshot.agents.find((item) => item.id === event.agentId);
          const task = snapshot.tasks.find((item) => item.id === event.taskId);
          return (
            <div className="activity-entry" key={event.id}>
              <div className="activity-time">{relativeTime(event.createdAt)}</div>
              <div className="activity-spine"><span />{index < snapshot.activity.length - 1 && <i />}</div>
              <div className="activity-body">
                <div className="activity-entry-head">
                  {agent ? <AgentAvatar agent={agent} size="small" /> : <div className="event-icon"><Building2 size={15} /></div>}
                  <div><strong>{event.summary}</strong><span>{event.type} {task ? `· ${task.title}` : ""}</span></div>
                </div>
                {event.detail && <p>{event.detail}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}

function PageShell({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return (
    <main className="page-shell">
      <header className="page-header"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></header>
      {children}
    </main>
  );
}

function LoadingScreen() {
  return <div className="loading-screen"><div className="brand-mark"><Sparkles size={20} /></div><LoaderCircle className="spin" size={22} /><span>Opening the board room…</span></div>;
}

export default function App() {
  const [view, setView] = useState<View>("board");
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void api.dashboard().then((data) => {
      setSnapshot(data);
      setError(null);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const pendingApprovals = useMemo(
    () => snapshot?.approvals.filter((approval) => approval.status === "pending").length ?? 0,
    [snapshot]
  );

  if (!snapshot && !error) return <LoadingScreen />;
  if (!snapshot) {
    return <div className="error-screen"><Bot size={28} /><h1>The organization API is unavailable.</h1><p>{error}</p><button className="primary-button" onClick={refresh}>Try again</button></div>;
  }

  return (
    <div className="app-shell">
      <Sidebar view={view} onView={setView} pendingApprovals={pendingApprovals} />
      <div className="content-shell">
        {error && <div className="error-banner">Last refresh failed: {error}</div>}
        {view === "board" && <BoardView snapshot={snapshot} refresh={refresh} onView={setView} />}
        {view === "work" && <WorkView snapshot={snapshot} refresh={refresh} />}
        {view === "studios" && <StudiosView snapshot={snapshot} />}
        {view === "organization" && <OrganizationView snapshot={snapshot} />}
        {view === "approvals" && <ApprovalsView snapshot={snapshot} refresh={refresh} />}
        {view === "activity" && <ActivityView snapshot={snapshot} />}
      </div>
    </div>
  );
}
