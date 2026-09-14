/* ══════════════════════════════════════════════════════════════════
   SLIME — people.js
   One register for everyone Slime knows.
   ══════════════════════════════════════════════════════════════════

   WHERE THINGS LIVE, AND WHY THEY ARE SPLIT

     people.json          who someone is, and their support report.
                          Editable, shareable, reviewable by a clinician.
                          This is the file your spreadsheet becomes.

     localStorage         the face descriptor, written by vision.html.
                          128 numbers per person, tied to this device and
                          this camera. Never travels with the report.

   They are joined by NAME. Re-enrolling a face does not touch the report,
   and rewriting the report does not require re-enrolling anyone.

   WHAT THE REPORT DECIDES, at runtime

     communication.preferredFormat  →  pictures / voice / text / story
     regulation.calmAudio           →  which piece plays during a crisis
     regulation.calmVolume          →  how loud, from the sensory profile
     contacts[role=first contact]   →  who gets the alert
     companion.character            →  which face Slime wears

   Nothing here is chosen by the code. Change the report and the behaviour
   changes with it — that is the whole point.

   USE
     await SlimePeople.load();
     SlimePeople.get("Alberto")        → the whole entry
     SlimePeople.format("Alberto")     → "pictures"
     SlimePeople.calm("Alberto")       → { file, volume, why }
     SlimePeople.firstContact("Dana")  → "Maël"
   ══════════════════════════════════════════════════════════════════ */

