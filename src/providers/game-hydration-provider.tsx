"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import type { GameStoreHydrationPayload } from "@/stores/game-store";
import { useGameStore } from "@/stores/game-store";

type Props = {
  initialData: GameStoreHydrationPayload;
  children: ReactNode;
};

export function GameHydrationProvider({ initialData, children }: Props) {
  const hydrateFromServer = useGameStore((state) => state.hydrateFromServer);
  const hasHydratedRef = useRef(false);

  if (!hasHydratedRef.current) {
    hasHydratedRef.current = true;
    hydrateFromServer(initialData);
  }

  return children;
}
