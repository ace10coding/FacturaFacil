import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DemoLoginForm, LoginForm } from "@/components/auth-forms";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/painel");
  return (
    <div className="card card-pad sm:p-7">
      <h2 className="font-heading text-[23px] text-[var(--navy)]">Entrar na sua conta</h2>
      <p className="mt-1 mb-5 text-[13px] muted">Gerencie clientes e cotações do seu negócio.</p>
      <LoginForm />
      <DemoLoginForm />
      <p className="mt-5 text-center text-[12.5px] muted">
        Ainda não tem conta?{" "}
        <Link href="/registar" className="font-semibold text-[var(--navy)] underline-offset-2 hover:underline">
          Criar conta
        </Link>
      </p>
    </div>
  );
}
