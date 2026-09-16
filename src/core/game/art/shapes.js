// src/core/game/art/shapes.js
//
// Le vocabulaire avec lequel un chunk minifié est lu : des formes, pas un arbre
// syntaxique.
//
// Les prédicats d'art ne peuvent pas nommer un symbole minifié — les noms
// changent à chaque build — et le fork n'embarque aucun analyseur. Le chunk est
// donc projeté ici en un vocabulaire volontairement pauvre : des littéraux
// d'objet avec leurs membres, des fonctions avec leurs identifiants libres, des
// déclarations par nom, et l'idiome d'enum que le jeu emploie.
//
// La projection est **structurelle et non syntaxique** : un jeton d'ouverture
// est apparié à sa fermeture en sautant chaînes et gabarits, puis chaque plage
// de jetons est classée par sa tête (`{`, `[`, `new`, une chaîne de références,
// un littéral). Rien n'essaie de comprendre une expression arithmétique : une
// plage qui n'est pas une forme connue vaut `unresolved`, ce qui est la bonne
// réponse pour un lecteur qui refuse d'inventer.
//
// Deux normalisations du minifieur sont faites ici, parce qu'elles sont des
// idioms du build et non des formes du jeu :
//
//   - `!0` et `!1` sont `true` et `false`, donc un membre booléen arrive en
//     `{kind:'boolean'}` — la table des drapeaux d'affichage est tout entière
//     écrite comme ça.
//   - un gabarit sans substitution est une chaîne : les noms de sprite du jeu
//     sont en backticks, et un lecteur qui les ignore rendrait une table vide au
//     lieu d'une table fausse.

const PUNCTUATORS = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=",
  "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>",
];

/** Après ces jetons, un `/` ouvre une expression régulière et non une division. */
const REGEX_AFTER_PUNCT = new Set([
  "(", "[", "{", ",", ";", ":", "?", "=", "==", "===", "!=", "!==", "!", "&&",
  "||", "??", "+", "-", "*", "%", "&", "|", "^", "<", ">", "<=", ">=", "~",
  "=>", "...", "return",
]);

/** Mots-clés d'ECMAScript, plus ceux qui ne peuvent pas être des identifiants libres. */
const KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for",
  "function", "if", "import", "in", "instanceof", "let", "new", "null", "of",
  "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var",
  "void", "while", "with", "yield", "await", "async", "static", "get", "set",
  "from", "as", "undefined",
]);

/** Les globales d'ECMAScript qu'une fonction du jeu peut lire sans les déclarer. */
export const HOST_GLOBALS = new Set([
  "Array", "Boolean", "Date", "JSON", "Map", "Math", "Number", "Object", "Promise",
  "Reflect", "RegExp", "Set", "String", "Symbol", "console", "globalThis", "undefined",
]);

const ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };

function decodeEscape(char) {
  return Object.hasOwn(ESCAPES, char) ? ESCAPES[char] : char;
}

/**
 * Découpe un chunk en jetons.
 *
 * Le seul point délicat est `/` : une expression régulière et une division
 * s'écrivent pareil. La règle est celle du langage — un `/` ouvre une regex
 * quand le jeton significatif précédent ne peut pas terminer une expression —
 * et elle est **nécessaire** ici : une regex mal lue, c'est un guillemet avalé
 * et un chunk entier projeté de travers.
 */
export function tokenize(text) {
  const tokens = [];
  let i = 0;
  let previous = null;

  const push = (token) => {
    tokens.push(token);
    previous = token;
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v") {
      i += 1;
      continue;
    }

    if (ch === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }

    if (ch === "/" && regexAllowed(previous)) {
      const end = scanRegExp(text, i);
      if (end !== -1) {
        push({ type: "regex", text: text.slice(i, end), start: i, end });
        i = end;
        continue;
      }
    }

    if (ch === "'" || ch === '"') {
      const end = scanString(text, i);
      if (end === -1) throw new Error(`unterminated string at ${i}`);
      push({
        type: "string",
        value: decodeString(text.slice(i + 1, end - 1)),
        quote: ch === "'" ? "single" : "double",
        text: text.slice(i, end),
        start: i,
        end,
      });
      i = end;
      continue;
    }

    if (ch === "`") {
      const scanned = scanTemplate(text, i);
      // Un gabarit sans substitution est une chaîne : c'est ainsi que le jeu
      // écrit ses noms de sprite.
      push({
        type: scanned.substitution ? "template" : "string",
        value: scanned.substitution ? null : decodeString(scanned.body),
        substitution: scanned.substitution,
        quote: "template",
        text: text.slice(i, scanned.end),
        start: i,
        end: scanned.end,
      });
      i = scanned.end;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      const end = scanNumber(text, i);
      push({ type: "number", value: Number(text.slice(i, end)), text: text.slice(i, end), start: i, end });
      i = end;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch) || (ch === "#" && /[A-Za-z_$]/.test(text[i + 1] ?? ""))) {
      let end = i + 1;
      while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) end += 1;
      push({ type: "name", value: text.slice(i, end), start: i, end });
      i = end;
      continue;
    }

    const punctuator = PUNCTUATORS.find((candidate) => text.startsWith(candidate, i));
    if (punctuator) {
      push({ type: "punct", value: punctuator, start: i, end: i + punctuator.length });
      i += punctuator.length;
      continue;
    }

    push({ type: "punct", value: ch, start: i, end: i + 1 });
    i += 1;
  }

  return tokens;
}

