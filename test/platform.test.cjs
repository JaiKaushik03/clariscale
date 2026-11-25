const test = require("node:test"),
  a = require("node:assert/strict");
const C = require("../integrations/eeva/src/core.js"),
  F = require("../integrations/eeva/src/flow.js"),
  V = require("../integrations/eeva/src/contracts.js"),
  E = require("../integrations/eeva/src/main.js");
for (const [text, want] of [
  ["Never", 0],
  ["almost never", 1],
  ["hardly ever", 1],
  ["Sometimes", 2],
  ["occasionally", 2],
  ["quite often", 3],
  ["very often", 4],
  ["always", 4],
  ["not every day", null],
  ["I do not feel this way every day", null],
  ["never but often", null],
  ["maybe sometimes", null],
  ["3", null],
  ["", null],
  ["unknown", null],
])
  test("frequency " + JSON.stringify(text), () =>
    a.equal(C.mapFrequency(text), want),
  );
for (let order of ["AB", "BA"])
  test("fixed ascending allocation " + order, () => {
    for (let r of [0, 0.99])
      a.deepEqual(
        C.randomAssignment(() => r, order),
        {
          order,
          A: [1, 2, 3, 4, 5],
          B: [6, 7, 8, 9, 10],
          order_source: "coordinator_assigned",
        },
      );
  });
test("scoring distinguishes missing from zero", () => {
  a.equal(C.susScore(Array(10).fill(3)), 50);
  a.equal(C.susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 100);
  a.equal(C.susScore(Array(9).fill(3)), null);
  a.equal(C.pssTotal(Array(10).fill(0)), 16);
  a.equal(C.pssTotal(Array(10).fill(2)), 20);
  a.equal(C.pssTotal([0, 0, 0, 0, 0, 0, 0, 0, 0, null]), null);
});
test("one clarification then distinct fallback", () => {
  let s = F.step(F.create("BA"), {
    id: "consent",
    type: "consent",
    accepted: true,
  });
  s = F.step(s, { id: "a", type: "answer", text: "maybe" });
  a.equal(s.state, "clarify");
  s = F.step(s, { id: "b", type: "answer", text: "unsure" });
  a.equal(s.state, "fallback");
  s = F.step(s, { id: "c", type: "answer", category: 2 });
  a.deepEqual(s.decision, {
    initial: null,
    after_clarification: null,
    fallback: 2,
    path: "fallback",
  });
  a.throws(
    () => F.step(s, { id: "c", type: "answer", text: "never" }),
    /Duplicate/,
  );
});
test("clarified automatic path remains distinct", () => {
  let s = F.step(F.create("BA"), { id: "c", type: "consent", accepted: true });
  s = F.step(s, { id: "a", type: "answer", text: "maybe" });
  s = F.step(s, { id: "b", type: "answer", text: "rarely" });
  a.deepEqual(s.decision, {
    initial: null,
    after_clarification: 1,
    fallback: null,
    path: "clarified",
  });
});
for (let order of ["AB", "BA"])
  test("whole lifecycle and acknowledgement gates " + order, () => {
    let i = 0,
      s = F.create(order);
    const send = (e) => (s = F.step(s, { ...e, id: String(++i) }));
    a.throws(() => send({ type: "answer", text: "sometimes" }));
    send({ type: "consent", accepted: true });
    for (let block = 0; block < 2; block++) {
      for (let q = 0; q < 5; q++)
        send({ type: "answer", text: "sometimes", category: 2 });
      a.equal(s.state, "sus");
      a.throws(() => send({ type: "sus", values: [3] }));
      send({ type: "sus", values: Array(10).fill(3) });
    }
    a.equal(s.state, "download");
    send({ type: "ack_download", checked: true });
    a.throws(() => send({ type: "to_upload" }));
    send({ type: "download", success: true });
    send({ type: "to_upload" });
    a.throws(() => send({ type: "finish" }));
    send({ type: "ack_upload", checked: true });
    send({ type: "finish" });
    a.equal(s.state, "complete");
  });
function fixture() {
  return {
    session_id: "SYNTH-ONLY",
    participant_code: "SYNTH-TEST",
    order: "AB",
    assignment: C.randomAssignment(() => 0, "AB"),
    data_type: "synthetic_test",
    version: "test",
    status: "completed",
    consent: true,
    conditions: Object.fromEntries(
      ["A", "B"].map((k, idx) => [
        k,
        {
          items: Array.from({ length: 5 }, (_, i) => ({
            item: idx * 5 + i + 1,
            category: 2,
            seconds: i + 1,
          })),
          sus: Array(10).fill(3),
          seconds: 999,
        },
      ]),
    ),
  };
}
module.exports = { fixture };
test("own-session contract timing and isolation", () => {
  let s = fixture();
  a.equal(V.ownSession(s, s.session_id).timing.A_item_seconds, 15);
  a.throws(() => V.ownSession(s, "OTHER"));
  a.equal(V.taskSeconds([{ seconds: 2 }]), null);
  s.conditions.A.items.push(s.conditions.A.items[0]);
  a.throws(() => V.validateNativeSession(s));
});
test("genuine XLSX ZIP and own-session rows", async () => {
  let s = fixture(),
    b = E.createSessionXlsx(s);
  a.equal(
    Buffer.from(await b.arrayBuffer())
      .subarray(0, 2)
      .toString(),
    "PK",
  );
  let rows = E.sessionWorkbookRows(s);
  a.ok(rows);
});
test("CSV protects formulas and preserves quoting", () => {
  let csv = C.toCSV([{ x: "=SUM(1,2)", y: 'a,"b"\nline', z: null }]);
  a.ok(csv.includes("'=SUM"));
  a.ok(csv.includes('""b""'));
  a.ok(csv.endsWith(',""'));
});
