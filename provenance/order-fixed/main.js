const assessment = require('./assessment.json');

// Pure calculations are exported for reproducible tests. No participant data is
// sent to the platform metrics service, an LLM, or an external classifier.
function mapFrequency(raw) {
  const text = String(raw || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").trim();
  if (!text || /\b(don't know|do not know|not sure|unsure|it depends|maybe|cannot say|can't say)\b/.test(text)) return null;

  // Abstain when frequency language is negated.
  if (/\b(not|no|don't|dont|doesn't|doesnt|didn't|didnt|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|haven't|havent|hasn't|hasnt|hadn't|hadnt|can't|cant|cannot|couldn't|couldnt|wouldn't|wouldnt|won't|wont|without)\b/.test(text)) return null;

  const rules = [
    [1, /\b(almost never|hardly ever|rarely|seldom)\b/g],
    [4, /\b(very often|almost always|almost every day|every day|daily|all the time|most days|always)\b/g],
    [3, /\b(fairly often|quite often|frequently|often)\b/g],
    [2, /\b(sometimes|occasionally|from time to time)\b/g],
    [0, /\bnever\b/g]
  ];

  let remaining = text;
  const found = new Set();

  rules.forEach(([value, pattern]) => {
    remaining = remaining.replace(pattern, () => {
      found.add(value);
      return ' ';
    });
  });

  return found.size === 1 ? Array.from(found)[0] : null;
}

// The same facial policy is shared by A and B.
// Responses and predicted categories never select an emotion.
function createAgentMotion(
  agent,
  clock = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id)
  },
  onError = () => {}
) {
  let stopped = false;
  let mode = 'listening';
  let phase = 0;
  let cursor = 0;
  let timer = null;
  let letters = 'hello';
  let previous = '';
  let reported = false;
  let cueTick = 999;

  function apply(mouth = [0, 0, 0, 0], blink = 0) {
    const pose = [
      { au: '1', intensity: cueTick >= 10 && cueTick < 16 ? 7 : 0 },
      { au: '4', intensity: 0 },
      { au: '5', intensity: 0 },
      { au: '6', intensity: cueTick < 10 ? 2 : 0 },
      { au: '12', intensity: cueTick < 10 ? 6 : 0 },
      { au: '15', intensity: 0 },
      { au: '18', intensity: mouth[2] },
      { au: '20', intensity: mouth[3] },
      { au: '25', intensity: mouth[0] },
      { au: '26', intensity: mouth[1] },
      { au: '45', intensity: blink }
    ];

    // Native VoiceManager owns the mouth during speech.
    const applied = agent.nativeLipSync && mode === 'speaking'
      ? pose.filter(unit => !['18', '20', '25', '26'].includes(unit.au))
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

    if (mode === 'open') {
      apply([55, 40, 0, 0]);
      return;
    }

    if (mode === 'blink') {
      apply([0, 0, 0, 0], 90);
      return;
    }

    if (mode !== 'speaking') {
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
    previous = '';
    draw();
  }

  tick();

  return {
    promptCue() {
      cueTick = 0;
      phase = 0;
      previous = '';
      draw();
    },

    startSpeaking(text) {
      letters = String(text || 'hello').toLowerCase();
      cursor = 0;
      setMode('speaking');
    },

    listen() {
      setMode('listening');
    },

    testOpen() {
      setMode('open');
    },

    testBlink() {
      setMode('blink');
    },

    stop() {
      if (stopped) return;

      stopped = true;
      clock.clearTimeout(timer);
      cueTick = 999;
      previous = '';
      apply();
    }
  };
}

module.exports.createAgentMotion = createAgentMotion;

const validCategory = value =>
  Number.isInteger(value) && value >= 0 && value <= 4;

function agreement(pairs) {
  const eligible = pairs.filter(
    p => validCategory(p.expected) && validCategory(p.predicted)
  );

  const n = eligible.length;

  if (!n) {
    return {
      n: 0,
      matches: 0,
      percent: null,
      kappa: null
    };
  }

  const matches = eligible.filter(
    p => p.expected === p.predicted
  ).length;

  const a = [0, 0, 0, 0, 0];
  const b = [0, 0, 0, 0, 0];

  eligible.forEach(p => {
    a[p.expected]++;
    b[p.predicted]++;
  });

  const pe = a.reduce(
    (sum, count, i) => sum + count * b[i],
    0
  ) / (n * n);

  return {
    n,
    matches,
    percent: matches / n * 100,
    kappa: pe === 1
      ? null
      : (matches / n - pe) / (1 - pe)
  };
}

function susScore(values) {
  if (
    values.length !== 10 ||
    values.some(v => !Number.isInteger(v) || v < 1 || v > 5)
  ) {
    return null;
  }

  return values.reduce(
    (sum, v, i) => sum + (i % 2 === 0 ? v - 1 : 5 - v),
    0
  ) * 2.5;
}

function pssTotal(values) {
  if (
    values.length !== 10 ||
    !values.every(validCategory)
  ) {
    return null;
  }

  return values.reduce(
    (sum, value, i) =>
      sum + ([4, 5, 7, 8].includes(i + 1) ? 4 - value : value),
    0
  );
}

// Fixed question assignment:
// A always receives original items 1-5.
// B always receives original items 6-10.
// The existing collection.reserve() supplies the balanced AB/BA order.
function randomAssignment(random = Math.random, requestedOrder = '') {
  const validOrder = ['AB', 'BA'].includes(requestedOrder);

  return {
    order: validOrder
      ? requestedOrder
      : (random() < 0.5 ? 'AB' : 'BA'),

    A: [1, 2, 3, 4, 5],
    B: [6, 7, 8, 9, 10],

    order_source: validOrder
      ? 'coordinator_assigned'
      : 'independent_random'
  };
}

function csvCell(value) {
  let text = value === null || value === undefined
    ? ''
    : String(value);

  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) {
    text = "'" + text;
  }

  return '"' + text.replace(/"/g, '""') + '"';
}

function summary(session) {
  const a = session.conditions.A;
  const b = session.conditions.B;

  const accepted = b.items.filter(
    i => validCategory(i.automatic_category)
  ).length;

  const categories = assessment.questions.map((_, index) => {
    const item = [...a.items, ...b.items].find(
      row => row.item === index + 1
    );

    return item
      ? (
        item.category ??
        item.automatic_category ??
        item.fallback_category ??
        null
      )
      : null;
  });

  return {
    A_item_ids: session.assignment.A,
    B_item_ids: session.assignment.B,

    mapping_coverage_percent: accepted / 5 * 100,
    automatic_items: accepted,

    clarification_items: b.items.filter(
      i => i.clarification_used
    ).length,

    structured_fallback_items: b.items.filter(
      i => i.fallback_used
    ).length,

    A_seconds: a.seconds,
    B_seconds: b.seconds,
    A_SUS: susScore(a.sus),
    B_SUS: susScore(b.sus),

    PSS10_total: pssTotal(categories),

    total_score_includes_fallback: b.items.some(
      i => validCategory(i.fallback_category)
    ),

    analysis_note:
      'Different items are assigned to A and B. No within-person cross-format item agreement or kappa is calculated. Blind human coding of B text is required for mapper agreement.'
  };
}

function itemRows(s) {
  return assessment.questions.map((question, i) => {
    const condition = s.assignment.A.includes(i + 1) ? 'A' : 'B';

    const row = s.conditions[condition].items.find(
      item => item.item === i + 1
    ) || {};

    const category =
      row.category ??
      row.automatic_category ??
      row.fallback_category ??
      null;

    return {
      session_id: s.session_id,
      participant_code: s.participant_code,
      data_type: s.data_type,
      version: s.version,
      order: s.order,
      order_source: s.assignment.order_source,
      status: s.status,

      A_item_ids: s.assignment.A.join('|'),
      B_item_ids: s.assignment.B.join('|'),

      item: i + 1,
      condition,
      question,
      raw_category: category,

      reverse_scored: [4, 5, 7, 8].includes(i + 1),

      scored_value: validCategory(category)
        ? (
          [4, 5, 7, 8].includes(i + 1)
            ? 4 - category
            : category
        )
        : null,

      original_response: row.original_response || '',
      clarification_response: row.clarification_response || '',

      initial_automatic_category:
        row.initial_automatic_category ?? null,

      automatic_category: row.automatic_category ?? null,
      fallback_category: row.fallback_category ?? null,

      clarification_used: !!row.clarification_used,
      fallback_used: !!row.fallback_used,

      item_seconds: row.seconds ?? null,
      item_status: row.status || 'not_started',

      A_seconds: s.conditions.A.seconds,
      B_seconds: s.conditions.B.seconds,

      A_SUS: susScore(s.conditions.A.sus),
      B_SUS: susScore(s.conditions.B.sus)
    };
  });
}

function toCSV(rows) {
  if (!rows.length) return '';

  const keys = Object.keys(rows[0]);

  return '\uFEFF' + [
    keys.map(csvCell).join(','),
    ...rows.map(
      row => keys.map(k => csvCell(row[k])).join(',')
    )
  ].join('\r\n');
}

function validParticipantCode(code) {
  const value = String(code || '').trim();

  return (
    value.length > 0 &&
    value.length <= 24 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

module.exports.studyCore = {
  validParticipantCode,
  mapFrequency,
  agreement,
  susScore,
  pssTotal,
  randomAssignment,
  summary,
  itemRows,
  toCSV
};

// Browser-standard storage and encryption.
function createLocalCollection(config) {
  let databasePromise;
  let publicKeyPromise;
  let serial = Promise.resolve();

  const encoder = new TextEncoder();

  const bytes64 = bytes => {
    let value = '';

    for (const b of new Uint8Array(bytes)) {
      value += String.fromCharCode(b);
    }

    return btoa(value);
  };

  function transaction(db, stores, mode) {
    try {
      return db.transaction(
        stores,
        mode,
        { durability: 'strict' }
      );
    } catch (_) {
      return db.transaction(stores, mode);
    }
  }

  function database() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        if (
          !config ||
          !globalThis.indexedDB ||
          !globalThis.crypto?.subtle
        ) {
          reject(
            new Error(
              'Encrypted local storage is not available in this browser.'
            )
          );
          return;
        }

        const request = indexedDB.open(config.database_name, 1);

        request.onupgradeneeded = () => {
          const db = request.result;

          db.createObjectStore(
            'sessions',
            { keyPath: 'session_id' }
          );

          db.createObjectStore(
            'codes',
            { keyPath: 'id' }
          );

          db.createObjectStore(
            'meta',
            { keyPath: 'id' }
          );
        };

        request.onerror = () => {
          reject(
            request.error ||
            new Error('Unable to open local storage.')
          );
        };

        request.onblocked = () => {
          reject(
            new Error(
              'Another tab is blocking local storage. Close duplicate study tabs.'
            )
          );
        };

        request.onsuccess = () => {
          request.result.onversionchange = () =>
            request.result.close();

          resolve(request.result);
        };
      });
    }

    return databasePromise;
  }

  function publicKey() {
    if (!publicKeyPromise) {
      publicKeyPromise = crypto.subtle.importKey(
        'jwk',
        config.publicJwk,
        {
          name: 'RSA-OAEP',
          hash: 'SHA-256'
        },
        false,
        ['wrapKey']
      );
    }

    return publicKeyPromise;
  }

  async function ready() {
    await publicKey();

    const db = await database();

    await new Promise((resolve, reject) => {
      const tx = transaction(
        db,
        ['meta'],
        'readwrite'
      );

      tx.objectStore('meta').put({
        id: 'storage-check',
        key_id: config.key_id
      });

      tx.oncomplete = resolve;

      tx.onerror = tx.onabort = () => {
        reject(
          tx.error ||
          new Error('Local storage write test failed.')
        );
      };
    });
  }

  // Preserved AB/BA balancing:
  // honor a coordinator order, otherwise choose the less-used order and randomly break a tie.
  async function reserve(code, dataType, sessionId, requestedOrder = '') {
    const requested = String(requestedOrder || '').trim().toUpperCase();
    if (requested && !['AB', 'BA'].includes(requested)) {
      throw new Error('Assigned order must be AB or BA. No session has started.');
    }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(
        config.key_id + ':' +
        String(code).trim().toUpperCase()
      )
    );

    const id = dataType + ':' + bytes64(digest);
    const db = await database();

    return new Promise((resolve, reject) => {
      const tx = transaction(
        db,
        ['codes', 'meta'],
        'readwrite'
      );

      let order;
      let duplicate = false;

      const codes = tx.objectStore('codes');
      const meta = tx.objectStore('meta');
      const lookup = codes.get(id);

      lookup.onsuccess = () => {
        if (lookup.result) {
          duplicate = true;
          tx.abort();
          return;
        }

        const countsRequest = meta.get(
          'balance-' + dataType
        );

        countsRequest.onsuccess = () => {
          const counts = countsRequest.result || {
            id: 'balance-' + dataType,
            AB: 0,
            BA: 0
          };

          order = requested || (counts.AB < counts.BA
            ? 'AB'
            : counts.BA < counts.AB
              ? 'BA'
              : (
                crypto.getRandomValues(
                  new Uint8Array(1)
                )[0] < 128
                  ? 'AB'
                  : 'BA'
              ));

          counts[order]++;
          meta.put(counts);

          codes.add({
            id,
            session_id: sessionId,
            order,
            requested_order: requested || null,
            order_source: requested ? 'coordinator_assigned' : 'local_pc_balanced_assignment',
            reserved_at: new Date().toISOString()
          });
        };
      };

      tx.oncomplete = () => {
        resolve({
          order,
          code_hash: id,
          requested_order: requested || null,
          order_source: requested ? 'coordinator_assigned' : 'local_pc_balanced_assignment'
        });
      };

      tx.onerror = tx.onabort = () => {
        reject(
          new Error(
            duplicate
              ? 'This participant code is already recorded on this PC for this session type. Ask the host to check the code; do not participate twice.'
              : 'Could not reserve the participant code. No session has started.'
          )
        );
      };
    });
  }

  async function encrypt(snapshot) {
    const aes = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256
      },
      true,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(
      new Uint8Array(12)
    );

    const aad = encoder.encode(
      config.project_id + '|' +
      config.key_id + '|' +
      snapshot.session_id
    );

    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad
      },
      aes,
      encoder.encode(JSON.stringify(snapshot))
    );

    const wrapped = await crypto.subtle.wrapKey(
      'raw',
      aes,
      await publicKey(),
      { name: 'RSA-OAEP' }
    );

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
      ciphertext: bytes64(encrypted)
    };
  }

  function save(session) {
    const snapshot = JSON.parse(
      JSON.stringify(session)
    );

    const task = serial.catch(() => {}).then(async () => {
      const packet = await encrypt(snapshot);
      const db = await database();

      await new Promise((resolve, reject) => {
        const tx = transaction(
          db,
          ['sessions'],
          'readwrite'
        );

        tx.objectStore('sessions').put(packet);
        tx.oncomplete = resolve;

        tx.onerror = tx.onabort = () => {
          reject(
            tx.error ||
            new Error('Session saving failed.')
          );
        };
      });

      await new Promise((resolve, reject) => {
        const tx = db.transaction(
          ['sessions'],
          'readonly'
        );

        const request = tx.objectStore(
          'sessions'
        ).get(packet.session_id);

        request.onerror = () =>
          reject(request.error);

        request.onsuccess = () => {
          if (
            request.result?.ciphertext ===
            packet.ciphertext
          ) {
            resolve();
          } else {
            reject(
              new Error(
                'Saved session could not be verified.'
              )
            );
          }
        };
      });

      return {
        receipt: packet.session_id,
        saved_at: packet.saved_at
      };
    });

    serial = task;
    return task;
  }

  async function archive() {
    const db = await database();

    const records = await new Promise(
      (resolve, reject) => {
        const request = db.transaction(
          ['sessions'],
          'readonly'
        ).objectStore('sessions').getAll();

        request.onsuccess = () =>
          resolve(request.result);

        request.onerror = () =>
          reject(request.error);
      }
    );

    return {
      format: 'team21-encrypted-archive-v1',
      project_id: config.project_id,
      key_id: config.key_id,
      exported_at: new Date().toISOString(),
      records
    };
  }

  function close() {
    serial.finally(() => {
      databasePromise
        ?.then(db => db.close())
        .catch(() => {});
    }).catch(() => {});
  }

  return {
    ready,
    reserve,
    save,
    archive,
    close
  };
}

