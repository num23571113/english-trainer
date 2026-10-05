"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-6 text-zinc-900 dark:bg-zinc-950 dark:text-white">
      <div className="max-w-md rounded-2xl border border-zinc-300 p-6 dark:border-zinc-700">
        <div className="text-lg font-bold">⚠️ 화면을 그리는 중 오류가 발생했어요</div>
        <p className="mt-2 text-sm text-zinc-500">
          {error?.message || "알 수 없는 오류"}
        </p>
        <button
          onClick={() => reset()}
          className="mt-4 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
        >
          다시 시도
        </button>
      </div>
    </main>
  );
}
