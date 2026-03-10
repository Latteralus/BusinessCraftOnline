"use client";

type Props = {
  intervalMs?: number;
};

export function PageAutoRefresh({ intervalMs = 30000 }: Props) {
  void intervalMs;
  return null;
}
