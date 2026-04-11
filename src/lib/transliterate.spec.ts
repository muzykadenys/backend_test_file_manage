import { expect } from 'chai';
import {
  decodeMulterUtf8Filename,
  normalizeFolderName,
  normalizeItemName,
  normalizeUploadedFileDisplayName,
} from './transliterate';

describe('transliterate', () => {
  it('decodes multer latin1 filename to utf-8 cyrillic', () => {
    const garbled = Buffer.from('фото.png', 'utf8').toString('latin1');
    expect(decodeMulterUtf8Filename(garbled)).to.equal('фото.png');
  });

  it('normalizes cyrillic file name to latin', () => {
    expect(normalizeUploadedFileDisplayName('Документ.pdf')).to.match(/^Dokument\.pdf$/);
    expect(normalizeUploadedFileDisplayName('фото.png')).to.match(/^foto\.png$/);
  });

  it('normalizes folder names with spaces', () => {
    expect(normalizeFolderName('  Мої файли  ')).to.equal('Moyi fayly');
  });

  it('normalizeItemName picks file vs folder heuristic', () => {
    expect(normalizeItemName('test.pdf')).to.match(/^test\.pdf$/);
    expect(normalizeItemName('Робота')).to.equal('Robota');
  });
});
