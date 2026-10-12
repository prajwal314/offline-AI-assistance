import { useEffect, useRef, useState } from "react";
import Dashboard from "./components/Dashboard";
import SystemStatus from "./components/SystemStatus";
import DocumentList from "./components/DocumentList";
import { InternetResearch, ResearchSources, BuildKBButton } from "./components/KnowledgeBase";
import Chat from "./components/Chat";
import { VDivider, HDivider, CornerGrip, clamp } from "./components/Resizable";

// Defaults as % of horizontal workspace: 15% | 25% | 60% (chat flex-1 takes ~60%)
const DEFAULTS = { leftPct: 15, midPct: 25, leftTopH: 300, midTopH: 270 };
const STORE_KEY = "kb-layout-v4";

function loadSizes() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      // migrate legacy pixel layout (v1) -> ignore, use new % defaults
      if (typeof p.leftPct === "number" && typeof p.midPct === "number") {
        return { ...DEFAULTS, ...p };
      }
    }
  } catch {}
  return { ...DEFAULTS };
}

function loadTheme() {
  try {
    const t = localStorage.getItem("kb-theme");
    if (t === "dark" || t === "light") return t;
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {}
  return "light";
}

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [sizes, setSizes] = useState(loadSizes);
  const [theme, setTheme] = useState(loadTheme);
  const mainRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(sizes)); } catch {}
  }, [sizes]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("kb-theme", theme); } catch {}
  }, [theme]);

  const set = (patch) => setSizes((s) => ({ ...s, ...patch }));
  const resetAll = () => setSizes({ ...DEFAULTS });

  // convert horizontal pixel drag into % of workspace width
  function dxToPct(dx) {
    const w = mainRef.current?.getBoundingClientRect().width || window.innerWidth;
    return (dx / w) * 100;
  }

  const growLeft = (dx) =>
    setSizes((s) => ({ ...s, leftPct: clamp(s.leftPct + dxToPct(dx), 10, 32) }));
  const growMid = (dx) =>
    setSizes((s) => ({ ...s, midPct: clamp(s.midPct + dxToPct(dx), 15, 45) }));
  const growLeftTop = (dy) =>
    setSizes((s) => ({ ...s, leftTopH: clamp(s.leftTopH + dy, 150, 620) }));
  const growMidTop = (dy) =>
    setSizes((s) => ({ ...s, midTopH: clamp(s.midTopH + dy, 150, 620) }));

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#f8f9fb] dark:bg-[#0b0f1a] flex flex-col">
      <header className="shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-[1600px] mx-auto px-3 h-[52px] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[12px] font-bold shrink-0">◉</div>
            <div className="leading-none min-w-0">
              <div className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-gray-100 truncate">AI Knowledge Assistant</div>
              <div className="text-[10px] font-medium text-gray-500 dark:text-gray-400 tracking-wide hidden sm:block">Offline RAG Knowledge Platform</div>
            </div>
          </div>
          <div className="hidden xl:block text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">Qwen3 · Chroma · SQLite · <span title="Drag the ⋮⋮ dividers or ⤡ corners to resize panels · double-click to reset">↔ drag dividers / corners to resize</span></div>
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            <SystemStatus />
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-50 dark:bg-emerald-900/30 border border-green-200 dark:border-emerald-800 text-[11px] font-medium text-green-700 dark:text-emerald-300 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Local
            </span>
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-300 hover:border-indigo-200 dark:hover:border-indigo-700 transition text-[14px] leading-none"
            >
              {theme === "dark" ? "☀" : "🌙"}
            </button>
            <button onClick={resetAll} title="Reset to 15% / 25% / 60%" className="hidden lg:inline-flex text-[11px] text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-300 px-1.5 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition">Reset</button>
          </div>
        </div>
      </header>

      {/* Resizable 3-column workspace — defaults 15% | 25% | 60%. Drag dividers/corners, double-click resets */}
      <main ref={mainRef} className="flex-1 min-h-0 w-full max-w-[1600px] mx-auto px-3 pt-2.5 pb-1.5 flex flex-col gap-2.5 overflow-y-auto lg:overflow-hidden lg:flex-row lg:gap-1">
        {/* LEFT rail: knowledge base + internet research (15%) */}
        <div
          className="flex flex-col gap-2.5 lg:gap-0 shrink-0 min-h-0 w-full lg:w-[var(--railW)] lg:h-full lg:overflow-hidden lg:min-w-[132px]"
          style={{ "--railW": `${sizes.leftPct}%` }}
        >
          {/* TOP: Knowledge Base */}
          <div className="relative shrink-0 min-h-0">
            <div className="lg:overflow-auto lg:pr-1 lg:h-[var(--topH)]" style={{ "--topH": `${sizes.leftTopH}px` }}>
              <Dashboard key={refreshKey} compact />
            </div>
            <CornerGrip
              onReset={() => set({ leftPct: DEFAULTS.leftPct, leftTopH: DEFAULTS.leftTopH })}
              onResize={(dx, dy) => {
                const dp = dxToPct(dx);
                setSizes((s) => ({
                  ...s,
                  leftPct: clamp(s.leftPct + dp, 10, 32),
                  leftTopH: clamp(s.leftTopH + dy, 150, 620),
                }));
              }}
            />
          </div>

          <HDivider
            onReset={() => set({ leftTopH: DEFAULTS.leftTopH })}
            onResize={growLeftTop}
          />

          {/* BOTTOM: Internet Research (stretches to window bottom) */}
          <div className="relative flex flex-col min-h-0 lg:flex-1 lg:overflow-hidden lg:pr-1 lg:pt-1">
            <InternetResearch compact fill />
            <CornerGrip
              onReset={() => set({ leftPct: DEFAULTS.leftPct })}
              onResize={(dx) => growLeft(dx)}
            />
            <div className="hidden lg:block text-[10px] leading-relaxed text-gray-400 dark:text-gray-500 text-center px-2 pt-1 pb-0.5 shrink-0">
              React → Express → SQLite / Chroma / Ollama → RAG<br />Q&A offline · Web only for Research
            </div>
          </div>
        </div>

        <VDivider
          onReset={() => set({ leftPct: DEFAULTS.leftPct })}
          onResize={growLeft}
        />

        {/* MIDDLE rail: documents + research sources (25%) */}
        <div
          className="flex flex-col gap-2.5 lg:gap-0 shrink-0 min-h-0 w-full lg:w-[var(--midW)] lg:h-full lg:overflow-hidden lg:min-w-[200px]"
          style={{ "--midW": `${sizes.midPct}%` }}
        >
          {/* TOP: Documents */}
          <div className="relative shrink-0 min-h-0">
            <div className="lg:overflow-auto lg:pr-1 lg:h-[var(--midTopH)]" style={{ "--midTopH": `${sizes.midTopH}px` }}>
              <DocumentList onUpdate={() => setRefreshKey((k) => k + 1)} compact />
            </div>
            <CornerGrip
              onReset={() => set({ midPct: DEFAULTS.midPct, midTopH: DEFAULTS.midTopH })}
              onResize={(dx, dy) => {
                const dp = dxToPct(dx);
                setSizes((s) => ({
                  ...s,
                  midPct: clamp(s.midPct + dp, 15, 45),
                  midTopH: clamp(s.midTopH + dy, 150, 620),
                }));
              }}
            />
          </div>

          <HDivider
            onReset={() => set({ midTopH: DEFAULTS.midTopH })}
            onResize={growMidTop}
          />

          {/* Build button — sits between Documents and Research Sources */}
          <div className="shrink-0 lg:pr-1 lg:py-1">
            <BuildKBButton />
          </div>

          {/* BOTTOM: Research Sources (stretches to window bottom) */}
          <div className="relative flex flex-col min-h-0 lg:flex-1 lg:overflow-hidden lg:pr-1 lg:pt-1">
            <ResearchSources compact fill />
            <CornerGrip
              onReset={() => set({ midPct: DEFAULTS.midPct })}
              onResize={(dx) => growMid(dx)}
            />
          </div>
        </div>

        <VDivider
          onReset={() => set({ midPct: DEFAULTS.midPct })}
          onResize={growMid}
        />

        {/* RIGHT: chat takes remaining ~60% */}
        <div className="flex flex-col min-h-[600px] lg:min-h-0 lg:h-full lg:overflow-hidden flex-1 min-w-0">
          <Chat compact />
        </div>
      </main>
    </div>
  );
}
