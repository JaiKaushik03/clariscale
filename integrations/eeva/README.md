# eEVA/SAGE integration

Upload this project's `project.json` and `src/` structure to an authorized browser-js project. The entry point remains `src/main.js`, exporting run(context) and stop(). This is application source only: no institutional avatar assets are included.

The public configuration is deliberately non-operational for real research storage. In an authorized private deployment, edit assessment.json with a researcher-provided RSA-OAEP public JWK, matching key_id and project_id, a fresh dedicated database_name and an HTTPS uploadUrl. Never include a private key. Never commit operational upload URLs. An example URL is a placeholder, not a working destination. Keep the decryption key in approved researcher storage. Do not point tests at the real study database.

Confirm the available context.agent, UI helpers and VoiceManager behavior against the installed framework. Existing project APIs are preserved; public framework-independent tests cannot verify institutional compatibility. Required FIU accounts/network/VPN access may apply. No deployment was changed during this repository finalization.

Run the native smoke checklist with fictional inputs only: explicit AB and BA, five correct items per block, clarification then fallback, both complete SUS forms, encrypted save receipt, own-session XLSX and optional JSON, acknowledgment gates and a privately configured manual upload link. Independently verify file arrival. Visually/audibly check cues and speech separately.

The November 20 deployed release had only native XLSX. The current JSON backup, validator and item-sum timing are post-study repository changes. Historical code versions in provenance retain their original behavior.
