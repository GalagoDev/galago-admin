import { loginAction } from "@/app/actions/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const hasError = params.error === "1";

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-neutral-50">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/30">
        <p className="text-sm uppercase tracking-[0.25em] text-neutral-400">
          Machine access
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
          Store admin login
        </h1>
        <p className="mt-4 text-sm leading-7 text-neutral-300">
          Shared password protection for the first version. User accounts can come later.
        </p>

        <form action={loginAction} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm text-neutral-300">
            Password
            <input
              type="password"
              name="password"
              className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none ring-0 placeholder:text-neutral-500 focus:border-white/20"
              placeholder="Enter shared password"
              required
            />
          </label>

          {hasError ? (
            <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              Wrong password.
            </div>
          ) : null}

          <button
            type="submit"
            className="mt-2 rounded-full bg-white px-4 py-3 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200"
          >
            Enter
          </button>
        </form>
      </div>
    </main>
  );
}
