export function VDivider({ onResize, onReset, title = "Drag to resize" }) {
  function onPointerDown(e) {
    e.preventDefault();
    let lastX = e.clientX;
    const move = (ev) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      onResize?.(dx, ev);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      title={`${title} · double-click to reset`}
      className="hidden lg:flex shrink-0 w-3 -mx-0.5 cursor-col-resize items-center justify-center group touch-none self-stretch"
    >
      <div className="w-[3px] h-12 rounded-full bg-gray-200 dark:bg-gray-700 group-hover:bg-indigo-400 group-active:bg-indigo-500 transition" />
    </div>
  );
}

// Horizontal divider between stacked panels — drag up/down. Double-click resets.
export function HDivider({ onResize, onReset, title = "Drag to resize" }) {
  function onPointerDown(e) {
    e.preventDefault();
    let lastY = e.clientY;
    const move = (ev) => {
      const dy = ev.clientY - lastY;
      lastY = ev.clientY;
      onResize?.(dy, ev);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      title={`${title} · double-click to reset`}
      className="hidden lg:flex shrink-0 h-3 -my-0.5 cursor-row-resize items-center justify-center group touch-none"
    >
      <div className="h-[3px] w-12 rounded-full bg-gray-200 dark:bg-gray-700 group-hover:bg-indigo-400 group-active:bg-indigo-500 transition" />
    </div>
  );
}

// Corner grip at bottom-right of a panel — drag diagonally to resize width + height.
export function CornerGrip({ onResize, onReset, title = "Drag corner to resize" }) {
  function onPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    let lastX = e.clientX;
    let lastY = e.clientY;
    const move = (ev) => {
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      onResize?.(dx, dy, ev);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => { e.stopPropagation(); onReset?.(); }}
      title={`${title} · double-click to reset`}
      className="hidden lg:block absolute bottom-1 right-1 w-4 h-4 cursor-nwse-resize opacity-40 hover:opacity-100 transition touch-none z-10"
    >
      <svg viewBox="0 0 16 16" className="w-4 h-4 text-gray-400 dark:text-gray-500">
        <path d="M11 15 L15 11 M8.5 15 L15 8.5 M6 15 L15 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
