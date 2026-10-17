import { ActivityKind } from './activity-kind.js';

export const TOOL_ACTIVITY_KINDS: Readonly<Record<string, ActivityKind>> = {
  Bash: ActivityKind.Command,
  commandExecution: ActivityKind.Command,
  exec_command: ActivityKind.Command,
  Read: ActivityKind.Read,
  read_file: ActivityKind.Read,
  fileRead: ActivityKind.Read,
  Write: ActivityKind.Write,
  Edit: ActivityKind.Write,
  MultiEdit: ActivityKind.Write,
  apply_patch: ActivityKind.Write,
  fileChange: ActivityKind.Write,
  Grep: ActivityKind.Search,
  Glob: ActivityKind.Search,
  codeSearch: ActivityKind.Search,
  WebFetch: ActivityKind.Web,
  WebSearch: ActivityKind.Web,
  webSearch: ActivityKind.Web,
};
