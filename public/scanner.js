// Bias Scanner: goes through an article sentence by sentence and flags word choices that are
// coded left, coded right, or loaded either way. It runs entirely in the browser.
//
// This flags *framing signals*, not proof of bias: a single word can be the accurate term, and
// words inside quotation marks are the speaker's, not the outlet's, so they count for less.

const BIAS_TERMS = [
  // ---- Israel / Middle East ----
  { re: /\boccupied (west bank|territor(y|ies)|palestinian territor(y|ies)|east jerusalem)\b|\b(the|israel'?s|israeli) occupation\b/i, side: 'left', note: 'Israel calls this territory disputed; "occupied" adopts the Palestinian and UN framing.', neutral: 'West Bank' },
  { re: /\bjudea and samaria\b/i, side: 'right', note: 'The biblical name used by Israel\'s government and the Israeli right.', neutral: 'West Bank' },
  { re: /\bapartheid\b/i, side: 'left', note: 'A contested legal charge. Stated as fact rather than attributed, it takes a side.', neutral: 'say who makes the accusation' },
  { re: /\bgenocid(e|al)\b/i, side: 'left', note: 'A legal charge under dispute in court. Stated as fact rather than attributed, it takes a side.', neutral: 'say who makes the accusation' },
  { re: /\bethnic cleansing\b/i, side: 'left', note: 'A charged accusation. Stated as fact rather than attributed, it takes a side.', neutral: 'describe the specific action' },
  { re: /\bsettler[- ]colonial\w*|\bcoloniz(er|ers|ation)\b/i, side: 'left', note: 'Frames Israel through an anti-colonial lens, a political argument.', neutral: 'describe the specific policy' },
  { re: /\b(armed )?resistance (fighters|groups?|movement|factions?)\b|\bthe resistance\b/i, side: 'left', note: 'Calling armed groups "the resistance" adopts their own framing.', neutral: 'name the group' },
  { re: /\bmartyr(s|ed|dom)?\b/i, side: 'left', note: '"Martyr" for militants killed adopts the group\'s religious framing.', neutral: 'killed' },
  { re: /\bzionist entity\b|\bIOF\b|\bisraeli occupation forces\b/i, side: 'left', note: 'Terms that deny Israel\'s legitimacy, used by hostile or far-left outlets.', neutral: 'Israel / IDF' },
  { re: /\bcollective punishment\b/i, side: 'left', note: 'A legal accusation. Stated as fact rather than attributed, it takes a side.', neutral: 'say who makes the accusation' },
  { re: /\bhamas (militants|fighters)\b|\bpalestinian (militants|fighters)\b/i, side: 'left', note: 'Softer than "terrorists". The US, EU and UK designate Hamas a terrorist group; some outlets avoid the word.', neutral: 'Hamas gunmen / members' },
  { re: /\b(hamas|hezbollah|houthi|islamic jihad|palestinian) terror(ists?| groups?| organi[sz]ation| army)?\b|\bterror (group|organi[sz]ation|army|chiefs?)\b/i, side: 'right', note: '"Terror" is the official US/EU designation for these groups, but many outlets avoid it; using it signals a framing choice.', neutral: 'Hamas (designated a terrorist group by the US and EU)' },
  { re: /\bpro-hamas\b/i, side: 'right', note: 'Labeling protesters "pro-Hamas" rather than "pro-Palestinian" assigns them support for the group.', neutral: 'pro-Palestinian' },
  { re: /\b(jihadis?t?s?|islamists?)\b/i, side: 'right', note: 'Religious labels for militants; accurate for some groups, but a framing choice.', neutral: 'name the group' },
  { re: /\b(iranian|tehran|islamic) regime\b|\bthe regime in tehran\b/i, side: 'right', note: '"Regime" implies illegitimacy; common for Iran in right-leaning coverage.', neutral: 'Iranian government' },
  { re: /(?<!\b(nova|october 7|oct\.? 7|munich|hebron|kfar aza|be'?eri|ma'?alot|sbarro|itamar|fogel)(\s+music festival|\s+festival)?\s+)\bmassacre[sd]?\b(?!\s+site)/i, side: 'loaded', note: 'Strongly emotive. Used by every side for its own victims.', neutral: 'attack / killing, with numbers and source' },

  // ---- US politics ----
  { re: /\bundocumented (immigrants?|migrants?|people|workers)\b/i, side: 'left', note: 'Preferred by immigration advocates.', neutral: 'immigrants in the country illegally' },
  { re: /\billegal aliens?\b|\billegals\b|\billegal immigrants?\b|\bcriminal aliens?\b/i, side: 'right', note: 'Preferred by immigration restrictionists. Many style guides avoid it.', neutral: 'immigrants in the country illegally' },
  { re: /\bopen[- ]borders?\b/i, side: 'right', note: 'A critic\'s description of an opponent\'s policy.', neutral: 'describe the specific policy' },
  { re: /\bgun safety\b/i, side: 'left', note: 'Advocates\' framing for gun restrictions.', neutral: 'gun laws / gun control' },
  { re: /\bforced[- ]birth\b/i, side: 'left', note: 'Abortion-rights activists\' label for opponents.', neutral: 'anti-abortion' },
  { re: /\bpro-abortion\b/i, side: 'right', note: 'Opponents\' label for abortion-rights supporters.', neutral: 'abortion-rights' },
  { re: /\bunborn (child|children|bab(y|ies))\b/i, side: 'right', note: 'Anti-abortion framing.', neutral: 'fetus' },
  { re: /\btax (cuts|breaks) for the (wealthy|rich)\b|\bbillionaire tax cuts?\b/i, side: 'left', note: 'Critics\' framing of tax policy.', neutral: 'tax cuts' },
  { re: /\bdeath tax\b/i, side: 'right', note: 'Opponents\' name for the estate tax.', neutral: 'estate tax' },
  { re: /\bvoter suppression\b/i, side: 'left', note: 'Critics\' label for voting rules; stated as fact, it takes a side.', neutral: 'voting restrictions / voting rules' },
  { re: /\bclimate (crisis|emergency|catastrophe)\b/i, side: 'left', note: 'Advocacy framing.', neutral: 'climate change' },
  { re: /\b(corporate greed|big oil|big pharma)\b/i, side: 'left', note: 'Pejorative framing of industries.', neutral: 'name the companies' },
  { re: /\b(far|hard)[- ]right\b|\bright[- ]wing extremists?\b|\bmaga extremists?\b/i, side: 'left', note: 'An ideological label applied by the writer; check whether it is used for the other side too.', neutral: 'conservative / name the position' },
  { re: /\b(far|radical|hard)[- ]left\b|\bleft[- ]wing (radicals?|extremists?)\b/i, side: 'right', note: 'An ideological label applied by the writer; check whether it is used for the other side too.', neutral: 'progressive / name the position' },
  { re: /\b(leftists?|marxists?|commies)\b/i, side: 'right', note: 'Ideological labels applied by the writer.', neutral: 'progressive / name the position' },
  { re: /\b(israel|jew|america|cop)-hat(ing|ers?)\b|\bpro-terror(ist)?\b|\bterror(ist)? sympathi[sz]ers?\b|\banti-american\b/i, side: 'right', note: 'A charged label that tells the reader what to think of the person.', neutral: 'say what they said or did' },
  { re: /\blawfare\b|\bdeep state\b|\bweaponi[sz]ed (doj|fbi|justice department)\b/i, side: 'right', note: 'Frames legal or government action as political warfare.', neutral: 'describe the case or action' },
  { re: /\b(migrant|border) invasion\b|\binvasion (at|across|of) the (southern )?border\b/i, side: 'right', note: 'War language for immigration.', neutral: 'border crossings' },
  { re: /\bdog[- ]whistles?\b|\bthreat to (our )?democracy\b|\b(authoritarian|fascist)(s|ism)?\b(?! (regime|government|state) (in|of) (china|russia|iran|north korea))/i, side: 'left', note: 'A charged label applied by the writer to a US political opponent.', neutral: 'say what they said or did' },
  { re: /\bgender-affirming (care|surgery|treatment)\b/i, side: 'left', note: 'Advocates\' term.', neutral: 'medical gender transition' },
  { re: /\breproductive (rights|freedom|health ?care|justice)\b/i, side: 'left', note: 'Advocates\' framing for abortion access.', neutral: 'abortion access' },
  { re: /\b(claim\w*|said|says|assert\w*|suggest\w*|insist\w*|accus\w*)\b[^.;]{0,60}?\bwithout (providing |offering |citing )?(any )?evidence\b|\bbaseless(ly)?\b|\bfalsely (claimed|said|claims|says|suggested)\b|\bdebunked\b/i, side: 'loaded', note: 'A fact-check verdict in the news copy. Fair when the article shows the evidence; a framing choice when it doesn\'t.', neutral: 'show the evidence' },
  { re: /\b(mobs?|thugs?)\b/i, side: 'loaded', note: 'Dehumanizing word for a group of people. Watch which side gets it.', neutral: 'crowd / protesters' },
  { re: /\bwoke\b/i, side: 'right', note: 'A pejorative used mostly by the right.', neutral: 'name the policy' },
  { re: /\bdemocrat party\b|\bdemocrat-(run|led|controlled)\b/i, side: 'right', note: '"Democrat" as an adjective is a deliberate partisan usage.', neutral: 'Democratic' },
  { re: /\bclimate (cult|alarmis[tm]s?|hoax)\b/i, side: 'right', note: 'Dismissive framing of climate concern.', neutral: 'climate activists / climate policy' },
  { re: /\bgender ideology\b/i, side: 'right', note: 'Opponents\' framing of transgender policy.', neutral: 'policies on gender identity' },
  { re: /\bglobalists?\b/i, side: 'right', note: 'Vague pejorative; sometimes used as an antisemitic dog whistle.', neutral: 'name the people or policy' },
  { re: /\b(mainstream|legacy|corporate) media\b|\bMSM\b/i, side: 'loaded', note: 'Frames other outlets as a hostile establishment. A horseshoe phrase: the far left and the far right both use it.', neutral: 'news outlets' },
  { re: /\billegal settlements?\b/i, side: 'left', note: 'Most countries consider the settlements illegal; Israel disputes it. Stated as fact, it takes a side.', neutral: 'settlements' },
  { re: /\b(the )?(israel|zionist|pro-israel) lobby\b/i, side: 'left', note: 'Frames support for Israel as a lobby\'s influence; "Zionist lobby" is often hostile.', neutral: 'name the group (e.g. AIPAC)' },
  { re: /\banti-israel (protesters?|activists?|students?|mobs?|demonstrators?|agitators?)\b/i, side: 'right', note: 'Labels pro-Palestinian protesters by what they oppose.', neutral: 'pro-Palestinian protesters' },
  { re: /\belection deniers?\b/i, side: 'left', note: 'A label applied by critics.', neutral: 'say what the person claimed' },
  { re: /\bislamophob(e|es|ia|ic)\b/i, side: 'left', note: 'A label applied by the writer; check whether the article shows why.', neutral: 'describe what was said' },
  { re: /\bdisinformation\b|\bmisinformation\b/i, side: 'loaded', note: 'Labels a claim false. Check whether the article shows why.', neutral: 'false claim (with the evidence)' },

  // ---- Loaded wording on any topic ----
  { re: /\b(slams|slammed)(?! (into|shut|the (door|brakes)))|\b(lambast(s|ed|ing)?|eviscerat(es|ed|ing)|(rips?|ripped|tears?|tore|lays?|laid) into|hits? out at|blasted|torches) (?!site|wave|radius)/i, side: 'loaded', note: 'Combat verbs make a statement sound like an attack.', neutral: 'criticized / said' },
  { re: /\b(shocking|horrific|outrageous|disgraceful|disgusting|stunning|bombshell|chilling|train[- ]wreck|unhinged|insane)\b/i, side: 'loaded', note: 'Emotional adjectives tell you how to feel instead of what happened.', neutral: 'drop the adjective' },
  { re: /\b(meltdown|firestorm|chaos|chaotic|insanity|nightmare)\b/i, side: 'loaded', note: 'Dramatic framing.', neutral: 'describe what happened' },
  { re: /\bso-called\b/i, side: 'loaded', note: '"So-called" signals the writer doesn\'t accept the name.', neutral: 'drop it' },
  { re: /\b(claimed|claims|claiming)\b(?= (that|to|he|she|they|it|its|the|a|an|without|in)\b)(?! (responsibility|credit))/i, side: 'loaded', note: '"Claims" instead of "says" signals doubt. Fine when the claim is disputed; telling when it\'s used for one side only.', neutral: 'said / says' },
  { re: /\b(admitted|admits|conceded|refused to)\b/i, side: 'loaded', note: 'Implies wrongdoing or evasion.', neutral: 'said / did not' },
  { re: /\b(was|were) killed\b(?![^.;]{0,80}\bby\b)|\b(died|have died|has died) (in|during|after|amid) (an? )?(israeli |us |american |russian )?(strike|airstrike|attack|bombing|raid)/i, side: 'loaded', note: 'Passive voice hides who did it ("were killed" without "by"); "died in a strike" softens it. Watch whether this is applied to one side only.', neutral: 'say who killed whom' },
];

const SIDES = {
  left: { label: 'Left-coded', cls: 'b-left' },
  right: { label: 'Right-coded', cls: 'b-right' },
  loaded: { label: 'Loaded', cls: 'b-loaded' },
};

function splitSentences(text) {
  return text.match(/[^.!?]+(?:[.!?]+["”’']?|$)/g)?.map(s => s.trim()).filter(Boolean) || [text];
}

// Character ranges that are someone else's words: inside double quotes (including a quote that
// opens or closes in another sentence), or right after an attribution like "accused Israel of".
function quoteRanges(s) {
  const out = [];
  // Double quotes, plus single quotes the way headlines use them: ‘…’ or '…' around words (not apostrophes).
  const re = /["“]([^"“”]{3,})["”]|‘([^‘’]{3,})’|(?<![\w])'([^']{3,}?)'(?![\w])/g;
  let m;
  while ((m = re.exec(s))) out.push([m.index, m.index + m[0].length]);
  const opens = (s.match(/[“]/g) || []).length, closes = (s.match(/[”]/g) || []).length;
  if (opens > closes) out.push([s.lastIndexOf('“'), s.length]);
  if (closes > opens) out.push([0, s.indexOf('”') + 1]);
  return out;
}

const ATTRIBUTION_BEFORE = /\b(accus\w*|alleg\w*|claims? (of|that)|charges? (of|that)|called (it )?|calls (it )?|described (it )?as|label(l)?ed (it )?(as )?|branded (it )?(as )?|reading|chant\w*|signs? (saying|reading)|denies|denied|rejects?|rejected|according to)\b[^.;]{0,70}$/i;
const ATTRIBUTION_AFTER = /^[^.;]{0,40}?,?\s*["”]?\s*(\b[A-Z][\w.'-]*\s?){1,4}(told|tells|said|says|wrote|writes|added|posted|tweeted|warns|warned|argues|argued|insists|insisted)\b/;

function attributed(sentence, start, end) {
  return ATTRIBUTION_BEFORE.test(sentence.slice(0, start)) || ATTRIBUTION_AFTER.test(sentence.slice(end));
}

function scanText(paragraphs) {
  const findings = [];
  // Only the outlet's own words count toward the lean; quoted words are listed but not scored.
  const counts = { left: 0, right: 0, loaded: 0, quoted: 0 };
  const marked = paragraphs.map((p, pi) => splitSentences(p).map((sentence, si) => {
    const quotes = quoteRanges(sentence);
    const hits = [];
    for (const t of BIAS_TERMS) {
      const re = new RegExp(t.re.source, 'gi');
      let m;
      while ((m = re.exec(sentence))) {
        if (hits.some(h => m.index < h.end && m.index + m[0].length > h.start)) continue;
        const quoted = quotes.some(([a, b]) => m.index >= a && m.index < b) || attributed(sentence, m.index, m.index + m[0].length);
        hits.push({ start: m.index, end: m.index + m[0].length, text: m[0], quoted, ...t });
      }
    }
    hits.sort((a, b) => a.start - b.start);
    for (const h of hits) {
      if (h.quoted) counts.quoted++; else counts[h.side]++;
      findings.push({ ...h, sentence, pi, si, id: `f${findings.length}` });
    }
    return { sentence, hits };
  }));
  const lean = counts.left + counts.right ? (counts.right - counts.left) / (counts.right + counts.left) : 0;
  return { findings, counts, lean, marked };
}

function leanVerdict({ counts, lean }) {
  const total = counts.left + counts.right;
  if (total === 0) return counts.loaded >= 3 ? 'No left- or right-coded word choices, but a lot of loaded language.' : 'No left- or right-coded word choices found in the outlet\'s own words.';
  if (total === 1) return `Only one ${counts.left ? 'left' : 'right'}-coded word choice. Not enough to call a lean.`;
  if (Math.abs(lean) < 0.34) return 'Word choice is mixed: signals from both sides.';
  const side = lean > 0 ? 'right' : 'left';
  return `Word choice leans ${Math.abs(lean) >= 0.75 && total >= 4 ? 'clearly ' : ''}${side} (${total} signals in the outlet's own words).`;
}

window.BiasScanner = { scanText, leanVerdict, SIDES };
