export function wilsonLowerBound(successes: number, trials: number, z = 1.96): number {
  if (trials <= 0 || successes < 0 || successes > trials) return 0;
  const proportion = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = proportion + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * trials)) / trials);
  return Math.max(0, (centre - margin) / denominator);
}

export function coChangeConfidence(coChangeCount: number, sourceChangeCount: number): number {
  if (sourceChangeCount < 3 || coChangeCount < 2) return 0;
  const statisticalFloor = wilsonLowerBound(coChangeCount, sourceChangeCount);
  const sampleStrength = Math.min(1, sourceChangeCount / 20);
  return Number((statisticalFloor * (0.55 + sampleStrength * 0.45)).toFixed(2));
}

export interface CoChangePair {
  leftPath: string;
  rightPath: string;
  sampleCount: number;
  coChangeCount: number;
  conditionalProbability: number;
  confidence: number;
  lastObserved: string;
}

export function calculateCoChangePairs(commits: Array<{ sha: string; occurredAt: string; paths: string[] }>): CoChangePair[] {
  const fileCounts = new Map<string, number>();
  const pairCounts = new Map<string, { count: number; lastObserved: string }>();

  for (const commit of commits) {
    const unique = [...new Set(commit.paths)].sort();
    for (const path of unique) fileCounts.set(path, (fileCounts.get(path) ?? 0) + 1);
    for (let leftIndex = 0; leftIndex < unique.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < unique.length; rightIndex += 1) {
        const left = unique[leftIndex];
        const right = unique[rightIndex];
        if (!left || !right) continue;
        const key = `${left}\0${right}`;
        const current = pairCounts.get(key);
        pairCounts.set(key, {
          count: (current?.count ?? 0) + 1,
          lastObserved: current && current.lastObserved > commit.occurredAt ? current.lastObserved : commit.occurredAt
        });
      }
    }
  }

  return [...pairCounts.entries()]
    .map(([key, value]) => {
      const [leftPath, rightPath] = key.split("\0");
      const sampleCount = Math.min(fileCounts.get(leftPath ?? "") ?? 0, fileCounts.get(rightPath ?? "") ?? 0);
      const confidence = coChangeConfidence(value.count, sampleCount);
      return {
        leftPath: leftPath ?? "",
        rightPath: rightPath ?? "",
        sampleCount,
        coChangeCount: value.count,
        conditionalProbability: sampleCount ? Number((value.count / sampleCount).toFixed(2)) : 0,
        confidence,
        lastObserved: value.lastObserved
      };
    })
    .filter((pair) => pair.confidence > 0)
    .sort((left, right) => right.confidence - left.confidence);
}

