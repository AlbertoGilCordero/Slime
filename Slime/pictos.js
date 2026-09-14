/* ══════════════════════════════════════════════════════════════════
   SLIME — pictos.js
   Real AAC pictograms from ARASAAC, straight from the browser.
   ══════════════════════════════════════════════════════════════════

   WHY THIS BEATS GENERATING THEM
     ARASAAC is the pictogram set that speech therapists and special
     education actually use. Drawn by Sergio Palao, maintained by the
     Government of Aragón, and already familiar to many of the people
     Slime is for. A generated picture is new every time; a pictogram
     someone already recognises is the whole point of the format.
     It is also instant and free, where generation was seconds and quota.

   ENDPOINTS
     search  https://api.arasaac.org/v1/pictograms/{lang}/search/{text}
             → array of pictograms, each with an _id
     image   https://static.arasaac.org/pictograms/{id}/{id}_500.png

   LICENCE — this matters, do not skip it
     Pictograms are the property of the Government of Aragón, created by
     Sergio Palao for ARASAAC, distributed under CC BY-NC-SA. Attribution
     is required wherever they appear: SlimePictos.CREDIT gives you the line.
     NC means non-commercial. Fine for a demo or a pilot; if Slime ever
     charges for anything, talk to ARASAAC first.

   USE
     const url = await SlimePictos.find("kettle");     // → image URL or null
     SlimePictos.setFallback(fn)   // fn(label) → Promise<url|null>, used only
                                   // for words ARASAAC does not have
     SlimePictos.setLanguage("es");   // only if you ever localise the demo
   ══════════════════════════════════════════════════════════════════ */

window.SlimePictos = (function(){

  const API    = "https://api.arasaac.org/v1/pictograms";
  const STATIC = "https://static.arasaac.org/pictograms";
  const SIZE   = 500;

  const CREDIT = "Pictograms: Sergio Palao · ARASAAC · Government of Aragón · CC BY-NC-SA";

  let lang = "en";
  let fallbackLang = "en";   // the whole demo is in English
  let onMiss = null;         // optional: draw it when the dictionary has nothing
  const cache = new Map();   // label → url | null

  /* Model output is short already, but "the red button" should still find
     "button". Drop articles and keep it to the words that carry meaning. */
  const STOP = new Set(["the","a","an","el","la","los","las","un","una","le","les","de","of","to","your","my"]);
  function clean(label){
    return String(label || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w))
      .join(" ")
      .trim();
  }

  /* Taking the first result is how "button" ends up as a shirt button. ARASAAC
     returns every sense of a word, so score them: an exact keyword match beats a
     partial one, and a keyword that is the whole entry beats one buried in a phrase. */
  function score(item, term){
    const kws = (item.keywords || []).map((k) => String(k.keyword || "").toLowerCase());
    if(!kws.length) return 0;
    const t = term.toLowerCase();
    let best = 0;
    kws.forEach((k) => {
      if(k === t) best = Math.max(best, 100);
      else if(k.split(/\s+/)[0] === t) best = Math.max(best, 60);
      else if(k.startsWith(t)) best = Math.max(best, 40);
      else if(k.includes(t)) best = Math.max(best, 20);
    });
    /* a plain entry is usually the everyday sense; a long keyword list is a
       specialised or metaphorical one */
    return best - Math.min(kws.length, 6);
  }

  async function searchIn(text, language){
    const url = API + "/" + language + "/search/" + encodeURIComponent(text);
    const res = await fetch(url, { headers:{ "Accept":"application/json" } });
    if(!res.ok) return null;                 // 404 is ARASAAC's "nothing found"
    const list = await res.json();
    if(!Array.isArray(list) || !list.length) return null;

    let best = list[0], bestScore = -1;
    list.slice(0, 12).forEach((item) => {
      const s = score(item, text);
      if(s > bestScore){ bestScore = s; best = item; }
    });
    const id = best._id || best.id;
    return id ? STATIC + "/" + id + "/" + id + "_" + SIZE + ".png" : null;
  }

  /* Steps arrive as actions — "fill kettle", "pour water". Try the whole phrase
     first, because ARASAAC has plenty of verb pictograms and an action picture
     beats an object picture for an instruction. Then the verb on its own, then
     the object as a last resort. */
  async function find(label){
    const key = String(label || "").toLowerCase();
    if(cache.has(key)) return cache.get(key);

    const phrase = clean(label);
    const words  = phrase.split(" ").filter(Boolean);
    const tries  = [];
    if(phrase) tries.push(phrase);
    if(words.length > 1){
      tries.push(words[0]);                       // the verb
      tries.push(words[words.length - 1]);        // the object
    }

    for(const language of [lang, fallbackLang]){
      for(const t of tries){
        try{
          const url = await searchIn(t, language);
          if(url){ cache.set(key, url); return url; }
        }catch(e){ /* network or CORS — try the next one */ }
      }
    }
    /* ARASAAC is a fixed dictionary, so uncommon words simply are not in it.
       If a fallback is registered, ask it to draw one. Slower and less
       recognisable than a real pictogram, which is exactly why it is second. */
    if(onMiss){
      try{
        const drawn = await onMiss(label);
        if(drawn){ cache.set(key, drawn); return drawn; }
      }catch(e){}
    }
    cache.set(key, null);
    return null;
  }

  return {
    find,
    CREDIT,
    setLanguage(l, fb){ lang = l || "en"; if(fb) fallbackLang = fb; },
    setFallback(fn){ onMiss = typeof fn === "function" ? fn : null; },
    language(){ return lang; },
    clearCache(){ cache.clear(); },
  };
})();
