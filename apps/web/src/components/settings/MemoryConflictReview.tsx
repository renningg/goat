import { useState } from "react";
import * as Option from "effect/Option";
import { MemoryOperationId, type EnvironmentId, type MemoryItem } from "@goat/contracts";
import { randomUUID } from "../../lib/utils";
import { memoryEnvironment } from "../../state/memory";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";

type Props = {
  item: Extract<MemoryItem, { status: "quarantined" }>;
  environmentId: EnvironmentId;
  canWrite: boolean;
  deviceName: (environmentId: EnvironmentId) => string;
  refresh: () => void;
  onNotice: (message: string) => void;
};

export function MemoryConflictReview({
  item,
  environmentId,
  canWrite,
  deviceName,
  refresh,
  onNotice,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const input = { memorySpaceId: item.memorySpaceId, memoryId: item.memoryId };
  const versions = useEnvironmentQuery(
    memoryEnvironment.history({
      environmentId,
      input: { ...input, limit: 1, includeConflictVersions: true },
    }),
  );
  const data = versions.data ? Option.getOrNull(versions.data)?.conflictVersions : undefined;
  const choices = data?.filter((v) => item.conflict.heads.includes(v.revision.revisionId));
  const selected = choices?.find((v) => v.revision.revisionId === selection);
  const save = useAtomCommand(memoryEnvironment.upsert, { reportFailure: false });

  async function confirm() {
    if (!canWrite || busy || !selected?.payload || choices?.length !== 2) return;
    setBusy(true);
    onNotice("");
    try {
      const reply = await save({
        environmentId,
        input: {
          ...input,
          operationId: MemoryOperationId.make(randomUUID()),
          expectedHeads: item.conflict.heads,
          reviewedRevisionId: selected.revision.revisionId,
          scope: item.scope,
          assertionKind: selected.revision.assertionKind,
          payload: selected.payload,
          baseBoundary: null,
          includeFailureDetails: true,
        },
      });
      if (reply._tag === "Success" && reply.value.outcome === "accepted") {
        onNotice(
          reply.value.pendingSync
            ? "Waiting for the hub to confirm your selection."
            : "Version kept.",
        );
      } else {
        onNotice("The selection could not be saved. Review the latest versions and try again.");
      }
      setSelection(null);
      refresh();
      versions.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (choices?.length !== 2 || choices.some((choice) => !choice.payload)) {
    return (
      <p role="status">
        {versions.isPending
          ? "Loading conflicting versions…"
          : "Conflicting versions are unavailable for review."}
      </p>
    );
  }
  return (
    <section aria-label="Review memory conflict" className="space-y-3">
      <p>Choose the version to keep. This memory is paused until the conflict is resolved.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {choices.map(({ revision, payload }) => (
          <label key={revision.revisionId} className="grid gap-2 rounded-md border p-3">
            <span>{deviceName(revision.provenance.environmentId)}</span>
            <span className="whitespace-pre-wrap break-words">{payload?.text}</span>
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name={item.conflict.conflictId}
                disabled={!canWrite || busy}
                checked={selection === revision.revisionId}
                onChange={() => setSelection(revision.revisionId)}
              />
              Keep this version
            </span>
          </label>
        ))}
      </div>
      <Button size="sm" disabled={!canWrite || !selected || busy} onClick={() => void confirm()}>
        Confirm selection
      </Button>
    </section>
  );
}
