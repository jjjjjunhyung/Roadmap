import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BackupStatus, planApi } from "../lib/api";

/** "11.23 04:00" in local time. */
function when(unix: number) {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function size(bytes: number | null) {
  if (bytes === null) return "";
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** The daily backup (courses and photos): when it last worked, why it failed, back up now. */
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
  if (!b) return null;
  const failing = !!b.last_error;

  return (
    <section className="stage backup" aria-label="백업">
      <span className="label">Backup</span>
      <div className={`backup-card${failing || !b.configured ? " warn" : ""}`}>
        <div className="backup-main">
          <b>
            {!b.configured
              ? "백업이 꺼져 있어"
              : failing
                ? "마지막 백업이 실패했어"
                : b.last_ok
                  ? "매일 새벽 4시에 백업하고 있어"
                  : "첫 백업을 기다리는 중이야"}
          </b>
          <small>
            {b.last_ok
              ? `마지막 성공 ${when(b.last_ok)} · ${size(b.last_bytes)} · 14일치 보관`
              : b.configured
                ? "데이트와 사진을 하루에 한 번 비공개 저장소에 보관해."
                : "서버에 BACKUP_URL이 없어."}
          </small>
          {failing && b.last_error_at !== null && (
            <small className="backup-err">
              {when(b.last_error_at)} · {b.last_error}
            </small>
          )}
        </div>
        {b.configured && (
          <button className="btn small ghost" disabled={now.isPending} onClick={() => now.mutate()}>
            {now.isPending ? "백업하는 중…" : "지금 백업"}
          </button>
        )}
      </div>
    </section>
  );
}
