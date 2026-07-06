// api/schools.js
// ─────────────────────────────────────────────────────────────────
// GET /api/schools?month=May              ← paginated school list
// GET /api/schools?month=May&page=2       ← page 2 (50 per page)
// GET /api/schools?month=May&block=Chargawan
// GET /api/schools?month=May&udise=09580803702
// GET /api/schools?month=May&priority=High
// GET /api/schools?month=May&category=Saksham
//
// Categories: Saksham | Madhyam | Pragatisheel | Zero
// Priority:   High (<40%) | Medium (40-60%) | Low (>60%)
// ─────────────────────────────────────────────────────────────────

const {
  fetchSheet,
  toFloat,
  toInt,
  jsonResponse,
  errorResponse,
} = require("./_lib/fetchSheet");

const GID = {
  aprData: "976222389",
  mayData: "1211065548",
};

const LIT_CODES = ["H104.2","H106.1","H108.1","H202.2","H106.2","H108.3","H208","H211","H301"];
const NUM_CODES = [
  "M 101.1 (A)","M 101.1 (B)","M101.2","M102.1","M102.3",
  "M201.2","M201.3","M103.1/M103.2","M205.1","M207.1",
  "M301.1","M301.2","M301.4","M302.1",
];
const ALL_CODES = [...LIT_CODES, ...NUM_CODES];

const PAGE_SIZE = 50;

// ── Category logic (your exact definitions) ───────────────────────
function categorize(litAvg, numAvg) {
  if (litAvg === null || numAvg === null) return "Unassessed";
  if (litAvg === 0 || numAvg === 0)       return "Zero";
  if (litAvg >= 75 && numAvg >= 75)       return "Saksham";
  if (litAvg >= 50 || numAvg >= 50)       return "Madhyam";
  return "Pragatisheel";
}

function priority(overallAvg) {
  if (overallAvg === null) return "Unassessed";
  if (overallAvg < 40)    return "High";
  if (overallAvg <= 60)   return "Medium";
  return "Low";
}

function parseSchoolRow(r) {
  const udise  = String(r["UDISE_SchoolCode"] || r["UDISE"] || "").replace(/\.0$/, "").trim();
  const block  = (r["Block  Name"] || r["Block Name"] || r["Block"] || "").trim();
  const school = (r["School_Name"]  || r["School Name"]  || "").trim();
  const total  = toInt(r["Total"]) || 0;

  if (!udise || !school) return null;

  const scores = {};
  ALL_CODES.forEach((c) => { scores[c] = toFloat(r[c]); });

  const litVals = LIT_CODES.map((c) => scores[c]).filter((v) => v !== null);
  const numVals = NUM_CODES.map((c) => scores[c]).filter((v) => v !== null);
  const allVals = [...litVals, ...numVals];
  const a = (arr) =>
    arr.length ? parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2)) : null;

  const litAvg     = a(litVals);
  const numAvg     = a(numVals);
  const overallAvg = a(allVals);

  // Focus competency = lowest scoring
  const scoredComps = ALL_CODES
    .map((c) => ({ code: c, val: scores[c] }))
    .filter((x) => x.val !== null)
    .sort((a, b) => a.val - b.val);

  const focusComp = scoredComps[0] || null;

  return {
    udise,
    school,
    block,
    total,
    litAvg,
    numAvg,
    overallAvg,
    category: categorize(litAvg, numAvg),
    priority: priority(overallAvg),
    focusCompCode: focusComp?.code  || null,
    focusCompVal:  focusComp?.val   || null,
    scores,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return errorResponse(res, "Method not allowed", 405);

  try {
    const {
      month    = "May",
      block    = "",
      udise    = "",
      priority: pri = "",
      category = "",
      page     = "0",
      search   = "",
    } = req.query;

    const gid = month.toLowerCase() === "april" ? GID.aprData : GID.mayData;
    const rows = await fetchSheet(gid);

    // ── Parse all rows ────────────────────────────────────────────
    let schools = rows
      .map(parseSchoolRow)
      .filter(Boolean);

    // ── Also fetch the other month for change calculation ─────────
    const otherGid   = month.toLowerCase() === "april" ? GID.mayData : GID.aprData;
    const otherRows  = await fetchSheet(otherGid);
    const otherMap   = {};
    otherRows.forEach((r) => {
      const u = String(r["UDISE_SchoolCode"] || r["UDISE"] || "").replace(/\.0$/, "").trim();
      if (u) otherMap[u] = r;
    });

    schools = schools.map((s) => {
      const other = otherMap[s.udise];
      if (!other) return { ...s, changePP: null };
      const otherParsed = parseSchoolRow(other);
      const changePP =
        s.overallAvg !== null && otherParsed?.overallAvg !== null
          ? parseFloat((s.overallAvg - (otherParsed?.overallAvg || 0)).toFixed(2))
          : null;
      return { ...s, changePP };
    });

    // ── Apply filters ─────────────────────────────────────────────
    if (block)    schools = schools.filter((s) => s.block.toLowerCase()    === block.toLowerCase());
    if (udise)    schools = schools.filter((s) => s.udise                  === udise.trim());
    if (pri)      schools = schools.filter((s) => s.priority.toLowerCase() === pri.toLowerCase());
    if (category) schools = schools.filter((s) => s.category.toLowerCase() === category.toLowerCase());
    if (search) {
      const q = search.toLowerCase();
      schools = schools.filter(
        (s) => s.school.toLowerCase().includes(q) || s.udise.includes(q) || s.block.toLowerCase().includes(q)
      );
    }

    // ── Distribution counts ───────────────────────────────────────
    const distribution = {
      Saksham:     schools.filter((s) => s.category === "Saksham").length,
      Madhyam:     schools.filter((s) => s.category === "Madhyam").length,
      Pragatisheel:schools.filter((s) => s.category === "Pragatisheel").length,
      Zero:        schools.filter((s) => s.category === "Zero").length,
      Unassessed:  schools.filter((s) => s.category === "Unassessed").length,
    };

    const priorityCounts = {
      High:   schools.filter((s) => s.priority === "High").length,
      Medium: schools.filter((s) => s.priority === "Medium").length,
      Low:    schools.filter((s) => s.priority === "Low").length,
    };

    // ── Pagination ────────────────────────────────────────────────
    // If UDISE query → return single school with full scores
    if (udise) {
      return jsonResponse(res, { month, schools, total: schools.length });
    }

    const pageNum  = Math.max(0, parseInt(page, 10) || 0);
    const total    = schools.length;
    const start    = pageNum * PAGE_SIZE;
    const pageData = schools.slice(start, start + PAGE_SIZE);

    // Strip full scores from list view (saves bandwidth)
    const slimPage = pageData.map(({ scores, ...rest }) => rest);

    return jsonResponse(res, {
      month,
      total,
      page:     pageNum,
      pageSize: PAGE_SIZE,
      pages:    Math.ceil(total / PAGE_SIZE),
      distribution,
      priorityCounts,
      schools: slimPage,
    });
  } catch (err) {
    console.error("[/api/schools] Error:", err.message);
    return errorResponse(res, err.message);
  }
};