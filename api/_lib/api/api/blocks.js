// api/blocks.js
// ─────────────────────────────────────────────────────────────────
// GET /api/blocks
// GET /api/blocks?block=Chargawan        ← single block detail
//
// Returns block-wise performance table including:
// - April + May averages per block
// - Change in pp
// - Ranking (performance + improvement)
// - Per-competency averages from Block_Pivot sheet
// ─────────────────────────────────────────────────────────────────

const {
  fetchSheet,
  toFloat,
  toInt,
  jsonResponse,
  errorResponse,
} = require("./_lib/fetchSheet");

const GID = {
  blockSummary: "744899508",
  mayData:      "1211065548",
  aprData:      "976222389",
};

const ALL_COMP_CODES = [
  "H104.2","H106.1","H108.1","M 101.1 (A)","M 101.1 (B)",
  "M101.2","M102.1","M102.3","H202.2","H106.2","H108.3",
  "M201.2","M201.3","M103.1/M103.2","M205.1","M207.1",
  "H208","H211","M301.1","M301.2","M301.4","M302.1","H301",
];
const LIT_CODES = ["H104.2","H106.1","H108.1","H202.2","H106.2","H108.3","H208","H211","H301"];
const NUM_CODES = ALL_COMP_CODES.filter((c) => !LIT_CODES.includes(c));

