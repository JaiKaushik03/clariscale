"use strict";
const C = globalThis.ClariScaleCore,
  F = globalThis.ClariScaleFlow,
  A = globalThis.ClariScaleAssessment;
const root = document.querySelector("#app");
let state = null,
  serial = 0,
  answers = [],
  start = 0,
  timerKey = null;
function el(tag, text, parent = root) {
  let n = document.createElement(tag);
  if (text) n.textContent = text;
  parent.append(n);
  return n;
}
function button(text, fn) {
  let b = el("button", text);
  b.onclick = () => {
    b.disabled = true;
    try {
      fn();
    } catch (e) {
      el("p", e.message);
      b.disabled = false;
    }
  };
  return b;
}
function send(event) {
  state = F.step(state, { ...event, id: String(++serial) });
  render();
}
function setup() {
  root.replaceChildren();
  el("h2", "Start a fictional session");
  const select = el("select");
  for (let o of ["AB", "BA"]) {
    let n = el("option", o, select);
    n.value = o;
  }
  button("Start synthetic demo", () => {
    state = F.create(select.value);
    answers = [];
    serial = 0;
    render();
  });
}
function render() {
  root.replaceChildren();
  el("small", "Synthetic session • " + state.order + " • " + state.state);
  if (state.state === "consent") {
    el(
      "p",
      "Use fictional answers only. Participation in a real study is voluntary. No clinical interpretation is provided. Reloading discards this in-memory demo.",
    );
    button("I agree to the synthetic demonstration", () =>
      send({ type: "consent", accepted: true }),
    );
  } else if (["item", "clarify", "fallback"].includes(state.state)) {
    let k = state.order[state.block],
      id = (k === "A" ? 0 : 5) + state.index + 1;
    el("h2", k + " · Question " + id);
    el("p", A.questions[id - 1]);
    if (timerKey !== state.block + "-" + state.index) {
      timerKey = state.block + "-" + state.index;
      start = performance.now();
    }
    const submit = (e) => {
      const old = state;
      let next = F.step(state, { ...e, id: String(++serial) });
      if (next.index !== old.index || next.state === "sus")
        answers.push({
          item: id,
          condition: k,
          seconds: (performance.now() - start) / 1000,
          ...next.decision,
        });
      state = next;
      render();
    };
    if (k === "A" || state.state === "fallback") {
      if (state.state === "fallback")
        el(
          "p",
          "Please select one of the original choices. This is logged as fallback.",
        );
      A.categories.forEach((t, i) =>
        button(t, () => submit({ type: "answer", category: i })),
      );
    } else {
      if (state.state === "clarify")
        el(
          "p",
          "Could you describe how often that happened during the last month?",
        );
      let input = el("textarea");
      input.value =
        state.state === "clarify"
          ? "Synthetic: unsure."
          : "Synthetic: sometimes.";
      button("Submit fictional answer", () =>
        submit({ type: "answer", text: input.value }),
      );
    }
  } else if (state.state === "sus") {
    el("h2", "Usability questionnaire (synthetic)");
    let inputs = A.sus.map((t) => {
      el("label", t);
      let s = el("select");
      for (let v = 1; v <= 5; v++) {
        let o = el("option", String(v), s);
        o.value = v;
      }
      s.value = "3";
      return s;
    });
    button("Submit ten ratings", () =>
      send({ type: "sus", values: inputs.map((s) => Number(s.value)) }),
    );
  } else if (state.state === "download") {
    el("h2", "Download your fictional session");
    button("Download synthetic JSON", () => {
      let url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              {
                schema_version: "clariscale.demo.v1",
                data_type: "synthetic_test",
                order: state.order,
                answers,
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      );
      let a = el("a");
      a.href = url;
      a.download = "ClariScale-SYNTHETIC.json";
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      send({ type: "download", success: true });
    });
    check("I have the downloaded file", "ack_download");
    let b = button("Proceed", () => send({ type: "to_upload" }));
    b.disabled = !state.downloaded || !state.download_ack;
  } else if (state.state === "upload") {
    el("h2", "Manual upload stage (demonstration)");
    el(
      "p",
      "No real destination is configured and no file is transmitted. The institutional workflow uses a configured clickable/copyable URL. Acknowledgment alone cannot prove upload.",
    );
    check("Simulate upload acknowledgment", "ack_upload");
    let b = button("Finish", () => send({ type: "finish" }));
    b.disabled = !state.upload_ack;
  } else {
    el("h2", "Synthetic demonstration complete");
    el("p", "No research participation or upload is claimed.");
    button("Restart and discard this demo", setup);
  }
  function check(t, type) {
    let l = el("label");
    let c = el("input", null, l);
    c.type = "checkbox";
    c.checked = type === "ack_download" ? state.download_ack : state.upload_ack;
    l.append(document.createTextNode(t));
    c.onchange = () => send({ type, checked: c.checked });
  }
}
setup();
