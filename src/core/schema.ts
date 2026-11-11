import { createRequire } from 'node:module';
import type { Model } from './types';

const require = createRequire(import.meta.url);

interface SchemaIssue {
  path: (string | number)[];
  message: string;
  params?: Record<string, unknown>;
}

interface SafeParseResult {
  success: boolean;
  data?: unknown;
  error?: { issues: SchemaIssue[] };
}

/** The editor's own model schema, from its React-free entry point. */
const { modelSchema } = require('isoflow/dist/standaloneExports') as {
  modelSchema: { safeParse(input: unknown): SafeParseResult };
};

export class ModelValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid diagram model: ${issues.join(' | ')}`);
    this.name = 'ModelValidationError';
  }
}

const describeIssue = (issue: SchemaIssue): string => {
  const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  const params = issue.params ? ` ${JSON.stringify(issue.params)}` : '';
  return `${where}${issue.message}${params}`;
};

/**
 * Validate against the editor's schema and return its parsed form: unknown keys dropped and
 * keys in schema order, so equal models serialise identically. The model must carry every icon
 * its items reference (see `withReferencedIcons`). Throws `ModelValidationError` for a model
 * the editor would refuse to load.
 */
export function parseModel(model: Model): Model {
  const result = modelSchema.safeParse(model);
  if (!result.success) {
    throw new ModelValidationError((result.error?.issues ?? []).map(describeIssue));
  }
  return result.data as Model;
}
