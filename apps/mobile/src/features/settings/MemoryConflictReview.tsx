import { useState } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, MemoryItem } from "@goat/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { Pressable, View } from "react-native";
import { memoryEnvironment } from "../../state/memory";
import { useAtomCommand } from "../../state/use-atom-command";
import { Copy, operationId } from "./memoryScreenParts";

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
  const input = { memorySpaceId: item.memorySpaceId, memoryId: item.memoryId };
  const atom = memoryEnvironment.history({
    environmentId,
    input: { ...input, limit: 1, includeConflictVersions: true },
  });
  const result = useAtomValue(atom);
  const refreshVersions = useAtomRefresh(atom);
  const [selection, setSelection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useAtomCommand(memoryEnvironment.upsert, { reportFailure: false });
  const data = AsyncResult.isSuccess(result)
    ? Option.getOrNull(result.value)?.conflictVersions
    : undefined;
  const choices = data?.filter((v) => item.conflict.heads.includes(v.revision.revisionId));
  const selected = choices?.find((v) => v.revision.revisionId === selection);

  async function confirm() {
    if (busy || !canWrite || !selected?.payload || choices?.length !== 2) return;
    setBusy(true);
    onNotice("");
    try {
      const reply = await save({
        environmentId,
        input: {
          ...input,
          operationId: operationId(),
          expectedHeads: item.conflict.heads,
          reviewedRevisionId: selected.revision.revisionId,
          scope: item.scope,
          assertionKind: selected.revision.assertionKind,
          payload: selected.payload,
          baseBoundary: null,
          includeFailureDetails: true,
        },
      });
      onNotice(
        reply._tag === "Success" && reply.value.outcome === "accepted"
          ? reply.value.pendingSync
            ? "Waiting for the hub to confirm your selection."
            : "Version kept."
          : "The selection could not be saved. Review the latest versions and try again.",
      );
      setSelection(null);
      refresh();
      refreshVersions();
    } finally {
      setBusy(false);
    }
  }

  if (choices?.length !== 2 || choices.some((choice) => !choice.payload))
    return (
      <Copy>
        {result.waiting
          ? "Loading conflicting versions…"
          : "Conflicting versions are unavailable for review."}
      </Copy>
    );
  return (
    <View className="gap-3">
      <Copy>Choose the version to keep. This memory is paused until the conflict is resolved.</Copy>
      {choices.map(({ revision, payload }) => (
        <Pressable
          key={revision.revisionId}
          accessibilityRole="radio"
          accessibilityState={{
            checked: selection === revision.revisionId,
            disabled: !canWrite || busy,
          }}
          disabled={!canWrite || busy}
          className="gap-2 rounded-md border border-border p-3"
          onPress={() => setSelection(revision.revisionId)}
        >
          <Copy>{deviceName(revision.provenance.environmentId)}</Copy>
          <Copy>{payload?.text}</Copy>
          <Copy>{selection === revision.revisionId ? "Selected" : "Keep this version"}</Copy>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={!canWrite || !selected || busy}
        onPress={() => void confirm()}
      >
        <Copy>Confirm selection</Copy>
      </Pressable>
    </View>
  );
}
