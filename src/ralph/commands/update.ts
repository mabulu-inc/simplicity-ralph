export interface UpdateResult {
  deprecated: boolean;
  message: string;
}

export async function runUpdate(_rootDir: string): Promise<UpdateResult> {
  return {
    deprecated: true,
    message:
      'The update command is no longer needed. Ralph now uses built-in templates at runtime, so prompt updates are automatic when you upgrade ralph.',
  };
}

export async function run(_args: string[]): Promise<void> {
  const result = await runUpdate(process.cwd());
  console.log(result.message);
}