// Build block-level averages directly from school data
function computeBlockAvgsFromSchools(schoolRows, compCodes) {
  const blockMap = {};

  for (const row of schoolRows) {
    const block = (row["Block  Name"] || row["Block Name"] || row["Block"] || "").trim();
    if (!block) continue;

    if (!blockMap[block]) {
      blockMap[block] = { schools: 0, students: 0, compSums: {}, compCounts: {} };
      compCodes.forEach((c) => { blockMap[block].compSums[c] = 0; blockMap[block].compCounts[c] = 0; });
    }

    blockMap[block].schools++;
    blockMap[block].students += toInt(row["Total"]) || 0;

    compCodes.forEach((c) => {
      const v = toFloat(row[c]);
      if (v !== null) {
        blockMap[block].compSums[c]   += v;
        blockMap[block].compCounts[c] += 1;
      }
    });
  }

  // Convert sums → averages
  const result = {};
  for (const [block, data] of Object.entries(blockMap)) {
    result[block] = {
      schools:  data.schools,
      students: data.students,
      comps:    {},
    };
    compCodes.forEach((c) => {
      const cnt = data.compCounts[c];
      result[block].comps[c] = cnt > 0 ? parseFloat((data.compSums[c] / cnt).toFixed(2)) : null;
    });
    // Literacy, Numeracy, Overall averages
    const litVals = LIT_CODES.map((c) => result[block].comps[c]).filter((v) => v !== null);
    const numVals = NUM_CODES.map((c) => result[block].comps[c]).filter((v) => v !== null);
    const allVals = [...litVals, ...numVals];
    const a = (arr) => arr.length ? parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2)) : null;
    result[block].litAvg = a(litVals);
    result[block].numAvg = a(numVals);
    result[block].overallAvg = a(allVals);
  }
  return result;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return errorResponse(res, "Method not allowed", 405);

  try {
    const filterBlock = (req.query.block || "").trim();

    // ── 1. Fetch Block_Summary sheet ──────────────────────────────
    const summaryRows = await fetchSheet(GID.blockSummary);
    const validSummary = summaryRows.filter((r) => r["Block"] && r["Block"].trim().length > 1);

    // ── 2. Fetch April + May school data for live block averages ──
    const [aprRows, mayRows] = await Promise.all([
      fetchSheet(GID.aprData),
      fetchSheet(GID.mayData),
    ]);

    const aprSchoolRows = aprRows.filter((r) => r["UDISE_SchoolCode"] || r["UDISE"]);
    const maySchoolRows = mayRows.filter((r) => r["UDISE_SchoolCode"] || r["UDISE"]);

    const aprBlockAvgs = computeBlockAvgsFromSchools(aprSchoolRows, ALL_COMP_CODES);
    const mayBlockAvgs = computeBlockAvgsFromSchools(maySchoolRows, ALL_COMP_CODES);

    // ── 3. Merge summary sheet + live block avgs ──────────────────
    const allBlocks = Array.from(
      new Set([
        ...validSummary.map((r) => r["Block"].trim()),
        ...Object.keys(mayBlockAvgs),
      ])
    );

    let blocks = allBlocks.map((block) => {
      const sum  = validSummary.find((r) => r["Block"].trim() === block) || {};
      const aprB = aprBlockAvgs[block] || {};
      const mayB = mayBlockAvgs[block] || {};

      const aprAvg  = toFloat(sum["Apr Overall Avg"] || sum["Apr Avg"]) ?? aprB.overallAvg;
      const mayAvg  = toFloat(sum["May Overall Avg"] || sum["May Avg"]) ?? mayB.overallAvg;
      const changePP = (aprAvg !== null && mayAvg !== null)
        ? parseFloat((mayAvg - aprAvg).toFixed(2))
        : null;

      return {
        block,
        nApr:       toInt(sum["N Apr"]) ?? aprB.schools ?? 0,
        nMay:       toInt(sum["N May"]) ?? mayB.schools ?? 0,
        aprAvg,
        mayAvg,
        changePP,
        rankMay:    toInt(sum["Rank (May)"] || sum["Rank"]),
        rankImprov: toInt(sum["Rank (Improv)"] || sum["Rank (Improvement)"]),
        litAvgMay:  mayB.litAvg   ?? null,
        numAvgMay:  mayB.numAvg   ?? null,
        // Per-competency averages for the heatmap
        compsMay: mayB.comps ?? {},
        compsApr: aprB.comps ?? {},
      };
    }).filter((b) => b.block.length > 1);

    // If querying a single block, return detailed school list too
    if (filterBlock) {
      const blockDetail = blocks.find(
        (b) => b.block.toLowerCase() === filterBlock.toLowerCase()
      );
      if (!blockDetail) {
        return errorResponse(res, `Block "${filterBlock}" not found`, 404);
      }

      // Schools for this block
      const schools = maySchoolRows
        .filter((r) => {
          const b = (r["Block  Name"] || r["Block Name"] || "").trim();
          return b.toLowerCase() === filterBlock.toLowerCase();
        })
        .map((r) => {
          const udise  = String(r["UDISE_SchoolCode"] || r["UDISE"] || "").replace(".0","").trim();
          const school = (r["School_Name"] || r["School Name"] || "").trim();
          const total  = toInt(r["Total"]) || 0;
          const comps  = {};
          ALL_COMP_CODES.forEach((c) => { comps[c] = toFloat(r[c]); });
          const litVals = LIT_CODES.map((c) => comps[c]).filter((v) => v !== null);
          const numVals = NUM_CODES.map((c) => comps[c]).filter((v) => v !== null);
          const a = (arr) => arr.length ? parseFloat((arr.reduce((s,v)=>s+v,0)/arr.length).toFixed(2)) : null;
          return {
            udise, school, total,
            litAvg: a(litVals),
            numAvg: a(numVals),
            overallAvg: a([...litVals,...numVals]),
            scores: comps,
          };
        })
        .sort((a, b) => (b.overallAvg || 0) - (a.overallAvg || 0));

      return jsonResponse(res, { block: blockDetail, schools });
    }

    // ── 4. Sort by May rank and return ────────────────────────────
    blocks.sort((a, b) => (a.rankMay || 99) - (b.rankMay || 99));

    const totalSchools = blocks.reduce((s, b) => s + b.nMay, 0);
    const districtAvgMay = parseFloat(
      (blocks.filter((b) => b.mayAvg !== null)
        .reduce((s, b) => s + b.mayAvg, 0) /
       blocks.filter((b) => b.mayAvg !== null).length
      ).toFixed(2)
    );

    return jsonResponse(res, {
      totalBlocks: blocks.length,
      totalSchoolsMay: totalSchools,
      districtAvgMay,
      blocks,
    });
  } catch (err) {
    console.error("[/api/blocks] Error:", err.message);
    return errorResponse(res, err.message);
  }
};