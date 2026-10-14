import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './index.css';
import { api, setCsrf, streamChat, type ChatUsage, type Me } from './lib/api';
import { Dropdown, type DropdownOption } from './components/Dropdown';

type UserRow = {
  id: string;
  username: string;
  status: string;
  expiresAt: string;
  promptLimit: number;
  promptCount: number;
  tokenBudget: number;
  tokenUsed: number;
};

type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
};

type ChatMessage = {
  id?: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  error?: boolean;
};

type TextAttachment = {
  name: string;
  content: string;
};

type PromptTemplate = {
  id: string;
  name: string;
  content: string;
};

type RetryRequest = {
  text: string;
  attachment: TextAttachment | null;
};

type ModelItem = {
  id: string;
  label: string;
};

const formatTime = (expiresAt: string) => {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const readableMath = (expression: string) => expression
  .replace(/\\mathcal\{([^}]+)\}/g, '$1')
  .replace(/\\(?:mathrm|text)\{([^}]+)\}/g, '$1')
  .replace(/\\(leq|le)/g, '≤')
  .replace(/\\(geq|ge)/g, '≥')
  .replace(/\\neq/g, '≠')
  .replace(/\\times/g, '×')
  .replace(/\\cdot/g, '·')
  .replace(/\\(?:min|max|log|sin|cos)/g, (command) => command.slice(1))
  .replace(/\\(?:left|right)/g, '')
  .replace(/\\,/g, ' ')
  .replace(/[{}]/g, '');

const formatInlineMath = (content: string) =>
  content.replace(/\$([^$\n]+)\$/g, (_match, expression: string) => `\`${readableMath(expression).trim()}\``);

const friendlyProviderError = (message: string) => {
  const normalized = message.toLowerCase();
  if (normalized.includes('503') || normalized.includes('high demand') || normalized.includes('unavailable')) {
    return 'This model is busy right now. Please retry in a moment or choose another model.';
  }
  return 'The selected model could not respond. Please retry or choose another model.';
};

// Helper SVG Icons
function SparklesIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  );
}

function CopyIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function CheckIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function TrashIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function PlusIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function MenuIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function StopIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function SendIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function AttachmentIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21.4 11.6-8.6 8.6a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3" />
    </svg>
  );
}

function DownloadIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4m-5 8h18" />
    </svg>
  );
}

// Quick Copy Button with immediate feedback
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`btn-secondary !py-1 !px-2.5 !text-xs transition-all duration-200 ${
        copied ? '!border-emerald-500/40 !bg-emerald-500/20 !text-emerald-300' : 'opacity-80 hover:opacity-100'
      }`}
      title="Copy to clipboard"
    >
      {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-400" /> : <CopyIcon className="w-3.5 h-3.5" />}
      <span>{copied ? 'Copied!' : label}</span>
    </button>
  );
}

// ----------------- LOGIN COMPONENT -----------------
function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api<Me>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setCsrf(result.csrfToken);
      onLogin(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-4 sm:p-6">
      <form onSubmit={submit} className="login-card panel w-full max-w-md p-6 sm:p-10 border-white/10 shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-2 w-2 rounded-full bg-violet-400 animate-ping" />
          <p className="text-xs font-bold tracking-widest text-violet-400 uppercase">TEMPORARY AI PLATFORM</p>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-950">
          Sign in
        </h1>
        <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
          Access managed AI models using temporary access credentials.
        </p>

        <div className="mt-8 space-y-4">
          <div>
            <label className="label login-label">Username / Email</label>
            <input
              className="field login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="learner-xxx@temporary.local or admin"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="label login-label">Password</label>
            <input
              className="field login-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••••••"
              autoComplete="current-password"
              required
            />
          </div>
        </div>

        {error && (
          <div className="mt-5 text-sm text-red-300 bg-red-500/10 border border-red-500/20 p-3.5 rounded-xl flex items-center gap-2 animate-in fade-in duration-200">
            <svg className="h-4 w-4 shrink-0 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <button className="btn-primary mt-8 w-full py-3.5 text-base shadow-xl" disabled={loading}>
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Signing in…
            </span>
          ) : (
            'Sign in to Workspace'
          )}
        </button>
      </form>
    </main>
  );
}

