/**
 * Read-only tool policy.
 *
 * A tool is exposed only if it declares `annotations.readOnlyHint: true`.
 * Anything else is treated as capable of writing and is blocked — including
 * tools with no annotations at all, whose behaviour we can't know.
 *
 * Guessing from names was considered and rejected: against the live server,
 * `content_library_get_course` reads as read-only by name but is annotated
 * `readOnlyHint: false`. An unannotated tool is a gap in the upstream server's
 * metadata, not a licence to infer.
 *
 * The cost is that read-only tools which forget the annotation are hidden. The
 * fix belongs upstream — annotate the tool — not here.
 */

/** Why a tool was allowed or blocked — surfaced in logs and blocked-call errors. */
export interface Verdict {
  readOnly: boolean;
  reason: string;
}

interface ToolLike {
  name?: unknown;
  annotations?: { readOnlyHint?: unknown; destructiveHint?: unknown } | undefined;
}

/** Judge a tool from its `tools/list` entry. Anything unproven is denied. */
export function classifyTool(tool: unknown): Verdict {
  const { name, annotations } = (tool ?? {}) as ToolLike;

  if (typeof name !== 'string' || name === '') {
    return { readOnly: false, reason: 'tool has no name' };
  }
  if (!annotations || typeof annotations !== 'object') {
    return { readOnly: false, reason: 'no annotations — assumed to write' };
  }
  if (annotations.readOnlyHint !== true) {
    return {
      readOnly: false,
      reason:
        annotations.readOnlyHint === false
          ? 'readOnlyHint is false'
          : 'no readOnlyHint — assumed to write',
    };
  }
  // Contradictory annotations resolve to the unsafe reading.
  if (annotations.destructiveHint === true) {
    return { readOnly: false, reason: 'readOnlyHint is true but destructiveHint is true' };
  }
  return { readOnly: true, reason: 'readOnlyHint' };
}
