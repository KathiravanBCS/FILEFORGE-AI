import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { getDatabase } from '@fileforge/database';
import type { AuthenticatedRequest, WorkspaceRole } from '../common/context.js';
import { roleCanManage, roleCanWrite } from '../common/context.js';
import { resolveRequestPrincipal } from '../common/session.js';

@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.headers.cookie) throw new UnauthorizedException('Sign in to continue.');
    const principal = await resolveRequestPrincipal(request);
    if (!principal) throw new UnauthorizedException('Your session is missing or has expired.');
    request.principal = principal;
    return true;
  }
}

@Injectable()
export class WorkspaceGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const id = request.headers['x-workspace-id'];
    if (typeof id !== 'string' || !id || id.length > 128)
      throw new BadRequestException('Select a workspace.');
    const member = await getDatabase().member.findFirst({
      where: { organizationId: id, userId: request.principal.userId },
    });
    if (!member) throw new ForbiddenException('You do not have access to this workspace.');
    if (!['owner', 'admin', 'member', 'viewer'].includes(member.role))
      throw new ForbiddenException('This role is not authorized.');
    request.workspace = { id, role: member.role as WorkspaceRole };
    return true;
  }
}

export function assertWrite(request: AuthenticatedRequest): void {
  if (!roleCanWrite(request.workspace.role))
    throw new ForbiddenException('This workspace is read only for your role.');
}
export function assertManage(request: AuthenticatedRequest): void {
  if (!roleCanManage(request.workspace.role))
    throw new ForbiddenException('Only workspace owners and admins can manage members.');
}