module.exports.createLocalCollection =
  createLocalCollection;

let activeCleanup = null;

module.exports.run = async function run(context) {
  // Keep native typing isolated from Unity keyboard capture.
  const frame = document.createElement('iframe');

  frame.title = 'Questionnaire study form';

  frame.style.cssText =
    'position:absolute;top:100px;right:24px;left:auto;bottom:auto;transform:none;width:min(520px,48vw);min-width:260px;max-width:calc(100vw - 24px);height:calc(100vh - 145px);background:white;border:1px solid #b8c7c7;border-radius:12px;box-shadow:0 6px 24px #0003;pointer-events:auto;z-index:20';

  context.ui.mountOverlay(frame);

  const agentCanvas = document.querySelector('canvas');

  const canvasTransform = agentCanvas
    ? {
      transform: agentCanvas.style.transform,
      transformOrigin: agentCanvas.style.transformOrigin
    }
    : null;

  const restoreCanvas = () => {
    if (agentCanvas && canvasTransform) {
      agentCanvas.style.transform =
        canvasTransform.transform;

      agentCanvas.style.transformOrigin =
        canvasTransform.transformOrigin;
    }
  };

  const resizePanel = () => {
    const compact = window.innerWidth < 760;

    frame.style.width = compact
      ? 'calc(100vw - 24px)'
      : 'min(420px,43vw)';

    frame.style.right = '12px';

    frame.style.top = compact
      ? '52vh'
      : '100px';

    frame.style.height = compact
      ? 'calc(48vh - 12px)'
      : 'calc(100vh - 145px)';

    if (agentCanvas) {
      if (compact) {
        agentCanvas.style.transform = 'scale(.49)';
        agentCanvas.style.transformOrigin = 'center top';
      } else {
        restoreCanvas();
      }
    }
  };

  resizePanel();
  window.addEventListener('resize', resizePanel);

  const formDocument = frame.contentDocument;

  formDocument.documentElement.lang = 'en';
  formDocument.body.style.margin = '0';

  const root = formDocument.createElement('section');

  root.setAttribute('aria-label', 'PSS-10 study');

  root.style.cssText =
    'box-sizing:border-box;width:100%;padding:22px;background:white;color:#172d32;font:16px/1.5 Arial,sans-serif';

  formDocument.body.appendChild(root);

  const collection = createLocalCollection(
    assessment.collection
  );

  let storageReady = false;
  let stopped = false;
  let session = null;
  let orderIndex = 0;
  let itemIndex = 0;
  let condition = null;
  let current = null;

  let speechEnabled = true;
  let speechBusy = false;
  let facialFailure = '';
  let faceWarning = null;

  const motion = createAgentMotion(
    context.agent,
    undefined,
    error => {
      facialFailure =
        'Facial animation unavailable: ' + error;

      if (faceWarning) {
        faceWarning.textContent = facialFailure;
      }

      if (session) {
        session.deviations.push(
          'Facial animation failure: ' + error
        );
      }
    }
  );

  const timers = new Set();
  const faceSettles = new Map();

  let finish;

  const lifetime = new Promise(resolve => {
    finish = resolve;
  });

  function cleanup() {
    if (stopped) return;

    window.removeEventListener(
      'resize',
      resizePanel
    );

    restoreCanvas();
    stopped = true;
    motion.stop();

    timers.forEach(clearTimeout);
    timers.clear();

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
    const b = el('button', text, parent);

    b.type = 'button';

    b.style.cssText =
      'padding:10px 14px;margin:10px 8px 0 0;border:1px solid #527574;border-radius:6px;background:#edf5f2;color:#183a35;cursor:pointer;font:inherit';

    b.addEventListener('click', async () => {
      if (stopped || b.disabled) return;

      b.disabled = true;

      try {
        await action();
      } catch (error) {
        if (session) {
          session.deviations.push(String(error));
          session.status = 'error';
          review();
        } else {
          el(
            'p',
            'Unable to start: ' + String(error)
          );
        }
      } finally {
        b.disabled = false;
      }
    });

    return b;
  }

  function field(
    label,
    tag = 'input',
    parent = root
  ) {
    const wrap = el('label', undefined, parent);

    wrap.style.cssText =
      'display:block;margin:12px 0';

    el('span', label, wrap);

    const input = el(tag, undefined, wrap);

    input.setAttribute('aria-label', label);

    input.style.cssText =
      'display:block;width:100%;box-sizing:border-box;padding:9px;font:inherit;margin-top:5px';

    return input;
  }

  function select(label, options, parent = root) {
    const input = field(label, 'select', parent);

    const placeholder = el(
      'option',
      'Choose an option',
      input
    );

    placeholder.value = '';

    options.forEach(([value, name]) => {
      const option = el('option', name, input);
      option.value = String(value);
    });

    return input;
  }

  function focusAgent() {
    const canvas =
      document.querySelector?.('canvas');

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
        Promise.resolve(
          context.agent.speak(text)
        ),

        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new Error('Agent speech timed out')
            );
          }, 60000);

          timers.add(timer);
        })
      ]);
    } catch (error) {
      failed = true;

      context.agent.stopSpeaking();

      if (session) {
        session.deviations.push(
          'Speech failure: ' + String(error)
        );
      }

      el(
        'p',
        'The spoken prompt was unavailable. This deviation is recorded. Please end the session and tell the study team before retrying.'
      );
    } finally {
      if (timer) {
        clearTimeout(timer);
        timers.delete(timer);
      }

      motion.listen();

      if (
        context.agent.nativeLipSync &&
        !stopped
      ) {
        await new Promise(resolve => {
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
    button('End session', async () => {
      if (speechBusy) {
        context.agent.stopSpeaking();
      }

      motion.listen();
      session.status = 'ended_early';

      await review();
    });
  }

  function setup() {
    clear();

    el('h2', 'Questionnaire study setup');

    el(
      'p',
      'This session runs on the study computer. Please enter the participant code for this session. You will answer ten questions once each, using two formats.'
    );

    const participant = field(
      'Participant code (for example S3-07)'
    );

    participant.maxLength = 24;

    el(
      'p',
      'The host enters the participant code for a station session, following the course handout (for example S3-07: station 3, participant 7). For an online session, participants enter their own code. Keep the same code throughout both formats and both usability questionnaires. Do not enter your name or birth date.'
    );

    el(
      'p',
      storageReady
        ? 'Saving is ready on this study computer. Complete both formats and both usability questionnaires, then wait for the saved confirmation before leaving.'
        : 'Checking local saving...'
    );

    const launchParams = new URL(
      window.location.href
    ).searchParams;

    const requestedOrder = String(launchParams.get('order') || '').trim().toUpperCase();
    const order = select('Assigned condition order (host)', [
      ['AUTO', 'Automatically balance AB and BA on this computer'],
      ['AB', 'AB: multiple choice first, then conversation'],
      ['BA', 'BA: conversation first, then multiple choice']
    ]);
    order.value = ['AB', 'BA'].includes(requestedOrder) ? requestedOrder : 'AUTO';
    el('p', "The host matches this order to the participant's assigned survey order before starting. Automatic balancing applies only when no order is assigned.");
    if (requestedOrder && !['AB', 'BA'].includes(requestedOrder)) {
      el('p', 'The link contains an invalid order. Ask the host to choose AB or BA before starting.');
    }

    const assignedCode = launchParams.get('code');

    if (assignedCode) {
      participant.value = assignedCode;
    }

    const testControls = el('details');

    el(
      'summary',
      'Team testing only',
      testControls
    );

    const type = select(
      'Session type',
      [
        ['study', 'Real participant'],
        ['dry_run', 'Team dry run'],
        ['synthetic_test', 'Synthetic software test']
      ],
      testControls
    );

    type.value = 'study';

    const classmate = field(
      'CAP 5627 classmate'
    );

    classmate.type = 'checkbox';

    const speech = field(
      'Use agent speech (required for real study)',
      'input',
      testControls
    );

    speech.type = 'checkbox';
    speech.checked = true;

    const consent = field(
      'I am at least 18 and voluntarily agree to participate'
    );

    consent.type = 'checkbox';

    el(
      'p',
      'This class study compares fixed-choice and typed answers to ten perceived-stress questions about the last month. The target duration is 15 minutes or less, including two usability questionnaires. You may leave an item unanswered or stop at any time. This is not diagnosis or treatment. Do not include names or identifying details in your answers. No microphone or camera is used. Your responses are saved in encrypted form in the Chrome profile on this computer for Jai and Valentina to review. They are not automatically sent to a central online survey. You may leave questions unanswered or stop; any responses already saved may remain as an incomplete session. Participants are not shown results or download controls.'
    );

    const warning = el('p', '');
    warning.setAttribute('role', 'status');

    const faceCheck = el('details');

    el(
      'summary',
      'Researcher facial movement check',
      faceCheck
    );

    faceWarning = el(
      'p',
      facialFailure,
      faceCheck
    );

    faceWarning.setAttribute(
      'role',
      'status'
    );

    el(
      'p',
      'Team check before collection. Every original item starts with the same mild warm smile (1.2 seconds), a small attentive brow cue (0.72 seconds), then neutral listening. The schedule, blinks and speech animation are identical in A and B and AB/BA. Answers never select emotion. Hand-gesture control is not documented in the approved Project Studio APIs.',
      faceCheck
    );

    button(
      'Open mouth test',
      () => {
        focusAgent();
        motion.testOpen();
      },
      faceCheck
    );

    button(
      'Blink test',
      () => {
        focusAgent();
        motion.testBlink();
      },
      faceCheck
    );

    button(
      'Preview fixed smile and attentive cue',
      () => {
        focusAgent();
        motion.listen();
        motion.promptCue();
      },
      faceCheck
    );

    button(
      'Return to listening face',
      () => {
        focusAgent();
        motion.listen();
      },
      faceCheck
    );

    button(
      'Play speech and face check',
      () => say(
        'Hello. You will answer ten questions once each, in two formats. Please answer naturally.'
      ),
      faceCheck
    );

    button('Begin session', async () => {
      const code = participant.value
        .trim()
        .toUpperCase();

      if (!validParticipantCode(code)) {
        warning.textContent =
          'Please enter a participant code, for example S3-07.';
        return;
      }

      if (
        !type.value ||
        !consent.checked
      ) {
        warning.textContent =
          'Select a session type and agree to participate before starting.';
        return;
      }

      if (!storageReady) {
        warning.textContent =
          'Saving is unavailable. Ask the host to restore storage before starting.';
        return;
      }

      if (
        type.value === 'study' &&
        !speech.checked
      ) {
        warning.textContent =
          'Real study sessions require the same agent speech in both conditions.';
        return;
      }

      const sessionId = crypto.randomUUID();

      let reservation;

      try {
        reservation = await collection.reserve(
          code,
          type.value,
          sessionId,
          order.value === 'AUTO' ? '' : order.value
        );
      } catch (error) {
        warning.textContent = String(
          error.message || error
        );
        return;
      }

      speechEnabled = speech.checked;
      motion.listen();

      session = {
        session_id: sessionId,
        participant_code: code,
        data_type: type.value,
        classmate: classmate.checked,
        version: assessment.version,
        requested_order: reservation.requested_order,
        launch_requested_order: requestedOrder || null,

        collection_mode: 'encrypted_local_pc',

        assignment: {
          ...randomAssignment(
            Math.random,
            reservation.order
          ),
          order_source: reservation.order_source
        },

        consent: true,
        started_at: new Date().toISOString(),
        ended_at: null,
        status: 'in_progress',
        speech_enabled: speechEnabled,

        facial_policy:
          'fixed item-onset warm smile for 1.2 seconds, attentive brow for 0.72 seconds, then neutral listening; same cue schedule in A/B and AB/BA; no answer-dependent emotion; periodic blinks and native lip sync; hand gestures unavailable in approved APIs',

        mouth_animation:
          context.agent.nativeLipSync
            ? 'eEVA native VoiceManager lip sync enabled; mouth AUs are not overwritten during speech'
            : 'approximate speech-state AU animation, not audio-aligned phoneme lip sync',

        mapping_policy:
          'deterministic frequency rules; explicit negation or conflicting frequencies require clarification',

        deviations: [],

        timing_definition:
          'Item seconds include spoken prompts and clarification; condition wall-clock seconds also include local autosaves between items. SUS is excluded.',

        conditions: {
          A: {
            items: [],
            sus: [],
            seconds: null,
            started_at: null
          },

          B: {
            items: [],
            sus: [],
            seconds: null,
            started_at: null
          }
        }
      };

      session.order = session.assignment.order;

      await collection.save(session);

      clear();
      el('h2', 'Study instructions');

      const instructions =
        'You will answer ten questions about your feelings and thoughts during the last month. Five questions use fixed choices and five use typed answers. Each question appears only once. Answer fairly quickly with your best estimate rather than counting exact occurrences. There are no right or wrong answers. We are testing the interface, not you. You may stop at any time.';

      el('p', instructions);

      const ready = await say(instructions);

      if (!stopped) {
        const start = button(
          'Start first questionnaire',
          beginCondition
        );

        start.disabled =
          !ready &&
          session.data_type === 'study';
      }

      participantControls();
    });
  }

  function beginCondition() {
    condition = session.order[orderIndex];
    itemIndex = 0;

    session.conditions[condition].started_at =
      Date.now();

    return showItem();
  }

  async function showItem() {
    if (stopped) return;

    const questionId =
      session.assignment[condition][itemIndex];

    current = {
      item: questionId,
      question: assessment.questions[questionId - 1],
      started_at: Date.now(),
      status: 'in_progress',
      category: null,
      original_response: '',
      clarification_response: '',
      initial_automatic_category: null,
      automatic_category: null,
      fallback_category: null,
      clarification_used: false,
      fallback_used: false,
      seconds: null
    };

    session.conditions[condition].items[itemIndex] =
      current;

    motion.promptCue();

    await renderItem('initial');
  }

  async function renderItem(stage) {
    const item = current;

    clear();

    el(
      'h2',
      'Question ' + (itemIndex + 1) + ' of 5'
    );

    el('p', item.question);

    let input;

    if (
      condition === 'A' ||
      stage === 'fallback'
    ) {
      input = select(
        'Your answer',
        assessment.categories.map(
          (label, i) => [i, label]
        )
      );
    } else {
      if (stage === 'clarify') {
        el(
          'p',
          'Could you describe how often that happened during the last month?'
        );
      }

      input = field(
        'Your answer',
        'textarea'
      );

      input.rows = 3;
      input.maxLength = 4000;
    }

    const notice = el('p', '');
    notice.setAttribute('role', 'status');

    let blankPrompted = false;

    const next = button('Continue', async () => {
      if (
        speechBusy ||
        current !== item
      ) {
        return;
      }

      const raw = input.value;

      if (!raw.trim()) {
        if (!blankPrompted) {
          blankPrompted = true;

          notice.textContent =
            'Please answer if you wish. Continue again to leave this item unanswered.';

          return;
        }

        item.status = 'unanswered';

        await finishItem(item);
        return;
      }

      if (condition === 'A') {
        item.category = Number(raw);
        item.status = 'answered';

        await finishItem(item);
        return;
      }

      if (stage === 'fallback') {
        item.fallback_category = Number(raw);
        item.fallback_used = true;
        item.status = 'structured_fallback';

        await finishItem(item);
        return;
      }

      const mapped = mapFrequency(raw);

      if (stage === 'initial') {
        item.original_response = raw;
        item.initial_automatic_category = mapped;
      } else {
        item.clarification_response = raw;
      }

      if (mapped !== null) {
        item.automatic_category = mapped;

        item.status = stage === 'clarify'
          ? 'mapped_after_clarification'
          : 'mapped_initial';

        await finishItem(item);
      } else if (stage === 'initial') {
        item.clarification_used = true;

        await renderItem('clarify');
      } else {
        item.fallback_used = true;

        await renderItem('fallback');
      }
    });

    next.disabled = true;

    participantControls();

    const ready = await say(
      stage === 'clarify'
        ? 'Could you describe how often that happened during the last month?'
        : stage === 'fallback'
          ? 'Please choose the response that best represents how often this happened.'
          : item.question
    );

    if (
      !stopped &&
      current === item
    ) {
      next.disabled =
        !ready &&
        session.data_type === 'study';

      input.focus();
    }
  }

  async function finishItem(item) {
    if (
      !session ||
      session.status !== 'in_progress'
    ) {
      return;
    }

    item.seconds =
      (Date.now() - item.started_at) / 1000;

    await collection.save(session);

    if (
      !session ||
      session.status !== 'in_progress'
    ) {
      return;
    }

    if (++itemIndex < 5) {
      await showItem();
    } else {
      session.conditions[condition].seconds =
        (
          Date.now() -
          session.conditions[condition].started_at
        ) / 1000;

      await collection.save(session);
      showSUS();
    }
  }

  function showSUS() {
    clear();

    el(
      'h2',
      'Your experience with this format'
    );

    el(
      'p',
      'Rate the format you just used. 1 means strongly disagree; 5 means strongly agree.'
    );

    const fields = assessment.sus.map(
      (statement, i) => select(
        (i + 1) + '. ' + statement,
        [1, 2, 3, 4, 5].map(
          n => [n, String(n)]
        )
      )
    );

    const notice = el('p', '');
    notice.setAttribute('role', 'status');

    button('Save questionnaire', async () => {
      if (
        fields.some(input => input.value === '')
      ) {
        notice.textContent =
          'Answer all ten statements, or use End session if you wish to stop.';

        return;
      }

      const activeSession = session;

      session.conditions[condition].sus =
        fields.map(
          input => Number(input.value)
        );

      await collection.save(session);

      if (
        session !== activeSession ||
        session.status !== 'in_progress'
      ) {
        return;
      }

      if (++orderIndex < 2) {
        clear();

        el('h2', 'Next questionnaire');

        el(
          'p',
          'The next format contains the other five questions. No question is repeated.'
        );

        button(
          'Start next questionnaire',
          beginCondition
        );

        participantControls();
      } else {
        session.status = 'completed';

        session.ended_at =
          new Date().toISOString();

        await review();
      }
    });

    participantControls();
  }

  async function review() {
    if (!session) return;

    if (!session.ended_at) {
      session.ended_at =
        new Date().toISOString();
    }

    clear();

    el('h2', 'Saving your session');

    el(
      'p',
      'Please keep this page open until saving is confirmed.'
    );

    const savingSession = session;

    let receipt;

    try {
      receipt = await collection.save(
        savingSession
      );

      if (session !== savingSession) {
        return;
      }
    } catch (error) {
      el(
        'p',
        'Saving was not confirmed. Please call the host and keep this page open.'
      );

      el('p', String(error.message || error));

      button('Retry saving', review);
      return;
    }

    const code = session.participant_code;
    const completed = session.status === 'completed';
    const dataType = session.data_type;

    clear();

    el(
      'h2',
      completed
        ? 'Session saved'
        : 'Partial session saved'
    );

    el(
      'p',
      'Participant code: ' + code
    );

    el(
      'p',
      dataType === 'study'
        ? 'Your responses have been saved on this study computer. You may now tell the host you are finished.'
        : 'This test session was saved separately from real participant data.'
    );

    el(
      'p',
      'Save receipt: ' + receipt.receipt
    );

    el(
      'p',
      'Results and downloads are available only through the separate researcher tools.'
    );

    session = null;
    current = null;
    condition = null;
    orderIndex = 0;
    itemIndex = 0;

    motion.listen();

    button(
      'Next participant',
      setup
    );
  }

  try {
    await collection.ready();
    storageReady = true;
  } catch (error) {
    clear();

    el('h2', 'Saving is unavailable');

    el(
      'p',
      'The study cannot start until saving is restored. Use the regular Chrome profile on the study computer.'
    );

    el(
      'p',
      String(error.message || error)
    );

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