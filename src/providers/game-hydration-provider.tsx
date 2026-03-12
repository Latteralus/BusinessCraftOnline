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
  const lastHydratedPayloadRef = useRef<GameStoreHydrationPayload | null>(null);

  if (lastHydratedPayloadRef.current !== initialData) {
    lastHydratedPayloadRef.current = initialData;
    useGameStore.getState().hydrateFromServer(initialData);
  }

  return children;
}
