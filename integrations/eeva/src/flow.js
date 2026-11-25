/* Framework-independent lifecycle used by the standalone demo, added after collection. */
(function (root) {
  const C =
    typeof module !== "undefined" ? require("./core.js") : root.ClariScaleCore;
  function create(order) {
    if (!["AB", "BA"].includes(order)) throw Error("Order must be AB or BA");
    return {
      schema_version: "clariscale.flow.v1",
      order,
      state: "consent",
      block: 0,
      index: 0,
      seen: [],
      decision: null,
      downloaded: false,
      download_ack: false,
      upload_ack: false,
    };
  }
  function step(s, event) {
    let n = structuredClone(s);
    if (!event.id || s.seen.includes(event.id))
      throw Error("Duplicate or missing submission id");
    n.seen.push(event.id);
    const fail = () => {
      throw Error("Invalid transition from " + s.state);
    };
    switch (event.type) {
      case "consent":
        if (s.state !== "consent" || event.accepted !== true) fail();
        n.state = "item";
        break;
      case "answer":
        if (!["item", "clarify", "fallback"].includes(s.state)) fail();
        {
          const condition = s.order[s.block];
          let category =
            condition === "A" || s.state === "fallback"
              ? event.category
              : C.mapFrequency(event.text);
          if (condition === "A" || s.state === "fallback") {
            if (!Number.isInteger(category) || category < 0 || category > 4)
              fail();
          }
          n.decision =
            s.state === "item"
              ? {
                  initial: condition === "B" ? category : null,
                  after_clarification: null,
                  fallback: null,
                  path: condition === "A" ? "choice" : "initial",
                }
              : structuredClone(s.decision);
          if (s.state === "clarify") {
            n.decision.after_clarification = category;
            n.decision.path = "clarified";
          }
          if (s.state === "fallback") {
            n.decision.fallback = category;
            n.decision.path = "fallback";
          }
          if (category === null) {
            n.state = s.state === "item" ? "clarify" : "fallback";
            break;
          }
          n.index++;
          n.state = n.index === 5 ? "sus" : "item";
          break;
        }
      case "sus":
        if (s.state !== "sus" || C.susScore(event.values) === null) fail();
        n.block++;
        n.index = 0;
        n.decision = null;
        n.state = n.block === 2 ? "download" : "item";
        break;
      case "download":
        if (s.state !== "download" || event.success !== true) fail();
        n.downloaded = true;
        break;
      case "ack_download":
        if (s.state !== "download") fail();
        n.download_ack = event.checked === true;
        break;
      case "to_upload":
        if (s.state !== "download" || !s.downloaded || !s.download_ack) fail();
        n.state = "upload";
        break;
      case "ack_upload":
        if (s.state !== "upload") fail();
        n.upload_ack = event.checked === true;
        break;
      case "finish":
        if (s.state !== "upload" || !s.upload_ack) fail();
        n.state = "complete";
        break;
      default:
        fail();
    }
    return n;
  }
  const api = { create, step };
  if (typeof module !== "undefined") module.exports = api;
  else root.ClariScaleFlow = api;
})(globalThis);
