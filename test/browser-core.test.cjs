const test = require("node:test"),
  a = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
test("browser demo loads the identical shared core without a module loader", () => {
  let ctx = {
    ClariScaleAssessment: require("../integrations/eeva/src/assessment.json"),
    structuredClone,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (let p of ["core.js", "flow.js"])
    vm.runInContext(fs.readFileSync("integrations/eeva/src/" + p, "utf8"), ctx);
  a.equal(ctx.ClariScaleCore.mapFrequency("sometimes"), 2);
  a.equal(ctx.ClariScaleFlow.create("BA").state, "consent");
});
test("participant contracts reject aggregate records", () => {
  const V = require("../integrations/eeva/src/contracts.js");
  a.throws(() => V.validateNativeSession({ records: [] }), /Aggregate/);
});
