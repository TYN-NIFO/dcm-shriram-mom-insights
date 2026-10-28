"use client";

import { useEffect, useState } from "react";

type Theme = "green" | "blue";

const OPTIONS: { value: Theme; label: string; swatch: string }[] = [
  { value: "green", label: "Green", swatch: "#ccff00" },
  { value: "blue", label: "DCM blue", swatch: "#008fcb" },
];

/** Points the browser-tab icon at the DCM Shriram mark (same in both themes). */
function setTabIcon() {
  const href = "/brand/dcm-shriram-mark.png";
  const links = document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
  if (links.length) links.forEach((l) => (l.href = href));
  else {
    const l = document.createElement("link");
    l.rel = "icon";
    l.href = href;
    document.head.appendChild(l);
  }
}

/** Switches the brand colour between green and DCM blue; the choice is remembered in this browser. */
export default function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("green");

  useEffect(() => {
    const t: Theme = document.documentElement.dataset.theme === "blue" ? "blue" : "green";
    setTheme(t);
    setTabIcon(); // Next re-adds its own icon link on navigation, so re-apply on mount
  }, []);

  const choose = (t: Theme) => {
    setTheme(t);
    setTabIcon();
    const root = document.documentElement;
    root.classList.add("theme-fade");
    if (t === "blue") root.dataset.theme = "blue";
    else delete root.dataset.theme;
    try {
      localStorage.setItem("mom-theme", t);
    } catch {
      /* private mode: the choice just won't persist */
    }
    window.setTimeout(() => root.classList.remove("theme-fade"), 450);
  };

  return (
    <div role="radiogroup" aria-label="Colour theme" className="inline-flex rounded-full bg-white p-1 shadow-sm ring-1 ring-zinc-200">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          onClick={() => choose(o.value)}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
            theme === o.value ? "bg-zinc-950 text-white" : "text-zinc-600 hover:text-zinc-950"
          }`}
        >
          <span className="size-3 rounded-full ring-1 ring-black/10" style={{ background: o.swatch }} aria-hidden />
          {o.label}
        </button>
      ))}
    </div>
  );
}
