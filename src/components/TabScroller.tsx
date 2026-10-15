"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A horizontal row that scrolls, with arrow buttons when it overflows.
 *
 * The user found the last tabs cut off at the screen edge ("Failing sources"
 * half visible, anything after it unreachable). The row still scrolls by
 * touch and trackpad; the arrows make it reachable with a mouse, and the
 * active tab is scrolled into view on load so the current page is never the
 * hidden one.
 */
export function TabScroller({ children, label }: { children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>("[aria-current='page'], [aria-selected='true']");
    if (active) {
      const left = active.offsetLeft - el.clientWidth / 2 + active.clientWidth / 2;
      el.scrollTo({ left: Math.max(0, left) });
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const scrollBy = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const step = dir * Math.max(160, el.clientWidth * 0.7);
    const before = el.scrollLeft;
    el.scrollBy({ left: step, behavior: "smooth" });
    // Smooth scrolling is skipped by some browsers and in background tabs;
    // if nothing moved, jump instead of leaving the arrow dead.
    window.setTimeout(() => {
      if (Math.abs(el.scrollLeft - before) < 1) el.scrollLeft = before + step;
      update();
    }, 350);
  };

  const arrow = (dir: -1 | 1, visible: boolean) => (
    <button
      type="button"
      onClick={() => scrollBy(dir)}
      aria-label={dir === -1 ? `Scroll ${label} left` : `Scroll ${label} right`}
      tabIndex={visible ? 0 : -1}
      className="absolute top-1/2 z-10 grid -translate-y-1/2 place-items-center text-[16px] font-bold"
      style={{
        [dir === -1 ? "left" : "right"]: 0,
        width: "34px",
        height: "34px",
        background: "var(--surface)",
        color: "var(--ink)",
        border: "1px solid var(--border-strong)",
        borderRadius: "999px",
        boxShadow: "var(--shadow-sm)",
        cursor: "pointer",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 150ms",
      }}
    >
      <span aria-hidden="true">{dir === -1 ? "‹" : "›"}</span>
    </button>
  );

  return (
    <div className="relative">
      {arrow(-1, canLeft)}
      <div
        ref={ref}
        role="tablist"
        aria-label={label}
        className="flex gap-1.5 overflow-x-auto py-1"
        style={{
          scrollbarWidth: "none",
          // Room under the arrows so the first and last tabs are not covered.
          paddingLeft: canLeft ? "40px" : "0",
          paddingRight: canRight ? "40px" : "0",
          maskImage: `linear-gradient(to right, ${canLeft ? "transparent 0, black 40px" : "black 0"}, ${canRight ? "black calc(100% - 40px), transparent 100%" : "black 100%"})`,
        }}
      >
        {children}
      </div>
      {arrow(1, canRight)}
    </div>
  );
}
