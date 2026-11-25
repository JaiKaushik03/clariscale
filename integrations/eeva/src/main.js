const assessment = require("./assessment.json");

// Pure calculations are exported for reproducible tests. No participant data is
// sent to the platform metrics service, an LLM, or an external classifier.
const { mapFrequency } = require("./core.js");
// The same facial policy is shared by A and B.
// Responses and predicted categories never select an emotion.
function createAgentMotion(
  agent,
  clock = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  },
  onError = () => {},
) {
  let stopped = false;
  let mode = "listening";
  let phase = 0;
  let cursor = 0;
  let timer = null;
  let letters = "hello";
  let previous = "";
  let reported = false;
  let cueTick = 999;

  function apply(mouth = [0, 0, 0, 0], blink = 0) {
    const pose = [
      { au: "1", intensity: cueTick >= 10 && cueTick < 16 ? 7 : 0 },
      { au: "4", intensity: 0 },
      { au: "5", intensity: 0 },
      { au: "6", intensity: cueTick < 10 ? 2 : 0 },
      { au: "12", intensity: cueTick < 10 ? 6 : 0 },
      { au: "15", intensity: 0 },
      { au: "18", intensity: mouth[2] },
      { au: "20", intensity: mouth[3] },
      { au: "25", intensity: mouth[0] },
      { au: "26", intensity: mouth[1] },
      { au: "45", intensity: blink },
    ];

    // Native VoiceManager owns the mouth during speech.
    const applied =
      agent.nativeLipSync && mode === "speaking"
        ? pose.filter((unit) => !["18", "20", "25", "26"].includes(unit.au))
        : pose;

    const key = JSON.stringify(applied);
    if (previous === key && !agent.nativeLipSync) return;

    try {
      agent.setAUs(applied);
      previous = key;
    } catch (error) {
      if (!reported) {
        reported = true;
        onError(String(error));
      }
    }
  }

  function draw() {
    const blink = phase % 41 === 39 ? 90 : 0;

    if (mode === "open") {
      apply([55, 40, 0, 0]);
      return;
    }

    if (mode === "blink") {
      apply([0, 0, 0, 0], 90);
      return;
    }

    if (mode !== "speaking") {
      apply([0, 0, 0, 0], blink);
      return;
    }

    const letter = letters[cursor++ % letters.length];

    const mouth = /[mbp\s.,!?;:]/.test(letter)
      ? [0, 0, 0, 0]
      : /[ou]/.test(letter)
        ? [28, 18, 14, 0]
        : /[iey]/.test(letter)
          ? [24, 12, 0, 12]
          : /a/.test(letter)
            ? [44, 28, 0, 4]
            : [12, 7, 0, 0];

    apply(mouth, blink);
  }

  function tick() {
    if (stopped) return;

    draw();
    phase++;
    cueTick++;
    timer = clock.setTimeout(tick, 120);
  }

  function setMode(next) {
    if (stopped) return;

    if (agent.nativeLipSync && mode !== next) {
      agent.neutral?.();
    }

    mode = next;
    previous = "";
    draw();
  }

  tick();

  return {
    promptCue() {
      cueTick = 0;
      phase = 0;
      previous = "";
      draw();
    },

    startSpeaking(text) {
      letters = String(text || "hello").toLowerCase();
      cursor = 0;
      setMode("speaking");
    },

    listen() {
      setMode("listening");
    },

    testOpen() {
      setMode("open");
    },

    testBlink() {
      setMode("blink");
    },

    stop() {
      if (stopped) return;

      stopped = true;
      clock.clearTimeout(timer);
      cueTick = 999;
      previous = "";
      apply();
    },
  };
}

module.exports.createAgentMotion = createAgentMotion;

const {
  validParticipantCode,
  agreement,
  susScore,
  pssTotal,
  randomAssignment,
  summary,
  itemRows,
  toCSV,
} = require("./core.js");
const validCategory = (v) => Number.isInteger(v) && v >= 0 && v <= 4;
module.exports.studyCore = require("./core.js");

