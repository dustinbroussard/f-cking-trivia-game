import { ArrowRight, DatabaseZap, ShieldAlert } from 'lucide-react';

export function GeneratorApp() {
  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(244,114,182,0.18),_transparent_30%),linear-gradient(160deg,_#0b1020_0%,_#111827_45%,_#1f2937_100%)] text-white">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10 sm:px-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/12 bg-white/8 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,_rgba(56,189,248,0.12),_transparent_40%,_rgba(249,115,22,0.14))]" />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-black uppercase tracking-[0.28em] text-cyan-100">
                <DatabaseZap className="h-4 w-4" />
                Migration Notice
              </p>
              <h1 className="font-display text-4xl font-black tracking-tight sm:text-5xl">
                The legacy generator has been retired.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-200 sm:text-base">
                This repo now runs on Supabase, and the old generator plus maintenance auth flow have been disabled.
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-white/12 bg-slate-950/45 px-5 py-4">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Status</p>
              <p className="mt-2 text-sm font-semibold text-white">Unavailable during migration cleanup</p>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[2rem] border border-white/10 bg-slate-950/55 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-300" />
              <h2 className="text-lg font-black tracking-wide">What Changed</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
              <p>The old generator depended on a legacy auth flow, legacy database reads, and a retired maintenance endpoint.</p>
              <p>Those pieces have been removed so this flow no longer ships or relies on that legacy stack.</p>
              <p>The next step is to replace this page with a Supabase-native admin tool if you still want one.</p>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-slate-950/55 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <h2 className="text-lg font-black tracking-wide">Recommended Replacement</h2>
            <div className="mt-4 space-y-4 text-sm text-slate-200">
              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/80">Next Move</p>
                <p className="mt-2 leading-6 text-slate-100">
                  Build a Supabase-backed admin page that calls a protected route or Edge Function and writes directly into the `questions` table.
                </p>
              </div>
              <a
                href="/"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/14 bg-white/6 px-5 py-4 font-bold text-white transition hover:bg-white/10"
              >
                Return to the game
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
