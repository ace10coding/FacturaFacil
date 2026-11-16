"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, type UseFormSetError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { loginSchema, registerSchema } from "@/lib/schemas";
import { loginAction, registerAction, requestPasswordResetAction, resetPasswordAction, demoLoginAction } from "@/app/actions/auth";
import { Field, FormMessage, SubmitButton } from "@/components/form-controls";

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;

function applyFieldErrors(
  fieldErrors: Record<string, string> | undefined,
  setError: UseFormSetError<any>,
) {
  if (!fieldErrors) return;
  for (const [name, message] of Object.entries(fieldErrors)) setError(name, { message });
}

export function LoginForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(async (values) => {
        setMessage("");
        const result = await loginAction(values);
        if (!result.ok) {
          setMessage(result.message);
          applyFieldErrors(result.fieldErrors, setError);
          return;
        }
        router.replace(result.data?.to ?? "/painel");
        router.refresh();
      })}
    >
      <FormMessage tone="error">{message}</FormMessage>
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <input id="email" className="input" type="email" autoComplete="email" {...register("email")} />
      </Field>
      <Field label="Palavra-passe" htmlFor="password" error={errors.password?.message}>
        <input id="password" className="input" type="password" autoComplete="current-password" {...register("password")} />
      </Field>
      <div className="flex items-center justify-between text-[12.5px]">
        <Link href="/recuperar" className="font-medium text-[var(--navy)] underline-offset-2 hover:underline">
          Esqueci a palavra-passe
        </Link>
      </div>
      <SubmitButton className="btn btn-primary w-full" pendingLabel="A entrar…">
        Entrar
      </SubmitButton>
    </form>
  );
}

export function DemoLoginForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 text-[10.5px] uppercase tracking-[0.12em] muted">
        <span className="h-px flex-1 bg-[var(--line)]" />
        ou
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>
      <FormMessage tone="error">{message}</FormMessage>
      <button
        type="button"
        className="btn btn-accent mt-3 w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage("");
            const result = await demoLoginAction();
            if (!result.ok) {
              setMessage(result.message);
              return;
            }
            router.replace(result.data?.to ?? "/painel");
            router.refresh();
          })
        }
      >
        {pending ? "A entrar…" : "Explorar demonstração"}
      </button>
      <p className="mt-2 text-center text-[11.5px] leading-relaxed muted">
        Entra com uma empresa de exemplo, já com clientes e cotações. Pode alterar tudo sem afetar clientes reais.
      </p>
    </div>
  );
}

export function RegisterForm() {
  const [message, setMessage] = useState("");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(async (values) => {
        setMessage("");
        const result = await registerAction(values);
        if (result && !result.ok) {
          setMessage(result.message);
          applyFieldErrors(result.fieldErrors, setError);
        }
      })}
    >
      <FormMessage tone="error">{message}</FormMessage>
      <Field label="Nome completo" htmlFor="fullName" error={errors.fullName?.message}>
        <input id="fullName" className="input" autoComplete="name" {...register("fullName")} />
      </Field>
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <input id="email" className="input" type="email" autoComplete="email" {...register("email")} />
      </Field>
      <Field
        label="Palavra-passe"
        htmlFor="password"
        hint="Mínimo de 8 caracteres."
        error={errors.password?.message}
      >
        <input id="password" className="input" type="password" autoComplete="new-password" {...register("password")} />
      </Field>
      <SubmitButton className="btn btn-primary w-full" pendingLabel="A criar conta…">
        Criar conta
      </SubmitButton>
    </form>
  );
}

export function ResetRequestForm() {
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await requestPasswordResetAction({ email });
          if (result.ok) {
            setMessage({ tone: "ok", text: result.message ?? "" });
            setLink(result.data ?? null);
          } else {
            setMessage({ tone: "error", text: result.message });
            setLink(null);
          }
        });
      }}
    >
      <FormMessage tone={message?.tone ?? "ok"}>{message?.text}</FormMessage>
      {link ? (
        <Link href={link} className="block break-all text-[12.5px] font-medium text-[var(--navy)] underline">
          Abrir link de recuperação
        </Link>
      ) : null}
      <Field label="Email da conta" htmlFor="email">
        <input
          id="email"
          className="input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>
      <button className="btn btn-primary w-full" disabled={isPending}>
        {isPending ? "A enviar…" : "Enviar instruções"}
      </button>
    </form>
  );
}

export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (password !== confirm) {
          setMessage({ tone: "error", text: "As palavras-passe não coincidem." });
          return;
        }
        startTransition(async () => {
          const result = await resetPasswordAction({ token, password });
          setMessage({ tone: result.ok ? "ok" : "error", text: result.message ?? "" });
        });
      }}
    >
      <FormMessage tone={message?.tone ?? "ok"}>{message?.text}</FormMessage>
      {!token ? (
        <p className="toast toast-error">Link inválido. Peça um novo link de recuperação.</p>
      ) : null}
      <Field label="Nova palavra-passe" htmlFor="new-password" hint="Mínimo de 8 caracteres.">
        <input
          id="new-password"
          className="input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </Field>
      <Field label="Confirmar palavra-passe" htmlFor="confirm">
        <input
          id="confirm"
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
      </Field>
      <button className="btn btn-primary w-full" disabled={isPending || !token}>
        {isPending ? "A guardar…" : "Definir nova palavra-passe"}
      </button>
    </form>
  );
}
