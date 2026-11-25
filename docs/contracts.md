# Data contracts

`clariscale.session.v1` identifies the new own-session JSON envelope. It contains one native session, never a sessions array or researcher archive. Native fields include:

| Object | Fields and interpretation |
|---|---|
| Session | session_id, participant_code, data_type, version, status, consent |
| Order | assigned_order (coordinator), requested_order (reservation), launch_requested_order (URL), order (executed sequence), assignment.order_source |
| Allocation | assignment.A = [1,2,3,4,5], assignment.B = [6,7,8,9,10] |
| Condition | items (strict ascending IDs, no duplicates), sus (up to ten valid ratings), seconds (item sum), wall_seconds (elapsed block) |
| Item | item, category, original_response, clarification_response, initial_automatic_category, automatic_category, fallback_category, clarification_used, fallback_used, seconds, status |
| Timing projection | timing.A_item_seconds / B_item_seconds, null until five valid item times exist |

Absent categories/times are null or absent in historical native records. New projected timing explicitly uses null. A fallback-used record must not carry a final automatic prediction. Missing categories remain valid missingness, not validation errors. Validation checks structure and ranges; it does not assert that self-reported data are truthful.

`clariscale.flow.v1` is the new pure demo lifecycle state: consent, item, clarify, fallback, sus, download, upload, complete. Seen event IDs reject duplicate submissions. The JSON demo export uses `clariscale.demo.v1` and `data_type: synthetic_test`, not the native schema.

XLSX remains the native deployed format, with Session, Answers and SUS sheets. The dependency-free ZIP/OOXML writer produces genuine `.xlsx` files and serializes response text as inline strings. CSV escapes commas, quotes/newlines, and prefixes formula-leading strings with an apostrophe. Downloads contain sensitive content and are not protected by browser-storage encryption.
