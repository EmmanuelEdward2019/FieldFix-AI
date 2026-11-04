import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(8).max(128);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
});
export type Register = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type Login = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type UpdateProfile = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: passwordSchema,
});
export type ChangePassword = z.infer<typeof changePasswordSchema>;

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  created_at: z.string().datetime(),
});
export type UserResponse = z.infer<typeof userResponseSchema>;

export const authResponseSchema = z.object({
  user: userResponseSchema,
  token: z.string().min(1),
  expires_at: z.string().datetime(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/* Email verification + password reset (Resend-backed links). */

export const registerResponseSchema = z.object({
  user: userResponseSchema,
  confirmation_required: z.boolean(),
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(8).max(256),
});
export type VerifyEmail = z.infer<typeof verifyEmailSchema>;

export const resendConfirmationSchema = z.object({
  email: emailSchema,
});
export type ResendConfirmation = z.infer<typeof resendConfirmationSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPassword = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(8).max(256),
  new_password: passwordSchema,
});
export type ResetPassword = z.infer<typeof resetPasswordSchema>;

/* TOTP multi-factor authentication (required for Super Admin accounts). */

export const mfaRequiredSchema = z.object({
  mfa_required: z.literal(true),
  mfa_token: z.string().min(8).max(256),
});
export type MfaRequired = z.infer<typeof mfaRequiredSchema>;

/** Login succeeds outright, or returns a short-lived MFA challenge token. */
export const loginResponseSchema = z.union([authResponseSchema, mfaRequiredSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const mfaStatusResponseSchema = z.object({
  enabled: z.boolean(),
  verified_at: z.string().datetime().nullable(),
});
export type MfaStatusResponse = z.infer<typeof mfaStatusResponseSchema>;

export const mfaEnrollResponseSchema = z.object({
  otpauth_url: z.string().min(1),
  secret: z.string().min(1),
});
export type MfaEnrollResponse = z.infer<typeof mfaEnrollResponseSchema>;

export const mfaCodeSchema = z.object({
  code: z.string().trim().min(6).max(16),
});
export type MfaCode = z.infer<typeof mfaCodeSchema>;

export const mfaVerifyResponseSchema = z.object({
  verified: z.literal(true),
  backup_codes: z.array(z.string()).optional(),
});
export type MfaVerifyResponse = z.infer<typeof mfaVerifyResponseSchema>;

export const mfaChallengeSchema = z.object({
  mfa_token: z.string().min(8).max(256),
  code: z.string().trim().min(6).max(16),
});
export type MfaChallenge = z.infer<typeof mfaChallengeSchema>;
