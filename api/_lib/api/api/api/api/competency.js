// api/competency.js
// ─────────────────────────────────────────────────────────────────
// GET /api/competency                 ← all competency data
// GET /api/competency?subject=Literacy
// GET /api/competency?subject=Numeracy
// GET /api/competency?grade=G1
//
// Returns:
// - Competency averages (April + May + change)
// - Zero scorer analysis
// - Score band distribution
// - Top 5 / Bottom 5
// ─────────────────────────────────────────────────────────────────

const {
  fetchSheet,
  toFloat,
  toInt,
  jsonResponse,
  errorResponse,
} = require("./_lib/fetchSheet");

const GID = {
  compAverages:    "1773715947",
  distribution:    "996877891",
  zeroScorers:     "781298126",
};

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return errorResponse(res, "Method not allowed", 405);

  try {
    const { subject = "", grade = "" } = req.query;

    // ── 1. Fetch all three sheets in parallel ─────────────────────
    const [compRows, distRows, zeroRows] = await Promise.all([
      fetchSheet(GID.compAverages),
      fetchSheet(GID.distribution),
      fetchSheet(GID.zeroScorers),
    ]);

    // ── 2. Parse Comp_Averages ────────────────────────────────────
    let competencies = compRows
      .filter((r) => r["Competency"] && r["Competency"].trim().length > 2)
      .map((r, idx) => ({
        code:      (r["Competency"]  || "").trim(),
        desc:      (r["Desc"]        || r["Description"] || "").trim(),
        grade:     (r["Grade"]       || "").trim(),
        subject:   (r["Subject"]     || "").trim(),
        aprAvg:    toFloat(r["April Avg"]  || r["Apr Avg"]),
        mayAvg:    toFloat(r["May Avg"]),
        changePP:  toFloat(r["Change pp"]  || r["Change PP"]),
        pctChange: toFloat(r["% Change"]   || r["Pct Change"]),
        rank:      toInt(r["Rank"]) ?? (idx + 1),
      }));

    // Apply filters
    if (subject) {
      competencies = competencies.filter(
        (c) => c.subject.toLowerCase() === subject.toLowerCase()
      );
    }
    if (grade) {
      competencies = competencies.filter(
        (c) => c.grade.toLowerCase() === grade.toLowerCase()
      );
    }

    // ── 3. Parse Zero_Scorer_Analysis ─────────────────────────────
    // Cols: Competency | Desc | Grade | Subject | Apr 0-scorers | May 0-scorers | Change count | % Change | Apr % schools | May % schools
    const zeroMap = {};
    zeroRows
      .filter((r) => r["Competency"] && r["Competency"].trim().length > 2)
      .forEach((r) => {
        const code = r["Competency"].trim();
        zeroMap[code] = {
          aprCount:  toInt(r["Apr 0-scorers"]   || r["Apr Zero Scorers"]),
          mayCount:  toInt(r["May 0-scorers"]   || r["May Zero Scorers"]),
          aprPct:    toFloat(r["Apr % schools"] || r["Apr Pct Schools"]),
          mayPct:    toFloat(r["May % schools"] || r["May Pct Schools"]),
          changeCnt: toInt(r["Change count"]    || r["Change Count"]),
        };
      });

    // ── 4. Parse Distribution_Analysis ───────────────────────────
    // Cols: Competency | Desc | Grade | Subject | Apr =0% | May =0% | Apr <50% | May <50% | Apr 50-75% | May 50-75% | Apr >75% | May >75%
    const distMap = {};
    distRows
      .filter((r) => r["Competency"] && r["Competency"].trim().length > 2)
      .forEach((r) => {
        const code = r["Competency"].trim();
        distMap[code] = {
          aprZero: toFloat(r["Apr =0%"]    || r["Apr Zero"]),
          mayZero: toFloat(r["May =0%"]    || r["May Zero"]),
          aprLow:  toFloat(r["Apr <50%"]   || r["Apr Low"]),
          mayLow:  toFloat(r["May <50%"]   || r["May Low"]),
          aprMid:  toFloat(r["Apr 50-75%"] || r["Apr Mid"]),
          mayMid:  toFloat(r["May 50-75%"] || r["May Mid"]),
          aprHigh: toFloat(r["Apr >75%"]   || r["Apr High"]),
          mayHigh: toFloat(r["May >75%"]   || r["May High"]),
        };
      });

    // ── 5. Merge everything ───────────────────────────────────────
    const merged = competencies.map((c) => ({
      ...c,
      zeroScorers:  zeroMap[c.code]  || null,
      distribution: distMap[c.code]  || null,
    }));

    // ── 6. Top 5 / Bottom 5 ───────────────────────────────────────
    const scored = merged.filter((c) => c.mayAvg !== null);
    const topFive    = [...scored].sort((a, b) => b.mayAvg    - a.mayAvg).slice(0, 5);
    const bottomFive = [...scored].sort((a, b) => a.mayAvg    - b.mayAvg).slice(0, 5);
    const mostImproved  = [...scored].sort((a, b) => (b.changePP || 0) - (a.changePP || 0)).slice(0, 5);
    const leastImproved = [...scored].sort((a, b) => (a.changePP || 0) - (b.changePP || 0)).slice(0, 5);

    // High zero-scorer competencies (sorted by May % of schools)
    const highZero = merged
      .filter((c) => c.zeroScorers?.mayPct !== null)
      .sort((a, b) => (b.zeroScorers?.mayPct || 0) - (a.zeroScorers?.mayPct || 0))
      .slice(0, 5);

    return jsonResponse(res, {
      total: merged.length,
      competencies: merged,
      topFive,
      bottomFive,
      mostImproved,
      leastImproved,
      highZero,
    });
  } catch (err) {
    console.error("[/api/competency] Error:", err.message);
    return errorResponse(res, err.message);
  }
};