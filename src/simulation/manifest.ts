import { MOVEMENT_RISK_POSITION, movementRiskFixture, riskAddress } from "./geometry";
import type {
  Bit,
  BitPair,
  JointProfile,
  LevelConfig,
  ManifestBundle,
  ManifestDerivation,
  Provenance,
  RiskRecord,
  RiskStreamState,
  ShotRecord,
  ShotStreamState,
  TriggerType,
} from "./types";

const RISK_STREAM_LENGTH = 160;
const SHOT_STREAM_LENGTH = 96;

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function bit(random: () => number): Bit {
  return random() < 0.5 ? 0 : 1;
}

function riskBits(
  random: () => number,
  profile: JointProfile,
  failureRate: number,
): BitPair {
  if (profile === "protected") {
    return [0, random() < failureRate ? 1 : 0];
  }
  if (profile === "reciprocal-no-double") {
    if (random() >= failureRate) return [0, 0];
    return random() < 0.5 ? [1, 0] : [0, 1];
  }
  const a = random() < failureRate ? 1 : 0;
  const b = random() < failureRate ? 1 : 0;
  return [a, b];
}

function makeRiskStream(
  level: LevelConfig,
  fixture: string,
  trigger: TriggerType,
  failureRate: number,
  random: () => number,
  scriptedRecords: readonly BitPair[] = [],
): RiskStreamState {
  const address = riskAddress(level.id, fixture, trigger);
  const records = Array.from({ length: RISK_STREAM_LENGTH }, (_, sampleIndex): RiskRecord => {
    const scriptedBits = scriptedRecords[sampleIndex];
    const scripted = scriptedBits !== undefined;
    return {
      id: `${address}/${sampleIndex}`,
      sampleIndex,
      address,
      trigger,
      bits: scripted ? scriptedBits : riskBits(random, level.jointProfile, failureRate),
      derivation: level.jointProfile === "protected" ? "protected-single" : "prepared-joint",
      source: scripted ? "scripted" : "simulator",
      circuitId: scripted ? `tutorial-${level.id}-${fixture}` : `sim-risk-${level.jointProfile}`,
    };
  });
  return { address, trigger, records, cursor: 0 };
}

function makeShotStream(jobId: string, random: () => number): ShotStreamState {
  const records = Array.from({ length: SHOT_STREAM_LENGTH }, (_, sampleIndex): ShotRecord => ({
    id: `${jobId}/shot/${sampleIndex}`,
    jobId,
    sampleIndex,
    bits: [bit(random), bit(random)],
    derivation: "circuit-shot",
    source: "simulator",
    circuitId: `sim-job-${jobId}`,
  }));
  return { jobId, records, cursor: 0 };
}

export function createManifestBundle(level: LevelConfig, seed = level.id * 9_973 + 41): ManifestBundle {
  const random = mulberry32(seed);
  const riskStreams: Record<string, RiskStreamState> = {};
  const fixtures: Array<{
    fixture: string;
    trigger: TriggerType;
    rate: number;
    scripted?: readonly BitPair[];
    enabled: boolean;
  }> = [
    {
      fixture: "PULSE",
      trigger: "interaction",
      rate: level.interactionFailureRate,
      scripted: level.features.scriptedPulseRecords ?? (
        level.features.scriptedPulseFirst ? [level.features.scriptedPulseFirst] : []
      ),
      enabled: level.features.interactionRisk,
    },
    {
      fixture: "COUPLE",
      trigger: "interaction",
      rate: level.interactionFailureRate,
      scripted: level.features.scriptedCoupleRecords,
      enabled: level.features.interactionRisk,
    },
    {
      fixture: "READOUT",
      trigger: "interaction",
      rate: level.interactionFailureRate * 0.55,
      scripted: level.features.scriptedReadoutRecords,
      enabled: level.features.interactionRisk,
    },
  ];
  for (const fixture of fixtures) {
    if (!fixture.enabled) continue;
    const stream = makeRiskStream(
      level,
      fixture.fixture,
      fixture.trigger,
      fixture.rate,
      random,
      fixture.scripted,
    );
    riskStreams[stream.address] = stream;
  }
  if (level.features.movementRisk) {
    const fallbackScript = level.features.scriptedMovementRecords ?? (
      level.features.scriptedMovementFirst ? [level.features.scriptedMovementFirst] : []
    );
    const tiles = level.features.movementRiskTiles ?? [
      { position: MOVEMENT_RISK_POSITION, scriptedRecords: fallbackScript },
    ];
    for (const tile of tiles) {
      const stream = makeRiskStream(
        level,
        movementRiskFixture(tile.position),
        "movement",
        level.movementFailureRate,
        random,
        tile.scriptedRecords ?? fallbackScript,
      );
      riskStreams[stream.address] = stream;
    }
  }

  const shotStreams: Record<string, ShotStreamState> = {};
  for (const job of level.jobs) {
    shotStreams[job.id] = makeShotStream(job.id, random);
  }

  return {
    format: "undercooled-manifest-v2",
    seed,
    riskStreams,
    shotStreams,
    lastRisk: null,
    lastShot: null,
  };
}

