/* ══════════════════════════════════════════════════════════════════
   SLIME — scenes.js
   ══════════════════════════════════════════════════════════════════

   NOTHING IS PRESSED. Seeing a face is the only trigger.

     (all of this is OFF unless ?scenes=on — by default Slime is just the companion)

     Maël seen              → "What would you like to do today?"
                              whatever she asks becomes the task, and
                              Slime delivers it to each person in the
                              shape that person needs.
     Alberto / Dana seen    → "How can I help you?"
     Lina seen              → "What would you like to do today?"
                              she is authorised; a profile sheet opens
                              on screen and a copy is sent.
     Movement flag raised   → the crisis sequence.

   EVERY HELP ENDS THE SAME WAY: "Is that everything?" — one closing
   beat, so an action finishes cleanly before the next one starts.

   WHAT IS REAL   the camera really recognises people; each profile
                  really changes the format of the answer; the task is
                  really written by the model against that profile; the
                  alert really leaves the machine.
   WHAT IS SCRIPTED   the order of the beats. Say so if asked.

   YOU SUPPLY     enrolments in vision.html using the names in ROSTER,
                  optional calm-1.mp3 / calm-2.mp3, optional character
                  pages (missing ones fall back to the 3D gel).
   ══════════════════════════════════════════════════════════════════ */

