/**
 * ITMS Human-Readable Naming System
 *
 * Transforms raw SUMO identifiers (numeric OSM nodes, cluster strings, synthetic IDs)
 * into clean, professional, municipal operations labels.
 *
 * Example:
 * Raw: "315577777" or "I4"
 * Primary: "I-04 Hospital Junction"
 * Secondary: "SUMO ID: 315577777"
 */

export interface JunctionMeta {
  code: string;       // e.g. "I-04"
  shortId: string;    // e.g. "I-04"
  name: string;       // e.g. "Hospital Junction"
  fullName: string;   // e.g. "I-04 · Hospital Junction"
  rawId: string;      // e.g. "315577777"
}

export interface RoadMeta {
  name: string;       // e.g. "Hospital Access Boulevard"
  fullName: string;   // e.g. "Hospital Access Boulevard (SUMO: E_W1_I1)"
  rawId: string;
}

// Curated municipal landmark names for known synthetic grid nodes
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
};

// Realistic municipal street names for deterministic assignment to OSM city nodes
const CITY_LANDMARK_POOL = [
  "Hamidia Hospital Junction",
  "AIIMS Bhopal Medical Hub",
  "VIP Boulevard Interchange",
  "Upper Lake Promenade",
  "Central Station North Plaza",
  "Polytechnic Square",
  "Bhadbhada Arterial Cross",
  "Link Road Commercial Hub",
  "Arera Hills Gateway",
  "MP Nagar Zone-1 Interchange",
  "Shahpura Lake Crossing",
  "New Market Transit Hub",
  "Govindpura Industrial Access",
  "Vallabh Bhawan Express",
  "TT Nagar Stadium Junction",
  "Kolar Road Interchange",
  "Hoshangabad Arterial Link",
  "Ayodhya Bypass Gateway",
  "Bairagarh Express Gate",
  "Raja Bhoj Airport Link",
  "Van Vihar South Gate",
  "Chunabhatti Commercial Square",
  "Bittan Market Crossing",
  "Malviya Nagar Plaza",
  "Jawahar Chowk Hub",
  "Roshanpura Intersection",
  "Lily Cinema Crossing",
  "Kamla Park Gateway",
  "Motia Talab Promenade",
  "Karond Mandi Junction",
  "Bhanpur Bypass Link",
  "Misrod Expressway Crossing",
  "Mandideep Arterial Gate",
  "Barkatullah University Square",
  "BHEL Jubilee Gate",
  "Awadhpuri Main Junction",
  "Khajuri Kalan Crossing",
  "Gandhi Nagar Airport Link",
  "Lalghati Commercial Circle",
  "Peer Gate Old City Hub",
  "Moti Masjid Heritage Crossing",
  "Taj-ul-Masajid Boulevard",
  "Idgah Hills Observatory Way",
  "MANIT Engineering Gateway",
  "SISTech Campus Crossing",
  "Neelbad Arterial Junction",
  "Ratibad Rural Arterial",
  "RRL Research Crossing",
  "Bagsewaniya Commercial Hub",
  "Katara Hills Express Link",
  "Salaiya Extension Crossing",
  "Gulmohar Colony Square",
  "Indrapuri Sector-C Cross",
  "Piplani Central Interchange",
  "Ayodhya Nagar Commercial Hub",
  "Ashoka Garden Circle",
  "Subhash Nagar Overbridge",
  "Prabhat Square Interchange",
  "Pul Bogda Junction",
  "Aishbagh Stadium Gate",
  "Jahangirabad Police Square",
  "Kohefiza Medical Circle",
  "Berasia Road Arterial",
  "Raisen Road Industrial Link",
  "Sehore Highway Bypass",
  "Chhola Mandir Crossing",
];

const SUFFIX_POOL = [
  "North Junction",
  "South Crossing",
  "East Approach",
  "West Link",
  "Central Interchange",
  "Flyover Approach",
  "Sector Gate",
];

