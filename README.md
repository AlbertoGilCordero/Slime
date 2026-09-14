# Slime

**A companion that becomes whatever the person in front of it needs.**

Slime is a support companion for autistic adults. It reads a person's support
profile and changes how it communicates to match: pictograms for one person,
spoken steps for another, a story for a third. Same answer, different shape.

The premise is that the person should not have to adapt to the tool.

---

## Why

Most support tools ship in one format and expect the person to meet them there.
Material is text-first, designed for children, and starts from zero every
session. Meanwhile the knowledge that actually helps — how someone learns, what
overwhelms them, what settles them — usually lives in one family's heads and
was never written down.

Slime takes that knowledge as a document, and behaves according to it.

---

## What it does

| It reads                          | It changes                                          |
|-----------------------------------|-----------------------------------------------------|
| Special interest                  | Which companion appears — Dragon Ball gives you Goku |
| Preferred communication format    | Pictograms, voice, plain text or a story            |
| Steps at once (spoken / pictures) | How much arrives in one answer                      |
| What helps me calm down           | Which piece of music plays during a crisis          |
| Emergency contact                 | Who gets alerted                                    |
| What you should not do            | Handed to the model verbatim as a hard constraint   |

None of this is chosen in code. Change the profile and the behaviour follows.

**Recognition.** A camera identifies who is in the room and loads their
profile. Someone Slime already knows is never asked who they are.

**Alerts.** A red button, and a camera heuristic that notices repeated fast
hand-to-head movement. Either one messages the person's first contact and opens
a calming screen built from their own profile.

---

## Running it

Everything is static files. No build step, no framework, no install.

```bash
cd Slime
python -m http.server 8000
```

Open <http://localhost:8000/vision.html> — and keep to that address.
`127.0.0.1:8000` is a different origin to the browser, with separate storage.

### First-time setup

1. **vision.html** — start the camera, enrol each person with their name and
   role. For anyone Slime accompanies, import their support profile (`.docx`)
   or fill in the form, then **Save profile**.
2. **Export everything** → `slime-data.json`. Put it in the folder. It is read
   on every start, so the data survives a change of address or machine.
3. **demo.html** — enable the microphone and camera. A known face loads that
   person's profile and greets them by name.

### Connecting the brain

Without a backend, Slime runs a local demo: canned replies, real ARASAAC
pictograms, browser speech. Everything is visible, nothing is invented.

For the real thing, import `slime-n8n-workflow.json` into
[n8n](https://n8n.io), add two Header Auth credentials — DeepSeek and Gemini —
activate it, and pass the production webhook URL:

```
demo.html?hook=https://your-n8n/webhook/slime
```

---

## How it is put together

```
demo.html          the companion: 3D Slime, conversation, alerts
vision.html        enrolment, support profiles, camera testing
├── vision.js      face recognition + the motion heuristic (vladmandic/human)
├── people.js      the register: profiles, and what the runtime reads from them
├── pictos.js      ARASAAC pictogram lookup
├── voices.js      one browser voice per character
├── lipsync.js     mouth driven by the audio actually playing (wawa-lipsync)
├── scenes.js      three scripted scenarios — off unless ?scenes=on
└── char-*.html    2D companions, each exposing setMouth / setExpression / speak
slime-n8n-workflow.json    the backend: DeepSeek, Gemini, Telegram
people.json        the register's baseline; imported profiles override it
audio/             crisis audio, named by each person's profile
```

The browser does the recognition, the pictogram lookup, the speech and the
lipsync. n8n holds every API key and orchestrates the language model. No frames
ever leave the device: only a 128-number face descriptor is stored, locally.

---

## What this is not

Worth stating plainly, because the gap between a demo and a product matters
more than usual here.

**The motion flag is a heuristic, not a detector.** It notices a hand moving
repeatedly to the head at speed. Scratching and adjusting glasses look the
same to it, and a head hitting a wall does not. It is wired to say *something
unusual, please check* and must never be relabelled as anything stronger. A
confident wrong alert is worse than no alert, because the next one stops being
believed.

**Slime never calls emergency services.** It puts the number in front of a
person who decides.

**The clinical grounding is a prompt, not a validated protocol.** It reads like
good practice. It has not been reviewed by anyone qualified, and no part of
this has been tested with the people it is for.

**Face recognition is not authentication.** A photograph is enough to fool it.
Anything sensitive should be sent to a registered address, not shown to
whoever is standing in front of the camera.

---

## Licences and credit

- **Pictograms** — property of the Government of Aragón, created by Sergio
  Palao for [ARASAAC](https://arasaac.org), CC BY-NC-SA. Attribution appears
  wherever they do. **NC means non-commercial**: fine for a demo or a pilot,
  but talk to ARASAAC before charging for anything.
- **[vladmandic/human](https://github.com/vladmandic/human)** — MIT. Face
  descriptors and body pose.
- **[wawa-lipsync](https://github.com/wass08/wawa-lipsync)** — MIT.
  Real-time visemes.
- **Characters** — the companion artwork here is original. Slime takes the
  *spirit* of what someone loves rather than reproducing a protected
  character, which is both the safer position and the better design: Slime
  stays Slime.

---

## Status

A working prototype. Built to be shown, argued with, and taken apart.

The next honest steps are validation with autistic adults and the
professionals who support them, a clinical review of the guidance in the
prompts, and a data model that holds up to scrutiny under GDPR Article 9 —
biometric and health data are special category, and a demo folder is not a
lawful basis.
