import { z } from 'zod';

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Missing reset token'),
    password: z.string().min(10, 'Use at least 10 characters').max(200),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Those passwords do not match',
    path: ['confirm'],
  });

export const commentSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(5000),
  parentId: z.string().uuid().nullable().optional(),
});

export const shareSchema = z.object({
  inviteeEmail: z.string().trim().email('Enter a valid email address'),
  inviteeName: z.string().trim().min(1, 'Name is required').max(100),
  canComment: z.boolean().default(true),
});

export const chatSchema = z.object({
  documentId: z.string().uuid(),
  question: z.string().trim().min(1).max(2000),
  shareToken: z.string().optional(),
});