// In-memory cache for deterministic OSM ID mapping
const dynamicCache = new Map<string, { code: string; name: string }>();
const nameUsageCount = new Map<string, number>();
let nextDynamicIndex = 1;

/** Hash string to integer */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Returns human-readable metadata for any junction ID (synthetic grid or OSM city node).
 */
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

  // 1. Check known grid junctions
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

  // 2. Check if already formatted like "I-04"
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

  // 3. Deterministic mapping for OSM / city / arbitrary nodes
  if (!dynamicCache.has(clean)) {
    const code = `I-${String(nextDynamicIndex++).padStart(2, "0")}`;
    const hash = hashString(clean);
    const baseName = CITY_LANDMARK_POOL[hash % CITY_LANDMARK_POOL.length]!;
    const usage = nameUsageCount.get(baseName) ?? 0;
    nameUsageCount.set(baseName, usage + 1);

    let finalName = baseName;
    if (usage > 0) {
      const suffix = SUFFIX_POOL[(usage - 1) % SUFFIX_POOL.length]!;
      finalName = `${baseName} — ${suffix}`;
    }
    dynamicCache.set(clean, { code, name: finalName });
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

/**
 * Returns just the short human-readable name, e.g. "I-04 Hospital Junction"
 */
export function formatJunction(rawId: string | null | undefined): string {
  const meta = getJunctionMeta(rawId);
  return meta.fullName;
}

/**
 * Returns human-readable road/segment name.
 */
export function getRoadMeta(rawId: string | null | undefined): RoadMeta {
  if (!rawId) {
    return { name: "Local Road", fullName: "Local Road", rawId: "—" };
  }

  const clean = rawId.trim();

  // Synthetic edge names like "E_W1_I1" or "E_I1_I2"
  if (clean.startsWith("E_")) {
    const parts = clean.split("_");
    if (parts.length >= 3) {
      const from = getJunctionMeta(parts[1]).code;
      const to = getJunctionMeta(parts[2]).code;
      const name = `${from} → ${to} Corridor Link`;
      return { name, fullName: `${name} (SUMO: ${clean})`, rawId: clean };
    }
  }

  // City road names or OSM IDs
  const hash = hashString(clean);
  const roadNames = [
    "Hospital Access Boulevard",
    "Central City Arterial",
    "Grand Ring Expressway",
    "Medical Corridor Link",
    "Transit Express Link",
    "Civic Center Avenue",
    "Parkway Perimeter",
    "Bypass Connector",
  ];
  const name = roadNames[hash % roadNames.length]!;
  return {
    name,
    fullName: `${name} (SUMO: ${clean})`,
    rawId: clean,
  };
}

/**
 * Returns clean human-readable vehicle label.
 * e.g. "Ambulance EMV-26" instead of "emergency.ambulance.1"
 */
export function getVehicleDisplay(vehicleId: string | null | undefined, type?: string): string {
  if (!vehicleId) return "Emergency Unit";

  const upper = vehicleId.toUpperCase();
  if (upper.includes("EMV") || upper.includes("AMBULANCE")) {
    const num = vehicleId.replace(/\D/g, "") || "26";
    return `🚑 Ambulance EMV-${num}`;
  }
  if (upper.includes("FIRE")) {
    const num = vehicleId.replace(/\D/g, "") || "04";
    return `🚒 Fire Engine FE-${num}`;
  }
  if (upper.includes("POLICE")) {
    const num = vehicleId.replace(/\D/g, "") || "12";
    return `🚓 Police Cruiser PC-${num}`;
  }

  if (type === "ambulance") return `🚑 Ambulance ${vehicleId}`;
  if (type === "fire_engine") return `🚒 Fire Engine ${vehicleId}`;
  if (type === "police") return `🚓 Police Unit ${vehicleId}`;

  return `Vehicle ${vehicleId}`;
}