window.SlimePeople = (function(){

  const FILE = "people.json";
  const STORE = "slime.passports";      // profiles entered in vision.html
  let people = {};
  let loaded = false;

  /* ── passports written on this device ──────────────────────────
     people.json is a file the browser can only read, so profiles filled
     in through vision.html live in localStorage and are merged over it.
     Export from vision.html to make one permanent. */
  function readStore(){
    try{ return JSON.parse(localStorage.getItem(STORE)) || {}; }
    catch(e){ return {}; }
  }
  function writeStore(all){
    try{ localStorage.setItem(STORE, JSON.stringify(all)); return true; }
    catch(e){ return false; }
  }

  async function load(url){
    try{
      const r = await fetch(url || FILE, { cache:"no-store" });
      if(!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      people = data.people || {};
      loaded = true;
    }catch(e){
      console.warn("[slime] people.json did not load:", e.message);
      people = {}; loaded = false;
    }
    /* locally entered passports win — they are the more recent edit */
    /* Under the SAME key, whatever the capitalisation: "ALBERTO" saved on the
       device replaces the "Alberto" people.json shipped with, rather than
       becoming a second person. Two entries for one face is how the wrong
       profile gets loaded. */
    const store = readStore();
    Object.keys(store).forEach((name) => {
      const k = Object.keys(people).find((x) => x.toLowerCase() === name.toLowerCase()) || name;
      people[k] = Object.assign({}, people[k], {
        role: "supported",
        passport: store[name],
        report: toReport(store[name], null),   // the imported document replaces, never merges
      });
    });
    return people;
  }

  /* ── passport → the handful of things the runtime acts on ──────
     The document is written for humans. These few fields are what the
     software reads; everything else is there for the people around them. */
  function detectFormat(text){
    const t = String(text || "").toLowerCase();
    if(/pictogram|picto|image|picture|symbol|pecs/.test(t)) return "pictures";
    if(/sign|speech|spoken|voice|oral|talk|verbal/.test(t)) return "voice";
    if(/stor|narrat/.test(t)) return "story";
    return "text";
  }

  function toReport(pp, existing){
    if(!pp) return existing || null;
    const who = pp.who || {}, com = pp.communication || {},
          wrong = pp.whenWrong || {}, med = pp.medical || {}, upd = pp.lastUpdate || {};
    const list = (s) => String(s || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

    return {
      name: [who.name, who.surname].filter(Boolean).join(" ") || who.preferredName || "",
      preferredName: who.preferredName || who.name || "",
      reference: pp.reference || "",
      reportDate: upd.date || "",
      author: upd.by || "",
      setting: upd.organisation || "",
      summary: pp.summary || "",
      communication: {
        preferredFormat: com.machineFormat || detectFormat(com.mostOften || com.howToCommunicate),
        secondFormat: detectFormat(com.expressMyself),
        detail: com.detail || "short",
        pace: com.pace || "normal",
        stepsSpoken: Number(com.stepsSpoken) || 3,
        stepsPictures: Number(com.stepsPictures) || 6,
        notes: [
          com.expressMyself && ("Expresses themselves with: " + com.expressMyself),
          com.mostOften && ("Uses most often: " + com.mostOften),
          com.changes && ("Communication changes when: " + com.changes),
          com.howToCommunicate && ("Communicate with them by: " + com.howToCommunicate),
          com.whatHelps && ("What helps understanding: " + com.whatHelps),
        ].filter(Boolean),
      },
      sensory: {
        stimulus: wrong.stimulus || "low",
        notes: [
          who.comfortable && ("Comfortable: " + who.comfortable),
          who.uncomfortable && ("Uncomfortable: " + who.uncomfortable),
        ].filter(Boolean),
      },
      learning: {
        worksWell: list(who.skills).concat(com.whatHelps ? [com.whatHelps] : []),
        doesNotWork: list(who.uncomfortable),
      },
      interests: list(who.specialInterest).concat(list(who.likes)),
      dislikes: list(who.dislikes),
      routine: who.routine || "",
      regulation: {
        earlySigns: list(wrong.signs),
        helps: list(wrong.calmMe),
        avoid: list(med.doNot),
        calmAudio: wrong.calmAudio || null,
        calmAudioWhy: wrong.calmMe || "",
        calmVolume: typeof wrong.calmVolume === "number" ? wrong.calmVolume : 0.3,
        stressors: list(wrong.stressors),
      },
      medical: {
        condition: med.condition || "",
        epilepsy: !!med.epilepsy,
        seizureType: med.seizureType || "",
        seizureDuration: med.seizureDuration || "",
        doThis: med.do || "",
        doNotDoThis: med.doNot || "",
        allergy: med.allergy || "",
        medication: med.medication || [],
      },
      contacts: (who.emergency || []).map((c, i) => ({
        name: c.name || "", relation: c.relation || "emergency contact",
        phone: c.phone || "", role: i === 0 ? "first contact" : "secondary",
      })),
      companion: { character: pp.companion || null },
      history: upd.history || [],
    };
  }

  const key = (name) => Object.keys(people)
    .find((k) => k.toLowerCase() === String(name || "").toLowerCase());

  function get(name){
    const k = key(name);
    return k ? Object.assign({ name:k }, people[k]) : null;
  }

  const report = (name) => { const p = get(name); return (p && p.report) || null; };
  const isSupported = (name) => { const p = get(name); return !!p && p.role === "supported"; };

  /* how this person is spoken to */
  function format(name){
    const r = report(name);
    return (r && r.communication && r.communication.preferredFormat) || "text";
  }

  /* what plays while someone is settling. Straight from the report, because
     the right sound for a low-stimulus profile is the wrong one for another. */
  function calm(name){
    const r = report(name);
    const g = (r && r.regulation) || {};
    return {
      file:   g.calmAudio || null,
      volume: typeof g.calmVolume === "number" ? g.calmVolume : 0.3,
      why:    g.calmAudioWhy || "",
    };
  }

  function firstContact(name){
    const r = report(name);
    const list = (r && r.contacts) || [];
    const first = list.find((c) => /first/i.test(c.role || "")) || list[0];
    return first ? first.name : null;
  }

  function character(name){
    const r = report(name);
    return (r && r.companion && r.companion.character) || null;
  }

  /* the handful of fields the on-screen profile panel shows */
  function flat(name){
    const r = report(name);
    if(!r) return { channel: format(name) };
    const c = r.communication || {}, s = r.sensory || {}, l = r.learning || {};
    return {
      channel: c.preferredFormat, detail: c.detail, pace: c.pace,
      stimulus: s.stimulus,
      interests: r.interests || [],
      whatWorks: l.worksWell || [], whatDoesnt: l.doesNotWork || [],
      notes: (c.notes || []).slice(0, 3),
    };
  }

  /* messaging targets, used by the alert route */
  function contactRoutes(name){
    const p = get(name);
    return p ? { telegram: p.telegram || "", phone: p.phone || "" } : { telegram:"", phone:"" };
  }

  function savePassport(name, passport){
    const all = readStore();
    Object.keys(all).forEach((k) => { if(k.toLowerCase() === name.toLowerCase() && k !== name) delete all[k]; });
    all[name] = passport;
    const ok = writeStore(all);
    if(ok){
      const k = Object.keys(people).find((x) => x.toLowerCase() === name.toLowerCase()) || name;
      people[k] = Object.assign({}, people[k], {
        role:"supported", passport, report: toReport(passport, null),
      });
    }
    return ok;
  }
  /* ── one shape for the panel, whatever the source ──────────────
     A person arrives two ways: a passport imported in vision.html, or a
     report already in people.json. The panel and the avatar should not
     care which. view() returns passport shape either way. */
  function view(name){
    const pp = passport(name);
    if(pp) return Object.assign({ _source:"imported profile" }, pp);
    const r = report(name);
    if(!r) return null;
    const c = r.communication || {}, s = r.sensory || {}, g = r.regulation || {}, m = r.medical || {};
    return {
      _source: "people.json",
      who: {
        name: r.name, preferredName: r.preferredName || r.name,
        specialInterest: (r.interests || [])[0] || "",
        likes: (r.interests || []).join(", "),
        dislikes: (r.dislikes || []).join(", "),
        routine: r.routine || "",
        comfortable: (g.helps || []).join(", "),
        uncomfortable: (g.stressors || []).concat((r.learning || {}).doesNotWork || []).join(", "),
        emergency: (r.contacts || []).map((x) => ({ name:x.name, relation:x.relation, phone:x.phone })),
      },
      communication: {
        expressMyself: c.secondFormat || "", mostOften: c.preferredFormat || "",
        howToCommunicate: (c.notes || [])[0] || "", whatHelps: (c.notes || [])[1] || "",
        machineFormat: c.preferredFormat || "text",
        stepsSpoken: c.stepsSpoken, stepsPictures: c.stepsPictures,
      },
      whenWrong: {
        stressors: (g.stressors || []).join(", "),
        signs: (g.earlySigns || []).join(", "),
        calmMe: (g.helps || []).join(", "),
        calmAudio: g.calmAudio || "", calmVolume: g.calmVolume,
        stimulus: s.stimulus || "",
      },
      medical: {
        condition: m.condition || "", epilepsy: m.epilepsy,
        seizureType: m.seizureType || "", seizureDuration: m.seizureDuration || "",
        do: m.doThis || "", doNot: m.doNotDoThis || "", allergy: m.allergy || "",
        medication: m.medication || [],
      },
      lastUpdate: {
        date: r.reportDate || "", by: r.author || "", organisation: r.setting || "",
        what: "", history: r.history || [],
      },
    };
  }

  function passport(name){ const k = key(name); return k && people[k] ? people[k].passport || null : null; }
  function deletePassport(name){
    const all = readStore(); delete all[name]; writeStore(all);
    if(people[name]) delete people[name].passport;
  }
  function exportAll(){
    return JSON.stringify({ people: Object.assign({}, people) }, null, 2);
  }

  return {
    load, get, report, flat, format, calm, firstContact, character,
    savePassport, passport, view, deletePassport, exportAll, toReport, detectFormat,
    contactRoutes, isSupported,
    all: () => Object.keys(people),
    supported: () => Object.keys(people).filter((n) => people[n].role === "supported"),
    isLoaded: () => loaded,
    /* anyone enrolled on this device who has no report on file */
    missingReports(enrolledNames){
      return (enrolledNames || [])
        .filter((n) => { const p = get(n); return p && p.role === "supported" && !p.report; })
        .concat((enrolledNames || []).filter((n) => !get(n)));
    },
  };
})();
