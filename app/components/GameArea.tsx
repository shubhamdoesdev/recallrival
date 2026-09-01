"use client";

import { useState } from "react";
import DotRing, { type DotState, type RingMode } from "../components/DotRing";

const MODES: { id: RingMode; label: string }[] = [
  { id: "flat", label: "Flat" },
  { id: "pillars", label: "Pillars" },
  { id: "octagons", label: "Octagons" },
];

/**
 * Self-contained sandbox for the dot ring: tap dots to chain them together,
 * each tap animates a line in from the previously tapped dot.
 * No turn/AI logic yet — just the core interaction.
 */
export default function GameArea() {
  const [chain, setChain] = useState<number[]>([]);
  const [mode, setMode] = useState<RingMode>("octagons");

  function handleDotClick(id: number) {
    setChain((c) => [...c, id]);
  }

  function getDotState(id: number): DotState {
    return chain.includes(id) ? "used" : "available";
  }

  return (
    <div className="flex w-full flex-col items-center gap-8 px-6 pt-10">
      <DotRing getDotState={getDotState} interactive onDotClick={handleDotClick} trail={chain} mode={mode} />

      <div className="flex items-center gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
              mode === m.id
                ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                : "border-neutral-300 text-black hover:bg-neutral-100 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-900"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {chain.length > 0 && (
        <button
          type="button"
          onClick={() => setChain([])}
          className="rounded-full bg-neutral-200 px-6 py-2 text-sm font-bold text-black transition-colors hover:bg-neutral-300 dark:bg-neutral-800 dark:text-white dark:hover:bg-neutral-700"
        >
          Reset
        </button>
      )}
    </div>
  );
}