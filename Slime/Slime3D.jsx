import React, { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";

/* ══════════════════════════════════════════════════════════════════
   SLIME — 3D companion, n8n backend

   ARCHITECTURE
     This page          the face, the voice, the interface
          │  POST { action, ... }
          ▼
     n8n webhook        holds every API key, orchestrates the agents
          ├─ action:"theme"  → DeepSeek  → character, palette, face, voice
          ├─ action:"reply"  → DeepSeek  → { mode, say, steps, check, mood }
          ├─ action:"learn"  → DeepSeek  → the updated profile
          ├─ action:"picto"  → Nano Banana (Gemini 2.5 Flash Image) → a real pictogram
          └─ action:"speak"  → ElevenLabs → mp3 as a data URL

   SETUP
     Import slime-n8n-workflow.json into n8n, activate it, paste the
     production webhook URL into the box on first run. It is remembered.

     With no webhook set, everything still runs in DEMO MODE: local
     persona presets, drawn pictograms, browser speech. Good enough to
     rehearse with, and it never leaves you without a demo.
   ══════════════════════════════════════════════════════════════════ */

const KEY = "slime:v3";

const EMPTY_PROFILE = {
  film: null, character: null,
  channel: null, detail: null, stimulus: null, pace: null,
  interests: [],
  difficulty: { level: null, signals: [] },
  whatWorks: [], whatDoesnt: [], notes: [],
};

const DEFAULT_THEME = {
  film: null, character: "Slime",
  persona: "Warm, calm, plain-spoken.",
  palette: { tint: "#8AE6D2", accent: "#F2B233", bg: "#040607" },
  face: { eyes: "round", accessory: "none", accessoryColor: "#F2B233" },
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
  vocabulary: [], greeting: "Hello. I am here.",
};

const FILM_Q = "Before we start. What is your favourite film?";
const FORMAT_Q = "How do you like things explained? You can say pictures, voice, text, or a story.";

/* ── prompts (sent to n8n, executed by DeepSeek) ──────────────── */

const THEME_PROMPT = `Someone just named their favourite film. Build a companion persona from it.

The companion is Slime: a soft, gel-like creature that helps an autistic adult with everyday tasks
and learning. It is about to take on the look and voice of a MAIN character from that film.

Return ONLY this JSON object:
{
 "film":"proper title",
 "character":"main character's name",
 "persona":"two short lines on how this character speaks. Never sarcasm or idioms.",
 "palette":{"tint":"#RRGGBB main colour from the film, bright enough on near-black","accent":"#RRGGBB","bg":"#RRGGBB near-black tinted toward the film"},
 "face":{"eyes":"round|large|narrow|wide","accessory":"hat|cap|crown|goggles|mask|ears|antenna|helmet|bow|scarf|none","accessoryColor":"#RRGGBB"},
 "voiceHint":"one of: warm_low, bright_high, gruff, gentle, playful",
 "vocabulary":["4-6 lowercase nouns from that world that can carry a metaphor"],
 "greeting":"one short line in character, saying hello and that it is ready to help"
}

If it is not a film you know, use a gentle generic persona and put what they said in "film". Never refuse.`;

function replyPrompt(theme) {
  return `You are ${theme.character}, from ${theme.film || "a story this person loves"}, helping an autistic adult with everyday tasks and learning.

HOW YOU SPEAK
${theme.persona}
Metaphors available from your world: ${(theme.vocabulary || []).join(", ") || "keep it plain"}.

RULES
- Short sentences. One idea per sentence.
- No idioms, no sarcasm, no figures of speech, except deliberate metaphors from your world in story mode.
- Never more than 3 steps at a time.
- Be concrete: "Press the round button on the right", not "activate the device".
- Never talk down. This is an adult.
- Clarity beats character. If staying in character makes a step harder to follow, drop the flavour.

READ THE PROFILE
- channel decides mode; if unknown use "text".
- difficulty.level "struggles" → fewer words, smaller steps, lean on whatWorks.
- difficulty.level "quick" → full three steps, less repetition.
- Never reuse anything listed in whatDoesnt.

For mode "pictures", each step must be 1-2 concrete nouns that can be drawn as a single symbol
("kettle", "red button", "eight minutes"). Never a sentence.

End explanations with a short check question so you learn whether it landed. Small talk: check = null.

Return ONLY this JSON:
{"mode":"text|voice|pictures|story","say":"one short line in character","steps":["...","...","..."],"check":"short question or null","mood":"calm|attentive|happy"}`;
}

const LEARN_PROMPT = `You quietly maintain a profile of an autistic adult talking to a companion.
You get the CURRENT PROFILE, the companion's LAST MESSAGE and the person's LATEST REPLY.
Return the profile updated with anything new. Keep what is there unless contradicted.

Fields: film, character (keep as is), channel (text|voice|pictures|story|null), detail (short|normal|null),
stimulus (low|normal|null), pace (slow|normal|null), interests[], difficulty{level:quick|steady|struggles|null, signals[max 4]},
whatWorks[max 4], whatDoesnt[max 4], notes[max 5].

READING DIFFICULTY — the important part. The companion's last message usually ends with a check
question, and the reply to it is your best signal.
  "yes"/"got it"/moves on            → it worked. Add the approach to whatWorks.
  "not really"/"show me differently" → it did not. Add the approach to whatDoesnt.
  repeated struggle                  → difficulty.level "struggles"
  first-time success                 → "quick"
  mixed                              → "steady"
Never set difficulty.level from one turn unless the signal is unmistakable.
Name the approach, never the person: "three steps at once was too many", not "they are slow".

Return ONLY the JSON profile object.`;

/* ── backend ──────────────────────────────────────────────────── */
async function callN8N(hook, payload) {
  const res = await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("n8n " + res.status);
  return res.json();
}

/* Demo mode: no webhook, no keys, still a working demo. */
const PRESETS = [
  { match: /toy story|buzz|woody/i, film: "Toy Story", character: "Buzz Lightyear", persona: "Bright and certain. Speaks in short confident lines. Likes missions and plans.", palette: { tint: "#6FB7F0", accent: "#F2B233", bg: "#050810" }, face: { eyes: "wide", accessory: "helmet", accessoryColor: "#F2F5F4" }, vocabulary: ["mission", "launch", "wings", "star", "command"], greeting: "Ready when you are. Give me the mission." },
  { match: /lion king|simba|rey le/i, film: "The Lion King", character: "Simba", palette: { tint: "#F0A94C", accent: "#F2E0A0", bg: "#0C0703" }, persona: "Warm and unhurried. Uses steady, grounded words.", face: { eyes: "large", accessory: "ears", accessoryColor: "#8A5A2B" }, vocabulary: ["savannah", "sunrise", "path", "pride", "river"], greeting: "I am here. Take your time." },
  { match: /nemo|dory|finding/i, film: "Finding Nemo", character: "Dory", palette: { tint: "#5FB0E0", accent: "#F2C94C", bg: "#020810" }, persona: "Cheerful and gentle. Repeats the important part so it sticks.", face: { eyes: "large", accessory: "none", accessoryColor: "#F2C94C" }, vocabulary: ["current", "reef", "swim", "shell", "tide"], greeting: "Hi. We will just keep going, one bit at a time." },
  { match: /wall|robot/i, film: "WALL·E", character: "WALL·E", palette: { tint: "#D9A441", accent: "#8AE6D2", bg: "#0B0803" }, persona: "Quiet and curious. Very few words. Never rushes.", face: { eyes: "large", accessory: "goggles", accessoryColor: "#B0BEC5" }, vocabulary: ["cube", "spark", "plant", "track", "signal"], greeting: "Hello. I am listening." },
];

function localTheme(answer) {
  const p = PRESETS.find((x) => x.match.test(answer));
  if (p) return { ...DEFAULT_THEME, ...p, voiceId: DEFAULT_THEME.voiceId };
  return { ...DEFAULT_THEME, film: answer, character: "Slime", greeting: "Hello. I am here and I am listening." };
}

function localReply(message, profile) {
  const m = (message || "").toLowerCase();
  const mode = profile.channel || "text";
  if (/hello|hi\b|hey/.test(m)) return { mode: "text", say: "Hello. What do you need to do today?", steps: [], check: null, mood: "happy" };
  if (/not really|differently/.test(m)) return { mode: mode === "pictures" ? "story" : "pictures", say: "Let me try it another way.", steps: ["kettle", "red button", "eight minutes"], check: "Better?", mood: "attentive" };
  if (/yes|got it/.test(m)) return { mode: "text", say: "Good. Ask me the next one when you are ready.", steps: [], check: null, mood: "happy" };
  return { mode, say: "Here it is, in three steps.", steps: ["kettle", "red button", "eight minutes"], check: "Did that work?", mood: "calm" };
}

/* ══════════════════════════════════════════════════════════════ */

export default function SlimeApp() {
  const [hook, setHook] = useState("");
  const [hookDraft, setHookDraft] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [phase, setPhase] = useState("film");
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState("calm");
  const [panel, setPanel] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [note, setNote] = useState("");
  const voice = useVoice();
  const scroller = useRef(null);
  const lastSlime = useRef(FILM_Q);
  const audio = useRef(null);

  const live = !!hook;

  /* ── voice out: ElevenLabs through n8n, browser speech otherwise ── */
  const say = useCallback(async (text) => {
    lastSlime.current = text;
    if (!text) return;
    setSpeaking(true);
    if (live) {
      try {
        const r = await callN8N(hook, { action: "speak", text, voiceId: theme.voiceId });
        if (r.audio) {
          if (audio.current) audio.current.pause();
          const a = new Audio(r.audio);
          audio.current = a;
          a.onended = () => setSpeaking(false);
          a.onerror = () => setSpeaking(false);
          await a.play();
          return;
        }
      } catch (e) { /* fall through to the browser */ }
    }
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.92; u.pitch = 1.05;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } else setSpeaking(false);
  }, [hook, live, theme.voiceId]);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(KEY);
        const s = JSON.parse(r.value);
        if (s.hook) { setHook(s.hook); setHookDraft(s.hook); }
        if (s.theme && s.profile) {
          setTheme(s.theme); setProfile(s.profile);
          setPhase(s.profile.channel ? "chat" : "format");
          return;
        }
      } catch (e) {}
      say(FILM_Q);
    })();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [turns, busy, phase]);

  async function save(next) {
    try { await window.storage.set(KEY, JSON.stringify({ hook, theme, profile, ...next })); } catch (e) {}
  }

  /* ── phase 1 → 2 ── */
  async function submitFilm(answer) {
    setTurns((t) => [...t, { who: "you", text: answer }]);
    setPhase("theming"); setBusy(true); setNote("");
    let t;
    try {
      t = live
        ? { ...DEFAULT_THEME, ...(await callN8N(hook, { action: "theme", system: THEME_PROMPT, user: "The film they named: " + answer })) }
        : localTheme(answer);
      t.palette = { ...DEFAULT_THEME.palette, ...(t.palette || {}) };
      t.face = { ...DEFAULT_THEME.face, ...(t.face || {}) };
    } catch (e) {
      t = localTheme(answer);
      setNote("The backend did not answer, so Slime used a local persona.");
    }
    setTheme(t);
    const p = { ...EMPTY_PROFILE, film: t.film, character: t.character };
    setProfile(p);
    await save({ theme: t, profile: p });
    setTurns((x) => [...x, { who: "slime", say: t.greeting, steps: [], mode: "text", tint: t.palette.tint }]);
    setPhase("format"); setBusy(false);
    say(t.greeting + " " + FORMAT_Q);
  }

  /* ── phase 2 → 3 ── */
  async function submitFormat(answer) {
    setTurns((t) => [...t, { who: "you", text: answer }]);
    const a = answer.toLowerCase();
    const channel = /pictur|draw|picto|image|symbol|dibujo/.test(a) ? "pictures"
      : /voice|speak|aloud|hear|talk|tell/.test(a) ? "voice"
      : /stor|tale|adventur|cuento/.test(a) ? "story" : "text";
    const p = { ...profile, channel };
    setProfile(p); await save({ profile: p }); setPhase("chat");
    const line = "Good. I will use " + channel + ". Ask me about anything you need to do today.";
    setTurns((t) => [...t, { who: "slime", say: line, steps: [], mode: "text", tint: theme.palette.tint }]);
    say(line);
  }

  /* ── phase 3 ── */
  async function submitChat(message) {
    setTurns((t) => [...t, { who: "you", text: message }]);
    setBusy(true);

    if (live) {
      callN8N(hook, {
        action: "learn", system: LEARN_PROMPT,
        user: "CURRENT PROFILE:\n" + JSON.stringify(profile, null, 2) +
              "\n\nCOMPANION'S LAST MESSAGE:\n" + lastSlime.current +
              "\n\nLATEST REPLY:\n" + message,
      }).then(async (p) => {
        const merged = { ...EMPTY_PROFILE, ...p, film: profile.film, character: profile.character,
          difficulty: { ...EMPTY_PROFILE.difficulty, ...(p.difficulty || {}) } };
        setProfile(merged); await save({ profile: merged });
      }).catch(() => {});
    }

    let r;
    try {
      r = live
        ? await callN8N(hook, { action: "reply", system: replyPrompt(theme),
            user: "PROFILE:\n" + JSON.stringify(profile, null, 2) + "\n\nMESSAGE:\n" + message })
        : localReply(message, profile);
    } catch (e) {
      r = localReply(message, profile);
      setNote("The backend did not answer, so that reply came from the local fallback.");
    }

    setMood(r.mood || "calm");
    const turn = { who: "slime", ...r, tint: theme.palette.tint, pictos: null };
    setTurns((t) => [...t, turn]);
    setBusy(false);

    const spoken = [r.say].concat(r.steps || []).concat([r.check]).filter(Boolean).join(". ");
    if (r.mode === "voice" || profile.channel === "voice") say(spoken);
    else lastSlime.current = spoken;

    /* real pictograms, fetched after the text so nothing waits on them */
    if (r.mode === "pictures" && live && (r.steps || []).length) {
      const idx = turns.length + 1;
      Promise.all(r.steps.map((label) =>
        callN8N(hook, { action: "picto", label, tint: theme.palette.tint })
          .then((x) => x.image || null).catch(() => null)
      )).then((imgs) => {
        setTurns((t) => t.map((x, i) => (i === idx ? { ...x, pictos: imgs } : x)));
      });
    }
  }

  function submit(text) {
    const v = (text || "").trim();
    if (!v || busy) return;
    setDraft("");
    if (phase === "film") submitFilm(v);
    else if (phase === "format") submitFormat(v);
    else submitChat(v);
  }

  async function startOver() {
    try { await window.storage.set(KEY, JSON.stringify({ hook })); } catch (e) {}
    setTheme(DEFAULT_THEME); setProfile(EMPTY_PROFILE); setTurns([]);
    setMood("calm"); setPanel(false); setPhase("film"); setNote("");
    say(FILM_Q);
  }

  async function saveHook() {
    const h = hookDraft.trim();
    setHook(h); setSetupOpen(false);
    try { await window.storage.set(KEY, JSON.stringify({ hook: h, theme, profile })); } catch (e) {}
  }

  const P = theme.palette;
  const prompt = phase === "film" ? FILM_Q : phase === "format" ? FORMAT_Q : null;

  return (
    <div style={{ minHeight: "100%", background: P.bg, color: "#F2F5F4",
      fontFamily: "'Manrope', ui-sans-serif, system-ui, sans-serif", display: "flex",
      flexDirection: "column", alignItems: "center", padding: "16px 16px 20px",
      transition: "background 1.2s ease", position: "relative" }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;600;700;800&display=swap');
        @keyframes slBar { 0%,100%{height:8px;opacity:.5} 50%{height:26px;opacity:1} }
        @keyframes slRing { 0%{transform:scale(1);opacity:.45} 100%{transform:scale(1.4);opacity:0} }
        .sl-in::placeholder{color:#5A6968} .sl-in:focus{outline:none}
      `}</style>

      <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 12 }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, letterSpacing: ".18em", textTransform: "uppercase", color: "#7C8A89" }}>
            {theme.film ? theme.character + " · " + theme.film : "Slime"}
          </span>
          <div style={{ display: "flex", gap: 7 }}>
            <button onClick={() => setSetupOpen(!setupOpen)} title={live ? "Connected to n8n" : "Demo mode"}
              style={{ ...chip, color: live ? P.tint : "#F2B233", borderColor: live ? P.tint + "66" : "#F2B23355" }}>
              {live ? "LIVE" : "DEMO"}
            </button>
            <button onClick={() => setPanel(!panel)} style={{ ...chip, color: panel ? P.tint : "#7C8A89" }}>PROFILE</button>
          </div>
        </div>

        {setupOpen && (
          <div style={{ border: "1px solid rgba(255,255,255,.13)", borderRadius: 14, padding: 14,
            display: "flex", flexDirection: "column", gap: 9 }}>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: "#A9B6B4" }}>
              Paste the n8n production webhook URL. With it, the brain is DeepSeek, pictograms come from
              Nano Banana and the voice from ElevenLabs. Without it, Slime runs a local demo.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="sl-in" value={hookDraft} onChange={(e) => setHookDraft(e.target.value)}
                placeholder="https://your-n8n/webhook/slime"
                style={{ flex: 1, fontFamily: "inherit", fontSize: 14, color: "#F2F5F4",
                  background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.14)",
                  borderRadius: 10, padding: "9px 12px" }} />
              <button onClick={saveHook} style={{ ...chip, borderColor: P.tint + "66", color: P.tint, padding: "8px 15px" }}>SAVE</button>
            </div>
          </div>
        )}

        <SlimeFace theme={theme} mood={mood} busy={busy || phase === "theming"}
          speaking={speaking} listening={voice.listening} />

        {prompt && <p style={{ fontSize: 20, lineHeight: 1.45, textAlign: "center", maxWidth: 420, margin: "0 auto" }}>{prompt}</p>}

        {note && <p style={{ fontSize: 13, lineHeight: 1.5, color: "#F2B233" }}>{note}</p>}

        <div ref={scroller} style={{ height: phase === "chat" ? 230 : 110, overflowY: "auto",
          display: "flex", flexDirection: "column", gap: 15, padding: 2 }}>
          {turns.map((t, i) =>
            t.who === "you"
              ? <p key={i} style={{ alignSelf: "flex-end", maxWidth: "80%", fontSize: 16, lineHeight: 1.4,
                  color: "#8E9C9A", border: "1px solid rgba(255,255,255,.12)",
                  borderRadius: "16px 16px 4px 16px", padding: "8px 12px" }}>{t.text}</p>
              : <SlimeTurn key={i} turn={t} onQuick={submit} live={i === turns.length - 1 && !busy} />
          )}
          {(busy || phase === "theming") && (
            <p style={{ fontSize: 14, color: "#5A6968", letterSpacing: ".08em" }}>
              {phase === "theming" ? "changing shape…" : "thinking…"}
            </p>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, alignItems: "center" }}>
          {voice.supported && !voice.blocked ? (
            <button onClick={() => voice.listening ? voice.stop() : voice.listen(submit)} disabled={busy}
              aria-label={voice.listening ? "Stop listening" : "Speak"}
              style={{ width: 72, height: 72, borderRadius: "50%", border: "none", cursor: busy ? "default" : "pointer",
                background: voice.listening ? P.tint : "transparent",
                boxShadow: voice.listening ? "0 0 0 3px " + P.tint : "inset 0 0 0 2px " + P.tint + "99",
                color: voice.listening ? P.bg : P.tint, opacity: busy ? .4 : 1,
                display: "grid", placeItems: "center", transition: "all .3s" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <rect x="9" y="2.5" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
              </svg>
            </button>
          ) : (
            <p style={{ fontSize: 13, color: "#F2B233", textAlign: "center", maxWidth: 380, lineHeight: 1.5 }}>
              The microphone is not available here. Type instead — Slime still speaks back.
            </p>
          )}
          <span style={{ fontSize: 12, letterSpacing: ".08em", color: "#5A6968", minHeight: 16 }}>
            {voice.listening ? "listening…" : (voice.supported && !voice.blocked ? "tap to speak" : "")}
          </span>

          <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "flex-end" }}>
            <textarea className="sl-in" value={draft} rows={1} placeholder="or type here"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(draft); } }}
              style={{ flex: 1, fontFamily: "inherit", fontSize: 16, lineHeight: 1.4, color: "#F2F5F4",
                background: "rgba(255,255,255,.04)",
                border: "1px solid " + (draft ? P.tint + "88" : "rgba(255,255,255,.13)"),
                borderRadius: 14, padding: "10px 13px", resize: "none", transition: "border-color .3s" }} />
            <button onClick={() => submit(draft)} disabled={busy || !draft.trim()} aria-label="Send"
              style={{ width: 44, height: 44, borderRadius: "50%", border: 0, background: P.tint, color: P.bg,
                fontSize: 18, cursor: "pointer", opacity: busy || !draft.trim() ? .3 : 1 }}>→</button>
          </div>
        </div>
      </div>

      {panel && <ProfilePanel profile={profile} theme={theme} onReset={startOver} live={live} />}
    </div>
  );
}

const chip = {
  background: "transparent", border: "1px solid rgba(255,255,255,.16)", borderRadius: 100,
  padding: "5px 12px", fontSize: 11, letterSpacing: ".12em", cursor: "pointer", fontFamily: "inherit",
};

/* ── the 3D companion ────────────────────────────────────────── */
function SlimeFace({ theme, mood, busy, speaking, listening }) {
  const mount = useRef(null);
  const state = useRef({});
  const P = theme.palette;
  const f = theme.face || DEFAULT_THEME.face;

  /* build the scene once */
  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const W = el.clientWidth, H = 230;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(W, H);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
    camera.position.set(0, 0, 6.2);

    /* gel body: displaced icosahedron, physical material with clearcoat */
    const geo = new THREE.IcosahedronGeometry(1.5, 40);
    geo.userData.base = geo.attributes.position.array.slice();
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(P.tint), roughness: 0.12, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.08,
      transparent: true, opacity: 0.92, transmission: 0.35, thickness: 1.4,
      emissive: new THREE.Color(P.tint), emissiveIntensity: 0.18,
    });
    const body = new THREE.Mesh(geo, mat);
    scene.add(body);

    /* inner core gives the gel depth */
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 32, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(P.accent), transparent: true, opacity: 0.2 })
    );
    scene.add(core);

    /* eyes */
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x06201f, roughness: 0.1, clearcoat: 1 });
    const eyes = [new THREE.Mesh(new THREE.SphereGeometry(1, 24, 24), eyeMat),
                  new THREE.Mesh(new THREE.SphereGeometry(1, 24, 24), eyeMat)];
    eyes.forEach((e) => scene.add(e));

    /* accessory */
    const acc = new THREE.Group();
    scene.add(acc);

    /* light */
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(3, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(P.accent), 1.1); rim.position.set(-4, -1, -3); scene.add(rim);
    const fill = new THREE.PointLight(new THREE.Color(P.tint), 1.6, 12); fill.position.set(0, 0, 3); scene.add(fill);

    state.current = { renderer, scene, camera, body, core, eyes, acc, mat, key, rim, fill, geo, el };

    let raf, t = 0, blinkAt = 3;
    const clock = new THREE.Clock();
    function loop() {
      raf = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      const s = state.current;
      t += dt * (s.busy ? 2.6 : 1);

      /* wobble the surface */
      const pos = s.geo.attributes.position, base = s.geo.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
        const n = Math.sin(x * 2.1 + t * 0.9) * Math.cos(y * 1.8 - t * 0.7) * Math.sin(z * 2.3 + t * 0.5);
        const k = 1 + n * (s.busy ? 0.10 : 0.055);
        pos.array[i * 3] = x * k; pos.array[i * 3 + 1] = y * k; pos.array[i * 3 + 2] = z * k;
      }
      pos.needsUpdate = true;
      s.geo.computeVertexNormals();

      s.body.rotation.y = Math.sin(t * 0.25) * 0.22;
      s.body.rotation.z = Math.sin(t * 0.19) * 0.07;
      const breathe = 1 + Math.sin(t * 0.8) * 0.02;
      s.body.scale.setScalar((s.scale || 1) * breathe);
      s.core.scale.setScalar((s.scale || 1) * breathe);
      s.core.rotation.y = -t * 0.3;

      /* eyes ride the front of the body and blink */
      if (t > blinkAt) blinkAt = t + 3 + Math.random() * 3;
      const blinking = blinkAt - t < 0.14;
      const sp = s.eyeSpread || 0.52, sz = s.eyeSize || 0.19, sc = (s.scale || 1);
      s.eyes.forEach((e, i) => {
        e.position.set((i === 0 ? -sp : sp) * sc, 0.18 * sc, 1.28 * sc);
        e.scale.set(sz * sc, (blinking ? 0.06 : (s.eyeH || sz)) * sc, sz * sc);
      });
      s.acc.scale.setScalar(sc);
      s.acc.rotation.y = s.body.rotation.y;

      /* the halo pulses while speaking or listening */
      s.fill.intensity = 1.6 + (s.pulse ? Math.abs(Math.sin(t * 5)) * 2.2 : 0);

      s.renderer.render(s.scene, s.camera);
    }
    loop();

    const onResize = () => {
      const w = el.clientWidth;
      s0().renderer.setSize(w, H);
      s0().camera.aspect = w / H; s0().camera.updateProjectionMatrix();
    };
    function s0() { return state.current; }
    addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      renderer.dispose(); geo.dispose(); mat.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []); // eslint-disable-line

  /* palette + face follow the theme */
  useEffect(() => {
    const s = state.current;
    if (!s.mat) return;
    s.mat.color.set(P.tint); s.mat.emissive.set(P.tint);
    s.core.material.color.set(P.accent);
    s.rim.color.set(P.accent); s.fill.color.set(P.tint);

    const E = { round: [0.19, 0.19, 0.52], large: [0.26, 0.26, 0.5], narrow: [0.2, 0.08, 0.52], wide: [0.21, 0.21, 0.64] };
    const [w, h, spread] = E[f.eyes] || E.round;
    s.eyeSize = w; s.eyeH = h; s.eyeSpread = spread;

    while (s.acc.children.length) s.acc.remove(s.acc.children[0]);
    buildAccessory(s.acc, f.accessory, f.accessoryColor || P.accent);
  }, [P.tint, P.accent, f.eyes, f.accessory, f.accessoryColor]);

  useEffect(() => {
    const s = state.current;
    s.busy = busy;
    s.pulse = speaking || listening;
    s.scale = mood === "happy" ? 1.08 : mood === "attentive" ? 1.03 : 1;
  }, [busy, speaking, listening, mood]);

  return (
    <div style={{ position: "relative", height: 230 }}>
      {(speaking || listening) && (
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 150, height: 150, marginLeft: -75,
          marginTop: -75, borderRadius: "50%", border: "2px solid " + P.tint,
          animation: "slRing 1.6s ease-out infinite", pointerEvents: "none" }} />
      )}
      <div ref={mount} style={{ width: "100%", height: 230 }} />
    </div>
  );
}

function buildAccessory(group, kind, colorHex) {
  if (!kind || kind === "none") return;
  const color = new THREE.Color(colorHex);
  const M = () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.15, clearcoat: 0.6 });
  const add = (mesh, pos, rot) => {
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    group.add(mesh);
  };

  if (kind === "hat") {
    add(new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.1, 24), M()), [0, 1.75, 0]);
    add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.09, 28), M()), [0, 1.2, 0]);
  } else if (kind === "cap") {
    add(new THREE.Mesh(new THREE.SphereGeometry(0.95, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), M()), [0, 1.05, 0]);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 0.7), M()), [0, 1.03, 0.9]);
  } else if (kind === "crown") {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 8), M()), [Math.cos(a) * 0.75, 1.5, Math.sin(a) * 0.75]);
    }
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.16, 26), M()), [0, 1.28, 0]);
  } else if (kind === "goggles") {
    [-0.52, 0.52].forEach((x) =>
      add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 12, 26), M()), [x, 0.2, 1.28]));
    add(new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.06, 10, 40), M()), [0, 0.2, 0], [0, 0, 0]);
  } else if (kind === "mask") {
    add(new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.5, 0.14), M()), [0, 0.2, 1.28]);
  } else if (kind === "ears") {
    [-0.72, 0.72].forEach((x) =>
      add(new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.72, 16), M()), [x, 1.42, 0], [0, 0, x < 0 ? 0.3 : -0.3]));
  } else if (kind === "antenna") {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 10), M()), [0, 1.85, 0]);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 20), M()), [0, 2.3, 0]);
  } else if (kind === "helmet") {
    const m = M(); m.transparent = true; m.opacity = 0.32; m.roughness = 0.05;
    add(new THREE.Mesh(new THREE.SphereGeometry(1.72, 30, 24), m), [0, 0.1, 0]);
  } else if (kind === "bow") {
    [-0.42, 0.42].forEach((x) =>
      add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 4), M()), [x, 1.5, 0], [0, 0, x < 0 ? Math.PI / 2 : -Math.PI / 2]));
    add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 14), M()), [0, 1.5, 0]);
  } else if (kind === "scarf") {
    add(new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.17, 12, 32), M()), [0, -1.05, 0], [Math.PI / 2, 0, 0]);
  }
}

/* ── one answer ──────────────────────────────────────────────── */
function SlimeTurn({ turn, onQuick, live }) {
  const { mode, say, steps = [], check, tint, pictos } = turn;

  const plain = (
    <ul style={{ display: "flex", flexDirection: "column", gap: 9, listStyle: "none", padding: 0, margin: 0 }}>
      {steps.map((s, i) => (
        <li key={i} style={{ fontSize: 17, lineHeight: 1.45, paddingLeft: 23, position: "relative" }}>
          <span style={{ position: "absolute", left: 2, top: ".62em", width: 8, height: 8, borderRadius: "50%", background: tint }} />{s}
        </li>
      ))}
    </ul>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {say && <p style={{ fontSize: 19, lineHeight: 1.45 }}>{say}</p>}

      {mode === "voice" && steps.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, height: 28 }}>
          {[0, 90, 180, 60, 240, 120, 30, 210, 150].map((d, i) => (
            <i key={i} style={{ width: 5, borderRadius: 3, background: tint, animation: "slBar 1.1s ease-in-out " + d + "ms infinite" }} />
          ))}
        </div>
      )}

      {mode === "story" && steps.length > 0 && (
        <div style={{ display: "flex", alignItems: "center" }}>
          {steps.map((_, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ width: 40, height: 2, background: tint + "80" }} />}
              <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid " + tint }} />
            </React.Fragment>
          ))}
        </div>
      )}

      {mode === "pictures" && steps.length > 0 ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {steps.map((s, i) => (
            <div key={i} style={{ flex: "1 1 0", minWidth: 96, padding: 10, border: "1px solid " + tint + "4A",
              borderRadius: 15, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ width: "100%", aspectRatio: "1", display: "grid", placeItems: "center",
                borderRadius: 11, background: "rgba(255,255,255,.03)", overflow: "hidden" }}>
                {pictos && pictos[i]
                  ? <img src={pictos[i]} alt={s} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : <span style={{ fontSize: 12, letterSpacing: ".1em", color: tint + "99" }}>
                      {pictos === null ? "drawing…" : "—"}
                    </span>}
              </div>
              <span style={{ fontSize: 14, color: "#8E9C9A", textAlign: "center" }}>{s}</span>
            </div>
          ))}
        </div>
      ) : (steps.length > 0 ? plain : null)}

      {check && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 16, lineHeight: 1.4, color: "#A9B6B4" }}>{check}</p>
          {live && (
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {["Yes, got it", "Not really", "Show me differently"].map((l) => (
                <button key={l} onClick={() => onQuick(l)}
                  style={{ fontFamily: "inherit", fontSize: 13, padding: "6px 13px", borderRadius: 100,
                    border: "1px solid " + tint + "55", background: "transparent", color: tint, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── profile ─────────────────────────────────────────────────── */
function ProfilePanel({ profile, theme, onReset, live }) {
  const tint = theme.palette.tint;
  const d = profile.difficulty || {};
  const Row = ({ k, v }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0",
      borderBottom: "1px solid rgba(255,255,255,.07)", fontSize: 13 }}>
      <span style={{ color: "#7C8A89" }}>{k}</span>
      <span style={{ color: v ? tint : "#4A5857", textAlign: "right" }}>{v || "—"}</span>
    </div>
  );
  const List = ({ title, items }) => (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: ".2em", textTransform: "uppercase", color: "#7C8A89", marginBottom: 6 }}>{title}</div>
      {(items || []).length === 0 ? <div style={{ fontSize: 13, color: "#4A5857" }}>—</div>
        : items.map((x, i) => (
          <div key={i} style={{ fontSize: 13, lineHeight: 1.5, color: "#C3CFCD", paddingLeft: 11, position: "relative" }}>
            <span style={{ position: "absolute", left: 0, color: tint }}>·</span>{x}
          </div>))}
    </div>
  );
  return (
    <div style={{ position: "fixed", top: 0, right: 0, width: 320, height: "100%", background: "#080C0D",
      borderLeft: "1px solid rgba(255,255,255,.1)", padding: "20px 18px", overflowY: "auto", zIndex: 10 }}>
      <h2 style={{ fontSize: 12, letterSpacing: ".22em", textTransform: "uppercase", color: "#7C8A89", fontWeight: 700, marginBottom: 6 }}>
        What Slime knows
      </h2>
      <p style={{ fontSize: 12, color: live ? tint : "#F2B233", marginBottom: 12 }}>
        {live ? "DeepSeek via n8n" : "local demo — no backend connected"}
      </p>
      <Row k="film" v={profile.film} /><Row k="character" v={profile.character} />
      <Row k="channel" v={profile.channel} /><Row k="detail" v={profile.detail} />
      <Row k="stimulus" v={profile.stimulus} /><Row k="pace" v={profile.pace} />
      <Row k="difficulty" v={d.level} />
      <List title="Interests" items={profile.interests} />
      <List title="What works" items={profile.whatWorks} />
      <List title="What doesn't" items={profile.whatDoesnt} />
      <List title="Signals" items={d.signals} />
      <List title="Notes" items={profile.notes} />
      <button onClick={onReset} style={{ marginTop: 20, fontFamily: "inherit", fontSize: 13, padding: "7px 15px",
        borderRadius: 100, border: "1px solid rgba(255,255,255,.18)", background: "transparent", color: "#8E9C9A", cursor: "pointer" }}>
        Start over
      </button>
    </div>
  );
}

/* ── speech in ───────────────────────────────────────────────── */
function useVoice() {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const rec = useRef(null);
  const cb = useRef(() => {});

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.continuous = false; r.interimResults = false; r.lang = "en-US";
    r.onresult = (e) => { const t = e.results[0][0].transcript; if (t && t.trim()) cb.current(t.trim()); };
    r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") setBlocked(true); setListening(false); };
    r.onend = () => setListening(false);
    rec.current = r;
    return () => { try { r.abort(); } catch (err) {} };
  }, []);

  const listen = useCallback((fn) => {
    if (!rec.current) return;
    cb.current = fn;
    try { if (window.speechSynthesis) speechSynthesis.cancel(); rec.current.start(); setListening(true); }
    catch (err) { setListening(false); }
  }, []);
  const stop = useCallback(() => { try { rec.current && rec.current.stop(); } catch (err) {} setListening(false); }, []);

  return { listening, supported, blocked, listen, stop };
}
