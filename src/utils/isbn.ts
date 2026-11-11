// ISBN helpers. Deliberately free of imports, so API modules can use them
// without pulling in Obsidian or the settings UI (unlike utils.ts).

// The shape of an ISBN-10 or ISBN-13, once spaces and hyphens are removed.
// No checksum check: use normalizeIsbn for that.
export const ISBN_REGEX = /^(97[89])?\d{9}[\dX]$/;

// Extracts a checksum-valid ISBN-10 or ISBN-13 from a value such as
// "978-87-85539-00-7" or "8799088932 (hf.)". Returns undefined otherwise,
// including for placeholder values like "0000000000".
export function normalizeIsbn(value: string): string | undefined {
  const candidate = value
    .match(/[\dXx][\dXx-]{8,16}[\dXx]/)?.[0]
    ?.replace(/-/g, '')
    .toUpperCase();
  if (!candidate || /^0+$/.test(candidate)) return undefined;
  if (/^\d{9}[\dX]$/.test(candidate) && isbn10CheckDigit(candidate.slice(0, 9)) === candidate[9]) return candidate;
  if (/^\d{13}$/.test(candidate) && isbn13CheckDigit(candidate.slice(0, 12)) === candidate[12]) return candidate;
  return undefined;
}

// An ISBN-10 converted to ISBN-13; an ISBN-13 as is.
export function toIsbn13(isbn: string): string {
  return isbn.length === 10 ? isbn10To13(isbn) : isbn;
}

export function isbn10To13(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`;
  return body + isbn13CheckDigit(body);
}

// Only 978 ISBNs have an ISBN-10 form.
export function isbn13To10(isbn13: string): string | undefined {
  if (!isbn13.startsWith('978')) return undefined;
  const body = isbn13.slice(3, 12);
  return body + isbn10CheckDigit(body);
}

function isbn10CheckDigit(body: string): string {
  const sum = [...body].reduce((acc, digit, i) => acc + Number(digit) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? 'X' : String(check);
}

function isbn13CheckDigit(body: string): string {
  const sum = [...body].reduce((acc, digit, i) => acc + Number(digit) * (i % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}
