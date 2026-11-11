import { loadSruFixture } from '../../test/sru_fixtures';
import { buildCqlQuery, parseSruResponse, SruBooksApi } from './sru_books_api';
import { ROYAL_DANISH_LIBRARY, SruPreset } from './sru_presets';

const mockRequestUrl = jest.fn();
jest.mock('obsidian', () => ({
  requestUrl: (...args: unknown[]) => mockRequestUrl(...args),
}));

const respondWith = (fixture: string) => mockRequestUrl.mockResolvedValue({ text: loadSruFixture(fixture) });
const requestedUrl = () => new URL(mockRequestUrl.mock.calls[0][0].url);

const preset: SruPreset = {
  id: 'test-library',
  name: 'Test Library',
  baseUrl: 'https://example.org/sru',
  keywordIndex: 'alma.all_for_ui',
  isbnIndex: 'alma.isbn',
  maximumRecords: 20,
  recordUrl: id => `https://example.org/record/${id}`,
};

beforeEach(() => mockRequestUrl.mockReset());

describe('buildCqlQuery', () => {
  it('searches the ISBN index for an ISBN, without hyphens or spaces', () => {
    expect(buildCqlQuery(preset, ' 978-87-85539-00-7 ')).toEqual({
      cql: 'alma.isbn=9788785539007',
      isbn: '9788785539007',
    });
    expect(buildCqlQuery(preset, '87 99088 93 2')).toEqual({ cql: 'alma.isbn=8799088932', isbn: '8799088932' });
  });

  it('searches the keyword index for anything else, quoted', () => {
    expect(buildCqlQuery(preset, 'dungeon crawler carl')).toEqual({ cql: 'alma.all_for_ui="dungeon crawler carl"' });
  });

  it('escapes quotes and backslashes in keyword searches', () => {
    expect(buildCqlQuery(preset, 'say "hi" \\ bye').cql).toBe('alma.all_for_ui="say \\"hi\\" \\\\ bye"');
  });
});

describe('parseSruResponse', () => {
  it('returns the total and the MARC records', () => {
    const { total, records } = parseSruResponse(loadSruFixture('keyword_dungeon_crawler_carl.xml'));
    expect(total).toBe(8);
    expect(records).toHaveLength(8);
    expect(records[0].localName).toBe('record');
    expect(records[0].namespaceURI).toBe('http://www.loc.gov/MARC21/slim');
  });

  it('returns no records for an empty result', () => {
    expect(parseSruResponse(loadSruFixture('no_results.xml'))).toEqual({ total: 0, records: [] });
  });

  it('throws the diagnostic message', () => {
    expect(() => parseSruResponse(loadSruFixture('diagnostic_unknown_index.xml'))).toThrow(
      'Catalog search has encountered an error',
    );
  });

  it('throws on a response that is not XML', () => {
    expect(() => parseSruResponse('<html><body>Bad gateway')).toThrow(/not a valid SRU response/);
  });

  it('reads records sent with recordPacking=string', () => {
    const inner = loadSruFixture('isbn_9788785539007.xml').match(
      /<record xmlns="http:\/\/www.loc.gov\/MARC21\/slim">[\s\S]*?<\/record>\s*<\/recordData>/,
    )[0];
    const marc = inner.replace(/<\/recordData>$/, '');
    const escaped = marc.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const xml = `<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><numberOfRecords>1</numberOfRecords><records><record><recordPacking>string</recordPacking><recordData>${escaped}</recordData></record></records></searchRetrieveResponse>`;
    const { records } = parseSruResponse(xml);
    expect(records).toHaveLength(1);
    expect(records[0].localName).toBe('record');
  });
});

