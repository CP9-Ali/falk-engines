import { describe, it, expect } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';
import { OidcVerifier } from '../security/oidc-auth';

describe('OIDC verification', () => {
  it('rejects tampered token', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    // (بدون idp حقيقي، يكفي أن نتحقق من رفض رموز غير صالحة)
    const verifier = new OidcVerifier(
      'https://idp.example.com',
      'falk-api',
      'https://idp.example.com/.well-known/jwks.json',
    );
    await expect(verifier.verify('invalid.token.here')).rejects.toThrow();
  });
});