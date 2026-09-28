import { z } from 'zod';
export const basicPasswordSchema = z.string().min(8, 'Use at least 8 characters.').max(200, 'Use no more than 200 characters.');
export const strongPasswordSchema = basicPasswordSchema
  .regex(/[A-Z]/, 'Add an uppercase letter.').regex(/[a-z]/, 'Add a lowercase letter.')
  .regex(/[0-9]/, 'Add a number.').regex(/[^A-Za-z0-9\s]/, 'Add a symbol.');
// Role must come from the reset token/verified flow's database user, never request input.
export const resetPasswordPolicy = (role: string) => role === 'admin' ? 'basic' : 'standard';
export const resetPasswordSchema = (role: string) => role === 'admin' ? basicPasswordSchema : strongPasswordSchema;
