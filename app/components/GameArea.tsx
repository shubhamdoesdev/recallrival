
"use client";

import { useState } from "react";
import DotRing, { DotState } from "./DotRing";

export default function GameArea() {
  const [chain, setChain] = useState<number[]>([]);
 
  function handleDotClick(id: number) {
    setChain((c) => [...c, id]);
  }
 
  function getDotState(id: number): DotState {
    return chain.includes(id) ? "used" : "available";
  }
 
  return (
    <div className="flex w-full flex-col items-center gap-8 px-6 pt-10">
      <DotRing getDotState={getDotState} interactive onDotClick={handleDotClick} trail={chain} />
 
    </div>
  );
}