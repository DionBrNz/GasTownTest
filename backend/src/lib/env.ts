function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/** Read per call (not at import) so tests can set the environment first. */
export const env = {
  tableName: (): string => required('TABLE_NAME'),
};
