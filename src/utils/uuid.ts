export interface BrowserCryptoProvider {
  getRandomValues?: Crypto['getRandomValues'];
  randomUUID?: () => `${string}-${string}-${string}-${string}-${string}`;
}

export class UuidCompatibilityError extends Error {
  readonly code = 'CRYPTO_RANDOM_UNAVAILABLE';

  constructor() {
    super('This browser cannot generate cryptographically secure identifiers.');
    this.name = 'UuidCompatibilityError';
  }
}

const formatUuidV4 = (bytes: Uint8Array): string => {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
};

export function createUuid(
  provider: BrowserCryptoProvider | undefined = globalThis.crypto,
): string {
  if (typeof provider?.randomUUID === 'function') {
    return provider.randomUUID.call(provider);
  }
  if (typeof provider?.getRandomValues !== 'function') {
    throw new UuidCompatibilityError();
  }
  const bytes = new Uint8Array(16);
  provider.getRandomValues(bytes);
  return formatUuidV4(bytes);
}
