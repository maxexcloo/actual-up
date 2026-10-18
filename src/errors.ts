/** The app's own configuration and setup errors; their messages never contain credentials. */
export class ConfigError extends Error {
  override name = "ConfigError";
}
