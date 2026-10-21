export const SKILLS_SCAN_LIMIT = {
  directories: 2000,
  headerBytes: 16384,
  totalBytes: 2 * 1024 * 1024,
  responseBytes: 128 * 1024,
} as const;

export const SKILL_METADATA_FIELDS = {
  name: 'name',
  description: 'description',
  userInvocable: 'user-invocable',
} as const;

export const SKILL_SETTINGS_FIELDS = {
  invocationOverrides: 'skillOverrides',
  enabledPlugins: 'enabledPlugins',
} as const;

export const SKILL_OVERRIDE_STATE = {
  Off: 'off',
} as const;

export const SKILL_ROOT_KIND = {
  Skills: 'skills',
  Commands: 'commands',
} as const;

export const SKILL_SETTING_SOURCE = {
  User: 'user',
  Project: 'project',
} as const;

export const SKILL_CLI_FLAGS = {
  addDirectory: '--add-dir',
  disableSlashCommands: '--disable-slash-commands',
  pluginDirectory: '--plugin-dir',
  settingSources: '--setting-sources',
} as const;

export const SKILL_FILE_NAMES = {
  skill: 'SKILL.md',
  legacyExtension: '.md',
  claudeDirectory: '.claude',
  skillsDirectory: 'skills',
  userSkills: '.claude/skills',
  userCommands: 'commands',
  projectCommands: '.claude/commands',
  userSettings: 'settings.json',
  localSettings: 'settings.local.json',
  pluginDescriptor: '.claude-plugin/plugin.json',
  installedPlugins: 'plugins/installed_plugins.json',
  plugins: 'plugins',
  pluginCache: 'plugins/cache',
} as const;