/** La même règle que `regexAllowed`, pour le caractère significatif précédent d'une substitution. */
function regexAllowedAt(character) {
  return "(,=[!&|?:;{}+-*%^~<>".includes(character) || character === "{";
}

function regexAllowed(previous) {
  if (previous === null) return true;
  if (previous.type === "punct") return REGEX_AFTER_PUNCT.has(previous.value);
  if (previous.type === "name") {
    return ["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "case", "do", "else", "yield", "await"].includes(
      previous.value
    );
  }
  return false;
}

/** La fin d'une expression régulière, ou -1 si celle-ci n'en est pas une. */
function scanRegExp(text, start) {
  let i = start + 1;
  let inClass = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") return -1;
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      i += 1;
      while (i < text.length && /[a-z]/.test(text[i])) i += 1;
      return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * La fin d'une chaîne quotée (l'index après le guillemet fermant), ou -1 si le
 * guillemet ne se referme pas.
 *
 * Ne pas lever est délibéré : dans une substitution de gabarit, le contenu est
 * du JavaScript arbitraire que ce lecteur ne lexe pas complètement, et un
 * guillemet qui appartient à une expression régulière (`/['"]/`) ressemble
 * exactement à une chaîne. Rendre -1 laisse l'appelant traiter le caractère pour
 * ce qu'il est, au lieu de faire tomber la projection d'un chunk entier — ce qui,
 * dans le test de cible du résolveur, ferait tomber la résolution du bundle.
 */
function scanString(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return -1;
}

/** Un gabarit, substitutions sautées en respectant les accolades imbriquées. */
function scanTemplate(text, start) {
  let i = start + 1;
  let body = "";
  let substitution = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      body += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "`") return { body, substitution, end: i + 1 };
    if (ch === "$" && text[i + 1] === "{") {
      substitution = true;
      let depth = 0;
      let previous = "{";
      i += 1;
      while (i < text.length) {
        const inner = text[i];
        if (inner === "{") {
          depth += 1;
          previous = inner;
        } else if (inner === "}") {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            break;
          }
          previous = inner;
        } else if (inner === "'" || inner === '"') {
          // Une regex comme `/['"]/` commence par un guillemet qui ne se referme
          // pas : -1 veut dire « ce n'était pas une chaîne », et le caractère est
          // traité comme du code.
          const end = scanString(text, i);
          if (end !== -1) {
            previous = inner;
            i = end - 1;
          }
        } else if (inner === "`") {
          i = scanTemplate(text, i).end - 1;
          previous = "`";
        } else if (inner === "/" && text[i + 1] === "/") {
          const end = text.indexOf("\n", i);
          i = end === -1 ? text.length : end;
        } else if (inner === "/" && text[i + 1] === "*") {
          const end = text.indexOf("*/", i + 2);
          i = end === -1 ? text.length : end + 1;
        } else if (inner === "/" && regexAllowedAt(previous)) {
          const end = scanRegExp(text, i);
          if (end !== -1) {
            previous = "/";
            i = end - 1;
          }
        } else if (inner !== " " && inner !== "\n" && inner !== "\t" && inner !== "\r") {
          previous = inner;
        }
        i += 1;
      }
      continue;
    }
    body += ch;
    i += 1;
  }
  throw new Error(`unterminated template at ${start}`);
}

