export default function Loading() {
  return (
    <div className="h-[100dvh] w-screen overflow-hidden flex flex-col bg-[#080e18] text-[#e8eef7]">
      {/* Top Header Skeleton */}
      <header className="flex-none h-12 md:h-13 border-b border-[#202b3e] bg-[#0b1422] px-3 md:px-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded bg-[#d3a85c] text-[#0d1624] font-bold text-xs flex items-center justify-center font-mono">
            TB
          </span>
          <span className="font-bold text-sm tracking-tight text-white">
            TraderBrain
          </span>
          <span className="text-xs text-[#8491a5] font-mono">XAUUSD</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 border border-[#d3a85c] bg-[#2a220e]/80 rounded text-[11px] font-bold text-[#e8c382] flex items-center gap-1.5 uppercase">
            <span className="w-2 h-2 rounded-full border border-[#d3a85c] border-t-transparent animate-spin" />
            <span>FETCHING DATA...</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Skeleton */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
        <main className="flex-1 min-w-0 flex flex-col h-full bg-[#09111d] relative">
          <div className="flex-none h-10 border-b border-[#202b3e] bg-[#0c1626] px-4 flex items-center justify-between">
            <div className="h-4 w-40 bg-[#162234] rounded animate-pulse" />
            <div className="h-4 w-24 bg-[#162234] rounded animate-pulse" />
          </div>

          <div className="flex-1 flex flex-col items-center justify-center relative">
            <div className="flex flex-col items-center gap-3 p-6 rounded-xl border border-[#202b3e] bg-[#0c1626] shadow-2xl max-w-sm text-center">
              <div className="relative w-12 h-12 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-[#d3a85c]/20" />
                <div className="absolute inset-0 rounded-full border-2 border-[#d3a85c] border-t-transparent animate-spin" />
                <span className="text-[10px] font-mono font-bold text-[#d3a85c]">TB</span>
              </div>
              <h3 className="text-sm font-bold text-[#e1e9f4] tracking-wide uppercase">
                Loading Market Terminal
              </h3>
              <p className="text-xs text-[#8491a5] mt-1 leading-relaxed">
                Connecting to backend and aggregating candles...
              </p>
            </div>
          </div>
        </main>

        <aside className="w-[280px] lg:w-[320px] flex-none border-l border-[#202b3e] bg-[#0c1421] hidden md:flex flex-col h-full p-4 space-y-4">
          <div className="h-4 w-32 bg-[#162234] rounded animate-pulse" />
          <div className="h-28 bg-[#09111c] border border-[#1e2d42] rounded-lg animate-pulse" />
          <div className="h-36 bg-[#09111c] border border-[#1e2d42] rounded-lg animate-pulse" />
        </aside>
      </div>

      {/* Footer Strip Skeleton */}
      <footer className="flex-none border-t border-[#202b3e] bg-[#0b1422] px-4 py-2 flex items-center justify-between text-xs">
        <div className="h-4 w-48 bg-[#162234] rounded animate-pulse" />
        <div className="h-4 w-32 bg-[#162234] rounded animate-pulse" />
      </footer>
    </div>
  );
}
