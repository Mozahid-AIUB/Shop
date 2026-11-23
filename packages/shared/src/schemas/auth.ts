import { z } from 'zod';
import { ROLES, type Role } from '../constants/roles';

/**
 * Auth validation — API (Nest pipe) আর web (ফর্ম) দুই জায়গায় এই schema-ই চলবে।
 * নিয়ম একবার লেখা হয়, দুই পাশে মেলে।
 */

/** বাংলাদেশি মোবাইল — 01[3-9] + ৮ ডিজিট। */
export const BD_PHONE_REGEX = /^01[3-9]\d{8}$/;

export const PASSWORD_MIN_LENGTH = 8;

/**
 * পাসওয়ার্ড: অন্তত ৮ অক্ষর, একটা অক্ষর আর একটা সংখ্যা।
 * argon2id দিয়ে hash হবে, তাই উপরের দিকে সীমা রাখা হয়নি —
 * শুধু DoS ঠেকাতে ১০০০ অক্ষরে থামানো।
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `পাসওয়ার্ড অন্তত ${PASSWORD_MIN_LENGTH} অক্ষরের হতে হবে`)
  .max(1000, 'পাসওয়ার্ড অনেক বড়')
  .regex(/[a-zA-Z]/, 'পাসওয়ার্ডে অন্তত একটা অক্ষর থাকতে হবে')
  .regex(/\d/, 'পাসওয়ার্ডে অন্তত একটা সংখ্যা থাকতে হবে');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('সঠিক ইমেইল দিন')
  .max(254, 'ইমেইল অনেক বড়');

export const phoneSchema = z
  .string()
  .trim()
  .regex(BD_PHONE_REGEX, 'সঠিক মোবাইল নম্বর দিন (যেমন 01712345678)');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(2, 'নাম অন্তত ২ অক্ষর').max(60, 'নাম অনেক বড়'),
  phone: phoneSchema.optional(),
});

/**
 * লগইনে পাসওয়ার্ড শুধু "আছে কিনা" দেখা হয় — শক্তি যাচাই নয়।
 * পুরোনো অ্যাকাউন্টের দুর্বল পাসওয়ার্ড যেন validation-এ আটকে না যায়।
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'পাসওয়ার্ড দিন').max(1000),
});

export const roleSchema = z.enum(ROLES);

/** ক্লায়েন্টে পাঠানো ইউজার — `password` এখানে নেই, রাখাও যাবে না। */
export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  role: roleSchema,
  isActive: z.boolean(),
});

/**
 * লগইন/রিফ্রেশের উত্তর।
 * refresh token ইচ্ছে করেই নেই — ওটা httpOnly cookie-তে যায়, body-তে নয়।
 */
export const authTokensSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});

export const authResponseSchema = authTokensSchema.extend({
  user: authUserSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthTokens = z.infer<typeof authTokensSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** JWT access token-এর ভেতরে যা থাকে। `sub` = user id (JWT standard)। */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}
