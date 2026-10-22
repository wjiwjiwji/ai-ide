export function truncateAgentOutput(
  value: string,
  limit = 80_000
): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}\n...[truncated]`
}