function fallbackRisk(stream: RiskStreamState, seed: number): RiskRecord {
  const sampleIndex = stream.cursor;
  const random = mulberry32(seed + sampleIndex * 131 + stream.address.length * 17);
  return {
    id: `${stream.address}/fallback/${sampleIndex}`,
    sampleIndex,
    address: stream.address,
    trigger: stream.trigger,
    bits: [bit(random), bit(random)],
    derivation: "prepared-joint",
    source: "simulator",
    circuitId: "simulator-reserve-risk",
  };
}

export function consumeRisk(bundle: ManifestBundle, address: string): RiskRecord | null {
  const stream = bundle.riskStreams[address];
  if (!stream) return null;
  const record = stream.records[stream.cursor] ?? fallbackRisk(stream, bundle.seed);
  stream.cursor += 1;
  bundle.lastRisk = record;
  return record;
}

function fallbackShot(stream: ShotStreamState, seed: number): ShotRecord {
  const sampleIndex = stream.cursor;
  const random = mulberry32(seed + sampleIndex * 197 + stream.jobId.length * 31);
  return {
    id: `${stream.jobId}/fallback/${sampleIndex}`,
    jobId: stream.jobId,
    sampleIndex,
    bits: [bit(random), bit(random)],
    derivation: "circuit-shot",
    source: "simulator",
    circuitId: "simulator-reserve-shot",
  };
}

export function consumeShot(bundle: ManifestBundle, jobId: string): ShotRecord {
  const stream = bundle.shotStreams[jobId];
  if (!stream) {
    const created = makeShotStream(jobId, mulberry32(bundle.seed + jobId.length * 223));
    bundle.shotStreams[jobId] = created;
    return consumeShot(bundle, jobId);
  }
  const record = stream.records[stream.cursor] ?? fallbackShot(stream, bundle.seed);
  stream.cursor += 1;
  bundle.lastShot = record;
  return record;
}

export interface ImportedRiskRecord {
  address: string;
  trigger: TriggerType;
  sampleIndex: number;
  bits: BitPair;
  derivation: Exclude<ManifestDerivation, "circuit-shot">;
  circuitId: string;
  measuredAt: string;
}

export interface ImportedShotRecord {
  jobId: string;
  sampleIndex: number;
  bits: BitPair;
  circuitId: string;
  measuredAt: string;
}

export interface ImportedManifestBundle {
  risks: ImportedRiskRecord[];
  shots: ImportedShotRecord[];
}

function asSource<T extends { source: Provenance }>(record: T): T {
  record.source = "hardware";
  return record;
}

export function importHardwareBundle(bundle: ManifestBundle, imported: ImportedManifestBundle): void {
  const groupedRisks = new Map<string, ImportedRiskRecord[]>();
  for (const record of imported.risks) {
    const group = groupedRisks.get(record.address) ?? [];
    group.push(record);
    groupedRisks.set(record.address, group);
  }
  for (const [address, records] of groupedRisks) {
    const stream = bundle.riskStreams[address];
    if (!stream) continue;
    const hardware = records
      .sort((a, b) => a.sampleIndex - b.sampleIndex)
      .map((record): RiskRecord =>
        asSource({
          id: `${address}/hardware/${record.sampleIndex}`,
          ...record,
          source: "hardware",
        }),
      );
    stream.records.unshift(...hardware);
  }

  const groupedShots = new Map<string, ImportedShotRecord[]>();
  for (const record of imported.shots) {
    const group = groupedShots.get(record.jobId) ?? [];
    group.push(record);
    groupedShots.set(record.jobId, group);
  }
  for (const [jobId, records] of groupedShots) {
    const stream = bundle.shotStreams[jobId];
    if (!stream) continue;
    const hardware = records
      .sort((a, b) => a.sampleIndex - b.sampleIndex)
      .map((record): ShotRecord =>
        asSource({
          id: `${jobId}/hardware/${record.sampleIndex}`,
          ...record,
          derivation: "circuit-shot",
          source: "hardware",
        }),
      );
    stream.records.unshift(...hardware);
  }
}
