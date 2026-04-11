import { expect } from 'chai';
import { extensionForMime, extensionForUploadedFile, isAllowedImageMime, normalizeUploadedFileMime } from './mime';

describe('mime', () => {
  it('allows jpeg png webp', () => {
    expect(isAllowedImageMime('image/jpeg')).to.equal(true);
    expect(isAllowedImageMime('image/png')).to.equal(true);
    expect(isAllowedImageMime('image/webp')).to.equal(true);
    expect(isAllowedImageMime('image/gif')).to.equal(false);
    expect(isAllowedImageMime(undefined)).to.equal(false);
  });

  it('maps extensions', () => {
    expect(extensionForMime('image/jpeg')).to.equal('jpg');
    expect(extensionForMime('image/png')).to.equal('png');
    expect(extensionForMime('image/webp')).to.equal('webp');
  });

  it('normalizes uploaded file mime', () => {
    expect(normalizeUploadedFileMime('application/pdf')).to.equal('application/pdf');
    expect(normalizeUploadedFileMime('')).to.equal('application/octet-stream');
    expect(normalizeUploadedFileMime(undefined)).to.equal('application/octet-stream');
  });

  it('extension for uploaded file from name or mime', () => {
    expect(extensionForUploadedFile('document.pdf', 'application/pdf')).to.equal('pdf');
    expect(extensionForUploadedFile('noext', 'text/plain')).to.equal('plain');
  });
});