// Browser-standard storage and encryption.
function createLocalCollection(config) {
  let databasePromise;
  let publicKeyPromise;
  let serial = Promise.resolve();

  const encoder = new TextEncoder();

  const bytes64 = (bytes) => {
    let value = "";

    for (const b of new Uint8Array(bytes)) {
      value += String.fromCharCode(b);
    }

    return btoa(value);
  };

  function transaction(db, stores, mode) {
    try {
      return db.transaction(stores, mode, { durability: "strict" });
    } catch (_) {
      return db.transaction(stores, mode);
    }
  }

  function database() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        if (!config || !globalThis.indexedDB || !globalThis.crypto?.subtle) {
          reject(
            new Error(
              "Encrypted local storage is not available in this browser.",
            ),
          );
          return;
        }

        const request = indexedDB.open(config.database_name, 1);

        request.onupgradeneeded = () => {
          const db = request.result;

          db.createObjectStore("sessions", { keyPath: "session_id" });

          db.createObjectStore("codes", { keyPath: "id" });

          db.createObjectStore("meta", { keyPath: "id" });
        };

        request.onerror = () => {
          reject(request.error || new Error("Unable to open local storage."));
        };

        request.onblocked = () => {
          reject(
            new Error(
              "Another tab is blocking local storage. Close duplicate study tabs.",
            ),
          );
        };

        request.onsuccess = () => {
          request.result.onversionchange = () => request.result.close();

          resolve(request.result);
        };
      });
    }

    return databasePromise;
  }

  function publicKey() {
    if (!publicKeyPromise) {
      publicKeyPromise = crypto.subtle.importKey(
        "jwk",
        config.publicJwk,
        {
          name: "RSA-OAEP",
          hash: "SHA-256",
        },
        false,
        ["wrapKey"],
      );
    }

    return publicKeyPromise;
  }

  async function ready() {
    await publicKey();

    const db = await database();

    await new Promise((resolve, reject) => {
      const tx = transaction(db, ["meta"], "readwrite");

      tx.objectStore("meta").put({
        id: "storage-check",
        key_id: config.key_id,
      });

      tx.oncomplete = resolve;

      tx.onerror = tx.onabort = () => {
        reject(tx.error || new Error("Local storage write test failed."));
      };
    });
  }

  // Preserved AB/BA balancing:
  // honor a coordinator order, otherwise choose the less-used order and randomly break a tie.
  async function reserve(code, dataType, sessionId, requestedOrder = "") {
    const requested = String(requestedOrder || "")
      .trim()
      .toUpperCase();
    if (requested && !["AB", "BA"].includes(requested)) {
      throw new Error(
        "Assigned order must be AB or BA. No session has started.",
      );
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(config.key_id + ":" + String(code).trim().toUpperCase()),
    );

    const id = dataType + ":" + bytes64(digest);
    const db = await database();

    return new Promise((resolve, reject) => {
      const tx = transaction(db, ["codes", "meta"], "readwrite");

      let order;
      let duplicate = false;

      const codes = tx.objectStore("codes");
      const meta = tx.objectStore("meta");
      const lookup = codes.get(id);

      lookup.onsuccess = () => {
        if (lookup.result) {
          duplicate = true;
          tx.abort();
          return;
        }

        const countsRequest = meta.get("balance-" + dataType);

        countsRequest.onsuccess = () => {
          const counts = countsRequest.result || {
            id: "balance-" + dataType,
            AB: 0,
            BA: 0,
          };

          order =
            requested ||
            (counts.AB < counts.BA
              ? "AB"
              : counts.BA < counts.AB
                ? "BA"
                : crypto.getRandomValues(new Uint8Array(1))[0] < 128
                  ? "AB"
                  : "BA");

          counts[order]++;
          meta.put(counts);

          codes.add({
            id,
            session_id: sessionId,
            order,
            requested_order: requested || null,
            order_source: requested
              ? "coordinator_assigned"
              : "local_pc_balanced_assignment",
            reserved_at: new Date().toISOString(),
          });
        };
      };

      tx.oncomplete = () => {
        resolve({
          order,
          code_hash: id,
          requested_order: requested || null,
          order_source: requested
            ? "coordinator_assigned"
            : "local_pc_balanced_assignment",
        });
      };

      tx.onerror = tx.onabort = () => {
        reject(
          new Error(
            duplicate
              ? "This participant code is already recorded on this PC for this session type. Ask the host to check the code; do not participate twice."
              : "Could not reserve the participant code. No session has started.",
          ),
        );
      };
    });
  }

  async function encrypt(snapshot) {
    const aes = await crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt"],
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const aad = encoder.encode(
      config.project_id + "|" + config.key_id + "|" + snapshot.session_id,
    );

    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: aad,
      },
      aes,
      encoder.encode(JSON.stringify(snapshot)),
    );

    const wrapped = await crypto.subtle.wrapKey("raw", aes, await publicKey(), {
      name: "RSA-OAEP",
    });

    return {
      session_id: snapshot.session_id,
      key_id: config.key_id,
      project_id: config.project_id,
      format: config.format,
      data_type: snapshot.data_type,
      status: snapshot.status,
      order: snapshot.order,
      version: snapshot.version,
      started_at: snapshot.started_at,
      saved_at: new Date().toISOString(),

      iv: bytes64(iv),
      wrapped_key: bytes64(wrapped),
      ciphertext: bytes64(encrypted),
    };
  }

  function save(session) {
    const snapshot = JSON.parse(JSON.stringify(session));

    const task = serial
      .catch(() => {})
      .then(async () => {
        const packet = await encrypt(snapshot);
        const db = await database();

        await new Promise((resolve, reject) => {
          const tx = transaction(db, ["sessions"], "readwrite");

          tx.objectStore("sessions").put(packet);
          tx.oncomplete = resolve;

          tx.onerror = tx.onabort = () => {
            reject(tx.error || new Error("Session saving failed."));
          };
        });

        await new Promise((resolve, reject) => {
          const tx = db.transaction(["sessions"], "readonly");

          const request = tx.objectStore("sessions").get(packet.session_id);

          request.onerror = () => reject(request.error);

          request.onsuccess = () => {
            if (request.result?.ciphertext === packet.ciphertext) {
              resolve();
            } else {
              reject(new Error("Saved session could not be verified."));
            }
          };
        });

        return {
          receipt: packet.session_id,
          saved_at: packet.saved_at,
        };
      });

    serial = task;
    return task;
  }

  async function archive() {
    const db = await database();

    const records = await new Promise((resolve, reject) => {
      const request = db
        .transaction(["sessions"], "readonly")
        .objectStore("sessions")
        .getAll();

      request.onsuccess = () => resolve(request.result);

      request.onerror = () => reject(request.error);
    });

    return {
      format: "team21-encrypted-archive-v1",
      project_id: config.project_id,
      key_id: config.key_id,
      exported_at: new Date().toISOString(),
      records,
    };
  }

  function close() {
    serial
      .finally(() => {
        databasePromise?.then((db) => db.close()).catch(() => {});
      })
      .catch(() => {});
  }

  return {
    ready,
    reserve,
    save,
    close,
  };
}

module.exports.createLocalCollection = createLocalCollection;

// Participant-only Excel export. No CDN, third-party library or archive decryption.
// XLSX is an OOXML package in a standards-compliant, uncompressed ZIP container.
const ONEDRIVE_UPLOAD_URL = assessment.uploadUrl;

