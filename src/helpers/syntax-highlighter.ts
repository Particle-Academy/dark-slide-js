/**
 * Minimal zero-dependency syntax highlighter. Mirrors PHP `Helpers\SyntaxHighlighter`.
 * Emits (text, kind) tokens; kinds: plain/keyword/string/comment/number/builtin/punctuation.
 */
export interface Token {
  text: string;
  kind: string;
}

interface LangConfig {
  patterns: Record<string, RegExp>;
  keywords: string[];
  builtins: string[];
}

// sticky + dotall so each pattern matches exactly at the scan offset, dot spans newlines
const S = (re: RegExp): RegExp => new RegExp(re.source, "sy");

const C_LIKE: Record<string, RegExp> = {
  comment: S(/\/\/[^\n]*|\/\*.*?\*\//),
  string: S(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/),
  number: S(/\b\d+(?:\.\d+)?\b/),
  word: S(/[A-Za-z_$][A-Za-z0-9_$]*/),
  punctuation: S(/[{}\[\]();,]/),
};

function config(lang: string | null): LangConfig | null {
  if (lang === null) return null;
  switch (lang) {
    case "javascript":
    case "typescript":
      return {
        patterns: C_LIKE,
        keywords: ["const","let","var","function","return","if","else","for","while","do","switch","case","break","continue","new","class","extends","implements","interface","type","enum","import","export","from","as","default","async","await","try","catch","finally","throw","typeof","instanceof","in","of","this","super","null","undefined","true","false","void","never","any","unknown","string","number","boolean","object"],
        builtins: ["console","Math","JSON","Object","Array","String","Number","Boolean","Promise","Map","Set","Date","Error","document","window","globalThis","require","module","process"],
      };
    case "php":
      return {
        patterns: {
          comment: S(/\/\/[^\n]*|#[^\n]*|\/\*.*?\*\//),
          string: S(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/),
          number: S(/\b\d+(?:\.\d+)?\b/),
          word: S(/\$?[A-Za-z_][A-Za-z0-9_]*/),
          punctuation: S(/[{}\[\]();,]/),
        },
        keywords: ["abstract","and","array","as","break","callable","case","catch","class","clone","const","continue","declare","default","do","echo","else","elseif","empty","enddeclare","endfor","endforeach","endif","endswitch","endwhile","enum","extends","final","finally","fn","for","foreach","function","global","goto","if","implements","include","include_once","instanceof","insteadof","interface","isset","list","match","namespace","new","null","or","private","protected","public","readonly","require","require_once","return","static","switch","throw","trait","try","unset","use","var","while","xor","yield","true","false","self","parent","this"],
        builtins: ["__construct","__toString","__invoke","array_map","array_filter","array_reduce","array_keys","array_values","array_merge","count","strlen","str_replace","str_starts_with","str_ends_with","str_contains","substr","sprintf","printf","json_encode","json_decode"],
      };
    case "json":
      return {
        patterns: {
          string: S(/"(?:[^"\\]|\\.)*"/),
          number: S(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/),
          word: S(/[A-Za-z_][A-Za-z0-9_]*/),
          punctuation: S(/[{}\[\]:,]/),
        },
        keywords: ["true", "false", "null"],
        builtins: [],
      };
    case "bash":
      return {
        patterns: {
          comment: S(/#[^\n]*/),
          string: S(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/),
          number: S(/\b\d+\b/),
          word: S(/[A-Za-z_][A-Za-z0-9_]*/),
          punctuation: S(/[{}\[\]();|&]/),
        },
        keywords: ["if","then","else","elif","fi","for","while","do","done","case","esac","in","function","return","break","continue","export","local","readonly","unset"],
        builtins: ["echo","printf","cd","pwd","ls","cp","mv","rm","mkdir","touch","cat","grep","sed","awk","curl","wget","git","npm","composer","php","node"],
      };
    case "css":
      return {
        patterns: {
          comment: S(/\/\*.*?\*\//),
          string: S(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/),
          number: S(/-?\d+(?:\.\d+)?(?:px|em|rem|%|vw|vh|deg)?/),
          word: S(/[\-A-Za-z_][\-A-Za-z0-9_]*/),
          punctuation: S(/[{};:,]/),
        },
        keywords: ["important", "inherit", "initial", "unset", "auto", "none"],
        builtins: [],
      };
    case "python":
      return {
        patterns: {
          comment: S(/#[^\n]*/),
          string: S(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/),
          number: S(/\b\d+(?:\.\d+)?\b/),
          word: S(/[A-Za-z_][A-Za-z0-9_]*/),
          punctuation: S(/[{}\[\]():,]/),
        },
        keywords: ["and","as","assert","async","await","break","class","continue","def","del","elif","else","except","finally","for","from","global","if","import","in","is","lambda","nonlocal","not","or","pass","raise","return","try","while","with","yield","True","False","None"],
        builtins: ["print","len","range","list","dict","set","tuple","str","int","float","bool","open","input","enumerate","zip","map","filter","sorted","reversed","sum","min","max","abs","round"],
      };
    case "html":
      return {
        patterns: {
          comment: S(/<!--.*?-->/),
          string: S(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/),
          keyword: S(/<\/?[A-Za-z][A-Za-z0-9-]*/),
          punctuation: S(/>|\/>|=/),
        },
        keywords: [],
        builtins: [],
      };
    default:
      return null;
  }
}

function normalizeLanguage(language: string | null | undefined): string | null {
  if (language === null || language === undefined) return null;
  const lang = language.toLowerCase().trim();
  switch (lang) {
    case "js":
      return "javascript";
    case "ts":
      return "typescript";
    case "jsx":
    case "tsx":
      return "typescript";
    case "sh":
    case "shell":
    case "bash":
    case "zsh":
      return "bash";
    case "py":
      return "python";
    case "xml":
      return "html";
    default:
      return lang;
  }
}

export const SyntaxHighlighter = {
  tokenize(code: string, language: string | null | undefined): Token[] {
    const lang = normalizeLanguage(language);
    const cfg = config(lang);
    if (cfg === null) return [{ text: code, kind: "plain" }];

    const tokens: Token[] = [];
    let offset = 0;
    const len = code.length;
    const keywords = new Set(cfg.keywords);
    const builtins = new Set(cfg.builtins);

    while (offset < len) {
      let bestKind: string | null = null;
      let bestLen = 0;

      for (const [kind, re] of Object.entries(cfg.patterns)) {
        re.lastIndex = offset;
        const m = re.exec(code);
        if (m && m.index === offset) {
          const matchLen = m[0].length;
          if (matchLen > bestLen) {
            bestLen = matchLen;
            bestKind = kind;
          }
        }
      }

      if (bestKind === null || bestLen === 0) {
        tokens.push({ text: code[offset]!, kind: "plain" });
        offset++;
        continue;
      }

      const text = code.slice(offset, offset + bestLen);
      let kind = bestKind;
      if (kind === "word") {
        if (keywords.has(text)) kind = "keyword";
        else if (builtins.has(text)) kind = "builtin";
        else kind = "plain";
      }
      tokens.push({ text, kind });
      offset += bestLen;
    }

    return coalesce(tokens);
  },

  colorFor(kind: string): string {
    switch (kind) {
      case "keyword":
        return "C084FC";
      case "string":
        return "86EFAC";
      case "comment":
        return "64748B";
      case "number":
        return "FBBF24";
      case "builtin":
        return "67E8F9";
      case "punctuation":
        return "CBD5E1";
      default:
        return "F8FAFC";
    }
  },

  supportedLanguages(): string[] {
    return ["javascript", "typescript", "jsx", "tsx", "php", "json", "bash", "shell", "css", "python", "html", "xml"];
  },
};

function coalesce(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (last && last.kind === t.kind) {
      last.text += t.text;
      continue;
    }
    out.push({ ...t });
  }
  return out;
}
