import { marcRecordsById } from '../../test/sru_fixtures';
import { invertName, parseMarcRecord, parsePageCount, parseSeriesNumber, stripIsbdPunctuation } from './marcxml';

describe('stripIsbdPunctuation', () => {
  it.each([
    ["The butcher's masquerade /", "The butcher's masquerade"],
    ['Dungeon Crawler Carl :', 'Dungeon Crawler Carl'],
    ['Dungeon crawler Carl ;', 'Dungeon crawler Carl'],
    ['DreamLitt,', 'DreamLitt'],
    ['Bird seeds.', 'Bird seeds'],
    ['  padded  ', 'padded'],
    ['No punctuation', 'No punctuation'],
  ])('%p → %p', (input, expected) => {
    expect(stripIsbdPunctuation(input)).toBe(expected);
  });

  it('keeps the period after an initial', () => {
    expect(stripIsbdPunctuation('Tolkien, J. R. R.')).toBe('Tolkien, J. R. R.');
    expect(stripIsbdPunctuation('J.')).toBe('J.');
  });

  it('keeps an ellipsis', () => {
    expect(stripIsbdPunctuation('And then...')).toBe('And then...');
    expect(stripIsbdPunctuation('And then... /')).toBe('And then...');
  });
});

describe('invertName', () => {
  it.each([
    ['Dinniman, Matt', 'Matt Dinniman'],
    ['Dinniman, Matt,', 'Matt Dinniman'],
    ['Gerhard, Jeldrik.', 'Jeldrik Gerhard'],
    ['Tolkien, J. R. R.', 'J. R. R. Tolkien'],
    ['Tom Vedsted Vonsild', 'Tom Vedsted Vonsild'],
    ['Martin Luther King, Jr.', 'Martin Luther King, Jr.'],
    ['King, Martin Luther, Jr.', 'Martin Luther King, Jr.'],
    ['Smith, Viv', 'Viv Smith'],
  ])('%p → %p', (input, expected) => {
    expect(invertName(input)).toBe(expected);
  });
});

describe('parsePageCount', () => {
  it.each([
    ['406 sider :', 406],
    ['707 pages ;', 707],
    ['xii, 406 sider', 406],
    ['[120] sider', 120],
    ['250 s.', 250],
    ['312 Seiten', 312],
    ['xii, 406, [2] sider', 406],
    ['317, [3] pages ;', 317],
    ['xvi, 1,088 pages', 1088],
    ['1.088 sider', 1088],
    ['1 online resource (300 pages)', 300],
  ])('%p → %p', (input, expected) => {
    expect(parsePageCount(input)).toBe(expected);
  });

  it('returns undefined when there is no page count', () => {
    expect(parsePageCount('1 online resource')).toBeUndefined();
    expect(parsePageCount('')).toBeUndefined();
  });
});

describe('parseSeriesNumber', () => {
  it.each([
    ['bog 2', '2'],
    ['bk. 5', '5'],
    ['[1]', '1'],
    ['3', '3'],
    ['2. bind', '2'],
    ['vol. 1.5', '1.5'],
    ['Teil A', 'Teil A'],
    ['1-3', '1-3'],
    ['bind 1 - 3', '1-3'],
  ])('%p → %p', (input, expected) => {
    expect(parseSeriesNumber(input)).toBe(expected);
  });
});

