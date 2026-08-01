import {
  normalizeGoogleDriveOAuthCredentials,
  requireGoogleDriveRootFolderId,
} from '../drive';

describe('Google Drive OAuth configuration', () => {
  it('trims every OAuth secret and the root folder ID at the initialization boundary', () => {
    expect(normalizeGoogleDriveOAuthCredentials({
      clientId: ' client-id\r\n',
      clientSecret: '\tclient-secret ',
      refreshToken: '\nrefresh-token\r',
    })).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
    });
    expect(requireGoogleDriveRootFolderId(' root-folder\r\n')).toBe('root-folder');
  });

  it.each([
    { clientId: ' \r\n', clientSecret: 'secret', refreshToken: 'token' },
    { clientId: 'id', clientSecret: '\t', refreshToken: 'token' },
    { clientId: 'id', clientSecret: 'secret', refreshToken: '\n' },
  ])('fails closed when an OAuth secret is blank after trimming', credentials => {
    expect(() => normalizeGoogleDriveOAuthCredentials(credentials))
      .toThrow('Google Drive OAuth secrets are not configured.');
  });

  it('fails closed when the root folder ID is blank without echoing its input', () => {
    const contaminated = ' \r\n';
    expect(() => requireGoogleDriveRootFolderId(contaminated))
      .toThrow('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured.');
    try {
      requireGoogleDriveRootFolderId(contaminated);
    } catch (error) {
      expect(String(error)).not.toContain('\\r');
      expect(String(error)).not.toContain('\\n');
    }
  });
});
