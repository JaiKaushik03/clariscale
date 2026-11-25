# Known issues and limits

- The public native config has no operational research encryption key or upload destination. A researcher must configure a separate authorized deployment before use. This PR does not modify that deployment.
- New native JSON, validation and timer-sum changes are covered at the core/export level, not a new end-to-end institutional browser deployment. Native eEVA full-flow smoke testing remains required after deployment.
- The new pure lifecycle model drives the standalone demo only. The institutional adapter retains its existing UI guards rather than claiming a complete state-machine replacement.
- The demo is in-memory, synthetic and avatar-free. No resume or browser storage is provided there. Institutional IndexedDB is local to a profile and has no central synchronization.
- Facial requests and speech-state animation are not proof of visible action units or phoneme-aligned lip sync. Repeat audible/visual QA in the actual framework before claiming it.
- Manual-upload acknowledgments do not prove arrival. Verify one fictional upload separately in an authorized environment.
- The deterministic English lexicon can miss valid wording and over-abstain on any explicit negation. It does not infer emotion or understand unrestricted language.
- Public synthetic test success does not imply study accuracy. Historical order mistakes, unrecovered logs, item/format confounding and small samples remain limitations after fixes.
- Existing binary handoff documents and archives are retained for history. Automated text/ZIP inspection is a bounded check, not a guarantee that all old assets are safe or legally redistributable. Do not rewrite history without a separate authorized remediation decision.
- No open-source license was present at finalization. Existing ownership and institutional/framework restrictions still apply.
