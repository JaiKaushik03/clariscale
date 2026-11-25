"use strict";
const core = require("./core.js");
const category = (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 4);
function validateNativeSession(s) {
  if (
    s &&
    ["sessions", "records", "archive", "privateJwk"].some((k) =>
      Object.hasOwn(s, k),
    )
  )
    throw Error("Aggregate or key data is not a participant session");
  if (
    !s ||
    typeof s.session_id !== "string" ||
    !s.session_id ||
    !core.validParticipantCode(s.participant_code) ||
    !["AB", "BA"].includes(s.order) ||
    !s.assignment ||
    !s.conditions
  )
    throw Error("Invalid session envelope");
  if (
    JSON.stringify(s.assignment.A) !== "[1,2,3,4,5]" ||
    JSON.stringify(s.assignment.B) !== "[6,7,8,9,10]" ||
    s.assignment.order !== s.order
  )
    throw Error("Invalid item allocation/order");
  for (const k of ["A", "B"]) {
    const c = s.conditions[k];
    if (
      !c ||
      !Array.isArray(c.items) ||
      !Array.isArray(c.sus) ||
      c.sus.length > 10
    )
      throw Error("Invalid condition");
    let prev = 0;
    for (const i of c.items) {
      if (!s.assignment[k].includes(i.item) || i.item <= prev)
        throw Error("Duplicate, unordered or foreign item");
      prev = i.item;
      for (const field of [
        "category",
        "initial_automatic_category",
        "automatic_category",
        "fallback_category",
      ])
        if (i[field] !== undefined && !category(i[field]))
          throw Error("Invalid category");
      if (i.seconds != null && (!Number.isFinite(i.seconds) || i.seconds < 0))
        throw Error("Invalid timing");
      if (i.fallback_used && i.automatic_category != null)
        throw Error("Fallback cannot be automatic success");
    }
    if (c.sus.some((v) => !Number.isInteger(v) || v < 1 || v > 5))
      throw Error("Invalid SUS response");
  }
  return s;
}
function taskSeconds(items) {
  if (
    items.length !== 5 ||
    items.some((i) => !Number.isFinite(i.seconds) || i.seconds < 0)
  )
    return null;
  return items.reduce((sum, i) => sum + i.seconds, 0);
}
function ownSession(s, sessionId) {
  validateNativeSession(s);
  if (s.session_id !== sessionId) throw Error("Session boundary violation");
  return {
    schema_version: "clariscale.session.v1",
    ...structuredClone(s),
    timing: {
      A_item_seconds: taskSeconds(s.conditions.A.items),
      B_item_seconds: taskSeconds(s.conditions.B.items),
    },
  };
}
module.exports = { validateNativeSession, taskSeconds, ownSession };
