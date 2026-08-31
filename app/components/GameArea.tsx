"use client";

import { useState } from "react";
import DotRing, { type DotState } from "../components/DotRing";

/**
 * Self-contained sandbox for the dot ring: tap dots to chain them together,
 * each tap animates a line in from the previously tapped dot.
 * No turn/AI logic yet — just the core interaction.
 */
export default function GameArea() {
  const [chain, setChain] = useState<number[]>([]);
  const [pillars, setPillars] = useState(false);

  function handleDotClick(id: number) {
    setChain((c) => [...c, id]);
  }

  function getDotState(id: number): DotState {
    return chain.includes(id) ? "used" : "available";
  }

  return (
    <div className="flex w-full flex-col items-center gap-8 px-6 pt-10">
      <DotRing getDotState={getDotState} interactive onDotClick={handleDotClick} trail={chain} pillars={pillars} />

      <div className="flex items-center gap-3">
        {chain.length > 0 && (
          <button
            type="button"
            onClick={() => setChain([])}
            className="rounded-full bg-neutral-200 px-6 py-2 text-sm font-bold text-black transition-colors hover:bg-neutral-300 dark:bg-neutral-800 dark:text-white dark:hover:bg-neutral-700"
          >
            Reset
          </button>
        )}

        <button
          type="button"
          onClick={() => setPillars((p) => !p)}
          className="rounded-full border border-neutral-300 px-6 py-2 text-sm font-bold text-black transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-900"
        >
          {pillars ? "Pillars: on" : "Pillars: off"}
        </button>
      </div>
    </div>
  );
}