function scanNumber(text, start) {
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (/[0-9a-fA-F_]/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === ".") {
      // Un deuxième point n'appartient plus au nombre (il ouvre un membre).
      if (text.slice(start, i).includes(".")) break;
      i += 1;
      continue;
    }
    if (ch === "x" || ch === "X" || ch === "o" || ch === "O" || ch === "b" || ch === "B") {
      if (i !== start + 1 || text[start] !== "0") break;
      i += 1;
      continue;
    }
    if (ch === "e" || ch === "E") {
      i += 1;
      if (text[i] === "+" || text[i] === "-") i += 1;
      continue;
    }
    if (ch === "n" && i === text.length - 1) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function decodeString(raw) {
  if (!raw.includes("\\")) return raw;
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "\\" && i + 1 < raw.length) {
      out += decodeEscape(raw[i + 1]);
      i += 1;
      continue;
    }
    out += raw[i];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Les formes
// ---------------------------------------------------------------------------------------------

/** Un objet projeté : ses membres, et son texte verbatim. */
function makeObject(tokens, text, start, end) {
  const members = [];
  // Découpe aux virgules de niveau 0, puis à la première `:` de niveau 0.
  let depth = 0;
  let segmentStart = -1;
  const segments = [];
  for (let i = start + 1; i < end - 1; i += 1) {
    const token = tokens[i];
    if (token.type === "punct") {
      if (token.value === "{" || token.value === "[" || token.value === "(") depth += 1;
      else if (token.value === "}" || token.value === "]" || token.value === ")") depth -= 1;
      else if (token.value === "," && depth === 0) {
        segments.push([segmentStart, i]);
        segmentStart = -1;
        continue;
      }
    }
    if (segmentStart === -1) segmentStart = i;
  }
  if (segmentStart !== -1) segments.push([segmentStart, end - 1]);

  for (const [lo, hi] of segments) {
    if (lo >= hi) continue;
    let colon = -1;
    let d = 0;
    for (let i = lo; i < hi; i += 1) {
      const token = tokens[i];
      if (token.type !== "punct") continue;
      if (token.value === "{" || token.value === "[" || token.value === "(") d += 1;
      else if (token.value === "}" || token.value === "]" || token.value === ")") d -= 1;
      else if (token.value === ":" && d === 0) {
        colon = i;
        break;
      }
    }
    if (colon === -1) {
      // Raccourci `{a}` ou étalement `{...a}` : le premier n'a pas de valeur ici.
      const only = tokens[lo];
      if (hi - lo === 1 && only.type === "name") {
        members.push({
          key: only.value,
          computed: false,
          value: { kind: "reference", path: [only.value], computed: false, start: only.start, end: only.end },
          start: only.start,
          end: only.end,
        });
      }
      continue;
    }
    const keyTokens = tokens.slice(lo, colon);
    const key = readKey(keyTokens, text);
    if (key === null) continue;
    const value = classify(tokens, colon + 1, hi, text);
    members.push({
      key: key.key,
      computed: key.computed,
      value,
      start: tokens[lo].start,
      end: tokens[hi - 1].end,
    });
  }

  return {
    kind: "object",
    name: null,
    members,
    start: tokens[start].start,
    end: tokens[end - 1].end,
    text: text.slice(tokens[start].start, tokens[end - 1].end),
    tokenStart: start,
    tokenEnd: end,
  };
}

function readKey(keyTokens, text) {
  if (keyTokens.length === 0) return null;
  const first = keyTokens[0];
  if (first.type === "name" && keyTokens.length === 1) return { key: first.value, computed: false };
  if (first.type === "string" && keyTokens.length === 1) return { key: first.value, computed: false };
  if (first.type === "number" && keyTokens.length === 1) return { key: first.text, computed: false };
  // Clé calculée : `[B.Plant.Aloe]`. Le texte est gardé tel quel, c'est lui que
  // la table des noms de sprite résout.
  if (first.type === "punct" && first.value === "[" && keyTokens.at(-1)?.value === "]") {
    const inner = keyTokens.slice(1, -1);
    if (inner.length === 0) return null;
    return { key: text.slice(inner[0].start, inner.at(-1).end), computed: true };
  }
  return null;
}

/** La fin du bloc ouvert au jeton `open`, en comptant les appariements. */
function matchBlock(tokens, open) {
  const pairs = { "{": "}", "[": "]", "(": ")" };
  const expected = pairs[tokens[open].value];
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    const value = tokens[i].type === "punct" ? tokens[i].value : null;
    if (value === tokens[open].value) depth += 1;
    else if (value === expected) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced ${tokens[open].value} at ${tokens[open].start}`);
}

/**
 * Classe une plage de jetons en une forme.
 *
 * Aucune expression n'est évaluée : une plage qui n'est pas un littéral, un
 * objet, un tableau, un appel ou une chaîne de références vaut `unresolved`.
 * C'est volontaire — une valeur devinée serait publiée comme si le jeu l'avait
 * dite.
 */
function classify(tokens, lo, hi, text) {
  const unresolved = { kind: "unresolved", start: tokens[lo]?.start ?? 0, end: tokens[hi - 1]?.end ?? 0 };
  if (lo >= hi) return unresolved;

  const single = tokens[lo];
  if (hi - lo === 1) {
    if (single.type === "number") return { kind: "number", value: single.value, text: single.text, start: single.start, end: single.end };
    if (single.type === "string") return { kind: "string", text: single.value, quote: single.quote, start: single.start, end: single.end };
    if (single.type === "template") return unresolved;
    if (single.type === "name") {
      if (single.value === "true" || single.value === "false") {
        return { kind: "boolean", value: single.value === "true", start: single.start, end: single.end };
      }
      if (single.value === "null") return { kind: "null", start: single.start, end: single.end };
      if (KEYWORDS.has(single.value)) return unresolved;
      return { kind: "reference", path: [single.value], computed: false, start: single.start, end: single.end };
    }
    return unresolved;
  }

  // `!0` / `!1` : les booléens du minifieur.
  if (single.type === "punct" && single.value === "!" && hi - lo === 2 && ["0", "1"].includes(tokens[lo + 1].text)) {
    return { kind: "boolean", value: tokens[lo + 1].text === "0", start: single.start, end: tokens[lo + 1].end };
  }
  if (single.type === "name" && single.value === "void" && hi - lo === 2) {
    return { kind: "null", start: single.start, end: tokens[lo + 1].end };
  }

  if (single.type === "punct" && single.value === "{") {
    const close = matchBlock(tokens, lo);
    if (close === hi - 1) {
      const object = makeObject(tokens, text, lo, close + 1);
      registerObjects(object);
      return object;
    }
  }

  if (single.type === "punct" && single.value === "[") {
    const close = matchBlock(tokens, lo);
    if (close === hi - 1) {
      const items = [];
      let segmentStart = lo + 1;
      let depth = 0;
      for (let i = lo + 1; i < close; i += 1) {
        const token = tokens[i];
        if (token.type === "punct") {
          if (token.value === "{" || token.value === "[" || token.value === "(") depth += 1;
          else if (token.value === "}" || token.value === "]" || token.value === ")") depth -= 1;
          else if (token.value === "," && depth === 0) {
            items.push(classify(tokens, segmentStart, i, text));
            segmentStart = i + 1;
          }
        }
      }
      if (segmentStart < close) items.push(classify(tokens, segmentStart, close, text));
      return { kind: "array", items, start: single.start, end: tokens[close].end, text: text.slice(single.start, tokens[close].end) };
    }
  }

  // `new Name(...)` et `Name(...)` : un appel, avec la classe éventuellement
  // construite. C'est la forme des filtres de mutation.
  let cursor = lo;
  let construct = false;
  if (tokens[cursor].type === "name" && tokens[cursor].value === "new") {
    construct = true;
    cursor += 1;
  }
  const chain = readChain(tokens, cursor);
  if (chain !== null) {
    let after = chain.next;
    while (tokens[after]?.type === "punct" && (tokens[after].value === "?" || tokens[after].value === "!")) after += 1;
    if (tokens[after]?.type === "punct" && tokens[after].value === "(") {
      const close = matchBlock(tokens, after);
      if (close === hi - 1) {
        const args = [];
        let segmentStart = after + 1;
        let depth = 0;
        for (let i = after + 1; i < close; i += 1) {
          const token = tokens[i];
          if (token.type === "punct") {
            if (token.value === "{" || token.value === "[" || token.value === "(") depth += 1;
            else if (token.value === "}" || token.value === "]" || token.value === ")") depth -= 1;
            else if (token.value === "," && depth === 0) {
              args.push(classify(tokens, segmentStart, i, text));
              segmentStart = i + 1;
            }
          }
        }
        if (segmentStart < close) args.push(classify(tokens, segmentStart, close, text));
        return {
          kind: "call",
          construct,
          callee: chain.path.join("."),
          path: chain.path,
          args,
          start: single.start,
          end: tokens[close].end,
          text: text.slice(single.start, tokens[close].end),
        };
      }
    }
    // Une chaîne de références pure : `R.Wet.sprite`, `B.Plant.Aloe`.
    if (chain.computed === false && chain.next === hi) {
      return { kind: "reference", path: chain.path, computed: false, start: single.start, end: tokens[hi - 1].end };
    }
    if (chain.computed) {
      return { kind: "reference", path: chain.path, computed: true, start: single.start, end: tokens[hi - 1].end };
    }
  }

  return unresolved;
}

/** Une chaîne `a.b.c` de jetons, ou `null` si elle ne commence pas par un nom. */
function readChain(tokens, lo) {
  if (tokens[lo]?.type !== "name" || KEYWORDS.has(tokens[lo].value)) return null;
  const path = [tokens[lo].value];
  let i = lo + 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === "punct" && (token.value === "." || token.value === "?.")) {
      const next = tokens[i + 1];
      if (next?.type !== "name") return i === lo + 1 ? null : { path, computed: false, next: i };
      path.push(next.value);
      i += 2;
      continue;
    }
    if (token.type === "punct" && token.value === "[") {
      // Un accès calculé termine la chaîne : la clé n'est pas un nom.
      return { path, computed: true, next: i };
    }
    break;
  }
  return { path, computed: false, next: i };
}

// ---------------------------------------------------------------------------------------------
// La projection d'un chunk
// ---------------------------------------------------------------------------------------------

let currentProjection = null;

/** Les objets d'une projection, indexés par position : une forme n'est enregistrée qu'une fois. */
function registerObjects(object) {
  if (currentProjection === null) return;
  if (currentProjection.objects.has(object.start)) return;
  currentProjection.objects.set(object.start, object);
  for (const member of object.members) {
    if (member.value.kind === "object") registerObjects(member.value);
  }
}

/**
 * Projette un chunk.
 *
 * `objects` porte tous les littéraux d'objet du chunk, celui de la déclaration
 * comme les imbriqués — un prédicat cherche la forme, pas l'endroit. `functions`
 * porte les fonctions nommées avec leurs identifiants libres, `declarations`
 * les déclarations par nom (valeur classée, et le texte qu'il faudrait
 * redéclarer pour l'exécuter), `assignments` l'idiome d'enum du jeu
 * (`e.Single = 'Single'`), `imports` de quoi nommer l'origine d'un externe.
 */
export function projectChunk(file, text) {
  const tokens = tokenize(text);
  const projection = {
    file,
    text,
    tokens,
    objects: new Map(),
    functions: [],
    declarations: new Map(),
    assignments: [],
    imports: [],
  };

  const previous = currentProjection;
  currentProjection = projection;
  try {
    scanStatements(tokens, text, projection);
    scanAssignments(tokens, text, projection);
    scanObjects(tokens, text, projection);
  } finally {
    currentProjection = previous;
  }

  return {
    file,
    text,
    tokens,
    objects: [...projection.objects.values()].sort((left, right) => left.start - right.start),
    functions: dedupeFunctions(projection.functions),
    declarations: [...projection.declarations.values()].sort((left, right) => left.start - right.start),
    assignments: projection.assignments,
    imports: projection.imports,
  };
}

/** Une fonction vue deux fois (déclaration et déclarateur) n'est gardée qu'une fois. */
function dedupeFunctions(functions) {
  const seen = new Map();
  for (const fn of functions) {
    const known = seen.get(fn.start);
    if (known === undefined || (known.name === null && fn.name !== null)) seen.set(fn.start, fn);
  }
  return [...seen.values()].sort((left, right) => left.start - right.start);
}

function scanStatements(tokens, text, projection) {
  let depth = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.type === "punct") {
      if (token.value === "{" || token.value === "[" || token.value === "(") depth += 1;
      else if (token.value === "}" || token.value === "]" || token.value === ")") depth -= 1;
      continue;
    }
    if (token.type !== "name") continue;

    if (token.value === "import" && depth === 0) {
      i = readImport(tokens, i, projection) - 1;
      continue;
    }

    // Une fonction est un candidat où qu'elle soit : les prédicats cherchent une
    // forme, et le jeu niche ses constructeurs d'enum dans des déclarateurs.
    if (token.value === "function") {
      const parsed = readFunction(tokens, text, i);
      if (parsed === null) continue;
      projection.functions.push(parsed.fn);
      if (parsed.declaration !== null && depth === 0) register(projection, parsed.declaration);
      i = parsed.fn.tokenEnd - 1;
      continue;
    }

    // Les déclarations d'un chunk sont celles de sa portée : une `let` au fond
    // d'un corps est un local, et l'enregistrer écraserait la déclaration que
    // les prédicats cherchent par son nom.
    if (depth === 0 && ["var", "let", "const"].includes(token.value)) {
      i = readDeclarations(tokens, text, projection, i) - 1;
      continue;
    }
  }
}

/**
 * L'idiome d'enum du jeu, ramassé partout : `e.Single = 'Single'`.
 *
 * C'est une passe à part et non une branche de `scanStatements` parce que le
 * jeu écrit ses enums dans une IIFE **à l'intérieur** d'un déclarateur
 * (`B=function(e){return e.Single=…}({})`) : la lecture des déclarations saute
 * toute la valeur d'un coup, donc une recherche d'assignations qui vivrait
 * dedans ne verrait jamais ces membres.
 */
function scanAssignments(tokens, text, projection) {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "name") continue;
    const chain = readChain(tokens, i);
    if (chain === null || chain.computed || chain.path.length < 2) continue;
    if (tokens[chain.next]?.type !== "punct" || tokens[chain.next].value !== "=") continue;
    const valueStart = chain.next + 1;
    const valueEnd = rangeEnd(tokens, valueStart);
    projection.assignments.push({
      path: chain.path,
      value: classify(tokens, valueStart, valueEnd, text),
      start: tokens[i].start,
      end: tokens[valueEnd - 1]?.end ?? tokens[i].end,
    });
    i = valueEnd - 1;
  }
}

/**
 * Un mot-clé qui ne peut pas continuer une valeur : la plage s'arrête devant.
 *
 * `function` et `class` n'y sont pas, et c'est volontaire : les deux peuvent
 * **ouvrir** une valeur (`X=function(){…}({})`, `Y=new class extends Z{…}`), et
 * le bundle écrit exactement ces deux formes. Les prendre pour des débuts
 * d'instruction coupait la chaîne de déclarateurs au milieu et faisait
 * disparaître les tables qui la suivaient.
 */
const STATEMENT_STARTS = new Set([
  "var", "let", "const", "if", "for", "while", "return", "try", "switch",
  "throw", "export", "import", "do",
]);

/** La fin d'une plage de valeur : la première virgule ou parenthèse fermante de niveau 0. */
function rangeEnd(tokens, lo) {
  let depth = 0;
  for (let i = lo; i < tokens.length; i += 1) {
    const token = tokens[i];
    // Le premier jeton est la valeur elle-même : `X=function(){…}({})` et
    // `X=class extends Y{…}` sont des déclarateurs, pas des instructions qui
    // commencent. La garde ne vaut donc que pour la suite, où un mot-clé de
    // statement signale la fin d'une valeur non terminée par `;`.
    if (i > lo && token.type === "name" && depth === 0 && STATEMENT_STARTS.has(token.value)) return i;
    if (token.type !== "punct") continue;
    if (token.value === "{" || token.value === "[" || token.value === "(") depth += 1;
    else if (token.value === "}" || token.value === "]") {
      if (depth === 0) return i;
      depth -= 1;
    } else if (token.value === ")") {
      if (depth === 0) return i;
      depth -= 1;
    } else if (depth === 0 && (token.value === "," || token.value === ";")) return i;
  }
  return tokens.length;
}

function register(projection, declaration) {
  if (!projection.declarations.has(declaration.name)) {
    projection.declarations.set(declaration.name, declaration);
  }
}

/**
 * Une déclaration `var|let|const`, déclarateur par déclarateur.
 *
 * Le minifieur écrit `var J={…},mo={…},jo={…};` : prendre « jusqu'au
 * point-virgule » lirait les trois comme une seule déclaration, et une table ne
 * serait alors publiée sous aucun nom.
 */
function readDeclarations(tokens, text, projection, start) {
  let i = start + 1;

  // Un motif déstructuré n'est pas un déclarateur nommé : le jeu n'en écrit pas
  // pour ses tables, et l'inventer nommerait une forme fausse.
  if (tokens[i]?.type === "punct" && (tokens[i].value === "{" || tokens[i].value === "[")) {
    const close = matchBlock(tokens, i);
    i = tokens[close + 1]?.value === "=" ? rangeEnd(tokens, close + 2) : close + 1;
  }

  while (i < tokens.length) {
    if (tokens[i].type !== "name") return i;
    const name = tokens[i].value;
    const nameToken = tokens[i];
    i += 1;

    if (tokens[i]?.type === "punct" && tokens[i].value === "=") {
      const valueStart = i + 1;
      const valueEnd = rangeEnd(tokens, valueStart);
      const value = classify(tokens, valueStart, valueEnd, text);
      const valueText = text.slice(
        tokens[valueStart]?.start ?? nameToken.end,
        tokens[valueEnd - 1]?.end ?? nameToken.end
      );
      register(projection, {
        kind: "value",
        name,
        value,
        valueStart: tokens[valueStart]?.start ?? nameToken.end,
        valueEnd: tokens[valueEnd - 1]?.end ?? nameToken.end,
        start: nameToken.start,
        end: tokens[valueEnd - 1]?.end ?? nameToken.end,
        text: `${name}=${valueText}`,
      });
      if (value.kind === "object") value.name = name;
      if (value.kind === "call" && value.args[0]?.kind === "object") value.args[0].name = name;
      // Un déclarateur à valeur de fonction est aussi une fonction : c'est ainsi
      // que le jeu construit ses enums (`B=function(e){…}({})`).
      for (let t = valueStart; t < valueEnd; t += 1) {
        if (tokens[t].type === "name" && tokens[t].value === "function") {
          const parsed = readFunction(tokens, text, t);
          if (parsed !== null) projection.functions.push(parsed.fn);
          break;
        }
      }
      i = valueEnd;
    }

    if (tokens[i]?.type === "punct" && tokens[i].value === ",") {
      i += 1;
      continue;
    }
    if (tokens[i]?.type === "punct" && tokens[i].value === ";") return i + 1;
    return i;
  }
  return i;
}

/** Une fonction nommée : son texte verbatim, ses paramètres, ses identifiants libres. */
function readFunction(tokens, text, start) {
  let i = start + 1;
  let name = null;
  if (tokens[i]?.type === "name" && !KEYWORDS.has(tokens[i].value)) {
    name = tokens[i].value;
    i += 1;
  }
  // `function*` : le générateur n'est pas une forme du jeu, mais l'étoile ne
  // doit pas faire perdre l'appariement.
  if (tokens[i]?.type === "punct" && tokens[i].value === "*") i += 1;
  if (tokens[i]?.type !== "punct" || tokens[i].value !== "(") return null;
  const paramsEnd = matchBlock(tokens, i);
  const params = readParameterNames(tokens, i + 1, paramsEnd);
  const bodyOpen = paramsEnd + 1;
  if (tokens[bodyOpen]?.type !== "punct" || tokens[bodyOpen].value !== "{") return null;
  const bodyClose = matchBlock(tokens, bodyOpen);
  const fn = {
    name,
    parameters: params,
    free: freeNames(tokens, bodyOpen, bodyClose, params, text),
    text: text.slice(tokens[start].start, tokens[bodyClose].end),
    start: tokens[start].start,
    end: tokens[bodyClose].end,
    tokenStart: start,
    tokenEnd: bodyClose + 1,
  };
  return {
    fn,
    declaration: name === null ? null : { kind: "function", name, value: null, text: fn.text, start: fn.start, end: fn.end },
  };
}

function readParameterNames(tokens, lo, hi) {
  const names = [];
  let depth = 0;
  let expectName = true;
  for (let i = lo; i < hi; i += 1) {
    const token = tokens[i];
    if (token.type === "punct") {
      if (token.value === "{" || token.value === "[" || token.value === "(") depth += 1;
      else if (token.value === "}" || token.value === "]" || token.value === ")") depth -= 1;
      else if (token.value === "," && depth === 0) expectName = true;
      else if (token.value === "=" && depth === 0) expectName = false;
      continue;
    }
    if (expectName && token.type === "name" && !KEYWORDS.has(token.value)) {
      names.push(token.value);
      expectName = false;
    }
  }
  return names;
}

/**
 * Les identifiants qu'une fonction lit et ne déclare pas.
 *
 * C'est cette liste qui identifie la fonction de placement : elle doit contenir
 * la table des ancres et le plafond, et rien d'autre que des globales de l'hôte
 * ou des tables que l'extracteur a trouvées. Un nom oublié se voit donc comme
 * un externe non résolu plutôt que comme un silence.
 */
function freeNames(tokens, bodyOpen, bodyClose, params, text) {
  void text;
  const declared = new Set(params);
  collectDeclared(tokens, bodyOpen, bodyClose, declared);

  const free = new Set();
  for (let i = bodyOpen; i <= bodyClose; i += 1) {
    const token = tokens[i];
    if (token.type !== "name") continue;
    if (KEYWORDS.has(token.value)) continue;
    const before = tokens[i - 1];
    // Accès de membre : `a.b` ne lit pas `b`.
    if (before?.type === "punct" && (before.value === "." || before.value === "?.")) continue;
    // Clé d'objet : `{isTallPlant:!1}` ne lit pas `isTallPlant`.
    if (tokens[i + 1]?.type === "punct" && tokens[i + 1].value === ":" && before?.type === "punct" && (before.value === "{" || before.value === ",")) {
      continue;
    }
    if (declared.has(token.value)) continue;
    free.add(token.value);
  }
  return [...free].sort();
}

/** Les noms qu'un corps déclare : `let|const|var`, motifs déstructurés compris. */
function collectDeclared(tokens, lo, hi, declared) {
  for (let i = lo; i < hi; i += 1) {
    const token = tokens[i];
    if (token.type !== "name" || !["var", "let", "const"].includes(token.value)) continue;
    const base = 0;
    let depth = base;
    let expectName = true;
    let expectingValue = false;
    for (let j = i + 1; j < hi; j += 1) {
      const inner = tokens[j];
      if (inner.type === "punct") {
        if (inner.value === "{" || inner.value === "[" || inner.value === "(") {
          depth += 1;
          if (expectName && inner.value === "{") expectingValue = true;
          continue;
        }
        if (inner.value === "}" || inner.value === "]" || inner.value === ")") {
          depth -= 1;
          continue;
        }
        if (inner.value === ";" && depth === base) {
          i = j;
          break;
        }
        if (inner.value === "=" && depth === base) {
          expectName = false;
          expectingValue = false;
          continue;
        }
        if (inner.value === ":" && depth === base + 1) {
          // `{offset:u}` : le nom après le deux-points est déclaré.
          expectName = true;
          continue;
        }
        if (inner.value === "," && depth === base) {
          expectName = true;
          expectingValue = false;
          continue;
        }
        continue;
      }
      if (expectName && inner.type === "name" && !KEYWORDS.has(inner.value)) {
        declared.add(inner.value);
        expectName = false;
      } else if (expectName && inner.type === "string") {
        // Nom de propriété entre guillemets dans un motif : la valeur qui suit.
        expectName = false;
      }
      void expectingValue;
    }
  }
}

/** Les littéraux d'objet du chunk, repérés à leur position d'expression. */
function scanObjects(tokens, text, projection) {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== "punct" || token.value !== "{") continue;
    if (!objectPosition(tokens, i)) continue;
    const close = matchBlock(tokens, i);
    // Un bloc vide est ambigu (`{}` est aussi un objet vide) : on ne le retient
    // que pour ses formes, il n'en porte aucune.
    const object = makeObject(tokens, text, i, close + 1);
    registerObjects(object);
    i = close;
  }
}

function objectPosition(tokens, index) {
  const before = tokens[index - 1];
  if (before === undefined) return true;
  if (before.type === "punct") {
    return ["=", "(", ",", "[", ":", "?", "=>", "&&", "||", "??", "...", "+"].includes(before.value);
  }
  if (before.type === "name") return ["return", "typeof", "case", "in", "of", "new", "delete", "void"].includes(before.value);
  return false;
}

/** L'instruction `import`, réduite à ce qu'un externe a besoin de savoir. */
function readImport(tokens, start, projection) {
  let i = start + 1;
  // `import "x"`, `import a from "x"`, `import{a as b,c}from"x"`.
  let specifier = null;
  const local = [];
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === "string") {
      specifier = token.value;
      i += 1;
      break;
    }
    if (token.type === "punct" && token.value === "{") {
      let depth = 0;
      let local0 = true;
      for (; i < tokens.length; i += 1) {
        const inner = tokens[i];
        if (inner.type === "punct" && inner.value === "{") {
          depth += 1;
          continue;
        }
        if (inner.type === "punct" && inner.value === "}") {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            break;
          }
          continue;
        }
        if (depth !== 1) continue;
        if (inner.type === "punct" && inner.value === ",") {
          local0 = true;
          continue;
        }
        if (inner.type === "name" && inner.value === "as") {
          local0 = true;
          continue;
        }
        if (inner.type === "name") {
          if (local0) {
            local.push(inner.value);
            local0 = false;
          }
          continue;
        }
      }
      continue;
    }
    if (token.type === "name" && token.value === "from") {
      i += 1;
      continue;
    }
    if (token.type === "name") {
      local.push(token.value);
      i += 1;
      continue;
    }
    if (token.type === "punct" && token.value === "*") {
      i += 1;
      continue;
    }
    break;
  }
  if (specifier !== null) {
    for (const name of local) projection.imports.push({ local: name, from: specifier });
  }
  return i + 1;
}

// ---------------------------------------------------------------------------------------------
// Lecture des formes
// ---------------------------------------------------------------------------------------------

/** La forme d'un objet, ou `null`. */
export function asObject(value) {
  return value?.kind === "object" ? value : null;
}

/** La forme d'une chaîne, ou `null`. */
export function asString(value) {
  return value?.kind === "string" ? value : null;
}

/** Le membre d'un objet par son nom, ou `null`. */
export function memberValue(object, key) {
  return object?.members.find((member) => member.key === key)?.value ?? null;
}

/** La déclaration d'un nom dans un chunk, ou `null`. */
export function declarationNamed(chunk, name) {
  return chunk.declarations.find((declaration) => declaration.name === name) ?? null;
}

/** L'objet contient-il l'autre : c'est ce qui distingue la table de ses morceaux. */
export function contains(outer, inner) {
  return outer.start <= inner.start && outer.end >= inner.end;
}

/** Les feuilles (chaînes) d'un objet, avec le chemin de clés qui y mène. */
export function leafEntries(object, path = []) {
  const entries = [];
  for (const member of object.members) {
    const next = [...path, member.key];
    if (member.value.kind === "string") entries.push([next, member.value]);
    else if (member.value.kind === "object") entries.push(...leafEntries(member.value, next));
  }
  return entries;
}

/** Les feuilles chaînes d'un objet, sans leur chemin. */
export function leafStrings(object) {
  return leafEntries(object).map(([, leaf]) => leaf);
}
