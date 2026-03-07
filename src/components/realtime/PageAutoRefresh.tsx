"use client";

import { useRouter } from "next/navigation";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";

type Props = {
  intervalMs?: number;
};

export function PageAutoRefresh({ intervalMs = 10000 }: Props) {
  const router = useRouter();

  useAutoRefresh(() => {
    router.refresh();
  }, { intervalMs });

  return null;
}
