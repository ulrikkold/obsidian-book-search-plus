import { ISBN_REGEX, isbn10To13, isbn13To10, normalizeIsbn, toIsbn13 } from './isbn';

describe('ISBN_REGEX', () => {
  it('matches ISBN-10 and ISBN-13 shapes', () => {
    expect(ISBN_REGEX.test('8799088932')).toBe(true);
    expect(ISBN_REGEX.test('080442957X')).toBe(true);
    expect(ISBN_REGEX.test('9788785539007')).toBe(true);
    expect(ISBN_REGEX.test('9688785539007')).toBe(false);
    expect(ISBN_REGEX.test('dungeon crawler')).toBe(false);
  });
});

describe('normalizeIsbn', () => {
  it('normalizes a valid ISBN and drops qualifiers and hyphens', () => {
    expect(normalizeIsbn('978-87-85539-00-7')).toBe('9788785539007');
    expect(normalizeIsbn('8799088932 (hf.)')).toBe('8799088932');
    expect(normalizeIsbn('080442957x')).toBe('080442957X');
  });

  it('rejects invalid and placeholder ISBNs', () => {
    expect(normalizeIsbn('0000000000')).toBeUndefined();
    expect(normalizeIsbn('9788785539008')).toBeUndefined();
    expect(normalizeIsbn('not an isbn')).toBeUndefined();
  });
});

describe('ISBN-10/13 conversion', () => {
  it('converts between ISBN-10 and ISBN-13', () => {
    expect(isbn10To13('8799088932')).toBe('9788799088935');
    expect(isbn13To10('9788799088935')).toBe('8799088932');
    expect(isbn13To10('9798765432100')).toBeUndefined();
  });

  it('toIsbn13 converts ISBN-10 and leaves ISBN-13 alone', () => {
    expect(toIsbn13('8799088932')).toBe('9788799088935');
    expect(toIsbn13('9788785539007')).toBe('9788785539007');
  });
});
