import { randomUUID } from 'crypto';
import type { Id } from './types';

export const newId = (prefix: string): Id => `${prefix}_${randomUUID()}`;