// ----------------- ADMIN COMPONENT -----------------
function Admin({ onLogout }: { onLogout: () => void }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [duration, setDuration] = useState('60');
  const [customDuration, setCustomDuration] = useState(360);
  const [promptLimit, setPromptLimit] = useState(50);
  const [tokenBudget, setTokenBudget] = useState(100000);
  const [created, setCreated] = useState<{ username: string; password: string; expiresAt: string } | null>(null);
  const [stats, setStats] = useState<{ requests: number; inputTokens: number; outputTokens: number; activeUsers: number } | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const durationOptions: DropdownOption[] = [
    { value: '30', label: '30 minutes', description: 'Quick evaluation' },
    { value: '60', label: '1 hour', description: 'Standard workshop session' },
    { value: '120', label: '2 hours', description: 'Extended lab' },
    { value: '240', label: '4 hours', description: 'Half-day training' },
    { value: 'custom', label: 'Custom duration…', description: 'Specify exact duration in minutes' },
  ];

  const load = async () => {
    try {
      const [u, s] = await Promise.all([
        api<UserRow[]>('/api/admin/users'),
        api<{ requests: number; inputTokens: number; outputTokens: number; activeUsers: number }>('/api/admin/usage'),
      ]);
      setUsers(u);
      setStats(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load dashboard');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const item = await api<{ username: string; password: string; expiresAt: string }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          durationMinutes: Number(duration === 'custom' ? customDuration : duration),
          promptLimit,
          tokenBudget,
        }),
      });
      setCreated(item);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create user');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/api/admin/users/${id}/revoke`, { method: 'POST' });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke user');
    }
  }

  async function deleteUser(id: string) {
    if (confirm('Delete this user account permanently?')) {
      try {
        await api(`/api/admin/users/${id}`, { method: 'DELETE' });
        void load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not delete user');
      }
    }
  }

  const handleCopyAll = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(`Username: ${created.username}\nPassword: ${created.password}`);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {}
  };

  return (
    <main className="admin-dashboard mx-auto max-w-7xl p-4 sm:p-6 md:p-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-violet-400" />
            <p className="text-xs font-bold tracking-widest text-violet-400 uppercase">ADMINISTRATOR CONTROL</p>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-950">
            Temporary AI Access
          </h1>
        </div>
        <button className="btn-secondary" onClick={onLogout}>
          Sign out
        </button>
      </header>

      <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
        {/* Issue Credentials Column */}
        <section className="panel p-6 sm:p-8 h-fit">
          <div className="flex items-center gap-2 mb-1">
            <SparklesIcon className="w-5 h-5 text-violet-400" />
            <h2 className="text-xl font-bold">Issue Credentials</h2>
          </div>
          <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
            Generate temporary credentials with enforce limits. Passwords are hash-protected.
          </p>

          <form onSubmit={create} className="mt-6 space-y-5">
            <div>
              <label className="label">Access Duration</label>
              <Dropdown
                options={durationOptions}
                value={duration}
                onChange={setDuration}
                className="w-full"
                buttonClassName="!py-2.5"
              />
            </div>

            {duration === 'custom' && (
              <div className="animate-in fade-in duration-200">
                <label className="label">Custom Duration (Minutes)</label>
                <div className="relative">
                  <input
                    className="field pr-16"
                    type="number"
                    min="5"
                    max="10080"
                    value={customDuration}
                    onChange={(e) => setCustomDuration(Number(e.target.value))}
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs text-zinc-400 font-medium">mins</span>
                </div>
                <div className="mt-2 flex gap-1.5 flex-wrap">
                  {[60, 180, 720, 1440].map((mins) => (
                    <button
                      type="button"
                      key={mins}
                      onClick={() => setCustomDuration(mins)}
                      className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="label">Prompt Limit</label>
              <div className="relative">
                <input
                  className="field"
                  type="number"
                  min="1"
                  max="10000"
                  value={promptLimit}
                  onChange={(e) => setPromptLimit(Number(e.target.value))}
                />
              </div>
              <div className="mt-2 flex gap-1.5">
                {[25, 50, 100, 200].map((val) => (
                  <button
                    type="button"
                    key={val}
                    onClick={() => setPromptLimit(val)}
                    className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Token Budget</label>
              <div className="relative">
                <input
                  className="field"
                  type="number"
                  value={tokenBudget}
                  onChange={(e) => setTokenBudget(Number(e.target.value))}
                />
              </div>
              <div className="mt-2 flex gap-1.5">
                {[50000, 100000, 250000, 500000].map((val) => (
                  <button
                    type="button"
                    key={val}
                    onClick={() => setTokenBudget(val)}
                    className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    {val >= 1000 ? `${val / 1000}k` : val}
                  </button>
                ))}
              </div>
            </div>

            <button className="btn-primary mt-6 w-full py-3" disabled={isSubmitting}>
              {isSubmitting ? 'Generating…' : 'Generate credentials'}
            </button>
          </form>

          {created && (
            <div className="mt-6 rounded-xl border border-violet-300 bg-violet-50 p-4 text-sm shadow-sm animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-3 border-b border-violet-200">
                <span className="text-xs font-bold text-violet-900 uppercase tracking-wider">Generated Access</span>
                <span className="text-[11px] font-semibold text-violet-700">Expires {new Date(created.expiresAt).toLocaleTimeString()}</span>
              </div>

              <div className="mt-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600 shrink-0">Username</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="text-xs text-slate-900 font-mono truncate">{created.username}</code>
                    <CopyButton text={created.username} label="" />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600 shrink-0">Password</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="text-xs text-violet-950 font-mono font-semibold truncate">{created.password}</code>
                    <CopyButton text={created.password} label="" />
                  </div>
                </div>
              </div>

              <button
                type="button"
                className={`btn-secondary mt-4 w-full justify-center transition-all ${
                  copiedAll ? '!bg-emerald-500/20 !border-emerald-500/40 !text-emerald-300' : ''
                }`}
                onClick={handleCopyAll}
              >
                {copiedAll ? <CheckIcon className="w-4 h-4 text-emerald-400" /> : <CopyIcon className="w-4 h-4" />}
                <span>{copiedAll ? 'Credentials copied!' : 'Copy full credentials'}</span>
              </button>
            </div>
          )}
        </section>

        {/* Dashboard Stats & Table Column */}
        <section className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {[
              ['Active Users', stats?.activeUsers, 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'],
              ['Requests', stats?.requests, 'bg-violet-500/10 text-violet-400 border-violet-500/30'],
              ['Input Tokens', stats?.inputTokens?.toLocaleString(), 'bg-blue-500/10 text-blue-400 border-blue-500/30'],
              ['Output Tokens', stats?.outputTokens?.toLocaleString(), 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/30'],
            ].map(([label, value, tagStyle]) => (
              <div className="panel p-4 sm:p-5 hover:border-white/20 transition-all" key={String(label)}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
                  <span className={`h-1.5 w-1.5 rounded-full ${tagStyle}`} />
                </div>
                <p className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">{value ?? '—'}</p>
              </div>
            ))}
          </div>

          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 p-4 sm:px-6">
              <h2 className="text-base sm:text-lg font-bold">Issued Accounts</h2>
              <span className="text-xs text-zinc-400 font-medium">{users.length} total</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[620px]">
                <thead className="text-zinc-400 bg-black/30 border-b border-white/5">
                  <tr>
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider">User</th>
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider">Status</th>
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider">Time Left</th>
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider">Prompts</th>
                    <th className="p-4 font-semibold text-xs uppercase tracking-wider">Tokens</th>
                    <th className="p-4 text-right font-semibold text-xs uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-zinc-500">
                        No accounts created yet.
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr className="hover:bg-white/[0.02] transition-colors" key={user.id}>
                        <td className="p-4 font-mono text-xs text-zinc-300">{user.username}</td>
                        <td className="p-4">
                          {user.status === 'ACTIVE' ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-400/20">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-zinc-400/10 px-2.5 py-0.5 text-xs font-medium text-zinc-400 ring-1 ring-inset ring-zinc-400/20">
                              {user.status}
                            </span>
                          )}
                        </td>
                        <td className="p-4 font-mono text-xs text-zinc-300">
                          {user.status === 'ACTIVE' ? formatTime(user.expiresAt) : '—'}
                        </td>
                        <td className="p-4 text-xs text-zinc-300">
                          <span className="font-semibold text-slate-950">{user.promptCount}</span> / {user.promptLimit}
                        </td>
                        <td className="p-4 text-xs text-zinc-300">
                          <span className="font-semibold text-slate-950">{user.tokenUsed.toLocaleString()}</span> / {user.tokenBudget.toLocaleString()}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {user.status === 'ACTIVE' && (
                              <button
                                className="btn-secondary !py-1 !px-2.5 !text-xs"
                                onClick={() => void revoke(user.id)}
                              >
                                Revoke
                              </button>
                            )}
                            <button
                              className="btn-danger !py-1 !px-2.5 !text-xs"
                              onClick={() => void deleteUser(user.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>

      {error && (
        <p className="mt-6 text-sm text-red-400 bg-red-400/10 border border-red-400/20 p-3.5 rounded-xl text-center">
          {error}
        </p>
      )}
    </main>
  );
}

// ----------------- CHAT COMPONENT (WITH STREAMING & MOBILE RESPONSIVENESS) -----------------
function Chat({ me, onLogout }: { me: Extract<Me, { role: 'TEMPORARY_USER' }>; onLogout: () => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState('');
  const [enabledModels, setEnabledModels] = useState<ModelItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(formatTime(me.expiresAt));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [conversationSearch, setConversationSearch] = useState('');
  const [attachment, setAttachment] = useState<TextAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [failedRequest, setFailedRequest] = useState<RetryRequest | null>(null);
  const [quota, setQuota] = useState({ promptCount: me.promptCount, tokenUsed: me.tokenUsed });

  const promptLimit = Number.isFinite(me.promptLimit) ? me.promptLimit : 0;
  const promptCount = Number.isFinite(quota.promptCount) ? quota.promptCount : 0;
  const promptsLeft = Math.max(0, promptLimit - promptCount);
  const tokenBudget = Number.isFinite(me.tokenBudget) ? me.tokenBudget : 0;
  const tokensUsed = Number.isFinite(quota.tokenUsed) ? quota.tokenUsed : 0;
  const tokensLeft = Math.max(0, tokenBudget - tokensUsed);
  const tokenProgress = tokenBudget ? Math.min(100, (tokensUsed / tokenBudget) * 100) : 0;
  const visibleConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(conversationSearch.trim().toLowerCase())
  );

  useEffect(() => {
    setQuota({ promptCount: me.promptCount, tokenUsed: me.tokenUsed });
  }, [me.promptCount, me.tokenUsed]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('temporary-ai-prompt-templates');
      if (saved) setTemplates(JSON.parse(saved));
    } catch {}
  }, []);

  const applyUsage = (usage?: ChatUsage) => {
    if (!usage) return;
    setQuota((current) => ({
      promptCount: Math.min(promptLimit, current.promptCount + 1),
      tokenUsed: Math.min(tokenBudget, current.tokenUsed + usage.inputTokens + usage.outputTokens),
    }));
  };

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadConversations = async () => {
    try {
      const list = await api<Conversation[]>('/api/conversations');
      setConversations(list);
    } catch {}
  };

  useEffect(() => {
    void loadConversations();
    api<ModelItem[]>('/api/models')
      .then((result) => {
        setEnabledModels(result);
        if (result.length > 0) {
          setModel(result[0].id);
        }
      })
      .catch(() => undefined);

    const timer = setInterval(() => setRemaining(formatTime(me.expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [me.expiresAt]);

  // Model options mapping for custom Dropdown
  const modelOptions = useMemo<DropdownOption[]>(() => {
    return enabledModels.map((m) => {
      let badge: string = 'AI';
      let badgeColor: DropdownOption['badgeColor'] = 'violet';
      if (m.id.startsWith('openai:')) {
        badge = 'OpenAI';
        badgeColor = 'emerald';
      } else if (m.id.startsWith('gemini:')) {
        badge = 'Gemini';
        badgeColor = 'blue';
      } else if (m.id.startsWith('anthropic:')) {
        badge = 'Claude';
        badgeColor = 'amber';
      }
      return {
        value: m.id,
        label: m.label.split('·')[1]?.trim() || m.label,
        badge,
        badgeColor,
        description: m.id,
      };
    });
  }, [enabledModels]);

  // Scroll to bottom when new messages arrive if autoScroll is enabled
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  // Detect user scroll up to stop forcing auto-scroll
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 80;
    setAutoScroll(isAtBottom);
  };

  async function openConversation(id: string) {
    if (busy) return;
    try {
      const conversation = await api<{ messages: ChatMessage[] }>('/api/conversations/' + id);
      setConversationId(id);
      setMessages(conversation.messages);
      setSidebarOpen(false);
      setAutoScroll(true);
    } catch {}
  }

  async function deleteConversation(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    try {
      await api('/api/conversations/' + id, { method: 'DELETE' });
      if (conversationId === id) {
        setConversationId(undefined);
        setMessages([]);
      }
      void loadConversations();
    } catch {}
  }

  function handleStop() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setBusy(false);
  }

  function saveTemplates(next: PromptTemplate[]) {
    setTemplates(next);
    localStorage.setItem('temporary-ai-prompt-templates', JSON.stringify(next));
  }

  function saveCurrentAsTemplate() {
    const content = draft.trim();
    if (!content) return;
    const name = window.prompt('Template name');
    if (!name?.trim()) return;
    saveTemplates([...templates, { id: crypto.randomUUID(), name: name.trim(), content }]);
  }

  async function selectAttachment(file?: File) {
    setAttachmentError('');
    if (!file) return;
    const supported = /\.(txt|md|csv|json)$/i.test(file.name);
    if (!supported) {
      setAttachmentError('Use a TXT, MD, CSV, or JSON file.');
      return;
    }
    if (file.size > 48_000) {
      setAttachmentError('Choose a text file smaller than 48 KB.');
      return;
    }
    try {
      const content = (await file.text()).trim();
      if (!content) {
        setAttachmentError('That file is empty.');
        return;
      }
      setAttachment({ name: file.name, content: content.slice(0, 15_000) });
    } catch {
      setAttachmentError('The file could not be read.');
    }
  }

  function exportConversation() {
    if (!messages.length) return;
    const content = ['# AI Workspace conversation', '', ...messages.flatMap((message) => [
      `## ${message.role === 'USER' ? 'You' : 'Assistant'}`,
      message.content,
      '',
    ])].join('\n');
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ai-workspace-conversation.md';
    link.click();
    URL.revokeObjectURL(url);
  }

  function retryLastRequest() {
    if (!failedRequest || busy) return;
    void send(undefined, failedRequest);
  }

  async function send(event?: React.FormEvent, retry?: RetryRequest) {
    event?.preventDefault();
    const textToSend = retry ? retry.text : draft.trim();
    const selectedAttachment = retry ? retry.attachment : attachment;
    if ((!textToSend && !selectedAttachment) || busy || !model) return;

    const visiblePrompt = selectedAttachment
      ? `${textToSend || 'Please review this file.'}\n\nAttached file: ${selectedAttachment.name}`
      : textToSend;
    const userMessage: ChatMessage = { role: 'USER', content: visiblePrompt };
    const initialAssistantMessage: ChatMessage = { role: 'ASSISTANT', content: '' };

    const nextMessages = [...messages.filter((message) => !message.error), userMessage];
    setMessages([...nextMessages, initialAssistantMessage]);
    setDraft('');
    setFailedRequest(null);
    setBusy(true);
    setAutoScroll(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await streamChat(
        {
          conversationId,
          model,
          messages: nextMessages.map((m) => ({ role: m.role.toLowerCase(), content: m.content })),
          attachment: selectedAttachment,
          signal: abortController.signal,
        },
        {
          onStart: (data) => {
            if (data.conversationId && !conversationId) {
              setConversationId(data.conversationId);
            }
          },
          onChunk: (chunk) => {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'ASSISTANT') {
                updated[updated.length - 1] = {
                  ...last,
                  content: last.content + chunk,
                };
              }
              return updated;
            });
          },
          onDone: (data) => {
            if (data.conversationId) {
              setConversationId(data.conversationId);
            }
            applyUsage(data.usage);
            setFailedRequest(null);
            void loadConversations();
          },
          onError: (err) => {
            const friendlyMessage = friendlyProviderError(err.message);
            setFailedRequest({ text: textToSend, attachment: selectedAttachment });
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'ASSISTANT') {
                updated[updated.length - 1] = {
                  ...last,
                  content: last.content ? `${last.content}\n\n${friendlyMessage}` : friendlyMessage,
                  error: true,
                };
              }
              return updated;
            });
          },
        }
      );
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        const friendlyMessage = friendlyProviderError(e instanceof Error ? e.message : '');
        setFailedRequest({ text: textToSend, attachment: selectedAttachment });
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'ASSISTANT') {
            updated[updated.length - 1] = {
              ...last,
              content: last.content || friendlyMessage,
              error: true,
            };
          }
          return updated;
        });
      }
    } finally {
      abortControllerRef.current = null;
      setBusy(false);
      setAttachment(null);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }

  const promptSuggestions = [
    { title: 'Explain architecture', text: 'Explain the core principles of event-driven architectures with practical examples.' },
    { title: 'Debug TypeScript code', text: 'Help me debug a type mismatch issue in TypeScript generic functions.' },
    { title: 'SQL Optimization', text: 'Provide strategies to optimize slow PostgreSQL queries with high read volume.' },
    { title: 'API Security audit', text: 'What are the essential API security checklist items for session cookies and CSRF?' },
  ];

  return (
    <main className="flex h-screen bg-transparent overflow-hidden">
      {/* Mobile Drawer Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden animate-in fade-in duration-200"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar: persistent on desktop, slide-out drawer on mobile */}
      <aside
        className={`workspace-sidebar fixed inset-y-0 left-0 z-50 w-72 transform border-r border-white/10 bg-zinc-950/95 p-4 backdrop-blur-xl transition-transform duration-300 md:static md:w-64 md:translate-x-0 md:bg-black/30 flex flex-col ${
          sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <div className="mb-4 flex items-center justify-between pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-violet-400" />
            <span className="text-[11px] font-bold tracking-widest text-violet-400 uppercase">AI WORKSPACE</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-secondary !py-1.5 !px-3 !text-xs gap-1.5"
              onClick={() => {
                setConversationId(undefined);
                setMessages([]);
                setSidebarOpen(false);
              }}
            >
              <PlusIcon className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
            <button
              type="button"
              className="p-1 text-zinc-400 hover:text-white md:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="mb-3">
          <input
            className="sidebar-search"
            value={conversationSearch}
            onChange={(event) => setConversationSearch(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
        </div>

        <div className="space-y-1 flex-1 overflow-y-auto pr-1">
          <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-2 py-1">Conversations</div>
          {conversations.length === 0 ? (
            <p className="px-3 py-4 text-xs text-zinc-500 text-center">No past chats yet.</p>
          ) : visibleConversations.length === 0 ? (
            <p className="px-3 py-4 text-xs text-zinc-500 text-center">No matching conversations.</p>
          ) : (
            visibleConversations.map((c) => {
              const isActive = conversationId === c.id;
              return (
                <div
                  key={c.id}
                  className={`group flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-all duration-150 cursor-pointer ${
                    isActive ? 'bg-sky-100 text-sky-950 font-semibold border border-sky-300 shadow-sm' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                  }`}
                  onClick={() => void openConversation(c.id)}
                >
                  <span className="truncate flex-1">{c.title}</span>
                  <button
                    type="button"
                    onClick={(e) => void deleteConversation(e, c.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-opacity"
                    title="Delete chat"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="sidebar-templates mt-3 pt-3 border-t border-slate-200">
          <div className="flex items-center justify-between gap-2 px-2">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Templates</span>
            <button type="button" className="sidebar-template-save" onClick={saveCurrentAsTemplate} disabled={!draft.trim()}>
              Save draft
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 px-2">
            {templates.length === 0 ? (
              <span className="text-[11px] text-slate-500">Save a draft to reuse it later.</span>
            ) : (
              templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="sidebar-template"
                  onClick={() => {
                    setDraft(template.content);
                    textareaRef.current?.focus();
                  }}
                  title={template.content}
                >
                  {template.name}
                </button>
              ))
            )}
          </div>
        </div>

        {/* User quota info in sidebar */}
        <div className="mt-4 pt-3 border-t border-slate-200 text-xs text-slate-500 space-y-2">
          <div className="flex justify-between items-center text-[11px]">
            <span>Prompts left:</span>
            <span className="text-slate-800 font-semibold">{promptsLeft} / {promptLimit}</span>
          </div>
          <div className="flex justify-between items-center text-[11px]">
            <span>Session expiry:</span>
            <span className="text-violet-700 font-mono">{remaining}</span>
          </div>
        </div>
      </aside>

      {/* Main Chat Interface */}
      <section className="flex min-w-0 flex-1 flex-col bg-black/10">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-white/10 bg-black/30 px-4 sm:px-6 py-3.5 backdrop-blur-xl shadow-sm z-10 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-lg md:hidden hover:bg-white/5"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <MenuIcon className="w-5 h-5" />
            </button>

            <div className="min-w-0">
              <Dropdown
                options={modelOptions}
                value={model}
                onChange={setModel}
                disabled={!enabledModels.length || busy}
                placeholder={enabledModels.length ? 'Select a model' : 'No models available'}
                className="w-52 sm:w-64"
                buttonClassName="!py-1.5 !text-xs sm:!text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-1.5 border border-violet-200 text-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-slate-700 font-medium">Expires in:</span>
              <span className="font-mono font-bold text-violet-800">{remaining}</span>
            </div>

            <button className="btn-secondary !py-1.5 !px-3 text-xs sm:text-sm" onClick={onLogout}>
              Sign out
            </button>
            <button
              type="button"
              className="btn-secondary !py-1.5 !px-3 text-xs sm:text-sm hidden lg:inline-flex"
              onClick={exportConversation}
              disabled={!messages.length}
              title="Export this conversation as Markdown"
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              Export
            </button>
          </div>
        </header>

        <div className="workspace-metrics mx-auto grid w-full max-w-4xl grid-cols-1 gap-3 px-4 pt-4 sm:grid-cols-3 sm:px-6 md:px-8">
          <div className="metric-card">
            <span className="metric-label">Prompts left</span>
            <strong className="metric-value">{promptsLeft}</strong>
            <span className="metric-detail">of {promptLimit} available</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Tokens used</span>
            <strong className="metric-value">{tokensUsed.toLocaleString()}</strong>
            <span className="metric-detail">of {tokenBudget.toLocaleString()} budget</span>
          </div>
          <div className="metric-card metric-card-progress">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="metric-label">Tokens left</span>
                <strong className="metric-value">{tokensLeft.toLocaleString()}</strong>
              </div>
              <span className="metric-percent">{Math.round(100 - tokenProgress)}%</span>
            </div>
            <div className="metric-track" aria-label={`${tokensLeft} tokens remaining`}>
              <span className="metric-fill" style={{ width: `${100 - tokenProgress}%` }} />
            </div>
          </div>
        </div>

        {/* Messages Body */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="mx-auto w-full max-w-4xl flex-1 space-y-6 overflow-y-auto p-4 sm:p-6 md:p-8"
        >
          {messages.length === 0 && (
            <div className="pt-12 sm:pt-20 pb-8 text-center animate-in fade-in zoom-in-95 duration-300">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-violet-600 to-fuchsia-600 shadow-xl shadow-violet-900/40 mb-5">
                <SparklesIcon className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-950">
                How can I assist you?
              </h1>
              <p className="mt-3 text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
                Send a message to begin. Model streaming responses appear progressively chunk by chunk.
              </p>

              {/* Suggestions grid */}
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl mx-auto text-left">
                {promptSuggestions.map((item, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setDraft(item.text);
                      textareaRef.current?.focus();
                    }}
                    className="p-3.5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] hover:border-violet-500/40 transition-all text-left group"
                  >
                    <div className="text-xs font-semibold text-zinc-200 group-hover:text-violet-300 transition-colors">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate mt-1">{item.text}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => {
            const isUser = message.role === 'USER';
            const isLastMessage = index === messages.length - 1;
            const isActivelyStreaming = busy && !isUser && isLastMessage;

            return (
              <article
                key={index}
                className={
                  isUser
                    ? 'user-message ml-auto max-w-[88%] sm:max-w-[80%] rounded-2xl rounded-tr-sm px-4.5 py-3.5 text-sm leading-relaxed'
                    : 'assistant-message w-full max-w-none rounded-2xl p-5 sm:p-6 text-sm'
                }
              >
                <div className="text-[14px] sm:text-[15px] leading-relaxed break-words">
                  {isUser ? (
                    message.content
                  ) : (
                    <div>
                      {message.content ? (
                        <div className="prose prose-invert max-w-none text-zinc-200 prose-pre:bg-zinc-950/80 prose-pre:border prose-pre:border-white/10 prose-code:text-violet-300">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{formatInlineMath(message.content)}</ReactMarkdown>
                        </div>
                      ) : isActivelyStreaming ? (
                        <span className="text-zinc-500 italic text-xs flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-violet-400 animate-ping" />
                          Generating response…
                        </span>
                      ) : null}
                      {isActivelyStreaming && <span className="streaming-cursor" aria-hidden="true" />}
                    </div>
                  )}
                </div>

                {!isUser && message.error && (
                  <div className="model-error-actions">
                    <button type="button" className="model-retry-button" onClick={retryLastRequest} disabled={!failedRequest || busy}>
                      Retry response
                    </button>
                    <span>Or choose another model above.</span>
                  </div>
                )}

                {!isUser && message.content && (
                  <div className="mt-3.5 pt-2.5 border-t border-white/5 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 font-mono">Response</span>
                    <CopyButton text={message.content} />
                  </div>
                )}
              </article>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="chat-composer-shell p-3 sm:p-4">
          <div className="mx-auto mb-2 flex w-full max-w-4xl flex-wrap items-center gap-2">
            <label className="attachment-button">
              <AttachmentIcon className="w-4 h-4" />
              Attach text file
              <input
                type="file"
                accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json"
                className="sr-only"
                onChange={(event) => {
                  void selectAttachment(event.target.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
            </label>
            {attachment && (
              <span className="attachment-chip">
                <AttachmentIcon className="w-3.5 h-3.5" />
                {attachment.name}
                <button type="button" onClick={() => setAttachment(null)} aria-label={`Remove ${attachment.name}`}>
                  <CloseIcon className="w-3.5 h-3.5" />
                </button>
              </span>
            )}
            {attachmentError && <span className="attachment-error">{attachmentError}</span>}
          </div>
          <form
            className="chat-composer mx-auto flex w-full max-w-4xl gap-2 rounded-2xl p-2 items-end transition-all"
            onSubmit={send}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              className="chat-composer-text w-full resize-none bg-transparent px-4 py-3 text-base sm:text-lg outline-none max-h-40 min-h-[52px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={busy ? 'Model is generating…' : 'Ask anything… (Enter to send, Shift+Enter for newline)'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />

            {busy ? (
              <button
                type="button"
                onClick={handleStop}
                className="btn-danger !rounded-xl !py-2.5 !px-3.5 shrink-0 m-0.5 gap-1.5 text-xs sm:text-sm font-semibold"
                title="Stop generation"
              >
                <StopIcon className="w-3.5 h-3.5 text-red-400" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                className="btn-primary !rounded-xl !py-2.5 !px-4 shrink-0 m-0.5 gap-1.5 text-xs sm:text-sm font-semibold"
                disabled={(!draft.trim() && !attachment) || !model}
              >
                <span>Send</span>
                <SendIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </form>

          <p className="text-center text-xs text-slate-500 mt-3 font-medium tracking-wide">
            PROTECTED TEMPORARY ENVIRONMENT • VERIFY IMPORTANT INFORMATION
          </p>
        </div>
      </section>
    </main>
  );
}

// ----------------- APP ROOT COMPONENT -----------------
function App() {
  // A workspace session is intentionally not restored on page load. This makes
  // the login screen the first screen every time the app is opened or refreshed.
  const [me, setMe] = useState<Me | null>(null);

  const logout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setCsrf('');
      setMe(null);
    }
  };

  if (!me) {
    return <Login onLogin={setMe} />;
  }

  return me.role === 'ADMIN' ? (
    <Admin onLogout={() => void logout()} />
  ) : (
    <Chat me={me} onLogout={() => void logout()} />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
