import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { Principal, Role } from './permissions';

const KNOWN_ROLES: ReadonlyArray<Role> = ['VIEWER', 'ANALYST', 'ENGINEER', 'APPROVER', 'AUDITOR'];

export class OidcVerifier {
  private jwks;
  constructor(
    private issuer: string,
    private audience: string,
    jwksUrl: string,
  ) {
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  async verify(token: string): Promise<Principal> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: this.audience,
    });
    const rawRoles = (payload.realm_access as any)?.roles ?? [];
    const roles = rawRoles.filter((r: string) =>
      KNOWN_ROLES.includes(r as Role)) as Role[];
    if (roles.length === 0) {
      throw new Error('Token has no FALK roles');
    }
    return { principalId: payload.sub as string, roles };
  }
}