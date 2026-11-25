# Evaluation and reproducibility

Run `python -B analysis/evaluate.py --input /private/source.csv` using the original Qualtrics CSV. Standard library only, Python 3.12+. It ignores Qualtrics label/import rows, filters consented study records, recomputes SUS from ten ratings, and sums per-item JavaScript timers. It emits aggregate JSON only. It does not print participant codes or text. `docs/aggregate-results.json` is a computed aggregate snapshot, with source SHA-256 for reproducibility. The source stays private.

Ten consented records were assigned 5 AB and 5 BA. This assignment is not evidence of actual execution. A linked recovered native record executed AB despite a BA assignment.

| Outcome | n | A | B | B minus A | 95% paired t interval | Exploratory p |
|---|---:|---:|---:|---:|---|---:|
| SUS | 9 | 89.72 | 75.56 | −14.17 | [−31.49, +3.16] | .096 |
| Primary item time (s) | 9 | 37.12 | 139.79 | +102.67 | [+35.13, +170.22] | .008 |
| All-ten time sensitivity (s) | 10 | 38.37 | 127.06 | +88.69 | [+21.51, +155.87] | .015 |

Exclusions, without public participant aliases: one record lacks seven SUS ratings and remains time-eligible; one lacks all B answers and remains SUS-eligible; another has five B texts but one missing final category and remains SUS/time-eligible without a complete PSS total. The two n=9 sets differ. B took longer in all nine primary eligible pairs. Different item sets confound format and content. Small-sample paired t intervals and p-values are exploratory, without population or causal claims. No clinical validation or noninferiority is established.

## Mapper replay

`node analysis/replay.cjs` runs a synthetic smoke fixture. To reproduce historical aggregates, privately supply original baseline rows as the first argument and `private-replay` as the second. Inputs require text, closed_reference and logged baseline_prediction; optional human_category may be null. Only aggregates print. The original replay script is preserved unchanged in `analysis/replay-original.cjs` for provenance, but its old relative paths are not the portable entry point.

The same 12 PSS-4 texts from three people give baseline coverage 5/12 (41.7%), mapped exact 2/5 (40%), all-text automatic exact 2/12, linear weighted kappa 0.285714. Final initial-pass mapping gives coverage 4/12 (33.3%), mapped exact 2/4 (50%), all-text exact 2/12, weighted kappa 0. Different mapped subsets prevent claiming an overall accuracy improvement. Closed choices are cross-format references, not independent gold-standard coding. This replay does not measure complete PSS-10 dialogue performance.

The standard-library Student-t CDF uses numerical integration; tests compare known quantiles and a hand-checkable paired example. No hard-coded research outputs drive calculation. All inputs for public smoke tests are synthetic.
