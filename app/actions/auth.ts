"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db, nowIso, uid } from "@/lib/db";
import {
  createDemoSession,
  createSession,
  destroySession,
  getBusinessForUser,
  hashPassword,
  newOpaqueToken,
  sha256,
  verifyPassword,
} from "@/lib/auth";
import { loginSchema, registerSchema } from "@/lib/schemas";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { DEMO_EMAIL, demoLoginEnabled } from "@/lib/demo";
import { seedDemoData } from "@/lib/demo-seed";
import { zodErrors, type ActionResult } from "@/lib/action";

export async function registerAction(input: unknown): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os dados introduzidos.", fieldErrors: zodErrors(parsed.error) };
  }

  const limit = rateLimit(await clientKey("register"), 5, 15 * 60 * 1000);
  if (!limit.ok) return { ok: false, message: "Demasiadas tentativas. Tente novamente mais tarde." };

  const { fullName, email, password } = parsed.data;
  const existing = db().prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return { ok: false, message: "Já existe uma conta com este email.", fieldErrors: { email: "Email já registado." } };
  }

  const userId = uid();
  const created = nowIso();
  db().exec("BEGIN IMMEDIATE");
  try {
    db().prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
      userId,
      email,
      hashPassword(password),
      created,
    );
    db().prepare("INSERT INTO profiles (id, user_id, full_name, created_at) VALUES (?, ?, ?, ?)").run(
      uid(),
      userId,
      fullName,
      created,
    );
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    console.error("register failed");
    throw error;
  }

  await createSession(userId);
  redirect("/onboarding");
}

export async function loginAction(input: unknown): Promise<ActionResult<{ to: string }>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os dados introduzidos.", fieldErrors: zodErrors(parsed.error) };
  }

  const limit = rateLimit(await clientKey("login"), 10, 15 * 60 * 1000);
  if (!limit.ok) return { ok: false, message: "Demasiadas tentativas. Tente novamente mais tarde." };

  const { email, password } = parsed.data;
  const row = db()
    .prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .get(email) as { id: string; password_hash: string } | undefined;

  if (!row || !verifyPassword(password, row.password_hash)) {
    return { ok: false, message: "Email ou palavra-passe incorretos." };
  }

  await createSession(row.id);
  const business = await getBusinessForUser(row.id);
  return { ok: true, data: { to: business ? "/painel" : "/onboarding" } };
}

export async function demoLoginAction(): Promise<ActionResult<{ to: string }>> {
  if (!demoLoginEnabled()) {
    return { ok: false, message: "A conta de demonstração não está disponível." };
  }

  const limit = rateLimit(await clientKey("demo-login"), 10, 15 * 60 * 1000);
  if (!limit.ok) return { ok: false, message: "Demasiadas tentativas. Tente novamente mais tarde." };

  try {
    seedDemoData();
  } catch {
    console.error("demo workspace setup failed");
    return { ok: false, message: "Não foi possível preparar a demonstração. Tente novamente." };
  }

  const row = db().prepare("SELECT id FROM users WHERE email = ?").get(DEMO_EMAIL) as
    | { id: string }
    | undefined;
  if (!row) {
    return { ok: false, message: "Não foi possível preparar a demonstração. Tente novamente." };
  }

  const business = await getBusinessForUser(row.id);
  if (!business) {
    return { ok: false, message: "Não foi possível preparar a empresa de demonstração. Tente novamente." };
  }

  await createDemoSession();
  return { ok: true, data: { to: "/painel" } };
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/entrar");
}

const emailOnly = z.object({ email: z.string().trim().toLowerCase().email("Email inválido") });

export async function requestPasswordResetAction(input: unknown): Promise<ActionResult<string>> {
  const parsed = emailOnly.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Introduza um email válido." };

  const limit = rateLimit(await clientKey("reset"), 5, 60 * 60 * 1000);
  if (!limit.ok) return { ok: false, message: "Demasiados pedidos. Aguarde um pouco." };

  const user = db().prepare("SELECT id FROM users WHERE email = ?").get(parsed.data.email) as
    | { id: string }
    | undefined;

  const generic = "Se existir uma conta com este email, enviámos as instruções de recuperação.";
  if (!user) return { ok: true, message: generic };

  const token = newOpaqueToken();
  db()
    .prepare(
      "INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(uid(), user.id, sha256(token), new Date(Date.now() + 60 * 60 * 1000).toISOString(), nowIso());

  const path = `/recuperar/palavra-passe?token=${token}`;
  if (process.env.NODE_ENV !== "production") {
    return { ok: true, message: `${generic} Ambiente local: use este link.`, data: path };
  }
  console.info(`Password reset link for ${parsed.data.email}: ${path}`);
  return { ok: true, message: generic };
}

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres"),
});

export async function resetPasswordAction(input: unknown): Promise<ActionResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os dados.", fieldErrors: zodErrors(parsed.error) };
  }

  const record = db()
    .prepare(
      `SELECT id, user_id, expires_at, used_at FROM password_resets
       WHERE token_hash = ? AND used_at IS NULL`,
    )
    .get(sha256(parsed.data.token)) as
    | { id: string; user_id: string; expires_at: string; used_at: string | null }
    | undefined;

  if (!record || new Date(record.expires_at).getTime() < Date.now()) {
    return { ok: false, message: "Este link de recuperação é inválido ou expirou." };
  }

  db().exec("BEGIN IMMEDIATE");
  try {
    db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(parsed.data.password),
      record.user_id,
    );
    db().prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(nowIso(), record.id);
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(record.user_id);
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }

  return { ok: true, message: "Palavra-passe atualizada. Já pode entrar." };
}
