#!/usr/bin/env node
/**
 * Builds the ITMS SUMO network (itms.net.xml) from the plain XML sources
 * using SUMO's netconvert.
 *
 * Usage: npm run build:network   (from the repository root)
 *
 * Requires SUMO binaries: pip install eclipse-sumo, a SUMO installation with
 * SUMO_HOME set, or SUMO_BINARY pointing to the netconvert executable.
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const networkDir = resolve(scriptDir, "..", "network");
const nodXml = join(networkDir, "itms.nod.xml");
const edgXml = join(networkDir, "itms.edg.xml");
const outXml = join(networkDir, "itms.net.xml");

function resolveNetconvert() {
  if (process.env.SUMO_BINARY && /netconvert/i.test(process.env.SUMO_BINARY)) {
    return process.env.SUMO_BINARY;
  }
  if (process.env.SUMO_HOME) {
    const candidate = join(process.env.SUMO_HOME, "bin", `netconvert${process.platform === "win32" ? ".exe" : ""}`);
    if (existsSync(candidate)) return candidate;
  }
  return "netconvert";
}

function main() {
  for (const required of [nodXml, edgXml]) {
    if (!existsSync(required)) {
      console.error(`Missing network source file: ${required}`);
      process.exitCode = 1;
      return;
    }
  }

  const netconvert = resolveNetconvert();
  const args = [
    "--node-files", nodXml,
    "--edge-files", edgXml,
    "--no-turnarounds", "true",
    "--output-file", outXml,
  ];

  console.log(`Building network with ${netconvert} ...`);
  const result = spawnSync(netconvert, args, { stdio: "inherit", windowsHide: true });

  if (result.error) {
    console.error(
      `Failed to start netconvert (${result.error.message}). ` +
      "Install SUMO (e.g. 'pip install eclipse-sumo'), set SUMO_HOME, or set SUMO_BINARY.",
    );
    process.exitCode = 1;
    return;
  }
  if (result.status !== 0 || !existsSync(outXml)) {
    console.error("netconvert failed; itms.net.xml was not produced.");
    process.exitCode = result.status ?? 1;
    return;
  }
  console.log(`Network built: ${outXml}`);
}

// Remove stale output first so failures cannot leave a misleading old net file.
rmSync(outXml, { force: true });
main();
