/* ══════════════════════════════════════════════════════════════════
   SLIME — voices.js
   A different voice for every character.
   ══════════════════════════════════════════════════════════════════

   One profile per character: which installed voice, at what pitch and speed.
   That is the whole file. Recorded clips were removed — everything Slime says
   is generated, so a clip library only ever covered the few fixed lines.

   The character pages have their own speech engine with phoneme-scheduled
   lipsync, so when one is loaded demo.html hands the line to IT with this
   character's voice settings. This file is used when no character page is up.

   USE
     SlimeVoices.setCharacter("goku");
     SlimeVoices.speak("Hello.", "goku", { onDone });
     SlimeVoices.installedVoices();   // check this on the presenting laptop
   ══════════════════════════════════════════════════════════════════ */

window.SlimeVoices = (function(){

  /* ── one profile per character ──────────────────────────────────
     prefer: substrings matched against the browser's installed voices,
             in order. First hit wins; anything unmatched falls back to
             the default voice for lang.
     pitch:  0 to 2, default 1.   rate: 0.1 to 10, default 1.
     Keep these clearly apart or two characters will sound the same. */
  const PROFILES = {
    goku:    { lang:"en-US", prefer:["Google US English","Samantha","Zira"], pitch:1.35, rate:1.06 },
    tintin:  { lang:"en-GB", prefer:["Google UK English Male","Daniel","George"], pitch:1.10, rate:1.00 },
    asterix: { lang:"en-GB", prefer:["Google UK English Male","Daniel","Arthur"], pitch:0.85, rate:0.94 },
    doctor:  { lang:"en-GB", prefer:["Google UK English Female","Serena","Kate"], pitch:1.00, rate:0.92 },
    macron:  { lang:"fr-FR", prefer:["Google français","Thomas","Amelie"], pitch:0.95, rate:1.00 },
    coffee:  { lang:"en-US", prefer:["Google US English","Alex","Fred"], pitch:0.70, rate:0.90 },
    neutral: { lang:"en-GB", prefer:["Google UK English Female","Samantha"], pitch:1.05, rate:0.94 },
  };

  let current = "neutral";

  /* ── browser voices ── */
  let voiceList = [];
  function refreshVoices(){
    try{ voiceList = speechSynthesis.getVoices() || []; }catch(e){ voiceList = []; }
  }
  if(window.speechSynthesis){
    refreshVoices();
    speechSynthesis.onvoiceschanged = refreshVoices;
  }

  function pickVoice(profile){
    if(!voiceList.length) refreshVoices();
    for(const want of profile.prefer || []){
      const hit = voiceList.find((v) => v.name.toLowerCase().includes(want.toLowerCase()));
      if(hit) return hit;
    }
    return voiceList.find((v) => v.lang === profile.lang)
        || voiceList.find((v) => v.lang && v.lang.startsWith((profile.lang || "en").slice(0, 2)))
        || null;
  }

  function profileFor(character){ return PROFILES[character] || PROFILES.neutral; }

  /* ── making sound ── */
  function synth(text, character, onDone){
    const p = profileFor(character);
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(p);
    if(v) u.voice = v;
    u.lang  = p.lang;
    u.pitch = p.pitch;
    u.rate  = p.rate;
    let done = false;
    const finish = () => { if(done) return; done = true; onDone && onDone(); };
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return u;
  }

  /* One line, in this character's voice. Returns the utterance so the caller
     can tell whether anything is actually speaking. */
  function speak(text, character, opts){
    opts = opts || {};
    if(!text){ opts.onDone && opts.onDone(); return null; }
    return synth(text, character || current, opts.onDone);
  }

  function stop(){
    try{ speechSynthesis.cancel(); }catch(e){}
  }

  return {
    speak, stop,
    profiles: PROFILES,
    setCharacter(name){ current = name || "neutral"; },
    character(){ return current; },
    profile: profileFor,
    voiceName(character){ const v = pickVoice(profileFor(character)); return v ? v.name : null; },
    installedVoices(){ if(!voiceList.length) refreshVoices(); return voiceList.map((v) => v.name + "  [" + v.lang + "]"); },
  };
})();
