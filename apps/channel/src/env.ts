export function required(name: string): string {
  const value = name === "INTELLIGENCE_API_KEY"
    ? process.env.CPK_INTELLIGENCE_API_KEY?.trim() || process.env[name]?.trim()
    : process.env[name];
  if (!value) {
    throw new Error(
      [
        `Missing required environment variable: ${name === "INTELLIGENCE_API_KEY" ? "CPK_INTELLIGENCE_API_KEY (or INTELLIGENCE_API_KEY)" : name}.`,
        "",
        "  Add the missing value to the root `.env` file,",
        "  run `npm run channel:setup` to configure Slack or Teams,",
        "  or `npm run dev:web` to try the browser template instead.",
      ].join("\n"),
    );
  }
  return value;
}
