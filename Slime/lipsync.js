/* ══════════════════════════════════════════════════════════════════
   SLIME — lipsync.js
   Drives a character's mouth from the audio that is actually playing.
   ══════════════════════════════════════════════════════════════════

   BUILT ON  wawa-lipsync (MIT, wass08) — real-time viseme detection in
   the browser via the Web Audio API. No server, no timestamps needed.

   TWO PATHS, because the two voices are not the same thing:

     ElevenLabs (or any mp3)  →  real analysis. The mouth follows the
                                 actual waveform, frame by frame.
     Browser speechSynthesis  →  no audio stream is exposed by the
                                 browser, so nothing can analyse it.
                                 Falls back to word-boundary events with
                                 a natural-looking oscillation. Less
                                 accurate, still convincingly alive.

   THE CHARACTER CONTRACT
   Whatever you plug in must offer at least setMouth(0..1). These are used
   when present:
       setMouth(v)                 0 closed, 1 wide open
       setViseme(name)             optional, if the art has mouth shapes
       setExpression(name)         neutral | happy | calm | thinking
       talk(ms, intensity)         optional, ignored here — we drive the
                                   mouth directly, which looks better

   USE
       SlimeLipsync.attach(window.HoloCharacter)          // same page
       SlimeLipsync.attach(document.getElementById("char")) // an iframe
       await SlimeLipsync.speakAudio(audioElement)
       SlimeLipsync.speakSynth(utterance, text)
       SlimeLipsync.stop()
   ══════════════════════════════════════════════════════════════════ */

