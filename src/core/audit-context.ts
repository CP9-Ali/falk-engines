export interface AuditContext {
    readonly actor: string;
    readonly traceId?: string;
  }
  
  export const SYSTEM_ACTOR: AuditContext = { actor: 'system' };