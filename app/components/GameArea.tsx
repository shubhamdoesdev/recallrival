"use client";

import { useState } from "react";
import DotRing, { type DotState } from "../components/DotRing";

/**
 * Self-contained sandbox for the ring: tap dots to chain them together, each
 * tap animates a line in from the previously tapped dot. DotRing itself now
 * blocks re-tapping an already-used dot for the rest of its ring, and once
 * all 8 are used it recedes that ring's mesh into the background and starts
 * a fresh one — this component doesn't need to know any of that happened,
 * it just keeps appending whatever gets tapped to one long `chain`.
 * No turn/AI logic yet — just the core interaction.
 */
export default function GameArea() {
  const [chain, setChain] = useState<number[]>([]);

  function handleDotClick(id: number) {
    setChain((c) => [...c, id]);
  }

  function getDotState(): DotState {
    return "available";
  }

  return (
    <div className="flex w-full flex-col items-center gap-8 px-6 pt-10">
      <DotRing getDotState={getDotState} interactive onDotClick={handleDotClick} trail={chain} />

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