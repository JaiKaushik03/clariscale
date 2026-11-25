// Unit test only: this in-memory IndexedDB adapter never accesses Chrome or participant data.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
function memoryDB() {
  const stores = { codes: new Map(), meta: new Map(), sessions: new Map() };
  const db = {
    close() {},
    transaction() {
      const local = Object.fromEntries(
        Object.entries(stores).map(([k, v]) => [
          k,
          new Map([...v].map(([id, obj]) => [id, structuredClone(obj)])),
        ]),
      );
      let pending = 0,
        aborted = false,
        done = false;
      const tx = {
        abort() {
          aborted = true;
          setImmediate(() => {
            if (!done) {
              done = true;
              tx.onabort?.();
            }
          });
        },
        objectStore(name) {
          return {
            get(id) {
              const req = {};
              pending++;
              setImmediate(() => {
                req.result = structuredClone(local[name].get(id));
                req.onsuccess?.();
                pending--;
                finish();
              });
              return req;
            },
            put(obj) {
              local[name].set(obj.id ?? obj.session_id, structuredClone(obj));
              finish();
            },
            add(obj) {
              const id = obj.id ?? obj.session_id;
              if (local[name].has(id)) throw Error("duplicate");
              local[name].set(id, structuredClone(obj));
              finish();
            },
          };
        },
      };
      function finish() {
        setImmediate(() => {
          if (!pending && !aborted && !done) {
            done = true;
            for (const k of Object.keys(stores)) stores[k] = local[k];
            tx.oncomplete?.();
          }
        });
      }
      finish();
      return tx;
    },
  };
  return {
    stores: () => stores,
    open() {
      const req = { result: db };
      setImmediate(() => req.onsuccess?.());
      return req;
    },
  };
}
(async () => {
  const adapter = memoryDB();
  globalThis.indexedDB = adapter;
  const config = require("../integrations/eeva/src/assessment.json").collection;
  const collection =
    require("../integrations/eeva/src/main.js").createLocalCollection(config);
  adapter
    .stores()
    .meta.set("balance-synthetic_test", {
      id: "balance-synthetic_test",
      AB: 12,
      BA: 0,
    });
  const explicit = await collection.reserve(
    "UNIT-AB",
    "synthetic_test",
    "unit-1",
    "AB",
  );
  assert.equal(
    explicit.order,
    "AB",
    "Explicit AB must override a local preference for BA",
  );
  assert.equal(explicit.order_source, "coordinator_assigned");
  const reverse = await collection.reserve(
    "UNIT-BA",
    "synthetic_test",
    "unit-2",
    " ba ",
  );
  assert.equal(reverse.order, "BA");
  const automatic = await collection.reserve(
    "UNIT-AUTO",
    "synthetic_test",
    "unit-3",
  );
  assert.equal(automatic.order, "BA");
  assert.equal(automatic.order_source, "local_pc_balanced_assignment");
  const before = structuredClone(
    adapter.stores().meta.get("balance-synthetic_test"),
  );
  await assert.rejects(
    () =>
      collection.reserve("UNIT-AB", "synthetic_test", "unit-duplicate", "BA"),
    /already recorded/,
  );
  await assert.rejects(
    () =>
      collection.reserve(
        "UNIT-INVALID",
        "synthetic_test",
        "unit-invalid",
        "XX",
      ),
    /must be AB or BA/,
  );
  assert.deepEqual(
    adapter.stores().meta.get("balance-synthetic_test"),
    before,
    "Rejected starts must not change counts",
  );
  for (let i = 0; i < 20; i++)
    await collection.reserve("BALANCE-" + i, "dry_run", "balance-" + i);
  const counts = adapter.stores().meta.get("balance-dry_run");
  assert.equal(counts.AB, 10);
  assert.equal(counts.BA, 10);
  await collection.reserve("UNIT-AB", "dry_run", "different-type", "AB");
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["wrapKey", "unwrapKey"],
  );
  const encryptedCollection =
    require("../integrations/eeva/src/main.js").createLocalCollection({
      ...config,
      publicJwk: await crypto.subtle.exportKey("jwk", keys.publicKey),
    });
  const snapshot = {
    session_id: "SYNTH-ENCRYPTION-ONLY",
    data_type: "synthetic_test",
    status: "partial",
    order: "AB",
    version: "test",
    started_at: "2026-11-25T00:00:00Z",
    response: "fictional sometimes",
  };
  await encryptedCollection.save(snapshot);
  const packet = adapter.stores().sessions.get(snapshot.session_id);
  assert.ok(
    packet.ciphertext &&
      !JSON.stringify(packet).includes("fictional sometimes"),
  );
  const aes = await crypto.subtle.unwrapKey(
    "raw",
    Buffer.from(packet.wrapped_key, "base64"),
    keys.privateKey,
    { name: "RSA-OAEP" },
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const params = {
    name: "AES-GCM",
    iv: Buffer.from(packet.iv, "base64"),
    additionalData: new TextEncoder().encode(
      config.project_id + "|" + config.key_id + "|" + snapshot.session_id,
    ),
  };
  const clear = await crypto.subtle.decrypt(
    params,
    aes,
    Buffer.from(packet.ciphertext, "base64"),
  );
  assert.deepEqual(JSON.parse(new TextDecoder().decode(clear)), snapshot);
  await assert.rejects(() =>
    crypto.subtle.decrypt(
      { ...params, additionalData: new TextEncoder().encode("wrong") },
      aes,
      Buffer.from(packet.ciphertext, "base64"),
    ),
  );
  assert.equal(
    encryptedCollection.archive,
    undefined,
    "Participant collection API must not expose aggregate archive",
  );
  const report = {
    encryption_roundtrip_and_tamper_rejection: true,
    aggregate_archive_not_exposed: true,
    explicit_order_overrides_local_counts: true,
    normalized_ba: true,
    automatic_chooses_less_used: true,
    duplicate_rejected_without_count_change: true,
    invalid_order_rejected_without_count_change: true,
    automatic_20_reservations: { AB: 10, BA: 10 },
    session_types_independent: true,
    scope:
      "Actual collection.reserve implementation with an in-memory transaction adapter. Real-browser storage/export verified separately.",
  };
  console.log(JSON.stringify(report));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
