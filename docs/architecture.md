# Architecture

ClariScale keeps the existing integration rather than introducing an incompatible framework rewrite.

- `integrations/eeva/project.json` retains the `src/main.js` browser-js entry convention. `src/main.js` exports `run(context)` and `stop()` and retains the later native UI, storage transactions and dependency-free OOXML writer.
- `src/core.js` holds the extracted deterministic mapper and pure scoring, allocation, agreement and CSV functions. CommonJS serves the native runner and Node tests; the same file exposes a browser namespace for the standalone demo.
- `src/contracts.js` validates native session envelopes, ascending item membership, category ranges and fallback consistency. It projects one session into versioned JSON and computes complete five-item timer sums.
- `src/flow.js` is a pure lifecycle model added during finalization. It drives the standalone demo, not the historical native UI. Event IDs reject replayed submissions. Invalid transitions fail before state mutation.
- The eEVA UI retains its existing completion guards. Its optional JSON backup is new, and cannot satisfy the required XLSX-download gate.
- The current adapter sums item timers for primary condition time and retains wall time separately. Historical results are recomputed from original per-item fields rather than retroactively changing old exports.

## Persistence and boundaries

The native implementation uses IndexedDB read/write transactions for code reservations and per-profile AB/BA counters. Explicit orders override local preference. Counters track reservations, not globally balanced completed participants. Browser/profile deletion loses local records; no cross-device synchronization exists.

Verified encryption design: a new AES-256-GCM key per snapshot, random 12-byte IV, authenticated project/key/session metadata and RSA-OAEP wrapping using a researcher public key. The corresponding private key stays outside the participant application. This is code inspection, not a cryptographic security audit. Own-session downloads are plaintext. The public configuration is deliberately unusable for real storage until a researcher supplies a public key and destination.

No resume is inferred from a code. An interrupted native session remains partial; use an explicitly authorized restart code and record the interruption privately. The memory-only local demo discards progress on reload. Existing native duplicate-code checks stay in place.

## Cue policy

The same programmed schedule requests AU6/AU12 for 1.20 seconds, then AU1 for 0.72 seconds, then neutral listening. Answer content does not select emotions. Mouth movement may use approximate speech-state AUs or a framework-native path. Neither proves observed execution or phoneme-aligned lip sync. The November 20 full-flow QA disabled speech and did not visually verify the subtle cues.