describe('parseMarcRecord: Danish translation (ISBN 9788785539007)', () => {
  const record = marcRecordsById('isbn_9788785539007.xml').get('99128819715505763');
  const fields = parseMarcRecord(record);

  it('reads the control number', () => {
    expect(fields.id).toBe('99128819715505763');
  });

  it('reads the title without punctuation', () => {
    expect(fields.title).toBe('Carls dommedagsscenarie');
    expect(fields.subtitle).toBe('');
  });

  it('lists the author but not the translator or illustrator from 720', () => {
    expect(fields.authors).toEqual(['Matt Dinniman']);
  });

  it('reads publisher and year from 260', () => {
    expect(fields.publisher).toBe('DreamLitt');
    expect(fields.publishDate).toBe('2026');
  });

  it('reads the page count', () => {
    expect(fields.totalPage).toBe(406);
  });

  it('reads the ISBN as ISBN-13', () => {
    expect(fields.isbns).toEqual(['9788785539007']);
  });

  it('reads the description from 520', () => {
    expect(fields.description).toMatch(/^Carl og Donut skal kæmpe mod monstre/);
  });

  it('reads subject terms from 650 as categories', () => {
    expect(fields.categories).toEqual([
      'overlevelse',
      'gaming',
      'rollespil',
      'gameshows',
      'underholdning',
      'venskab',
      'slåskampe',
      'gladiatorkampe',
      'monstre',
      'fiktive steder',
    ]);
  });

  it('reads series and number from 830', () => {
    expect(fields.series).toBe('Dungeon crawler Carl');
    expect(fields.seriesNumber).toBe('2');
  });
});

describe('parseMarcRecord: keyword search records', () => {
  const records = marcRecordsById('keyword_dungeon_crawler_carl.xml');

  it('UK edition: 264 publication over copyright year, series from 490', () => {
    const fields = parseMarcRecord(records.get('99128277341105763'));
    expect(fields.title).toBe("The butcher's masquerade");
    expect(fields.authors).toEqual(['Matt Dinniman']);
    expect(fields.publisher).toBe('Michael Joseph');
    expect(fields.publishDate).toBe('2026');
    expect(fields.totalPage).toBe(707);
    expect(fields.isbns).toEqual(['9780241829820', '9780241829813']);
    expect(fields.series).toBe('Dungeon crawler Carl');
    expect(fields.seriesNumber).toBe('5');
  });

  it('categories: 650 subjects then 655 genres, deduplicated, without French 650 ind2=6', () => {
    const fields = parseMarcRecord(records.get('99128193330805763'));
    expect(fields.categories).toEqual([
      'End of the world',
      'Television game shows',
      'Prisons',
      'Labyrinths',
      'Monsters',
      'Novels',
      'Science fiction',
      'Apocalyptic fiction',
      'Humorous fiction',
      'LitRPG (Fiction)',
    ]);
    const withFrench = parseMarcRecord(records.get('99128193933305763'));
    expect(withFrench.categories).not.toContain('Labyrinthes');
    expect(withFrench.categories).toContain('Labyrinths');
  });

  it('leaves out French genre terms from 655 ($2 rvmgf)', () => {
    const fields = parseMarcRecord(records.get('99128584951005763'));
    expect(fields.categories).not.toContain('Romans');
    expect(fields.categories).toContain('Novels');
  });

  it('subtitle from 245 $b; first 260 $b only; bracketed series number', () => {
    const fields = parseMarcRecord(records.get('99128175701605763'));
    expect(fields.title).toBe('Dungeon Crawler Carl');
    expect(fields.subtitle).toBe('roman');
    expect(fields.publisher).toBe('DreamLitt');
    expect(fields.seriesNumber).toBe('1');
  });
});

// Small hand-written records for cases the recorded responses don't cover.
function marcRecord(fieldsXml: string): Element {
  const xml = `<record xmlns="http://www.loc.gov/MARC21/slim"><leader>00000nam a2200000 i 4500</leader>${fieldsXml}</record>`;
  return new DOMParser().parseFromString(xml, 'application/xml').documentElement;
}

const df = (tag: string, subfields: Record<string, string>, ind1 = ' ', ind2 = ' ') =>
  `<datafield tag="${tag}" ind1="${ind1}" ind2="${ind2}">${Object.entries(subfields)
    .map(([code, value]) => `<subfield code="${code}">${value}</subfield>`)
    .join('')}</datafield>`;

