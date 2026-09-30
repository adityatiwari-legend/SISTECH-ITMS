/**
 * Human-Readable Junction & Signal Naming for Roadside Devices
 */

export interface JunctionMeta {
  code: string;
  shortId: string;
  name: string;
  fullName: string;
  rawId: string;
}

const GRID_JUNCTIONS: Record<string, { code: string; name: string }> = {
  I1: { code: "I-01", name: "West Commercial Crossing" },
  I2: { code: "I-02", name: "Central Boulevard Hub" },
  I3: { code: "I-03", name: "Medical Center Gateway" },
  I4: { code: "I-04", name: "Hospital Junction" },
  I5: { code: "I-05", name: "Civic Transit Plaza" },
  I6: { code: "I-06", name: "Trauma Base Access" },
  W1: { code: "W-01", name: "EMS Western Staging Depot" },
  W2: { code: "W-02", name: "West Arterial Entry" },
  E1: { code: "E-01", name: "East Expressway Link" },
  E2: { code: "E-02", name: "City Hospital Emergency Base" },
  S1: { code: "S-01", name: "South Industrial Gate" },
  S2: { code: "S-02", name: "Marketplace Crossing" },
  S3: { code: "S-03", name: "Fire Station South Base" },
  N1: { code: "N-01", name: "North Ring Entry" },
  N2: { code: "N-02", name: "North Transit Hub" },
  N3: { code: "N-03", name: "Northeast Arterial" },
  "315577777": { code: "I-01", name: "Link Road Commercial Hub" },
  "315577785": { code: "I-03", name: "Hospital Junction" },
};

const CITY_LANDMARK_POOL = [
  "Hospital Junction",
  "Hamidia Medical Crossing",
  "VIP Boulevard Interchange",
  "Upper Lake Promenade",
  "Central Station Plaza",
  "Polytechnic Square",
  "Bhadbhada Arterial Cross",
  "Link Road Commercial Hub",
  "Arera Hills Gateway",
  "MP Nagar Core Interchange",
  "Shahpura Lake Crossing",
  "New Market Transit Hub",
  "Govindpura Access Square",
  "Vallabh Bhawan Express",
  "Sports Complex Junction",
  "Kolar Road Interchange",
  "Hoshangabad Arterial Link",
  "Ayodhya Bypass Gateway",
  "Bairagarh Express Gate",
  "Airport Link Junction",
];

const dynamicCache = new Map<string, { code: string; name: string }>();
let nextDynamicIndex = 1;

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getJunctionMeta(rawId: string | null | undefined): JunctionMeta {
  if (!rawId) {
    return {
      code: "I-??",
      shortId: "I-??",
      name: "Unassigned Junction",
      fullName: "Unassigned Junction",
      rawId: "—",
    };
  }

  const clean = rawId.trim();
  const upper = clean.toUpperCase();

  if (GRID_JUNCTIONS[upper]) {
    const meta = GRID_JUNCTIONS[upper]!;
    return {
      code: meta.code,
      shortId: meta.code,
      name: meta.name,
      fullName: `${meta.code} · ${meta.name}`,
      rawId: clean,
    };
  }

  if (/^I-0?[1-9]\d?$/i.test(clean)) {
    const num = parseInt(clean.replace(/[^0-9]/g, ""), 10);
    const code = `I-${String(num).padStart(2, "0")}`;
    const name = GRID_JUNCTIONS[`I${num}`]?.name ?? `Intersection ${num}`;
    return {
      code,
      shortId: code,
      name,
      fullName: `${code} · ${name}`,
      rawId: clean,
    };
  }

  if (!dynamicCache.has(clean)) {
    const code = `I-${String(nextDynamicIndex++).padStart(2, "0")}`;
    const hash = hashString(clean);
    const name = CITY_LANDMARK_POOL[hash % CITY_LANDMARK_POOL.length]!;
    dynamicCache.set(clean, { code, name });
  }

  const assigned = dynamicCache.get(clean)!;
  return {
    code: assigned.code,
    shortId: assigned.code,
    name: assigned.name,
    fullName: `${assigned.code} · ${assigned.name}`,
    rawId: clean,
  };
}

export function generateDeviceIdForSignal(signalId: string): string {
  const meta = getJunctionMeta(signalId);
  const normalizedCode = meta.code.replace(/[^a-zA-Z0-9]/g, "");
  return `CRPD-${normalizedCode}-01`;
}