window.SlimeScenes = (function(){

  /* OFF by default. The app is the ordinary companion until you decide otherwise.
     Turn it on with ?scenes=on in the address, or SlimeScenes.enable() in the console.
     The cast below is a placeholder — nobody is assigned a character here. Character
     choice comes from the film the person names, exactly as it always did. */
  let ENABLED = /[?&]scenes=on/.test(location.search);


  const ROSTER = {
    /* doc is filled in at startup from profile-<name>.json — that report is the
       source of truth for how Slime behaves with this person. The few fields
       here are only fallbacks if the file is missing. */
    /* Filled in from people.json at startup. These only matter if it fails to load. */
    Alberto: { role:"supported", alertTo:"Anthony", doc:null },
    Dana:    { role:"supported", alertTo:"Maël",    doc:null },
    Anthony: { role:"circle",    relation:"colleague of Alberto" },
    "Maël":  { role:"circle",    relation:"manager", canRequest:true },
    Lina:    { role:"clinician", relation:"doctor",  canRequest:true, authorised:true },
  };

  const CHARACTERS = {
    goku:    "char-goku.html",
    tintin:  "char-tintin.html",
    asterix: "char-asterix.html",
    doctor:  "char-doctor.html",
    macron:  "char-macron.html",
    coffee:  "char-coffee.html",
  };

  const GREET_COOLDOWN = 90000;
  const CLOSING = "Is that everything?";

  let api = null, scene = null, waitingFor = null, onSeen = null, audio = null;
  const lastGreeted = {};

  const log  = (m) => api && api.note && api.note(m);
  const yes  = (t) => /^\s*(yes|yeah|yep|ok|okay|sure|got it|that'?s all|all good|done|no more|nothing)/i.test(t || "");
  const neutral = () => api.setCharacter(null, "neutral");

  /* flatten the report into the handful of fields the UI shows */
  function flatten(p){
    if(window.SlimePeople && p && p.name && SlimePeople.report(p.name)) return SlimePeople.flat(p.name);
    const d = p.doc;
    if(!d) return { channel:p.channel };
    const c = d.communication || {}, s = d.sensory || {}, l = d.learning || {};
    return {
      channel: c.preferredFormat || p.channel,
      detail:  c.detail, pace: c.pace, stimulus: s.stimulus,
      interests: d.interests || [],
      whatWorks: l.worksWell || [], whatDoesnt: l.doesNotWork || [],
      notes: (c.notes || []).slice(0, 3),
    };
  }

  function becomeFor(name){
    const p = ROSTER[name];
    if(!p) return;
    p.name = name;
    /* Only switch the look if the report actually names one. Otherwise leave
       whatever the person chose through the film question. */
    const ch = p.doc && p.doc.companion && p.doc.companion.character;
    if(ch && CHARACTERS[ch]) api.setCharacter(CHARACTERS[ch], ch);
    api.setProfile(flatten(p));
  }

  /* people.json is the register. ROSTER below is only a fallback if it fails. */
  async function loadProfiles(){
    if(!window.SlimePeople) return;
    await SlimePeople.load();
    SlimePeople.all().forEach(function(name){
      var src = SlimePeople.get(name);
      ROSTER[name] = Object.assign({}, ROSTER[name], {
        role: src.role,
        relation: src.relation,
        canRequest: src.canRequest,
        authorised: src.authorised,
        doc: src.report || null,
        alertTo: SlimePeople.firstContact(name) || (ROSTER[name] && ROSTER[name].alertTo) || null,
      });
    });
  }

  function awaitPerson(match, then, prompt){
    waitingFor = match; onSeen = then;
    if(prompt) api.say(prompt);
  }

  /* ── the camera is the trigger ── */
  function personSeen(who){
    if(!ENABLED || !who || !who.name) return;

    if(scene && waitingFor){
      const list = Array.isArray(waitingFor) ? waitingFor : [waitingFor];
      if(!list.some((n) => n.toLowerCase() === who.name.toLowerCase())) return;
      const fn = onSeen; waitingFor = null; onSeen = null; fn(who);
      return;
    }
    if(scene) return;

    const p = ROSTER[who.name];
    if(!p) return;
    const now = Date.now();
    if(lastGreeted[who.name] && now - lastGreeted[who.name] < GREET_COOLDOWN) return;
    lastGreeted[who.name] = now;

    if(p.role === "clinician")      openClinician(who);
    else if(p.role === "supported") openCompanion(who);
    else if(p.canRequest)           openRequest(who);
  }

  /* ── the one closing beat every action shares ── */
  function close(then){
    if(!scene) scene = { id:"closing" };
    api.showSteps({ mode:"text", say:null, steps:[], check:CLOSING, mood:"calm" });
    scene.expectCheck = (answer) => {
      if(yes(answer)){
        api.say("Good. I am here when you need me.");
        const person = scene.person;
        neutral(); scene = null;
        if(then) then();
      } else {
        api.say("Tell me what else you need.");
        const person = scene.person;
        scene.expectRequest = (t) => deliver(t, person, () => close(then));
      }
    };
  }

  /* ── doing the thing, in the shape this person needs ── */
  function deliver(task, personName, then){
    if(!personName){ api.say("I am not sure who this is for."); scene = null; return; }
    becomeFor(personName);
    scene.person = personName;

    api.ask(task, personName).then((r) => {
      api.showSteps(r);
      scene.expectCheck = (answer) => {
        if(yes(answer)){
          api.say("Good. Thank you, " + personName + ".");
          setTimeout(() => (then ? then() : close()), 1400);
        } else {
          api.say("No problem. Another way.");
          api.ask(task, personName, r.mode).then((alt) => {
            api.showSteps(alt);
            scene.expectCheck = () => (then ? then() : close());
          });
        }
      };
    }).catch(() => { api.say("I could not put that together. Try again."); scene = null; });
  }

  /* ══════════ someone with standing asks for something ══════════ */
  function openRequest(who){
    scene = { id:"request", from:who.name };
    neutral();
    api.say("Hello " + who.name + ". What would you like to do today?");
    scene.expectRequest = (task) => {
      scene.task = task;
      api.say("I will show them. Let me find them.");
      const queue = ["Dana", "Alberto"];
      const next = () => {
        scene = scene || { id:"request", from:who.name, task:task };
        scene.id = "request"; scene.task = task; scene.from = who.name;
        if(!queue.length){
          neutral();
          api.say("Both done. I will tell " + who.name + ".");
          scene = null; return;
        }
        const name = queue.shift();
        awaitPerson(name,
          () => deliver(task, name, () => close(next)),
          "Could " + name + " come to the screen, please?");
      };
      next();
    };
  }

  /* ══════════ the person Slime accompanies ══════════ */
  /* demo.html already greets a recognised person and loads their profile, so
     this only opens the request loop — greeting twice was the old behaviour. */
  function openCompanion(who){
    scene = { id:"companion", person:who.name };
    becomeFor(who.name);
    scene.expectRequest = (task) => deliver(task, who.name, () => close());
  }

  /* ══════════ the clinician ══════════ */
  function openClinician(who){
    scene = { id:"clinician", doctor:who.name };
    neutral();
    api.say("Hello Doctor " + who.name + ". What would you like to do today?");
    const ask = (text) => {
      const m = String(text || "").match(/alberto|dana/i);
      if(!m){ api.say("Whose profile would you like?"); scene.expectRequest = ask; return; }
      sendProfile(m[0][0].toUpperCase() + m[0].slice(1).toLowerCase());
    };
    scene.expectRequest = ask;
  }

  function sendProfile(subject){
    const doc = scene.doctor;
    const p = ROSTER[subject] || {};
    if(!p.doc){ api.say("I do not have a report on file for " + subject + "."); close(); return; }
    api.say("Here is " + subject + "'s profile, Doctor " + doc + ". A copy is on its way to you.");
    api.showProfile(subject, p, doc);                       // opens on screen for the room to see
    api.callN8N({ action:"share-profile", subject, to:doc, at:new Date().toISOString() })
      .then(() => log("Copy sent to " + doc + "."))
      .catch(() => log("Could not send the copy."));
    close();
  }

  /* ══════════ the crisis sequence ══════════ */
  function openCrisis(flag){
    const name = (flag && flag.person) || (api.who() && api.who().name);
    const p = ROSTER[name];
    if(!p || p.role !== "supported"){ log("Flag raised, but no accompanied person recognised."); return; }

    scene = { id:"crisis", person:name };
    becomeFor(name);
    api.say("I am here. Let's slow down together.");
    /* Which piece, and how loud, comes from this person's sensory profile.
       A sustained drone settles one of them and adds load for the other. */
    var c = (window.SlimePeople && SlimePeople.calm(name)) || { file:p.calmAudio, volume:0.35 };
    playCalm(c.file, c.volume);
    if(c.why) console.log("[slime] calm audio for " + name + ": " + c.file + " — " + c.why);

    /* demo.html has already sent the alert. This one carries the extra context
       the scene knows — who to notify — and n8n de-duplicates on nothing, so if
       you see two messages, drop this call. */
    api.callN8N({
      action:"alert", person:name, notify:p.alertTo, source:"camera",
      contacts:(flag && flag.contacts) || null, seconds:(flag && flag.seconds) || null,
      at:new Date().toISOString(),
      message:"Repeated fast hand-to-head movement. Worth checking in.",
    }).then(() => log("Message sent to " + p.alertTo + "."))
      .catch(() => log("Could not reach " + p.alertTo + "."));

    awaitPerson([p.alertTo], (who) => {
      stopCalm(); neutral();
      api.showSteps({
        mode:"text",
        say:"Thank you for coming, " + who.name + ".",
        steps:["I saw repeated fast hand-to-head movement and let you know.",
               "I do not know what happened. You do."],
        check:"Is " + name + " alright now, or do you want to call 112?",
        mood:"attentive",
      });
      scene.expectCheck = (answer) => {
        if(/112|emergency|ambulance/i.test(answer)){
          /* Slime never dials. It puts the number in front of a person who decides. */
          api.showSteps({ mode:"text", say:"Then call 112 now.",
            steps:["112 — emergency services.", "Stay with " + name + " while you call."],
            check:null, mood:"attentive" });
          scene = null;
        } else {
          api.say("Good. I will keep things quiet for a while.");
          close();
        }
      };
    });
  }

  function playCalm(file, volume){
    stopCalm();
    if(!file) return;
    try{
      audio = new Audio(file); audio.loop = true;
      audio.volume = typeof volume === "number" ? volume : 0.35;
      audio.play().catch(() => log("Calming audio needs a click first, or the file is missing."));
    }catch(e){}
  }
  function stopCalm(){ if(audio){ audio.pause(); audio = null; } }

  /* ══════════ wiring ══════════ */
  return {
    init(hooks){ api = hooks; return ENABLED ? loadProfiles() : Promise.resolve(); },
    enable(){ ENABLED = true; return loadProfiles(); },
    disable(){ ENABLED = false; scene = null; waitingFor = null; onSeen = null; stopCalm(); },
    enabled(){ return ENABLED; },
    roster: ROSTER,
    flatten,
    characters: CHARACTERS,
    personSeen,
    /* Only the on-screen sequence. demo.html sends the alert itself, always,
       so nothing here can suppress it. */
    onFlag(flag){ if(ENABLED && !scene) openCrisis(flag); },
    active(){ return scene ? scene.id : null; },
    stop(){ scene = null; waitingFor = null; onSeen = null; stopCalm(); },
    /* demo.html offers the user's words here first; a live scene eats them */
    handleReply(text){
      if(!scene) return false;
      if(scene.expectRequest){ const f = scene.expectRequest; scene.expectRequest = null; f(text); return true; }
      if(scene.expectCheck){   const f = scene.expectCheck;   scene.expectCheck = null;   f(text); return true; }
      return false;
    },
    /* console testing only — the app itself is trigger-driven */
    start(id, arg){
      stopCalm(); waitingFor = null; onSeen = null; scene = null;
      if(id === "request")   return openRequest(arg || { name:"Maël" });
      if(id === "companion") return openCompanion(arg || { name:"Dana" });
      if(id === "clinician") return openClinician(arg || { name:"Lina" });
      if(id === "crisis")    return openCrisis(arg);
    },
  };
})();