function sessionWorkbookRows(s) {
  if (!s || !s.assignment || !s.conditions?.A || !s.conditions?.B) {
    throw new Error("The current session is not available for export.");
  }

  const categoryLabel = (value) =>
    validCategory(value) ? assessment.categories[value] : null;
  const toUTC = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  };
  const a = s.conditions.A;
  const b = s.conditions.B;
  const metadata = [
    ["Field", "Value"],
    ["Participant code", s.participant_code],
    ["Session ID", s.session_id],
    ["Session type", s.data_type],
    ["Study version", s.version],
    ["Study status", s.status],
    ["Consent given", s.consent],
    ["CAP 5627 classmate", s.classmate],
    ["Requested order (host)", s.requested_order],
    ["Requested order (launch URL)", s.launch_requested_order],
    ["Actual condition order", s.order],
    ["Order source", s.assignment.order_source],
    ["A assigned PSS item IDs", s.assignment.A.join(", ")],
    ["B assigned PSS item IDs", s.assignment.B.join(", ")],
    ["Session started (UTC)", toUTC(s.started_at)],
    ["Session ended (UTC)", toUTC(s.ended_at)],
    ["A started (UTC)", toUTC(a.started_at)],
    ["B started (UTC)", toUTC(b.started_at)],
    ["A duration (seconds; excludes SUS)", a.seconds],
    ["B duration (seconds; excludes SUS)", b.seconds],
    ["A SUS score (0-100, only complete)", susScore(a.sus)],
    ["B SUS score (0-100, only complete)", susScore(b.sus)],
    [
      "PSS-10 total (0-40, only all items answered)",
      pssTotal(
        assessment.questions.map((_, index) => {
          const id = index + 1;
          const condition = s.assignment.A.includes(id) ? a : b;
          const item = condition.items.find((entry) => entry.item === id);
          return item
            ? (item.category ??
                item.automatic_category ??
                item.fallback_category ??
                null)
            : null;
        }),
      ),
    ],
    ["PSS-10 reverse-scored item IDs", assessment.reverseItems.join(", ")],
    ["Session collection mode", s.collection_mode],
    ["Agent speech enabled", s.speech_enabled],
    ["Facial policy", s.facial_policy],
    ["Mouth animation", s.mouth_animation],
    ["Mapping policy", s.mapping_policy],
    ["Timing definition", s.timing_definition],
    ["Deviations (JSON)", JSON.stringify(s.deviations || [])],
    ["Upload method", "Manual OneDrive upload; not automatically verified"],
    [
      "Export note",
      "This is only the current participant session; downloaded XLSX is not encrypted.",
    ],
  ];

  const answers = [
    [
      "PSS item ID",
      "Condition",
      "Exact PSS item wording",
      "Item status",
      "Missing response",
      "Final category (0-4)",
      "Final category label",
      "Original multiple-choice category (0-4)",
      "Original multiple-choice label",
      "Original typed response",
      "Clarification response",
      "Initial automatic category (0-4)",
      "Initial automatic label",
      "Final automatic category (0-4)",
      "Final automatic label",
      "Structured fallback category (0-4)",
      "Structured fallback label",
      "Clarification used",
      "Fallback used",
      "Reverse scored",
      "Scored PSS item value",
      "Item duration (seconds)",
      "Item started (UTC)",
    ],
  ];

  assessment.questions.forEach((question, index) => {
    const id = index + 1;
    const condition = s.assignment.A.includes(id) ? "A" : "B";
    const entry = (s.conditions[condition].items || []).find(
      (item) => item.item === id,
    );
    const item = entry || {};
    // Do not mistake a missing B `category` for a missing mapped/fallback answer.
    const finalCategory =
      item.category ??
      item.automatic_category ??
      item.fallback_category ??
      null;
    const missing = !validCategory(finalCategory);
    const reversed = assessment.reverseItems.includes(id);
    answers.push([
      id,
      condition,
      question,
      item.status || "not_started",
      missing,
      finalCategory,
      categoryLabel(finalCategory),
      item.category ?? null,
      categoryLabel(item.category),
      item.original_response ?? "",
      item.clarification_response ?? "",
      item.initial_automatic_category ?? null,
      categoryLabel(item.initial_automatic_category),
      item.automatic_category ?? null,
      categoryLabel(item.automatic_category),
      item.fallback_category ?? null,
      categoryLabel(item.fallback_category),
      Boolean(item.clarification_used),
      Boolean(item.fallback_used),
      reversed,
      missing ? null : reversed ? 4 - finalCategory : finalCategory,
      item.seconds ?? null,
      toUTC(item.started_at),
    ]);
  });

  const sus = [
    [
      "Condition",
      "SUS item ID",
      "Exact SUS statement",
      "Original response (1-5)",
      "SUS score (0-100; complete only)",
    ],
  ];
  ["A", "B"].forEach((condition) => {
    const values = s.conditions[condition].sus || [];
    const score = susScore(values);
    assessment.sus.forEach((statement, index) => {
      sus.push([condition, index + 1, statement, values[index] ?? null, score]);
    });
  });

  return [
    { name: "Session", rows: metadata, widths: [47, 85] },
    {
      name: "Answers",
      rows: answers,
      widths: [
        13, 13, 88, 23, 17, 17, 22, 23, 23, 65, 58, 22, 24, 22, 23, 25, 23, 19,
        17, 17, 20, 22, 30,
      ],
    },
    { name: "SUS", rows: sus, widths: [14, 15, 93, 24, 30] },
  ];
}

