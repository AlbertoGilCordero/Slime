/* ══════════════════════════════════════════════════════════════════
   SLIME — vision.js
   Face recognition + a repetitive-motion flag, all in the browser.
   ══════════════════════════════════════════════════════════════════

   BUILT ON  vladmandic/human  (MIT) — face descriptors and body pose
   in one library, loaded from a CDN. Nothing installs.

   WHAT LEAVES THE DEVICE
     Nothing. Frames are processed in the browser and discarded. Only a
     128-number face descriptor per enrolled person is stored, in
     localStorage. No images are kept, none are uploaded.

   WHAT THIS IS NOT
     The motion flag is a HEURISTIC, not a clinical detector. It notices
     a hand repeatedly moving to the head at speed. That pattern has many
     innocent causes — scratching, adjusting glasses, tiredness. It is
     wired to say "something unusual, please check", never to assert what
     happened. Do not relabel it. A confident wrong alert is worse than
     no alert, because the family stops believing the next one.

   USE
     <script src="https://cdn.jsdelivr.net/npm/@vladmandic/human/dist/human.js"></script>
     <script src="vision.js"></script>

     SlimeVision.start({ video, onPerson, onFlag, onStatus })
     SlimeVision.enroll("Marta","sister","circle")  → saves whoever is on camera
       role "supported" = a person Slime accompanies (several allowed)
       role "circle"    = family, colleague, carer
       role "clinician" = a professional
     SlimeVision.people()                    → [{name, relation, role}]
     SlimeVision.exportFaces() / importFaces(list)  → move a device's data
     SlimeVision.forget("Marta")
     SlimeVision.stop()

   TUNE          the THRESHOLDS block below.
   ══════════════════════════════════════════════════════════════════ */