describe('parseMarcRecord: edge cases', () => {
  it('pairs the series number with the right series when there are several', () => {
    const record = marcRecord(
      df('490', { a: 'Penguin classics ;', v: '42' }, '1') +
        df('490', { a: 'Discworld ;', v: '3' }, '1') +
        df('830', { a: 'Discworld.' }, ' ', '0') +
        df('830', { a: 'Penguin classics ;', v: '42.' }, ' ', '0'),
    );
    const fields = parseMarcRecord(record);
    expect(fields.series).toBe('Discworld');
    expect(fields.seriesNumber).toBe('3');
  });

  it('ignores "[S.l. : s.n.]" where the brackets span $a and $b', () => {
    const record = marcRecord(df('260', { a: '[S.l. :', b: 's.n.],', c: '1985.' }));
    expect(parseMarcRecord(record).publisher).toBe('');
    expect(parseMarcRecord(record).publishDate).toBe('1985');
  });

  it('removes the unmatched bracket from a publisher when the brackets span $a and $b', () => {
    const record = marcRecord(df('260', { a: '[S.l. :', b: 'Forlag X],', c: '1985.' }));
    expect(parseMarcRecord(record).publisher).toBe('Forlag X');
  });

  it.each(['[udgiver ikke identificeret],', '[utgivare okänd]', '[förlag ej identifierad]'])(
    'ignores the Scandinavian publisher placeholder %p',
    placeholder => {
      const record = marcRecord(df('264', { b: placeholder, c: '2024' }, ' ', '1'));
      expect(parseMarcRecord(record).publisher).toBe('');
    },
  );

  it('keeps a real publisher whose name contains a placeholder word', () => {
    const record = marcRecord(df('260', { b: 'Unknown Press,', c: '2001' }));
    expect(parseMarcRecord(record).publisher).toBe('Unknown Press');
  });

  it('reads a corporate or meeting main entry (110/111) as the author', () => {
    const record = marcRecord(
      df('110', { a: 'Aarhus Universitet.', b: 'Institut for Statskundskab,', e: 'author.' }, '2'),
    );
    expect(parseMarcRecord(record).authors).toEqual(['Aarhus Universitet. Institut for Statskundskab']);
    const meeting = marcRecord(df('111', { a: 'Nordic Library Conference' }, '2'));
    expect(parseMarcRecord(meeting).authors).toEqual(['Nordic Library Conference']);
  });

  it('counts a corporate added entry (710/711) only when it is marked as author', () => {
    const record = marcRecord(
      df('100', { a: 'Hansen, Ole,', '4': 'aut' }, '1') +
        df('710', { a: 'Danmarks Statistik,', '4': 'aut' }, '2') +
        df('710', { a: 'Gyldendal (Firm)' }, '2'),
    );
    expect(parseMarcRecord(record).authors).toEqual(['Ole Hansen', 'Danmarks Statistik']);
  });

  it('falls back to 008 for the year when there is no 260/264', () => {
    const record = marcRecord(
      `<controlfield tag="008">230201s2019    dk ||||g      00||0 dan||</controlfield>${df('245', { a: 'Titel' })}`,
    );
    expect(parseMarcRecord(record).publishDate).toBe('2019');
  });

  it('uses the 264 copyright year only when there is no publication year', () => {
    const record = marcRecord(df('264', { b: 'Forlag,' }, ' ', '1') + df('264', { c: '©2020' }, ' ', '4'));
    expect(parseMarcRecord(record).publishDate).toBe('2020');
    expect(parseMarcRecord(record).publisher).toBe('Forlag');
  });

  it('includes co-authors from 700, but not editors, translators or name/title entries', () => {
    const record = marcRecord(
      df('100', { a: 'Pratchett, Terry,', e: 'author.' }, '1') +
        df('700', { a: 'Gaiman, Neil,', e: 'author.' }, '1') +
        df('700', { a: 'Hansen, Ole,', e: 'oversætter.' }, '1') +
        df('700', { a: 'Smith, Ann,', '4': 'edt' }, '1') +
        df('700', { a: 'Austen, Jane.', t: 'Pride and prejudice.' }, '1') +
        df('700', { a: 'Holm, Lise' }, '1'),
    );
    expect(parseMarcRecord(record).authors).toEqual(['Terry Pratchett', 'Neil Gaiman', 'Lise Holm']);
  });

  it('does not invert a forename-only heading (ind1=0)', () => {
    const record = marcRecord(df('100', { a: 'Elizabeth II, Queen of Great Britain' }, '0'));
    expect(parseMarcRecord(record).authors).toEqual(['Elizabeth II, Queen of Great Britain']);
  });

  it('converts an ISBN-10 to ISBN-13', () => {
    const record = marcRecord(df('020', { a: '8799088932 (hf.)' }));
    expect(parseMarcRecord(record).isbns).toEqual(['9788799088935']);
  });

  it('keeps repeated 245 $n and $p in the order they appear', () => {
    const record = marcRecord(
      `<datafield tag="245" ind1="1" ind2="0"><subfield code="a">Encyclopedia.</subfield><subfield code="n">Vol. 1,</subfield><subfield code="p">Animals.</subfield><subfield code="n">Vol. 2,</subfield><subfield code="p">Plants.</subfield></datafield>`,
    );
    expect(parseMarcRecord(record).title).toBe('Encyclopedia. Vol. 1. Animals. Vol. 2. Plants');
  });

  it('lists every ISBN in 020 as ISBN-13, in record order', () => {
    const record = marcRecord(df('020', { a: '9780241829820' }) + df('020', { a: '0140449132' }));
    expect(parseMarcRecord(record).isbns).toEqual(['9780241829820', '9780140449136']);
  });

  it('recognises relator URIs and "joint author"', () => {
    const record = marcRecord(
      df('100', { a: 'Pratchett, Terry,', '4': 'http://id.loc.gov/vocabulary/relators/aut' }, '1') +
        df('700', { a: 'Gaiman, Neil,', e: 'joint author.' }, '1') +
        df('700', { a: 'Kidby, Paul,', '4': 'http://id.loc.gov/vocabulary/relators/ill' }, '1'),
    );
    expect(parseMarcRecord(record).authors).toEqual(['Terry Pratchett', 'Neil Gaiman']);
  });

  it('takes the series number from 490 when 830 has none', () => {
    const record = marcRecord(
      df('490', { a: 'Big series ;', v: '3' }, '1') + df('830', { a: 'Big series.' }, ' ', '0'),
    );
    const fields = parseMarcRecord(record);
    expect(fields.series).toBe('Big series');
    expect(fields.seriesNumber).toBe('3');
  });

  it.each(['[publisher not identified],', '[s.n.],', '[Verlag nicht ermittelt]'])(
    'ignores the publisher placeholder %p',
    placeholder => {
      const record = marcRecord(df('264', { a: '[Place] :', b: placeholder, c: '2024' }, ' ', '1'));
      expect(parseMarcRecord(record).publisher).toBe('');
      expect(parseMarcRecord(record).publishDate).toBe('2024');
    },
  );

  it('keeps a publisher supplied in brackets by the cataloguer', () => {
    const record = marcRecord(df('260', { b: '[DreamLitt],', c: '2026' }));
    expect(parseMarcRecord(record).publisher).toBe('[DreamLitt]');
  });

  it('returns empty fields for an empty record', () => {
    const fields = parseMarcRecord(marcRecord(''));
    expect(fields).toMatchObject({
      id: '',
      title: '',
      subtitle: '',
      authors: [],
      publisher: '',
      publishDate: '',
      totalPage: undefined,
      description: '',
      categories: [],
      isbns: [],
      series: '',
      seriesNumber: '',
    });
  });
});

describe('parseMarcRecord: placeholder ISBNs', () => {
  const records = marcRecordsById('isbn_spurious_matches.xml');

  it('ignores 0000000000 in 020 $a and $z', () => {
    expect(parseMarcRecord(records.get('99124493133605763')).isbns).toEqual([]);
    const fields = parseMarcRecord(records.get('99122600923205763'));
    expect(fields.isbns).toEqual([]);
  });

  it('reads 260 $c with a trailing period', () => {
    expect(parseMarcRecord(records.get('99124493133605763')).publishDate).toBe('2022');
  });
});
