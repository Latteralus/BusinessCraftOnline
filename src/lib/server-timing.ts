type TimingPhase = {
  label: string;
  durationMs: number;
};

export type TimingCollector = {
  measure: <T>(label: string, task: () => Promise<T>) => Promise<T>;
  finish: (extra?: Record<string, unknown>) => void;
};

function roundMs(value: number) {
  return Number(value.toFixed(2));
}

export function createTimingCollector(label: string, route: string): TimingCollector {
  const enabled = process.env.PERF_TIMING === "1";
  const startedAt = performance.now();
  const phases: TimingPhase[] = [];

  return {
    async measure<T>(phaseLabel: string, task: () => Promise<T>) {
      if (!enabled) {
        return task();
      }

      const phaseStartedAt = performance.now();
      try {
        return await task();
      } finally {
        phases.push({
          label: phaseLabel,
          durationMs: roundMs(performance.now() - phaseStartedAt),
        });
      }
    },
    finish(extra = {}) {
      if (!enabled) return;

      console.info(
        "[perf]",
        JSON.stringify({
          label,
          route,
          durationMs: roundMs(performance.now() - startedAt),
          phases,
          ...extra,
        })
      );
    },
  };
}

export async function withTiming<T>(
  label: string,
  route: string,
  task: (timing: TimingCollector) => Promise<T>,
  extra?: Record<string, unknown>
) {
  const timing = createTimingCollector(label, route);
  try {
    return await task(timing);
  } finally {
    timing.finish(extra);
  }
}
