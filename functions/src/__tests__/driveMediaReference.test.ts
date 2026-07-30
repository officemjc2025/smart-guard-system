import { extractDriveFileId } from '../driveMediaReference';

const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123';

describe('Google Drive media reference normalization', () => {
  it.each([
    [`https://drive.google.com/file/d/${id}/view?usp=drivesdk`, id],
    [`https://drive.google.com/open?id=${id}`, id],
    [`https://drive.google.com/uc?export=view&id=${id}`, id],
    [id, id],
    [{ drive_file_id: id }, id],
  ])('extracts a validated file ID from %o', (value, expected) => {
    expect(extractDriveFileId(value)).toBe(expected);
  });

  it.each([
    'https://evil.example/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_123/view',
    'https://drive.google.com/file/d/short/view',
    'javascript:alert(1)',
    '',
    { url: `https://drive.google.com/file/d/${id}/view` },
  ])('rejects invalid or untrusted references: %o', value => {
    expect(() => extractDriveFileId(value)).toThrow();
  });
});