window.SlimeLipsync = (function(){

  const CDN = "https://esm.sh/wawa-lipsync@0.0.2";

  /* how open the mouth is for each viseme. Vowels open, plosives shut. */
  const OPENNESS = {
    SIL: 0.00, REST: 0.00, PP: 0.05, FF: 0.20, TH: 0.28, DD: 0.32, KK: 0.30,
    CH: 0.35, SS: 0.22, NN: 0.25, RR: 0.40, MBP: 0.05, L: 0.35,
    AA: 1.00, A: 1.00, E: 0.62, IH: 0.45, I: 0.45, OH: 0.72, O: 0.72, OU: 0.55, U: 0.55,
  };

  /* the character engine uses lowercase a/e/i/o/u plus rest — map wawa's names onto it */
  const TO_CHAR_VISEME = {
    AA:"a", A:"a", E:"e", IH:"i", I:"i", OH:"o", O:"o", OU:"u", U:"u",
    PP:"rest", MBP:"rest", SIL:"rest", REST:"rest",
    FF:"e", TH:"e", DD:"e", KK:"e", CH:"e", SS:"e", NN:"e", RR:"o", L:"e",
  };

  let lip = null, loading = null;
  let targets = [];
  let raf = null, running = false;
  let smoothed = 0;

  /* ── loading the library, once, lazily ── */
  function ready(){
    if(lip) return Promise.resolve(lip);
    if(loading) return loading;
    loading = import(/* webpackIgnore: true */ CDN)
      .then((m) => { lip = new m.Lipsync(); return lip; })
      .catch((e) => { console.warn("[lipsync] library did not load:", e.message); return null; });
    return loading;
  }

  /* ── talking to the character, in the page or across an iframe ── */
  function attach(target){
    if(!target) return;
    if(target.tagName === "IFRAME"){
      targets.push({ kind:"frame", win: target.contentWindow });
    } else if(typeof target.postMessage === "function" && !target.setMouth){
      targets.push({ kind:"frame", win: target });
    } else {
      targets.push({ kind:"direct", obj: target });
    }
  }
  function detachAll(){ targets = []; }

  function send(method, args){
    for(const t of targets){
      try{
        if(t.kind === "direct"){
          if(typeof t.obj[method] === "function") t.obj[method].apply(t.obj, args);
        } else {
          t.win.postMessage({ source:"slime-lipsync", method, args }, "*");
        }
      }catch(e){}
    }
  }

  const setMouth   = (v) => send("setMouth", [Math.max(0, Math.min(1, v))]);
  const setViseme  = (n) => send("setViseme", [n]);
  const expression = (n) => send("setExpression", [n]);

  /* ── path 1 · real audio, real analysis ── */
  async function speakAudio(audioEl){
    const L = await ready();
    stop();
    if(!L || !audioEl){ return false; }

    /* the analyser needs a source already set — connecting an empty
       element silently does nothing, and that is a long afternoon lost */
    if(!audioEl.src && !audioEl.srcObject){
      console.warn("[lipsync] audio element has no src yet");
      return false;
    }

    try{ L.connectAudio(audioEl); }
    catch(e){ console.warn("[lipsync] connectAudio failed:", e.message); return false; }

    running = true;
    let lastViseme = "";

    (function loop(){
      if(!running) return;
      raf = requestAnimationFrame(loop);
      try{ L.processAudio(); }catch(e){ return; }

      const v = String(L.viseme || "sil").toUpperCase();
      const target = OPENNESS[v] !== undefined ? OPENNESS[v] : 0.3;

      /* ease towards the target so the jaw does not chatter frame to frame */
      smoothed += (target - smoothed) * 0.35;
      setMouth(smoothed);

      if(v !== lastViseme){ lastViseme = v; setViseme(TO_CHAR_VISEME[v] || "rest"); }
    })();

    const done = () => { stop(); audioEl.removeEventListener("ended", done); };
    audioEl.addEventListener("ended", done);
    return true;
  }

  /* ── path 2 · browser speech, which exposes no audio to analyse ── */
  /* Ask the character to speak the line itself. Its engine schedules visemes from the
     text and resyncs on word boundaries, which beats anything we can do from outside.
     Returns false if no attached character offers it, so the caller can fall back. */
  function speakVia(text, opts){
    let handled = false;
    for(const t of targets){
      if(t.kind === "direct" && typeof t.obj.speak === "function"){ t.obj.speak(text, opts || {}); handled = true; }
      else if(t.kind === "frame"){
        try{ t.win.postMessage({ source:"slime-lipsync", method:"speak", args:[text, opts || {}] }, "*"); handled = true; }catch(e){}
      }
    }
    return handled;
  }

  function speakSynth(utterance, text){
    stop();
    running = true;

    /* word boundaries give the rhythm; a wobble inside each word gives it life */
    let energy = 0, decay = 0.055;
    const words = (text || "").split(/\s+/).filter(Boolean).length || 1;

    if(utterance){
      utterance.onboundary = (e) => { if(e.name === "word" || !e.name) energy = 1; };
      const end = () => { stop(); };
      utterance.addEventListener ? utterance.addEventListener("end", end) : (utterance.onend = end);
    }

    /* no boundary events on some browsers — keep a gentle idle rhythm going */
    let t = 0, lastKick = 0;
    const meanWordMs = 340;

    (function loop(){
      if(!running) return;
      raf = requestAnimationFrame(loop);
      t += 16;
      if(energy < 0.05 && t - lastKick > meanWordMs){ energy = 0.85; lastKick = t; }

      const wobble = 0.55 + 0.45 * Math.sin(t / 55);
      const target = energy * wobble;
      smoothed += (target - smoothed) * 0.4;
      setMouth(smoothed);
      energy = Math.max(0, energy - decay);
    })();

    return words;
  }

  function stop(){
    running = false;
    if(raf) cancelAnimationFrame(raf);
    raf = null;
    smoothed = 0;
    setMouth(0);
    setViseme("SIL");
  }

  return { attach, detachAll, speakAudio, speakSynth, speakVia, stop,
           setExpression: expression, hasCharacter: () => targets.some((t) => t.kind === "frame"), ready };
})();

/* ══════════════════════════════════════════════════════════════════
   Drop this inside a character page to receive the calls:

   window.addEventListener("message", (e) => {
     const d = e.data;
     if(!d || d.source !== "slime-lipsync") return;
     const fn = window.HoloCharacter && window.HoloCharacter[d.method];
     if(typeof fn === "function") fn.apply(window.HoloCharacter, d.args);
   });
   ══════════════════════════════════════════════════════════════════ */
