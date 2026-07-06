// api/district.js
// ─────────────────────────────────────────────────────────────────
// GET /api/district
//
// Returns district-level KPI summary:
// - Total schools assessed (April + May)
// - District average % (overall, literacy, numeracy)
// - Month-over-month change
// - Competency averages for both months
// ─────────────────────────────────────────────────────────────────

const {
  fetchSheet,
  toFloat,
  toInt,
  jsonResponse,
  errorResponse,
} = require("./_lib/fetchSheet");

// Sheet GIDs from your workbook
const GID = {
  compAverages: "1773715947",
  blockSummary: "744899508",
  aprData:      "976222389",
  mayData:      "1211065548",
};

// Competency codes — matches your sheet column headers exactly
const LIT_CODES = [
  "H104.2", "H106.1", "H108.1", "H202.2",
  "H106.2", "H108.3", "H208",   "H211", "H301",
];
const NUM_CODES = [
  "M 101.1 (A)", "M 101.1 (B)", "M101.2",
  "M102.1",       "M102.3",       "M201.2",
  "M201.3",       "M103.1/M103.2","M205.1",
  "M207.1",       "M301.1",       "M301.2",
  "M301.4",       "M302.1",
];
const ALL_CODES = [...LIT_CODES, ...NUM_CODES];

module.exports = async function handler(req, res) {
  // Only allow GET
  if (req.method !== "GET") {
    return errorResponse(res, "Method not allowed", 405);
  }

  try {
    // ── 1. Fetch Comp_Averages sheet ──────────────────────────────
    // Rows look like: Competency | Desc | Grade | Subject | April Avg | May Avg | Change pp | % Change | Rank
    const compRows = await fetchSheet(GID.compAverages);

    // Skip any header/title rows (they have empty or non-code first column)
    const validCompRows = compRows.filter(
      (r) => r["Competency"] && r["Competency"].trim().length > 2
    );

    // Build competency list
    const competencies = validCompRows.map((r) => ({
      code:      (r["Competency"]  || "").trim(),
      desc:      (r["Desc"]        || r["Description"] || "").trim(),
      grade:     (r["Grade"]       || "").trim(),
      subject:   (r["Subject"]     || "").trim(),
      aprAvg:    toFloat(r["April Avg"] || r["Apr Avg"] || r["April Overall Avg"]),
      mayAvg:    toFloat(r["May Avg"]   || r["May Overall Avg"]),
      changePP:  toFloat(r["Change pp"] || r["Change PP"]),
      rank:      toInt(r["Rank"]),
    }));

    // ── 2. District-level subject averages ────────────────────────
    const litComps = competencies.filter((c) =>
      c.subject === "Literacy" || LIT_CODES.includes(c.code)
    );
    const numComps = competencies.filter((c) =>
      c.subject === "Numeracy" || NUM_CODES.includes(c.code)
    );

    const avg = (arr, key) => {
      const vals = arr.map((c) => c[key]).filter((v) => v !== null && !isNaN(v));
      return vals.length ? parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2)) : null;
    };

    const districtAprAvg = avg(competencies, "aprAvg");
    const districtMayAvg = avg(competencies, "mayAvg");
    const districtChange =
      districtMayAvg !== null && districtAprAvg !== null
        ? parseFloat((districtMayAvg - districtAprAvg).toFixed(2))
        : null;

    // ── 3. Fetch Block dashboard sheet for school counts ─────────
    const blockRows = await fetchSheet(GID.blockSummary);
    const validBlocks = blockRows.filter((r) => r["Block"] && r["Block"].trim());

    // Total schools
    const totalApr = validBlocks.reduce((s, r) => s + (toInt(r["N Apr"]) || 0), 0);
    const totalMay = validBlocks.reduce((s, r) => s + (toInt(r["N May"]) || 0), 0);

    // Best and worst blocks
    const blocksSorted = validBlocks
      .map((r) => ({
        block:    r["Block"].trim(),
        aprAvg:   toFloat(r["Apr Overall Avg"] || r["Apr Avg"]),
        mayAvg:   toFloat(r["May Overall Avg"] || r["May Avg"]),
        changePP: toFloat(r["Change pp"]       || r["Change PP"]),
        rank:     toInt(r["Rank (May)"]        || r["Rank"]),
      }))
      .filter((b) => b.mayAvg !== null)
      .sort((a, b) => (a.rank || 99) - (b.rank || 99));

    const topBlock    = blocksSorted[0]   || null;
    const bottomBlock = blocksSorted[blocksSorted.length - 1] || null;
    const mostImproved = [...blocksSorted].sort(
      (a, b) => (b.changePP || 0) - (a.changePP || 0)
    )[0] || null;

    // ── 4. Auto-generate insights ─────────────────────────────────
    const insights = [];

    if (districtChange !== null) {
      const direction = districtChange >= 0 ? "improved" : "declined";
      insights.push(
        `District average ${direction} by ${Math.abs(districtChange).toFixed(2)}pp from April to May.`
      );
    }
    if (mostImproved) {
      insights.push(
        `${mostImproved.block} recorded the highest block-level improvement: +${(mostImproved.changePP || 0).toFixed(2)}pp.`
      );
    }
    if (bottomBlock) {
      insights.push(
        `${bottomBlock.block} has the lowest May average at ${(bottomBlock.mayAvg || 0).toFixed(1)}% — priority block for intervention.`
      );
    }
    const lowestComp = [...competencies]
      .filter((c) => c.mayAvg !== null)
      .sort((a, b) => a.mayAvg - b.mayAvg)[0];
    if (lowestComp) {
      insights.push(
        `${lowestComp.desc || lowestComp.code} (${lowestComp.code}) is the weakest competency district-wide at ${lowestComp.mayAvg.toFixed(1)}%.`
      );
    }
    const topComp = [...competencies]
      .filter((c) => c.changePP !== null)
      .sort((a, b) => b.changePP - a.changePP)[0];
    if (topComp) {
      insights.push(
        `${topComp.desc || topComp.code} showed the largest improvement: +${(topComp.changePP || 0).toFixed(2)}pp.`
      );
    }

    // ── 5. Build and return response ──────────────────────────────
    return jsonResponse(res, {
      summary: {
        months:          ["April", "May"],
        totalBlocks:     validBlocks.length,
        schoolsApril:    totalApr,
        schoolsMay:      totalMay,
        districtAprAvg,
        districtMayAvg,
        districtChangePP: districtChange,
        literacyAprAvg:  avg(litComps, "aprAvg"),
        literacyMayAvg:  avg(litComps, "mayAvg"),
        numeracyAprAvg:  avg(numComps, "aprAvg"),
        numeracyMayAvg:  avg(numComps, "mayAvg"),
        topBlock,
        bottomBlock,
        mostImproved,
      },
      competencies,
      insights,
    });
  } catch (err) {
    console.error("[/api/district] Error:", err.message);
    return errorResponse(res, err.message);
  }
};