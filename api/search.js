// api/search.js
// Vercel Serverless Function — BSM Candidate Live Search
// Queries all 6 pipeline sheets in Smartsheet, filters in-memory, returns merged results.

const SMARTSHEET_API = "https://api.smartsheet.com/2.0";

// The 6 pipeline sheets (funnel stages). A candidate exists in exactly one at a time.
const SHEETS = [
  { id: "2269489626304388", stage: "Recruitment - Newly Registered" },
  { id: "329611896377220", stage: "Recruitment - Online Registration" },
  { id: "5491450611453828", stage: "Recruitment - Screening" },
  { id: "3241937867853700", stage: "Recruitment - Ready to Assess" },
  { id: "7817907694161796", stage: "Recruitment - Assessed" },
  { id: "4234298248875908", stage: "HOTEL GAP POOL" },
];

// Column titles we care about. We resolve these to column IDs per-sheet at runtime
// (titles are consistent across sheets, but IDs differ since they're separate sheets).
const WANTED_COLUMNS = [
  "PIN / CREW ID",
  "FIRST NAME",
  "LAST NAME",
  "GENDER",
  "PHONE",
  "WHATSAPP",
  "EMAIL",
  "PROVINCE",
  "CITY",
  "DEPARTMENT",
  "POSITION",
  "POSITION APPLY",
  "SUGGESTED POSITION",
  "SUGESTED POSITION", // legacy typo present in some sheets — keep as fallback
  "CRUISE EXPERIENCE",
  "CRUISE TYPE",
  "SHIP COMPANY",
  "C1/D EXP DATE",
  "SCHENGEN EXP DATE",
  "AVAILABILITY DATE",
  "CREW POOL STATUS",
];

// In-memory cache for column maps (resets on cold start — fine for this use case)
const columnMapCache = {};
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getToken() {
  const token = process.env.SMARTSHEET_API_TOKEN;
  if (!token) throw new Error("SMARTSHEET_API_TOKEN not set");
  return token;
}

async function getColumnMap(sheetId) {
  const cached = columnMapCache[sheetId];
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.map;

  const res = await fetch(`${SMARTSHEET_API}/sheets/${sheetId}/columns?includeAll=true`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch columns for sheet ${sheetId}: ${res.status}`);
  const data = await res.json();

  const map = {}; // title (upper) -> column id
  for (const col of data.data) {
    map[col.title.trim().toUpperCase()] = col.id;
  }
  columnMapCache[sheetId] = { map, time: Date.now() };
  return map;
}

function resolveWantedColumnIds(colMap) {
  const ids = [];
  const idToTitle = {};
  for (const title of WANTED_COLUMNS) {
    const id = colMap[title.toUpperCase()];
    if (id && !ids.includes(id)) {
      ids.push(id);
      idToTitle[id] = title.toUpperCase();
    }
  }
  return { ids, idToTitle };
}

async function fetchSheetRows(sheetId, columnIds) {
  const url = `${SMARTSHEET_API}/sheets/${sheetId}?columnIds=${columnIds.join(",")}&pageSize=5000`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(`Failed to fetch sheet ${sheetId}: ${res.status}`);
  return res.json();
}

function cellValue(row, colId) {
  const cell = row.cells.find((c) => c.columnId === colId);
  if (!cell) return null;
  // MULTI_PICKLIST values sometimes arrive as arrays in cell.value or displayValue
  return cell.displayValue ?? cell.value ?? null;
}

function rowToCandidate(row, idToTitle, stage) {
  const c = {};
  for (const [colId, titleUpper] of Object.entries(idToTitle)) {
    c[titleUpper] = cellValue(row, Number(colId));
  }
  return {
    pin: c["PIN / CREW ID"] || "",
    firstName: c["FIRST NAME"] || "",
    lastName: c["LAST NAME"] || "",
    gender: c["GENDER"] || "",
    phone: c["PHONE"] || "",
    whatsapp: c["WHATSAPP"] || "",
    email: c["EMAIL"] || "",
    province: c["PROVINCE"] || "",
    city: c["CITY"] || "",
    department: c["DEPARTMENT"] || "",
    position: c["POSITION"] || c["POSITION APPLY"] || c["SUGGESTED POSITION"] || c["SUGESTED POSITION"] || "",
    cruiseExperience: c["CRUISE EXPERIENCE"] || "",
    cruiseType: c["CRUISE TYPE"] || "",
    shipCompany: c["SHIP COMPANY"] || "",
    c1dExpDate: c["C1/D EXP DATE"] || "",
    schengenExpDate: c["SCHENGEN EXP DATE"] || "",
    availabilityDate: c["AVAILABILITY DATE"] || "",
    crewPoolStatus: c["CREW POOL STATUS"] || "",
    stage,
  };
}

function matchesFilters(candidate, filters) {
  const { position, cruiseExperience, cruiseType, province, c1dExpAfter, schengenExpAfter } = filters;

  if (position && !String(candidate.position).toUpperCase().includes(position.toUpperCase())) return false;
  if (cruiseExperience && String(candidate.cruiseExperience).toUpperCase() !== cruiseExperience.toUpperCase()) return false;
  if (cruiseType && String(candidate.cruiseType).toUpperCase() !== cruiseType.toUpperCase()) return false;
  if (province && String(candidate.province).toUpperCase() !== province.toUpperCase()) return false;

  // Expiry filters: "valid until at least X" i.e. exp date >= given date
  if (c1dExpAfter) {
    if (!candidate.c1dExpDate) return false;
    if (new Date(candidate.c1dExpDate) < new Date(c1dExpAfter)) return false;
  }
  if (schengenExpAfter) {
    if (!candidate.schengenExpDate) return false;
    if (new Date(candidate.schengenExpDate) < new Date(schengenExpAfter)) return false;
  }

  return true;
}

export default async function handler(req, res) {
  // Basic shared-password gate for internal team use
  const accessKey = req.headers["x-access-key"];
  if (!process.env.ACCESS_PASSWORD || accessKey !== process.env.ACCESS_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const filters = {
      position: req.query.position || "",
      cruiseExperience: req.query.cruiseExperience || "",
      cruiseType: req.query.cruiseType || "",
      province: req.query.province || "",
      c1dExpAfter: req.query.c1dExpAfter || "",
      schengenExpAfter: req.query.schengenExpAfter || "",
    };
    const stageFilter = req.query.stage || ""; // filter sheet asal (opsional)

    const results = [];
    const sheetsToQuery = stageFilter
      ? SHEETS.filter((s) => s.stage.toUpperCase() === stageFilter.toUpperCase())
      : SHEETS;

    await Promise.all(
      sheetsToQuery.map(async ({ id, stage }) => {
        const colMap = await getColumnMap(id);
        const { ids, idToTitle } = resolveWantedColumnIds(colMap);
        if (ids.length === 0) return;
        const sheetData = await fetchSheetRows(id, ids);
        for (const row of sheetData.rows || []) {
          const candidate = rowToCandidate(row, idToTitle, stage);
          if (!candidate.pin && !candidate.firstName) continue; // skip empty rows
          if (matchesFilters(candidate, filters)) results.push(candidate);
        }
      })
    );

    res.status(200).json({ count: results.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