describe('SruBooksApi.getByQuery', () => {
  const api = new SruBooksApi(preset);

  it('sends a searchRetrieve request for MARCXML to the preset endpoint', async () => {
    respondWith('no_results.xml');
    await api.getByQuery('dungeon crawler carl');

    const url = requestedUrl();
    expect(url.origin + url.pathname).toBe('https://example.org/sru');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      version: '1.2',
      operation: 'searchRetrieve',
      recordSchema: 'marcxml',
      maximumRecords: '20',
      query: 'alma.all_for_ui="dungeon crawler carl"',
    });
  });

  it('maps a record to a Book', async () => {
    respondWith('isbn_9788785539007.xml');
    const [book] = await api.getByQuery('9788785539007');

    expect(book).toEqual({
      title: 'Carls dommedagsscenarie',
      subtitle: '',
      author: 'Matt Dinniman',
      authors: ['Matt Dinniman'],
      category: expect.stringMatching(/^overlevelse, gaming, rollespil/),
      categories: expect.arrayContaining(['overlevelse', 'fiktive steder']),
      publisher: 'DreamLitt',
      publishDate: '2026',
      totalPage: 406,
      coverUrl: '',
      coverSmallUrl: '',
      description: expect.stringMatching(/^Carl og Donut/),
      link: 'https://example.org/record/99128819715505763',
      previewLink: '',
      isbn10: '8785539007',
      isbn13: '9788785539007',
    });
  });

  it('returns every record of a keyword search, in catalogue order', async () => {
    respondWith('keyword_dungeon_crawler_carl.xml');
    const books = await api.getByQuery('dungeon crawler carl');
    expect(books.map(b => b.title)).toEqual([
      "The butcher's masquerade",
      "Carl's doomsday scenario",
      'Carls dommedagsscenarie',
      "The dungeon anarchist's cookbook",
      'Dungeon Crawler Carl',
      'Dungeon Crawler Carl',
      'Dungeon crawler Carl',
      'The gate of the feral gods',
    ]);
  });

  it('drops records from an ISBN search that do not carry that ISBN', async () => {
    respondWith('isbn_spurious_matches.xml');
    await expect(api.getByQuery('9780000000002')).resolves.toEqual([]);
  });

  it('reports the searched ISBN when a record lists several', async () => {
    respondWith('keyword_dungeon_crawler_carl.xml');
    const books = await api.getByQuery('978-0-241-82981-3');
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("The butcher's masquerade");
    expect(books[0].isbn13).toBe('9780241829813');
    expect(books[0].isbn10).toBe('024182981X');
  });

  it('matches an ISBN-10 search against ISBN-13 records', async () => {
    respondWith('isbn_9788785539007.xml');
    const books = await api.getByQuery('8785539007');
    expect(books).toHaveLength(1);
    expect(books[0].isbn10).toBe('8785539007');
  });

  it('returns an empty list when nothing matches', async () => {
    respondWith('no_results.xml');
    await expect(api.getByQuery('xqzvbnmplkwj')).resolves.toEqual([]);
  });

  it('rejects with the library diagnostic', async () => {
    respondWith('diagnostic_unknown_index.xml');
    await expect(api.getByQuery('anything')).rejects.toThrow('Catalog search has encountered an error');
  });

  it('does not send a request for an empty query', async () => {
    await expect(api.getByQuery('   ')).resolves.toEqual([]);
    expect(mockRequestUrl).not.toHaveBeenCalled();
  });

  it('leaves link empty when the preset has no record URL', async () => {
    respondWith('isbn_9788785539007.xml');
    const [book] = await new SruBooksApi({ ...preset, recordUrl: undefined }).getByQuery('9788785539007');
    expect(book.link).toBe('');
  });
});

describe('ROYAL_DANISH_LIBRARY preset', () => {
  it('points at the Alma SRU endpoint with Alma index names', () => {
    expect(ROYAL_DANISH_LIBRARY).toMatchObject({
      baseUrl: 'https://kbdk-kgl.alma.exlibrisgroup.com/view/sru/45KBDK_KGL',
      keywordIndex: 'alma.all_for_ui',
      isbnIndex: 'alma.isbn',
    });
    expect(ROYAL_DANISH_LIBRARY.maximumRecords).toBeLessThanOrEqual(50);
  });
});
