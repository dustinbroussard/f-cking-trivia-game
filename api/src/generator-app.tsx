import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Loader2, LogIn, ShieldCheck, Sparkles } from 'lucide-react';
import { auth, finishSignInRedirect, signIn, signOut } from './firebase';

interface TriggerResult {
  message?: string;
  requestId?: string;
  results?: Array<{
    category: string;
    difficulty: 'easy' | 'medium' | 'hard';
    count?: number;
    added?: number;
    status: string;
    error?: string;
  }>;
  error?: string;
}

function summarizeResults(result: TriggerResult | null) {
  if (!result?.results?.length) return null;

  const replenished = result.results.filter((entry) => entry.status === 'replenished');
  const sufficient = result.results.filter((entry) => entry.status === 'sufficient');
  const errors = result.results.filter((entry) => entry.status === 'error');
  const added = replenished.reduce((sum, entry) => sum + (entry.added || 0), 0);

  return { replenished, sufficient, errors, added };
}

export function GeneratorApp() {
  const [user, setUser] = useState<User | null>(null);
  const [hasResolvedInitialAuthState, setHasResolvedInitialAuthState] = useState(false);
  const [hasResolvedRedirectSignIn, setHasResolvedRedirectSignIn] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TriggerResult | null>(null);
  const isAuthLoading = !hasResolvedInitialAuthState || !hasResolvedRedirectSignIn;

  useEffect(() => {
    finishSignInRedirect().catch((err) => {
      console.error('[generator] Redirect sign-in failed:', err);
      setError('Google sign-in did not finish cleanly.');
    }).finally(() => {
      setHasResolvedRedirectSignIn(true);
    });

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setHasResolvedInitialAuthState(true);
    });

    return unsubscribe;
  }, []);

  const handleTrigger = async () => {
    if (!user) {
      setError('You need to sign in first.');
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/maintenance/top-up', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Generation request failed.');
      }

      setResult(data);
    } catch (err) {
      console.error('[generator] Trigger failed:', err);
      setError(err instanceof Error ? err.message : 'Generation request failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const summary = summarizeResults(result);

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(244,114,182,0.18),_transparent_30%),linear-gradient(160deg,_#0b1020_0%,_#111827_45%,_#1f2937_100%)] text-white">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10 sm:px-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/12 bg-white/8 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,_rgba(56,189,248,0.12),_transparent_40%,_rgba(249,115,22,0.14))]" />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-black uppercase tracking-[0.28em] text-cyan-100">
                <Sparkles className="h-4 w-4" />
                Question Generator
              </p>
              <h1 className="font-display text-4xl font-black tracking-tight sm:text-5xl">
                One button. Full database top-up.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-200 sm:text-base">
                This app does one job: trigger the existing server-side question pipeline and write approved questions into Firestore.
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-white/12 bg-slate-950/45 px-5 py-4">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Signed In</p>
              <p className="mt-2 break-all text-sm font-semibold text-white">
                {user?.email || (isAuthLoading ? 'Checking session...' : 'Not signed in')}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[2rem] border border-white/10 bg-slate-950/55 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
              <h2 className="text-lg font-black tracking-wide">Trigger Controls</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              The button calls `/api/maintenance/top-up`. The API checks your Firebase ID token against `MAINTENANCE_ALLOWED_EMAILS`.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              {!user ? (
                <button
                  type="button"
                  onClick={() => signIn().catch((err) => {
                    console.error('[generator] Sign-in failed:', err);
                    setError(err instanceof Error ? err.message : 'Google sign-in failed.');
                  })}
                  disabled={isAuthLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-5 py-4 font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAuthLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
                  Sign In With Google
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleTrigger}
                    disabled={isRunning}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-400 px-5 py-4 font-black text-slate-950 transition hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                    {isRunning ? 'Generating...' : 'Generate Questions'}
                  </button>
                  <button
                    type="button"
                    onClick={() => signOut().catch((err) => {
                      console.error('[generator] Sign-out failed:', err);
                      setError(err instanceof Error ? err.message : 'Sign-out failed.');
                    })}
                    className="rounded-2xl border border-white/14 bg-white/6 px-5 py-4 font-bold text-white transition hover:bg-white/10"
                  >
                    Sign Out
                  </button>
                </>
              )}
            </div>

            {error ? (
              <div className="mt-5 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            {result?.requestId ? (
              <div className="mt-5 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                Request ID: <span className="font-mono">{result.requestId}</span>
              </div>
            ) : null}
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-slate-950/55 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <h2 className="text-lg font-black tracking-wide">Last Run</h2>
            {!summary ? (
              <p className="mt-4 text-sm leading-6 text-slate-300">
                No run yet. After you trigger generation, this panel will show how many buckets were replenished and whether anything failed.
              </p>
            ) : (
              <div className="mt-4 space-y-4 text-sm text-slate-200">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Buckets Filled</p>
                    <p className="mt-2 text-3xl font-black text-white">{summary.replenished.length}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Questions Added</p>
                    <p className="mt-2 text-3xl font-black text-white">{summary.added}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Errors</p>
                    <p className="mt-2 text-3xl font-black text-white">{summary.errors.length}</p>
                  </div>
                </div>

                <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                  {result?.results?.map((entry) => (
                    <div
                      key={`${entry.category}-${entry.difficulty}`}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-white">
                          {entry.category} / {entry.difficulty}
                        </p>
                        <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-slate-200">
                          {entry.status}
                        </span>
                      </div>
                      <p className="mt-2 text-slate-300">
                        {entry.status === 'replenished'
                          ? `Added ${entry.added || 0} approved questions.`
                          : entry.status === 'sufficient'
                            ? `Already had ${entry.count || 0} approved questions.`
                            : entry.error || 'No extra details returned.'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
