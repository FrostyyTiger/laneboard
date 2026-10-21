// HuJSON (JWCC): JSON plus `//` and `/* */` comments and trailing commas,
// the format of a Tailscale policy file. Nothing else is relaxed: no
// unquoted keys, no single quotes. No dependency: the comments and the
// trailing commas become spaces (so JSON.parse's positions still point at
// the right character) and JSON.parse does the rest.

/** Comments outside strings -> spaces. Newlines are kept, for line numbers. */
export function stripComments(text) {
  const s = String(text);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      // A string, copied as is: an escaped quote does not end it.
      let j = i + 1;
      while (j < s.length && s[j] !== '"' && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && s[i + 1] === '/') {
      let j = i;
      while (j < s.length && s[j] !== '\n') j++;
      out += ' '.repeat(j - i);
      i = j;
    } else if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end < 0) throw new SyntaxError(`unclosed /* comment at position ${i}`);
      out += s.slice(i, end + 2).replace(/[^\n]/g, ' ');
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** A comma followed (after whitespace) by `}` or `]` -> a space. */
export function stripTrailingCommas(text) {
  const s = String(text);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"' && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '}' || s[j] === ']') { out += ' '; continue; }
    }
    out += c;
  }
  return out;
}

/** Parse HuJSON text. Throws a SyntaxError like JSON.parse. */
export function parseHujson(text) {
  return JSON.parse(stripTrailingCommas(stripComments(text)));
}
