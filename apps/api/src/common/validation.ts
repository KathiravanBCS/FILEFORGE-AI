import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success)
    throw new BadRequestException({
      message: 'Check the submitted values.',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  return result.data;
}
export function found<T>(value: T | null): T {
  if (value === null) throw new NotFoundException('Record not found in this workspace.');
  return value;
}
