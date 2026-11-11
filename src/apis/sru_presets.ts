// A library catalogue reachable over SRU (Search/Retrieve via URL). SRU fixes
// the protocol but not the index or schema names, so each library needs its
// own preset. Presets are plain data.
export interface SruPreset {
  id: string;
  name: string;
  baseUrl: string;
  keywordIndex: string; // CQL index for free-text search
  isbnIndex: string; // CQL index for ISBN search
  recordSchema?: string; // the server's name for MARC 21 XML; defaults to 'marcxml'
  maximumRecords?: number; // the server's cap on records per request, if it has one
  recordUrl?: string; // link to the record in the library's own catalogue; {id} is the 001 control number
}

// Det Kgl. Bibliotek. The catalogue runs on Ex Libris Alma, whose SRU
// interface caps maximumRecords at 50 (from its explain response).
export const ROYAL_DANISH_LIBRARY: SruPreset = {
  id: 'royal-danish-library',
  name: 'Royal Danish Library',
  baseUrl: 'https://kbdk-kgl.alma.exlibrisgroup.com/view/sru/45KBDK_KGL',
  keywordIndex: 'alma.all_for_ui',
  isbnIndex: 'alma.isbn',
  maximumRecords: 50,
  recordUrl: 'https://soeg.kb.dk/discovery/fulldisplay?docid=alma{id}&context=L&vid=45KBDK_KGL:KGL',
};
