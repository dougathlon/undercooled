import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

interface PngContract {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly rgba: boolean;
}

const contracts: readonly PngContract[] = [
  { path: "public/assets/environment/undercooled-workshop-shell-v3.png", width: 1_600, height: 900, rgba: false },
  ...["worker-a", "worker-b"].flatMap((worker) =>
    Array.from({ length: 5 }, (_, index) => ({
      path: `public/assets/characters-v4/${worker}-frames/${String(index + 1).padStart(2, "0")}.png`,
      width: 384,
      height: 384,
      rgba: true,
    })),
  ),
  ...["submit", "prep", "pulse", "couple", "readout"].map((station) => ({
    path: `public/assets/stations-v3/${station}.png`,
    width: 256,
    height: 192,
    rgba: true,
  })),
  ...[
    "pulse-h",
    "pulse-x",
    "pulse-p",
    "coupling-half",
    "empty-canister",
    "result-canister",
    "coolant-cell",
  ].map((item) => ({
    path: `public/assets/items-v3/${item}.png`,
    width: 128,
    height: 128,
    rgba: true,
  })),
  { path: "public/assets/tools-v3/cryo-lance.png", width: 192, height: 192, rgba: true },
] as const;

function readPng(contract: PngContract): Buffer {
  return readFileSync(resolve(process.cwd(), contract.path));
}

describe("v0.4 demo visual asset contract", () => {
  test.each(contracts)("$path has the expected PNG dimensions and color type", (contract) => {
    const bytes = readPng(contract);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(contract.width);
    expect(bytes.readUInt32BE(20)).toBe(contract.height);
    expect(bytes[25]).toBe(contract.rgba ? 6 : 2);
  });

  test("the complete runtime art set stays within a phone-conscious budget", () => {
    const totalBytes = contracts.reduce((total, contract) => total + readPng(contract).byteLength, 0);
    expect(totalBytes).toBeLessThan(8 * 1_024 * 1_024);
  });
});
