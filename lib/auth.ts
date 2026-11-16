import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, nowIso, uid } from "./db";
import { DEMO_EMAIL, demoLoginEnabled } from "./demo";
import { seedDemoData } from "./demo-seed";
import { newOpaqueToken, sha256 } from "./hash";

export { newOpaqueToken, sha256 };

export const SESSION_COOKIE = "ff_session";
const SESSION_DAYS = 30;
const DEMO_SESSION_TOKEN = "ff_demo_preview";

export type SessionUser = {
  id: string;
  email: string;
  full_name: string | null;
};

export type Business = {
  id: string;
  owner_user_id: string;
  name: string;
  nuit: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  website: string | null;
  logo_path: string | null;
  default_validity_days: number;
  default_notes: string | null;
  default_terms: string | null;
  default_tax_bp: number;
  currency: string;
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function createSession(userId: string): Promise<void> {
  const token = newOpaqueToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  db()
    .prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(uid(), userId, sha256(token), expires.toISOString(), nowIso());

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function createDemoSession(): Promise<void> {
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, DEMO_SESSION_TOKEN, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && token !== DEMO_SESSION_TOKEN) {
    db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  }
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  if (token === DEMO_SESSION_TOKEN) {
    if (!demoLoginEnabled()) return null;
    seedDemoData();
    const demoUser = db()
      .prepare(
        `SELECT u.id, u.email, p.full_name
         FROM users u LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.email = ?`,
      )
      .get(DEMO_EMAIL) as SessionUser | undefined;
    return demoUser ?? null;
  }

  const row = db()
    .prepare(
      `SELECT u.id, u.email, p.full_name, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as { id: string; email: string; full_name: string | null; expires_at: string } | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    return null;
  }
  return { id: row.id, email: row.email, full_name: row.full_name };
}

export async function getBusinessForUser(userId: string): Promise<Business | null> {
  const row = db().prepare("SELECT * FROM businesses WHERE owner_user_id = ?").get(userId) as
    | Business
    | undefined;
  return row ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");
  return user;
}

export async function requireBusiness(): Promise<{ user: SessionUser; business: Business }> {
  const user = await requireUser();
  const business = await getBusinessForUser(user.id);
  if (!business) redirect("/onboarding");
  return { user, business };
}
