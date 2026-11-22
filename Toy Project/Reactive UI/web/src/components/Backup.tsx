import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BackupStatus, planApi } from "../lib/api";

/** "11.23 04:00" in local time. */
function when(unix: number) {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The daily backup (courses and photos) stays out of sight while it works; the card only appears
 * when the last try failed or backups are off, with the reason and a way to try again.
 */
export function BackupCard({
  api,
  plannerKey,
}: {
  api: ReturnType<typeof planApi>;
  plannerKey: string;
}) {
  const qc = useQueryClient();
  const queryKey = ["plan", plannerKey, "backup"];
  const q = useQuery({ queryKey, queryFn: api.backup, retry: false });
  const now = useMutation({
    mutationFn: api.backupNow,
    onSuccess: (b) => qc.setQueryData<BackupStatus>(queryKey, b),
  });
  const b = q.data;
  if (!b || (b.configured && !b.last_error)) return null;

  return (
    <section className="stage backup" aria-label="백업">
      <span className="label">Backup</span>
      <div className="backup-card warn">
        <div className="backup-main">
          <b>{b.configured ? "마지막 백업이 실패했어" : "백업이 꺼져 있어"}</b>
          {b.last_error && b.last_error_at !== null ? (
            <small className="backup-err">
              {when(b.last_error_at)} · {b.last_error}
            </small>
          ) : (
            <small>서버에 BACKUP_URL이 없어.</small>
          )}
        </div>
        {b.configured && (
          <button className="btn small ghost" disabled={now.isPending} onClick={() => now.mutate()}>
            {now.isPending ? "백업하는 중…" : "다시 백업"}
          </button>
        )}
      </div>
    </section>
  );
}
