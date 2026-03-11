import type { InitConfig } from './claude-md.js';

export interface RalphConfigJson {
  language: string;
  packageManager: string;
  testingFramework: string;
  qualityCheck: string;
  testCommand: string;
  agent: string;
  model?: string;
  fileNaming?: string;
  database?: string;
}

export function generateRalphConfigJson(config: InitConfig, agent: string, model?: string): string {
  const obj: RalphConfigJson = {
    language: config.language,
    packageManager: config.packageManager,
    testingFramework: config.testingFramework,
    qualityCheck: config.qualityCheck,
    testCommand: config.testCommand,
    agent,
  };

  if (model) {
    obj.model = model;
  }

  if (config.fileNaming) {
    obj.fileNaming = config.fileNaming;
  }

  if (config.database) {
    obj.database = config.database;
  }

  return JSON.stringify(obj, null, 2) + '\n';
}