function createSessionXlsx(session) {
  require("./contracts.js").validateNativeSession(session);

  const sheets = sessionWorkbookRows(session);
  const encoder = new TextEncoder();
  const encode = (text) => encoder.encode(text);
  // Remove forbidden XML characters; retain newlines, tabs and Unicode.
  const xmlText = (value) =>
    String(value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const colName = (number) => {
    let result = "";
    for (let x = number; x; x = Math.floor((x - 1) / 26)) {
      result = String.fromCharCode(65 + ((x - 1) % 26)) + result;
    }
    return result;
  };
  const cellXml = (value, reference, header) => {
    const style = header ? ' s="1"' : ' s="2"';
    if (value === null || value === undefined)
      return `<c r="${reference}"${style}/>`;
    if (typeof value === "number" && Number.isFinite(value)) {
      return `<c r="${reference}"${style}><v>${value}</v></c>`;
    }
    if (typeof value === "boolean") {
      return `<c r="${reference}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
    }
    // inlineStr ensures text such as =1+1 is NOT an executable spreadsheet formula.
    return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
  };
  const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const paths = [];
  const sheetXmls = sheets.map((sheet, i) => {
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    paths.push(path);
    const cols = sheet.widths
      .map(
        (width, index) =>
          `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
      )
      .join("");
    const rows = sheet.rows
      .map((values, rowIndex) => {
        const number = rowIndex + 1;
        const maxText = Math.max(
          0,
          ...values.map((value) =>
            typeof value === "string"
              ? Math.max(value.split("\n").length, Math.ceil(value.length / 90))
              : 1,
          ),
        );
        const height =
          rowIndex === 0 ? 30 : Math.min(90, 19 * Math.max(1, maxText));
        const cells = values
          .map((value, colIndex) =>
            cellXml(value, colName(colIndex + 1) + number, rowIndex === 0),
          )
          .join("");
        return `<row r="${number}" ht="${height}" customHeight="1">${cells}</row>`;
      })
      .join("");
    const lastCol = colName(sheet.rows[0].length);
    return (
      xmlHead +
      `<worksheet xmlns="${ns}">` +
      `<dimension ref="A1:${lastCol}${sheet.rows.length}"/>` +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="18"/>' +
      `<cols>${cols}</cols><sheetData>${rows}</sheetData>` +
      `<autoFilter ref="A1:${lastCol}${sheet.rows.length}"/>` +
      "</worksheet>"
    );
  });

  const styles =
    xmlHead +
    `<styleSheet xmlns="${ns}">` +
    '<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173A4D"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment wrapText="1" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>' +
    "</styleSheet>";

  const workbook =
    xmlHead +
    `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets
      .map(
        (sheet, i) =>
          `<sheet name="${xmlText(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets></workbook>`;
  const workbookRels =
    xmlHead +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>";
  const contentTypes =
    xmlHead +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    paths
      .map(
        (path) =>
          `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    "</Types>";
  const rootRels =
    xmlHead +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";
  const files = [
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", rootRels],
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", workbookRels],
    ["xl/styles.xml", styles],
    ...paths.map((path, i) => [path, sheetXmls[i]]),
  ];

  // ZIP STORE method (no compression): supported by Excel and requires no libraries.
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let crc = n;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    table[n] = crc >>> 0;
  }
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const u16 = (view, offset, value) => view.setUint16(offset, value, true);
  const u32 = (view, offset, value) => view.setUint32(offset, value, true);
  const parts = [];
  const directory = [];
  let offset = 0;
  files.forEach(([filename, content]) => {
    const name = encode(filename);
    const data = encode(content);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const header = new DataView(local.buffer);
    u32(header, 0, 0x04034b50);
    u16(header, 4, 20);
    u16(header, 6, 0x0800); // UTF-8 flag.
    u16(header, 8, 0); // STORE compression method.
    u16(header, 10, 0);
    u16(header, 12, 0x0021); // 1980-01-01.
    u32(header, 14, checksum);
    u32(header, 18, data.length);
    u32(header, 22, data.length);
    u16(header, 26, name.length);
    local.set(name, 30);
    parts.push(local, data);
    directory.push({ name, size: data.length, checksum, offset });
    offset += local.length + data.length;
  });
  const centralStart = offset;
  directory.forEach((file) => {
    const central = new Uint8Array(46 + file.name.length);
    const view = new DataView(central.buffer);
    u32(view, 0, 0x02014b50);
    u16(view, 4, 20);
    u16(view, 6, 20);
    u16(view, 8, 0x0800);
    u16(view, 10, 0);
    u16(view, 12, 0);
    u16(view, 14, 0x0021);
    u32(view, 16, file.checksum);
    u32(view, 20, file.size);
    u32(view, 24, file.size);
    u16(view, 28, file.name.length);
    u32(view, 42, file.offset);
    central.set(file.name, 46);
    parts.push(central);
    offset += central.length;
  });
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50);
  u16(endView, 8, directory.length);
  u16(endView, 10, directory.length);
  u32(endView, 12, offset - centralStart);
  u32(endView, 16, centralStart);
  parts.push(end);
  return new Blob(parts, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

module.exports.createSessionXlsx = createSessionXlsx;
module.exports.sessionWorkbookRows = sessionWorkbookRows;

let activeCleanup = null;

module.exports.run = async function run(context) {
  // Keep native typing isolated from Unity keyboard capture.
  const frame = document.createElement("iframe");

  frame.title = "Questionnaire study form";

  frame.style.cssText =
    "position:absolute;top:100px;right:24px;left:auto;bottom:auto;transform:none;width:min(520px,48vw);min-width:260px;max-width:calc(100vw - 24px);height:calc(100vh - 145px);background:white;border:1px solid #b8c7c7;border-radius:12px;box-shadow:0 6px 24px #0003;pointer-events:auto;z-index:20";

  context.ui.mountOverlay(frame);

  const agentCanvas = document.querySelector("canvas");

  const canvasTransform = agentCanvas
    ? {
        transform: agentCanvas.style.transform,
        transformOrigin: agentCanvas.style.transformOrigin,
      }
    : null;

  const restoreCanvas = () => {
    if (agentCanvas && canvasTransform) {
      agentCanvas.style.transform = canvasTransform.transform;

      agentCanvas.style.transformOrigin = canvasTransform.transformOrigin;
    }
  };

  const resizePanel = () => {
    const compact = window.innerWidth < 760;

    frame.style.width = compact ? "calc(100vw - 24px)" : "min(420px,43vw)";

    frame.style.right = "12px";

    frame.style.top = compact ? "52vh" : "100px";

    frame.style.height = compact ? "calc(48vh - 12px)" : "calc(100vh - 145px)";

    if (agentCanvas) {
      if (compact) {
        agentCanvas.style.transform = "scale(.49)";
        agentCanvas.style.transformOrigin = "center top";
      } else {
        restoreCanvas();
      }
    }
  };

  resizePanel();
  window.addEventListener("resize", resizePanel);

  const formDocument = frame.contentDocument;

  formDocument.documentElement.lang = "en";
  formDocument.body.style.margin = "0";

  const root = formDocument.createElement("section");

  root.setAttribute("aria-label", "PSS-10 study");

  root.style.cssText =
    "box-sizing:border-box;width:100%;padding:22px;background:white;color:#172d32;font:16px/1.5 Arial,sans-serif";

  formDocument.body.appendChild(root);

  const collection = createLocalCollection(assessment.collection);

  let storageReady = false;
  let stopped = false;
  let session = null;
  let orderIndex = 0;
  let itemIndex = 0;
  let condition = null;
  let current = null;

  let speechEnabled = true;
  let speechBusy = false;
  let facialFailure = "";
  let faceWarning = null;

  const motion = createAgentMotion(context.agent, undefined, (error) => {
    facialFailure = "Facial animation unavailable: " + error;

    if (faceWarning) {
      faceWarning.textContent = facialFailure;
    }

    if (session) {
      session.deviations.push("Facial animation failure: " + error);
    }
  });

  const timers = new Set();
  const faceSettles = new Map();
  const activeDownloadUrls = new Set();
  let savedReceipt = null;
  let downloadInitiated = false;
  let submissionStage = null;

  let finish;

  const lifetime = new Promise((resolve) => {
    finish = resolve;
  });

  function cleanup() {
    if (stopped) return;

    window.removeEventListener("resize", resizePanel);

    restoreCanvas();
    stopped = true;
    motion.stop();

    timers.forEach(clearTimeout);
    timers.clear();
    activeDownloadUrls.forEach((url) => URL.revokeObjectURL(url));
    activeDownloadUrls.clear();

    faceSettles.forEach((resolve, id) => {
      clearTimeout(id);
      resolve();
    });

    faceSettles.clear();

    context.agent.stopSpeaking();
    context.agent.neutral();

    collection.close();
    frame.remove();
    finish();
  }

  activeCleanup = cleanup;
  context.onCleanup(cleanup);

  function el(tag, text, parent = root) {
    const node = formDocument.createElement(tag);

    if (text !== undefined) {
      node.textContent = text;
    }

    parent.appendChild(node);
    return node;
  }

  function clear() {
    root.replaceChildren();
    root.scrollTop = 0;
  }

  function button(text, action, parent = root) {
    const b = el("button", text, parent);

    b.type = "button";

    b.style.cssText =
      "padding:10px 14px;margin:10px 8px 0 0;border:1px solid #527574;border-radius:6px;background:#edf5f2;color:#183a35;cursor:pointer;font:inherit";

    b.addEventListener("click", async () => {
      if (stopped || b.disabled) return;

      b.disabled = true;

      try {
        await action();
      } catch (error) {
        if (session) {
          session.deviations.push(String(error));
          session.status = "error";
          review();
        } else {
          el("p", "Unable to start: " + String(error));
        }
      } finally {
        b.disabled = false;
      }
    });

    return b;
  }

  function field(label, tag = "input", parent = root) {
    const wrap = el("label", undefined, parent);

    wrap.style.cssText = "display:block;margin:12px 0";

    el("span", label, wrap);

    const input = el(tag, undefined, wrap);

    input.setAttribute("aria-label", label);

    input.style.cssText =
      "display:block;width:100%;box-sizing:border-box;padding:9px;font:inherit;margin-top:5px";

    return input;
  }

  function select(label, options, parent = root) {
    const input = field(label, "select", parent);

    const placeholder = el("option", "Choose an option", input);

    placeholder.value = "";

    options.forEach(([value, name]) => {
      const option = el("option", name, input);
      option.value = String(value);
    });

    return input;
  }

  function focusAgent() {
    const canvas = document.querySelector?.("canvas");

    if (canvas) {
      canvas.tabIndex = -1;
      canvas.focus();
    }
  }

  async function say(text) {
    if (!speechEnabled || stopped) return true;

    focusAgent();
    speechBusy = true;
    motion.startSpeaking(text);

    let timer;
    let failed = false;

    try {
      await Promise.race([
        Promise.resolve(context.agent.speak(text)),

        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("Agent speech timed out"));
          }, 60000);

          timers.add(timer);
        }),
      ]);
    } catch (error) {
      failed = true;

      context.agent.stopSpeaking();

      if (session) {
        session.deviations.push("Speech failure: " + String(error));
      }

      el(
        "p",
        "The spoken prompt was unavailable. This deviation is recorded. Please end the session and tell the study team before retrying.",
      );
    } finally {
      if (timer) {
        clearTimeout(timer);
        timers.delete(timer);
      }

      motion.listen();

      if (context.agent.nativeLipSync && !stopped) {
        await new Promise((resolve) => {
          const id = setTimeout(() => {
            faceSettles.delete(id);
            resolve();
          }, 300);

          faceSettles.set(id, resolve);
        });
      }

      speechBusy = false;
    }

    return !failed;
  }

  function participantControls() {
    button("End session", async () => {
      if (speechBusy) {
        context.agent.stopSpeaking();
      }

      motion.listen();
      session.status = "ended_early";

      await review();
    });
  }

  function setup() {
    clear();

    el("h2", "Questionnaire study setup");

    el(
      "p",
      "Please enter your participant code. You will answer ten questions once each using two formats. This study saves encrypted responses in the browser profile on the device you use.",
    );

    const participant = field("Participant code (for example S3-07)");

    participant.maxLength = 24;

    el(
      "p",
      "The host enters the participant code for a station session, following the course handout (for example S3-07: station 3, participant 7). For an online session, participants enter their own code. Keep the same code throughout both formats and both usability questionnaires. Do not enter your name or birth date.",
    );

    el(
      "p",
      storageReady
        ? "Encrypted saving is available in this browser profile. After your session is saved, download your results and manually upload the Excel file to OneDrive."
        : "Checking encrypted local saving...",
    );

    el(
      "p",
      "At the end of this study, please download your session results file and manually upload it using the OneDrive link provided. Keep the same participant code throughout. Do not include your name or birth date in your filename.",
    );

    const launchParams = new URL(window.location.href).searchParams;

    const requestedOrder = String(launchParams.get("order") || "")
      .trim()
      .toUpperCase();
    const order = select("Assigned condition order (host)", [
      ["AUTO", "Automatically balance AB and BA on this computer"],
      ["AB", "AB: multiple choice first, then conversation"],
      ["BA", "BA: conversation first, then multiple choice"],
    ]);
    order.value = ["AB", "BA"].includes(requestedOrder)
      ? requestedOrder
      : "AUTO";
    el(
      "p",
      "The host matches this order to the participant's assigned survey order before starting. Automatic balancing applies only when no order is assigned.",
    );
    if (requestedOrder && !["AB", "BA"].includes(requestedOrder)) {
      el(
        "p",
        "The link contains an invalid order. Ask the host to choose AB or BA before starting.",
      );
    }

    const assignedCode = launchParams.get("code");

    if (assignedCode) {
      participant.value = assignedCode;
    }

    const testControls = el("details");

    el("summary", "Team testing only", testControls);

    const type = select(
      "Session type",
      [
        ["study", "Real participant"],
        ["dry_run", "Team dry run"],
        ["synthetic_test", "Synthetic software test"],
      ],
      testControls,
    );

    type.value = "study";

    const classmate = field("CAP 5627 classmate");

    classmate.type = "checkbox";

    const speech = field(
      "Use agent speech (required for real study)",
      "input",
      testControls,
    );

    speech.type = "checkbox";
    speech.checked = true;

    const consent = field(
      "I am at least 18 and voluntarily agree to participate",
    );

    consent.type = "checkbox";

    el(
      "p",
      "This voluntary class study compares fixed-choice and typed answers to perceived-stress questions about the last month. The target duration is 15 minutes or less, including two usability questionnaires. You may skip an item or stop at any time; saved partial answers may remain in this browser profile. This is not a diagnosis or treatment. Do not include names or identifying details. No microphone or camera is used. Your answers are saved encrypted in the browser profile on this device. After a successful save, you can download your own results as an unencrypted Excel file and manually upload it to Jai and Valentina through their OneDrive file-request link. You can decline to upload a partial session if you stop early. The downloaded file and OneDrive copy are not encrypted by the local study storage system. No answers are uploaded automatically to Qualtrics or OneDrive. Online use also depends on having the necessary eEVA and FIU access.",
    );

    const warning = el("p", "");
    warning.setAttribute("role", "status");

    const faceCheck = el("details");

    el("summary", "Researcher facial movement check", faceCheck);

    faceWarning = el("p", facialFailure, faceCheck);

    faceWarning.setAttribute("role", "status");

    el(
      "p",
      "Team check before collection. Every original item starts with the same mild warm smile (1.2 seconds), a small attentive brow cue (0.72 seconds), then neutral listening. The schedule, blinks and speech animation are identical in A and B and AB/BA. Answers never select emotion. Hand-gesture control is not documented in the approved Project Studio APIs.",
      faceCheck,
    );

    button(
      "Open mouth test",
      () => {
        focusAgent();
        motion.testOpen();
      },
      faceCheck,
    );

    button(
      "Blink test",
      () => {
        focusAgent();
        motion.testBlink();
      },
      faceCheck,
    );

    button(
      "Preview fixed smile and attentive cue",
      () => {
        focusAgent();
        motion.listen();
        motion.promptCue();
      },
      faceCheck,
    );

    button(
      "Return to listening face",
      () => {
        focusAgent();
        motion.listen();
      },
      faceCheck,
    );

    button(
      "Play speech and face check",
      () =>
        say(
          "Hello. You will answer ten questions once each, in two formats. Please answer naturally.",
        ),
      faceCheck,
    );

    button("Begin session", async () => {
      const code = participant.value.trim().toUpperCase();

      if (!validParticipantCode(code)) {
        warning.textContent =
          "Please enter a participant code, for example S3-07.";
        return;
      }

      if (!type.value || !consent.checked) {
        warning.textContent =
          "Select a session type and agree to participate before starting.";
        return;
      }

      if (!storageReady) {
        warning.textContent =
          "Saving is unavailable. Ask the host to restore storage before starting.";
        return;
      }

      if (type.value === "study" && !speech.checked) {
        warning.textContent =
          "Real study sessions require the same agent speech in both conditions.";
        return;
      }

      const sessionId = crypto.randomUUID();

      let reservation;

      try {
        reservation = await collection.reserve(
          code,
          type.value,
          sessionId,
          order.value === "AUTO" ? "" : order.value,
        );
      } catch (error) {
        warning.textContent = String(error.message || error);
        return;
      }

      speechEnabled = speech.checked;
      motion.listen();

      savedReceipt = null;
      downloadInitiated = false;
      submissionStage = null;

      session = {
        schema_version: "clariscale.session.v1",
        assigned_order: order.value === "AUTO" ? null : order.value,
        session_id: sessionId,
        participant_code: code,
        data_type: type.value,
        classmate: classmate.checked,
        version: assessment.version,
        requested_order: reservation.requested_order,
        launch_requested_order: requestedOrder || null,

        collection_mode: "encrypted_local_pc",

        assignment: {
          ...randomAssignment(Math.random, reservation.order),
          order_source: reservation.order_source,
        },

        consent: true,
        started_at: new Date().toISOString(),
        ended_at: null,
        status: "in_progress",
        speech_enabled: speechEnabled,

        facial_policy:
          "fixed item-onset warm smile for 1.2 seconds, attentive brow for 0.72 seconds, then neutral listening; same cue schedule in A/B and AB/BA; no answer-dependent emotion; periodic blinks and framework speech/mouth requests; visual execution and phoneme alignment not established",

        mouth_animation: context.agent.nativeLipSync
          ? "eEVA native VoiceManager lip sync enabled; mouth AUs are not overwritten during speech"
          : "approximate speech-state AU animation, not audio-aligned phoneme lip sync",

        mapping_policy:
          "deterministic frequency rules; explicit negation or conflicting frequencies require clarification",

        deviations: [],

        timing_definition:
          "Item seconds include spoken prompts and clarification; condition wall-clock seconds also include local autosaves between items. SUS is excluded.",

        conditions: {
          A: {
            items: [],
            sus: [],
            seconds: null,
            started_at: null,
          },

          B: {
            items: [],
            sus: [],
            seconds: null,
            started_at: null,
          },
        },
      };

      session.order = session.assignment.order;

      await collection.save(session);

      clear();
      el("h2", "Study instructions");

      const instructions =
        "You will answer ten questions about your feelings and thoughts during the last month. Five questions use fixed choices and five use typed answers. Each question appears only once. Answer fairly quickly with your best estimate rather than counting exact occurrences. There are no right or wrong answers. We are testing the interface, not you. You may stop at any time. At the end, download your Excel results file and manually upload it using the OneDrive link.";

      el("p", instructions);

      const ready = await say(instructions);

      if (!stopped) {
        const start = button("Start first questionnaire", beginCondition);

        start.disabled = !ready && session.data_type === "study";
      }

      participantControls();
    });
  }

  function beginCondition() {
    condition = session.order[orderIndex];
    itemIndex = 0;

    session.conditions[condition].started_at = Date.now();

    return showItem();
  }

  async function showItem() {
    if (stopped) return;

    const questionId = session.assignment[condition][itemIndex];

    current = {
      item: questionId,
      question: assessment.questions[questionId - 1],
      started_at: Date.now(),
      status: "in_progress",
      category: null,
      original_response: "",
      clarification_response: "",
      initial_automatic_category: null,
      automatic_category: null,
      fallback_category: null,
      clarification_used: false,
      fallback_used: false,
      seconds: null,
    };

    session.conditions[condition].items[itemIndex] = current;

    motion.promptCue();

    await renderItem("initial");
  }

  async function renderItem(stage) {
    const item = current;

    clear();

    el("h2", "Question " + (itemIndex + 1) + " of 5");

    el("p", item.question);

    let input;

    if (condition === "A" || stage === "fallback") {
      input = select(
        "Your answer",
        assessment.categories.map((label, i) => [i, label]),
      );
    } else {
      if (stage === "clarify") {
        el(
          "p",
          "Could you describe how often that happened during the last month?",
        );
      }

      input = field("Your answer", "textarea");

      input.rows = 3;
      input.maxLength = 4000;
    }

    const notice = el("p", "");
    notice.setAttribute("role", "status");

    let blankPrompted = false;

    const next = button("Continue", async () => {
      if (speechBusy || current !== item) {
        return;
      }

      const raw = input.value;

      if (!raw.trim()) {
        if (!blankPrompted) {
          blankPrompted = true;

          notice.textContent =
            "Please answer if you wish. Continue again to leave this item unanswered.";

          return;
        }

        item.status = "unanswered";

        await finishItem(item);
        return;
      }

      if (condition === "A") {
        item.category = Number(raw);
        item.status = "answered";

        await finishItem(item);
        return;
      }

      if (stage === "fallback") {
        item.fallback_category = Number(raw);
        item.fallback_used = true;
        item.status = "structured_fallback";

        await finishItem(item);
        return;
      }

      const mapped = mapFrequency(raw);

      if (stage === "initial") {
        item.original_response = raw;
        item.initial_automatic_category = mapped;
      } else {
        item.clarification_response = raw;
      }

      if (mapped !== null) {
        item.automatic_category = mapped;

        item.status =
          stage === "clarify" ? "mapped_after_clarification" : "mapped_initial";

        await finishItem(item);
      } else if (stage === "initial") {
        item.clarification_used = true;

        await renderItem("clarify");
      } else {
        item.fallback_used = true;

        await renderItem("fallback");
      }
    });

    next.disabled = true;

    participantControls();

    const ready = await say(
      stage === "clarify"
        ? "Could you describe how often that happened during the last month?"
        : stage === "fallback"
          ? "Please choose the response that best represents how often this happened."
          : item.question,
    );

    if (!stopped && current === item) {
      next.disabled = !ready && session.data_type === "study";

      input.focus();
    }
  }

  async function finishItem(item) {
    if (!session || session.status !== "in_progress") {
      return;
    }

    item.seconds = (Date.now() - item.started_at) / 1000;

    await collection.save(session);

    if (!session || session.status !== "in_progress") {
      return;
    }

    if (++itemIndex < 5) {
      await showItem();
    } else {
      session.conditions[condition].wall_seconds =
        (Date.now() - session.conditions[condition].started_at) / 1000;
      session.conditions[condition].seconds =
        require("./contracts.js").taskSeconds(
          session.conditions[condition].items,
        );

      await collection.save(session);
      showSUS();
    }
  }

  function showSUS() {
    clear();

    el("h2", "Your experience with this format");

    el(
      "p",
      "Rate the format you just used. 1 means strongly disagree; 5 means strongly agree.",
    );

    const fields = assessment.sus.map((statement, i) =>
      select(
        i + 1 + ". " + statement,
        [1, 2, 3, 4, 5].map((n) => [n, String(n)]),
      ),
    );

    const notice = el("p", "");
    notice.setAttribute("role", "status");

    button("Save questionnaire", async () => {
      if (fields.some((input) => input.value === "")) {
        notice.textContent =
          "Answer all ten statements, or use End session if you wish to stop.";

        return;
      }

      const activeSession = session;

      session.conditions[condition].sus = fields.map((input) =>
        Number(input.value),
      );

      await collection.save(session);

      if (session !== activeSession || session.status !== "in_progress") {
        return;
      }

      if (++orderIndex < 2) {
        clear();

        el("h2", "Next questionnaire");

        el(
          "p",
          "The next format contains the other five questions. No question is repeated.",
        );

        button("Start next questionnaire", beginCondition);

        participantControls();
      } else {
        session.status = "completed";

        session.ended_at = new Date().toISOString();

        await review();
      }
    });

    participantControls();
  }

  function acknowledgement(label) {
    const wrap = el("label");
    wrap.style.cssText =
      "display:flex;align-items:flex-start;gap:9px;margin:14px 0;cursor:pointer";
    const input = el("input", undefined, wrap);
    input.type = "checkbox";
    input.checked = false;
    input.style.cssText = "width:18px;height:18px;flex:none;margin-top:3px";
    el("span", label, wrap);
    return input;
  }

  function startWorkbookDownload() {
    if (!session || !savedReceipt) {
      throw new Error("The local save has not been confirmed.");
    }
    const workbook = createSessionXlsx(session);
    const safeCode =
      String(session.participant_code || "participant")
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 32) || "participant";
    const safeId = String(session.session_id || "session")
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .slice(0, 36);
    const filename = `PSS10_${safeCode}_${safeId}.xlsx`;
    const url = URL.createObjectURL(workbook);
    activeDownloadUrls.add(url);
    const anchor = formDocument.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    formDocument.body.appendChild(anchor);
    try {
      anchor.click();
    } catch (error) {
      URL.revokeObjectURL(url);
      activeDownloadUrls.delete(url);
      throw error;
    } finally {
      anchor.remove();
    }
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      activeDownloadUrls.delete(url);
      timers.delete(timer);
    }, 90000);
    timers.add(timer);
    // A click requests a browser download, but does not prove a file was saved.
    return filename;
  }

  function showDownload() {
    if (!session || !savedReceipt) return;
    submissionStage = "download";
    clear();
    el("h2", "Download your results");
    el("p", "Participant code: " + session.participant_code);
    el(
      "p",
      session.status === "completed"
        ? "Your completed study session was saved locally."
        : "This is an incomplete session. Downloading and uploading it is optional; you may close this page without submitting it.",
    );
    el(
      "p",
      "Download and keep this Excel file for the next step. It contains only your responses and is readable without the browser encryption key.",
    );
    const notice = el(
      "p",
      "After your browser starts the download, confirm that you have the file using the checkbox below.",
    );
    notice.setAttribute("role", "status");
    const downloaded = acknowledgement("I have downloaded my results file");
    const proceed = button("Proceed to upload", () => {
      if (
        submissionStage !== "download" ||
        !downloadInitiated ||
        !downloaded.checked ||
        advancing
      )
        return;
      advancing = true;
      showUpload();
    });
    let advancing = false;
    proceed.disabled = true;
    const sync = () => {
      proceed.disabled = advancing || !downloadInitiated || !downloaded.checked;
    };
    downloaded.addEventListener("change", sync);
    const downloadButton = button("Download my results (.xlsx)", () => {
      if (submissionStage !== "download") return;
      try {
        const filename = startWorkbookDownload();
        downloadInitiated = true;
        notice.textContent =
          "Download started: " +
          filename +
          ". Confirm that the file is on your device before checking the box. Your browser may block downloads.";
        sync();
      } catch (error) {
        notice.textContent =
          "Could not start the Excel download: " +
          String(error.message || error) +
          ". Check browser download permissions and try again. Your saved study answers have not been changed.";
        downloadInitiated = false;
        sync();
      }
    });
    button("Download own-session JSON (optional backup)", () => {
      try {
        const data = require("./contracts.js").ownSession(
          session,
          session.session_id,
        );
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          }),
        );
        activeDownloadUrls.add(url);
        const a = formDocument.createElement("a");
        a.href = url;
        a.download = "ClariScale-session.json";
        a.click();
        const timer = setTimeout(() => {
          URL.revokeObjectURL(url);
          activeDownloadUrls.delete(url);
          timers.delete(timer);
        }, 90000);
        timers.add(timer);
        notice.textContent =
          "Own-session JSON backup requested. The Excel download is still required for the manual upload workflow.";
      } catch (_) {
        notice.textContent =
          "JSON export validation failed. Ask the host for assistance.";
      }
    });
    // Keep the download action above its acknowledgement and progression.
    root.insertBefore(downloadButton, downloaded.parentNode);
    el(
      "p",
      "A started download is not proof of a completed download. The checkbox is your own confirmation.",
    );
  }

  function showUpload() {
    if (!session || !savedReceipt || !downloadInitiated) return;
    submissionStage = "upload";
    clear();
    el("h2", "Upload your results");
    el("p", "Participant code: " + session.participant_code);
    el(
      "p",
      "Upload the Excel (.xlsx) file downloaded in the previous step to the OneDrive file-request folder “eva results”.",
    );
    const uploadLink = el("a", "Open OneDrive upload page");
    uploadLink.href = ONEDRIVE_UPLOAD_URL;
    uploadLink.target = "_blank";
    uploadLink.rel = "noopener noreferrer";
    uploadLink.style.cssText =
      "display:inline-block;padding:11px 14px;margin:8px 0;color:#124a7a;background:#e8f3ff;border-radius:6px;text-decoration:underline;font-weight:bold";
    el(
      "p",
      "The link opens in a new tab. Opening the page does not upload a file.",
    );
    const linkField = field("Full OneDrive upload URL (select to copy)");
    linkField.value = ONEDRIVE_UPLOAD_URL;
    linkField.readOnly = true;
    linkField.addEventListener("focus", () => linkField.select());
    const copyNotice = el("p", "");
    copyNotice.setAttribute("role", "status");
    button("Copy upload link", async () => {
      try {
        if (!navigator.clipboard?.writeText) {
          linkField.focus();
          linkField.select();
          copyNotice.textContent =
            "Link selected. Press Ctrl+C (or Copy on your device) to copy it.";
          return;
        }
        await navigator.clipboard.writeText(ONEDRIVE_UPLOAD_URL);
        copyNotice.textContent = "Upload link copied.";
      } catch (_) {
        linkField.focus();
        linkField.select();
        copyNotice.textContent =
          "Automatic copying is unavailable. Select the field and copy it manually.";
      }
    });
    el(
      "p",
      "After OneDrive confirms your upload, return here and check the box. eEVA cannot independently verify the upload.",
    );
    const uploaded = acknowledgement("I have uploaded my results file");
    let advancing = false;
    const proceed = button("Proceed", () => {
      if (submissionStage !== "upload" || !uploaded.checked || advancing)
        return;
      advancing = true;
      showFinished();
    });
    proceed.disabled = true;
    uploaded.addEventListener("change", () => {
      proceed.disabled = advancing || !uploaded.checked;
    });
    button("Back to download", () => {
      if (submissionStage !== "upload" || advancing) return;
      advancing = true;
      showDownload();
    });
  }

  function showFinished() {
    if (!session || !savedReceipt) return;
    submissionStage = "finished";
    clear();
    el("h2", "Thank you");
    el(
      "p",
      session.status === "completed"
        ? "You have completed the submission steps. You may now close this page."
        : "You have finished the optional submission steps for your incomplete session. You may now close this page.",
    );
    el("p", "Participant code: " + session.participant_code);
    el("p", "Local save receipt: " + savedReceipt.receipt);
    el(
      "p",
      "The OneDrive upload was confirmed by your checkbox, not verified by eEVA.",
    );
    button("Next participant", () => {
      if (submissionStage !== "finished") return;
      session = null;
      current = null;
      condition = null;
      orderIndex = 0;
      itemIndex = 0;
      savedReceipt = null;
      downloadInitiated = false;
      submissionStage = null;
      motion.listen();
      setup();
    });
  }

  function showPartialOptions() {
    if (!session || !savedReceipt) return;
    submissionStage = "partial";
    clear();
    el("h2", "Partial session saved");
    el("p", "Participant code: " + session.participant_code);
    el("p", "Local save receipt: " + savedReceipt.receipt);
    el(
      "p",
      "This session is not marked completed (status: " +
        session.status +
        "). Its available responses were saved locally. You may close this page now; downloading or uploading is entirely optional.",
    );
    button("Download/upload partial results (optional)", () => {
      if (submissionStage !== "partial") return;
      showDownload();
    });
  }

  async function review() {
    if (!session) return;

    if (!session.ended_at) {
      session.ended_at = new Date().toISOString();
    }

    clear();
    el("h2", "Saving your session");
    el("p", "Please keep this page open until saving is confirmed.");
    const savingSession = session;
    let receipt;
    try {
      receipt = await collection.save(savingSession);
      if (session !== savingSession) return;
    } catch (error) {
      el("p", "Saving was not confirmed. Please keep this page open.");
      el("p", String(error.message || error));
      button("Retry saving", review);
      return;
    }

    savedReceipt = receipt;
    if (session.status === "completed") {
      showDownload();
    } else {
      showPartialOptions();
    }
  }

  try {
    await collection.ready();
    storageReady = true;
  } catch (error) {
    clear();

    el("h2", "Saving is unavailable");

    el(
      "p",
      "The study cannot start until saving is restored. Use the regular Chrome profile on the study computer.",
    );

    el("p", String(error.message || error));

    await lifetime;
    return;
  }

  setup();

  await lifetime;
};

module.exports.stop = async function stop() {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
};
