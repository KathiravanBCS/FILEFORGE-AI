import type { Request } from 'express';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export interface Principal {
  userId: string;
  email: string;
  sessionId: string;
}
export interface Workspace {
  id: string;
  role: WorkspaceRole;
}
export interface AuthenticatedRequest extends Request {
  principal: Principal;
  workspace: Workspace;
}

export function roleCanWrite(role: string): boolean {
  return ['owner', 'admin', 'member'].includes(role.toLowerCase());
}
export function roleCanManage(role: string): boolean {
  return ['owner', 'admin'].includes(role.toLowerCase());
}
export function requireTenantRecord<T>(record: T | null): T {
  if (!record) throw new Error('TENANT_RECORD_NOT_FOUND');
  return record;
}
