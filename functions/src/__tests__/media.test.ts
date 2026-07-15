import { Buffer } from 'buffer';

describe('Media Utilities Test Suite', () => {
  it('should successfully encode and decode media files to/from base64', () => {
    const originalText = 'Smart Guard System Secure Media Proof';
    const base64Encoded = Buffer.from(originalText).toString('base64');
    const decodedText = Buffer.from(base64Encoded, 'base64').toString('utf-8');

    expect(decodedText).toBe(originalText);
  });

  it('should format file size correctly', () => {
    const formatBytes = (bytes: number) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
  });
});
