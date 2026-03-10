"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { GameStoreHydrationPayload } from "@/stores/game-store";
import { useGameStore } from "@/stores/game-store";

type Props = {
  initialData: GameStoreHydrationPayload;
  children: ReactNode;
};

export function GameHydrationProvider({ initialData, children }: Props) {
  const hydrateFromServer = useGameStore((state) => state.hydrateFromServer);
  const lastHydratedPayloadRef = useRef<GameStoreHydrationPayload | null>(null);

  useEffect(() => {
    if (lastHydratedPayloadRef.current === initialData) {
      return;
    }

    lastHydratedPayloadRef.current = initialData;
    hydrateFromServer(initialData);
  }, [hydrateFromServer, initialData]);

  return children;
}