window.SlimeVision = (function(){

  const DB_KEY = "slime.vision.people";

  const THRESHOLDS = {
    faceMatch:      0.45,   // similarity above this counts as the same person
    minFaceScore:   0.55,   // ignore weak detections
    headRadius:     0.85,   // wrist within this × shoulder-width of the head counts as a contact
    minSpeed:       0.55,   // wrist must be moving this fast (screen widths / second)
    contactsNeeded: 4,      // this many contacts …
    windowMs:       6000,   // … inside this window raises the flag
    cooldownMs:     45000,  // then stay quiet this long
    identifyEvery:  700,    // ms between identity checks (cheap on the CPU)
  };

  let human = null, video = null, raf = null, running = false;
  let cb = { onPerson(){}, onFlag(){}, onStatus(){} };
  let people = load();
  let current = null, lastIdentify = 0;
  let contacts = [], lastFlag = 0;
  let lastWrist = { l:null, r:null }, lastT = 0;

  /* ── the enrolled household ── */
  function load(){
    try { return JSON.parse(localStorage.getItem(DB_KEY)) || []; }
    catch(e){ return []; }
  }
  function save(){
    try { localStorage.setItem(DB_KEY, JSON.stringify(people)); } catch(e){}
  }

  function similarity(a, b){
    if(human && human.match && typeof human.match.similarity === "function"){
      try { return human.match.similarity(a, b); } catch(e){}
    }
    /* fallback: euclidean distance mapped to 0-1, same shape as Human's own */
    let s = 0;
    for(let i = 0; i < a.length; i++){ const d = a[i] - b[i]; s += d*d; }
    return Math.max(0, 1 - Math.sqrt(s));
  }

  function identify(descriptor){
    let best = null, bestScore = 0;
    for(const p of people){
      const s = similarity(descriptor, p.descriptor);
      if(s > bestScore){ bestScore = s; best = p; }
    }
    return (best && bestScore >= THRESHOLDS.faceMatch)
      ? { name:best.name, relation:best.relation, role:best.role || "circle", score:bestScore }
      : { name:null, relation:null, role:null, score:bestScore };
  }

  /* ── the motion heuristic ── */
  function point(kps, name){
    const k = kps.find((x) => x.part === name);
    return (k && k.score > 0.3) ? { x:k.positionRaw ? k.positionRaw[0] : k.position[0] / (video.videoWidth || 1),
                                    y:k.positionRaw ? k.positionRaw[1] : k.position[1] / (video.videoHeight || 1) } : null;
  }

  function checkMotion(body, now){
    if(!body || !body.keypoints) return;
    const kps = body.keypoints;

    const head = point(kps, "nose") || point(kps, "leftEar") || point(kps, "rightEar");
    const ls = point(kps, "leftShoulder"), rs = point(kps, "rightShoulder");
    if(!head || !ls || !rs) return;

    const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y) || 0.2;
    const dt = lastT ? (now - lastT) / 1000 : 0;
    lastT = now;

    ["l","r"].forEach((side) => {
      const w = point(kps, side === "l" ? "leftWrist" : "rightWrist");
      if(!w){ lastWrist[side] = null; return; }

      let speed = 0;
      if(lastWrist[side] && dt > 0){
        speed = Math.hypot(w.x - lastWrist[side].x, w.y - lastWrist[side].y) / dt;
      }
      lastWrist[side] = w;

      const near = Math.hypot(w.x - head.x, w.y - head.y) < shoulderW * THRESHOLDS.headRadius;
      if(near && speed > THRESHOLDS.minSpeed){
        const last = contacts[contacts.length - 1];
        if(!last || now - last > 180) contacts.push(now);   // debounce one motion into one contact
      }
    });

    /* keep only what is inside the window */
    contacts = contacts.filter((t) => now - t < THRESHOLDS.windowMs);

    if(contacts.length >= THRESHOLDS.contactsNeeded && now - lastFlag > THRESHOLDS.cooldownMs){
      lastFlag = now;
      const payload = {
        kind: "repetitive-motion",
        contacts: contacts.length,
        seconds: Math.round(THRESHOLDS.windowMs / 1000),
        person: current && current.name ? current.name : null,
        at: new Date().toISOString(),
        /* deliberate wording — this reports a pattern, it does not diagnose one */
        message: "Repeated fast hand-to-head movement. Worth checking in.",
      };
      contacts = [];
      cb.onFlag(payload);
    }
  }

  /* ── loop ── */
  async function tick(){
    if(!running) return;
    raf = requestAnimationFrame(tick);
    if(video.readyState < 2) return;

    let res;
    try { res = await human.detect(video); } catch(e){ return; }
    const now = performance.now();

    if(res.body && res.body.length) checkMotion(res.body[0], now);

    if(now - lastIdentify > THRESHOLDS.identifyEvery){
      lastIdentify = now;
      const face = (res.face || []).filter((f) => f.score > THRESHOLDS.minFaceScore)[0];
      if(face && face.embedding){
        const who = identify(face.embedding);
        const changed = !current || current.name !== who.name;
        current = who;
        if(changed) cb.onPerson(who);
      } else if(current){
        current = null;
        cb.onPerson({ name:null, relation:null, role:null, score:0 });
      }
    }
  }

  /* ── public ── */
  async function start(opts){
    cb = Object.assign(cb, opts || {});
    video = opts.video;
    if(!window.Human){ cb.onStatus("Human library did not load. Check the CDN script tag."); return false; }

    cb.onStatus("asking for the camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video:{ width:640, height:480, facingMode:"user" }, audio:false });
      video.srcObject = stream;
      await video.play();
    } catch(e){
      cb.onStatus("camera blocked or unavailable: " + e.message);
      return false;
    }

    cb.onStatus("loading models…");
    human = new window.Human.Human({
      backend: "webgl",
      modelBasePath: "https://cdn.jsdelivr.net/npm/@vladmandic/human/models/",
      filter: { enabled:true, equalization:false },
      face: { enabled:true, detector:{ rotation:false, maxDetected:3 }, mesh:{ enabled:true },
              description:{ enabled:true }, iris:{ enabled:false }, emotion:{ enabled:false }, antispoof:{ enabled:false } },
      body: { enabled:true, maxDetected:1 },
      hand: { enabled:false }, gesture:{ enabled:false }, object:{ enabled:false }, segmentation:{ enabled:false },
    });
    await human.load();
    await human.warmup();

    running = true;
    lastT = 0; contacts = [];
    cb.onStatus("watching");
    tick();
    return true;
  }

  function stop(){
    running = false;
    if(raf) cancelAnimationFrame(raf);
    if(video && video.srcObject){
      video.srcObject.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    cb.onStatus("stopped");
  }

  async function enroll(name, relation, role){
    if(!human || !video) return { ok:false, error:"not started" };
    let res;
    try { res = await human.detect(video); } catch(e){ return { ok:false, error:e.message }; }
    const face = (res.face || []).filter((f) => f.score > THRESHOLDS.minFaceScore)[0];
    if(!face || !face.embedding) return { ok:false, error:"no clear face in view" };

    const existing = people.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    /* roles:
         supported  a person Slime accompanies. There can be several.
         circle     family, colleague, carer.
         clinician  a professional.  */
    const ROLES = ["supported", "circle", "clinician"];
    const entry = { name, relation: relation || "",
                    role: ROLES.indexOf(role) >= 0 ? role : "circle",
                    descriptor: Array.from(face.embedding) };
    if(existing >= 0) people[existing] = entry; else people.push(entry);
    save();
    return { ok:true, name, relation, role: entry.role };
  }

  function forget(name){
    people = people.filter((p) => p.name.toLowerCase() !== String(name).toLowerCase());
    save();
    if(current && current.name && current.name.toLowerCase() === String(name).toLowerCase()) current = null;
  }

  /* ── moving a device's data somewhere else ────────────────────
     Descriptors live in this browser under this exact origin, so
     localhost:8000 and 127.0.0.1:8000 hold separate copies. These let
     the data travel between them. */
  function exportFaces(){ return people; }
  function importFaces(list, replace){
    if(!Array.isArray(list)) return people.length;
    if(replace) people = [];
    list.forEach((p) => {
      if(!p || !p.name || !p.descriptor) return;
      const i = people.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase());
      const entry = { name:p.name, relation:p.relation || "", role:p.role || "circle",
                      descriptor:p.descriptor };
      if(i >= 0) people[i] = entry; else people.push(entry);
    });
    save();
    return people.length;
  }

  return {
    start, stop, enroll, forget, exportFaces, importFaces,
    people: () => people.map((p) => ({ name:p.name, relation:p.relation, role:p.role || "circle" })),
    supported: () => people.filter((p) => p.role === "supported")
                           .map((p) => ({ name:p.name, relation:p.relation, role:p.role })),
    find: (n) => people.find((p) => p.name.toLowerCase() === String(n).toLowerCase()) || null,
    who:    () => current,
    thresholds: THRESHOLDS,
  };
})();
