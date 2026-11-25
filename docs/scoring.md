# Scoring and timing

SUS requires ten integer responses in 1–5 for each condition. Odd-numbered contributions are response minus 1; even-numbered contributions are 5 minus response. Sum and multiply by 2.5. The 0–100 score is not percent correct. Missing responses produce null.

PSS-10 uses raw categories 0–4. Reverse only Q4, Q5, Q7 and Q8 with 4 minus category. Total 0–40 exists only when all ten categories exist. Zero is a valid category, not missing. Different five-item blocks are not equivalent stress scales and should not be compared as such.

Primary condition time is the sum of five item timers, excluding SUS. Missing/invalid timers produce null. Wall duration, session duration and Qualtrics First Click/Last Click/Page Submit timing have different meanings and remain separate. The historical per-item JavaScript timers, not page timing, drive `analysis/evaluate.py`.

SUS exclusions and timing exclusions differ. Primary timing also requires all five B texts. Missing final category alone does not invalidate an otherwise eligible SUS/time pair. No missing category is imputed for total stress scoring.
