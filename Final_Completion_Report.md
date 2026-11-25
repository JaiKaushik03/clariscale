# CAP 5627 Project 2.1 completion report

Verified October 21 2026. Version PSS4-offline-1.1.0.

## 1 Overall status

The offline application works and was actually tested in Edge 155 with networking disabled. It implements the professor-approved fallback described in the supplied request. No external page requests or browser page errors were recorded. It is ready for human classroom dry runs and subsequent baseline collection. No genuine pilot results were available or fabricated.

## 2 Actual code status

Working features include both four-item conditions, exact PSS-4 wording/order/categories, clear-text mapping, one neutral clarification, successful clarified mapping, structured fallback, empty-answer handling, anonymous sessions, AB/BA order, item/condition timing, partial/interrupted logs, local recovery, CSV/JSON export/import, dataset filters, separate first-response and clarified agreement, kappa and scoring. The mapper is deterministic, without a trained model or network API.

No unresolved defect was found within the tested offline scope. Human dry runs, real pilot collection, final SUS administration and eEVA integration remain unfinished. Local recovery is browser-policy dependent. No face/voice recordings are made.

## 3 Test results

| Evidence | Executed | Passed | Failed |
| Unit suite | 80 | 80 | 0 |
| Offline browser interaction checks | 36 | 36 | 0 |
| Spreadsheet calculation checks | 44 | 44 | 0 |
| Native Microsoft Excel checks | 25 | 25 | 0 |

The browser also executes the same 80 unit tests; do not double-count these as different test cases. Browser checks cover both orders, raw categories, clear/unclear/empty answers, clarification resolution, manual fallback exclusion, session isolation, recovery, export/import and mobile overflow. Spreadsheet checks independently verify kappa, blank versus zero, duplicates, mismatched versions, dataset exclusion, scoring and timing medians/ranges. Native Excel opens the real workbook, tracker and synthetic fixture/CSV and confirms recalculation. Normal CSV opening preserves quoted multiline text; use File Open instead of the legacy OpenText route.

Both DOCX guides were opened in Microsoft Word and rendered: seven pages each. All pages were reviewed, including a pagination repair. The protocol is one rendered page. Workbook previews were reviewed and the trial table uses grayscale styling, frozen headers and filters.

## 4 File locations

The project directory is this repository root.

- Offline application: [index.html](01_Application/index.html)
- Test suite: [tests.html](02_Tests/tests.html)
- Trial log: [PSS4_Offline_Trial_Log.xlsx](03_Baseline/PSS4_Offline_Trial_Log.xlsx)
- One-page protocol: [PSS4_One_Page_Baseline_Protocol.pdf](03_Baseline/PSS4_One_Page_Baseline_Protocol.pdf)
- Updated original tracker: [Kloster_Liu_CAP5627_Project1_TaskList_Updated.xlsx](04_Project_Tracker/Kloster_Liu_CAP5627_Project1_TaskList_Updated.xlsx)
- Technical technical documentation: [Implementation_Reference.docx](technical/Implementation_Reference.docx)
- Screenshots: [README.md](technical/Screenshots/README.md)
- Jai guide: [Jai_Implementation_Explanation.docx](06_Jai_Guide/Jai_Implementation_Explanation.docx)
- Run instructions: [README.md](README.md)

## 5 Baseline status

The collection infrastructure is ready; genuine pilot data is absent and the real trial sheet is empty. Run 1–2 actual team dry runs first, obtain voluntary participation, then collect classmates' paired A/B answers using trial type fallback. The primary calculation compares first automatic categories with paired raw closed-ended categories; report eligible count, matches, percentage, coverage, kappa when defined, clarification/fallback rates and completed-time summaries. Keep clarified automatic agreement separate. Retain every failure with exclusion reasons.

## 6 Classroom demonstration

Open index.html, enter TESTDEMO, select AB and Synthetic software test, then Start assigned condition. Complete A with any choices. In B type Sometimes on item 1; It depends then Maybe on item 2 to show clarification and fixed-choice fallback; leave item 3 empty twice; type Fairly often on item 4. Open Researcher tools, expand Developer mapping check and check Almost never to show category 1. Export CSV and backup JSON. These demonstrations are synthetic. Follow the protocol with anonymous P codes and Offline fallback baseline for actual collection.

## 7 Technical documentation

The technical reference covers the research question, variables, hypotheses, architecture, algorithm, source attribution, social controls and verification evidence. Screenshots and evidence tables accompany the implementation reference.
