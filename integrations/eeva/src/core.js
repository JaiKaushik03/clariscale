// Extracted from the post-collection eEVA implementation. Mapper behavior preserved.
const assessment =
  typeof module !== "undefined"
    ? require("./assessment.json")
    : globalThis.ClariScaleAssessment;
function mapFrequency(raw) {
  const text = String(raw || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
  if (
    !text ||
    /\b(don't know|do not know|not sure|unsure|it depends|maybe|cannot say|can't say)\b/.test(
      text,
    )
  )
    return null;

  // Abstain when frequency language is negated.
  if (
    /\b(not|no|don't|dont|doesn't|doesnt|didn't|didnt|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|haven't|havent|hasn't|hasnt|hadn't|hadnt|can't|cant|cannot|couldn't|couldnt|wouldn't|wouldnt|won't|wont|without)\b/.test(
      text,
    )
  )
    return null;

  const rules = [
    [1, /\b(almost never|hardly ever|rarely|seldom)\b/g],
    [
      4,
      /\b(very often|almost always|almost every day|every day|daily|all the time|most days|always)\b/g,
    ],
    [3, /\b(fairly often|quite often|frequently|often)\b/g],
    [2, /\b(sometimes|occasionally|from time to time)\b/g],
    [0, /\bnever\b/g],
  ];

  let remaining = text;
  const found = new Set();

  rules.forEach(([value, pattern]) => {
    remaining = remaining.replace(pattern, () => {
      found.add(value);
      return " ";
    });
  });

  return found.size === 1 ? Array.from(found)[0] : null;
}

const validCategory = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 4;

function agreement(pairs) {
  const eligible = pairs.filter(
    (p) => validCategory(p.expected) && validCategory(p.predicted),
  );

  const n = eligible.length;

  if (!n) {
    return {
      n: 0,
      matches: 0,
      percent: null,
      kappa: null,
    };
  }

  const matches = eligible.filter((p) => p.expected === p.predicted).length;

  const a = [0, 0, 0, 0, 0];
  const b = [0, 0, 0, 0, 0];

  eligible.forEach((p) => {
    a[p.expected]++;
    b[p.predicted]++;
  });

  const pe = a.reduce((sum, count, i) => sum + count * b[i], 0) / (n * n);

  return {
    n,
    matches,
    percent: (matches / n) * 100,
    kappa: pe === 1 ? null : (matches / n - pe) / (1 - pe),
  };
}

function susScore(values) {
  if (
    values.length !== 10 ||
    Array.from(values).some((v) => !Number.isInteger(v) || v < 1 || v > 5)
  ) {
    return null;
  }

  return (
    values.reduce((sum, v, i) => sum + (i % 2 === 0 ? v - 1 : 5 - v), 0) * 2.5
  );
}

function pssTotal(values) {
  if (values.length !== 10 || !Array.from(values).every(validCategory)) {
    return null;
  }

  return values.reduce(
    (sum, value, i) => sum + ([4, 5, 7, 8].includes(i + 1) ? 4 - value : value),
    0,
  );
}

// Fixed question assignment:
// A always receives original items 1-5.
// B always receives original items 6-10.
// The existing collection.reserve() supplies the balanced AB/BA order.
function randomAssignment(random = Math.random, requestedOrder = "") {
  const validOrder = ["AB", "BA"].includes(requestedOrder);

  return {
    order: validOrder ? requestedOrder : random() < 0.5 ? "AB" : "BA",

    A: [1, 2, 3, 4, 5],
    B: [6, 7, 8, 9, 10],

    order_source: validOrder ? "coordinator_assigned" : "independent_random",
  };
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);

  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) {
    text = "'" + text;
  }

  return '"' + text.replace(/"/g, '""') + '"';
}

function summary(session) {
  const a = session.conditions.A;
  const b = session.conditions.B;

  const accepted = b.items.filter((i) =>
    validCategory(i.automatic_category),
  ).length;

  const categories = assessment.questions.map((_, index) => {
    const item = [...a.items, ...b.items].find((row) => row.item === index + 1);

    return item
      ? (item.category ??
          item.automatic_category ??
          item.fallback_category ??
          null)
      : null;
  });

  return {
    A_item_ids: session.assignment.A,
    B_item_ids: session.assignment.B,

    mapping_coverage_percent: (accepted / 5) * 100,
    automatic_items: accepted,

    clarification_items: b.items.filter((i) => i.clarification_used).length,

    structured_fallback_items: b.items.filter((i) => i.fallback_used).length,

    A_seconds: a.seconds,
    B_seconds: b.seconds,
    A_SUS: susScore(a.sus),
    B_SUS: susScore(b.sus),

    PSS10_total: pssTotal(categories),

    total_score_includes_fallback: b.items.some((i) =>
      validCategory(i.fallback_category),
    ),

    analysis_note:
      "Different items are assigned to A and B. No within-person cross-format item agreement or kappa is calculated. Blind human coding of B text is required for mapper agreement.",
  };
}

function itemRows(s) {
  return assessment.questions.map((question, i) => {
    const condition = s.assignment.A.includes(i + 1) ? "A" : "B";

    const row =
      s.conditions[condition].items.find((item) => item.item === i + 1) || {};

    const category =
      row.category ?? row.automatic_category ?? row.fallback_category ?? null;

    return {
      session_id: s.session_id,
      participant_code: s.participant_code,
      data_type: s.data_type,
      version: s.version,
      order: s.order,
      order_source: s.assignment.order_source,
      status: s.status,

      A_item_ids: s.assignment.A.join("|"),
      B_item_ids: s.assignment.B.join("|"),

      item: i + 1,
      condition,
      question,
      raw_category: category,

      reverse_scored: [4, 5, 7, 8].includes(i + 1),

      scored_value: validCategory(category)
        ? [4, 5, 7, 8].includes(i + 1)
          ? 4 - category
          : category
        : null,

      original_response: row.original_response || "",
      clarification_response: row.clarification_response || "",

      initial_automatic_category: row.initial_automatic_category ?? null,

      automatic_category: row.automatic_category ?? null,
      fallback_category: row.fallback_category ?? null,

      clarification_used: !!row.clarification_used,
      fallback_used: !!row.fallback_used,

      item_seconds: row.seconds ?? null,
      item_status: row.status || "not_started",

      A_seconds: s.conditions.A.seconds,
      B_seconds: s.conditions.B.seconds,

      A_SUS: susScore(s.conditions.A.sus),
      B_SUS: susScore(s.conditions.B.sus),
    };
  });
}

function toCSV(rows) {
  if (!rows.length) return "";

  const keys = Object.keys(rows[0]);

  return (
    "\uFEFF" +
    [
      keys.map(csvCell).join(","),
      ...rows.map((row) => keys.map((k) => csvCell(row[k])).join(",")),
    ].join("\r\n")
  );
}

function validParticipantCode(code) {
  const value = String(code || "").trim();

  return (
    value.length > 0 &&
    value.length <= 24 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

const core = {
  validParticipantCode,
  mapFrequency,
  agreement,
  susScore,
  pssTotal,
  randomAssignment,
  summary,
  itemRows,
  toCSV,
};

if (typeof module !== "undefined") module.exports = core;
else globalThis.ClariScaleCore = core;
