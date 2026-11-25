const test = require("node:test"),
  a = require("node:assert/strict");
const C = require("../integrations/eeva/src/core.js"),
  V = require("../integrations/eeva/src/contracts.js"),
  old = require("../provenance/order-fixed/main.js").studyCore;
test("sparse values never become complete scores", () => {
  a.equal(C.susScore(new Array(10)), null);
  a.equal(C.pssTotal(new Array(10)), null);
});
test("extracted mapper preserves source lexicon and precedence", () => {
  for (let x of [
    "almost never",
    "never",
    "very often",
    "often",
    "quite often",
    "always",
    "occasionally",
    "not sometimes",
    "every day sometimes",
    "UNSURE",
    "from time to time",
    "hardly ever",
    "seldom",
    "most days",
  ])
    a.equal(C.mapFrequency(x), old.mapFrequency(x));
});
test("invalid export payloads fail without leaking input", () => {
  for (let s of [null, {}, [], { session_id: "other" }])
    a.throws(() => V.validateNativeSession(s), /Invalid session/);
});
test("missing and negative timers remain unavailable", () => {
  a.equal(
    V.taskSeconds(Array.from({ length: 5 }, () => ({ seconds: null }))),
    null,
  );
  a.equal(
    V.taskSeconds(Array.from({ length: 5 }, () => ({ seconds: -1 }))),
    null,
  );
});
