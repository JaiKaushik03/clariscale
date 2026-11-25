# Portfolio: ClariScale

## Engineering problem

Build an auditable conversational assessment where free text can abstain instead of silently forcing a frequency category. Preserve a working institutional agent integration while making core logic reproducible outside that framework.

## Jai's verified implementation contributions

- JavaScript assessment flow, deterministic mapping/clarification integration and explicit raw versus fallback logs.
- Investigation and correction of requested AB/BA order being lost during local reservation, backed by synthetic AB/BA runs and an in-memory reservation test.
- Browser persistence and participant export engineering, including native XLSX, with current own-session JSON/validation improvements clearly dated after collection.
- Regression tests and private-input aggregate-analysis tooling, with AI assistance disclosed.

Study design, protocol, independent coding, interpretation and presentation were collaborative with Valentina Kloster. The eEVA/SAGE team supplies the avatar renderer and framework APIs. These are not solely Jai's inventions.

## Decisions and evidence

Keep deterministic rules inspectable. Separate the pure core from institutional UI while retaining its entry point. Reject invalid exports and duplicate lifecycle submissions. Preserve missing values and distinguish fallback from automatic output. Balance local reservations without claiming global coordination. Keep actual research data private and expose only aggregate results plus synthetic fixtures.

The study had ten consented Qualtrics records. Exploratory paired analysis showed B minus A SUS −14.17 (n=9) and item time +102.67 seconds (different n=9 subset). Item-content confounding prevents causal attribution. Initial mapper replay did not improve all-text exact agreement (2/12 for each version).

## Resume bullets

- Implemented JavaScript assessment workflows integrating deterministic frequency mapping, neutral clarification and participant-only XLSX exports with the eEVA/SAGE embodied-agent framework, collaborating on an FIU research prototype.
- Debugged AB/BA order propagation and added portable regression checks for allocation, missing-value scoring, dialogue paths and export boundaries; verified local balancing across 20 synthetic in-memory reservations.
- Built private-input reproducibility tooling for a collaborative 10-record pilot, keeping participant text private and reporting distinct exclusions, uncertainty and study-design limits.

## Interview lessons

A later code fix cannot repair an unverified historical order. Improved mapped-only percentage can hide lower coverage. A browser-saved record is not a team upload. A requested action unit is not visual verification. Testing these boundaries matters as much as implementing the happy path.
