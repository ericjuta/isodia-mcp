import { htmlToText } from '../../src/core/text';
import type { Walkthrough } from '../../src/core/walkthrough';

export function buildListStepsPayload(
  story: Walkthrough,
  currentStepId: string,
  { origin, pathname }: { origin: string; pathname: string }
) {
  return {
    title: story.title,
    articleUrl: story.articleUrl,
    currentStepId,
    steps: story.steps.map(({ id, title, view }, index) => ({
      id, index: index + 1, title, view, url: `${origin}${pathname}?step=${id}`
    }))
  };
}

export function buildReadStepPayload(story: Walkthrough, stepId: string | undefined) {
  const step = story.steps.find(({ id }) => id === stepId);
  if (!step) {
    const validStepIds = story.steps.map(({ id }) => id);
    const problem = typeof stepId === 'string' ? `Unknown step id ${JSON.stringify(stepId)}.` : 'A step id is required.';
    return { error: `${problem} Valid step ids: ${validStepIds.join(', ')}.`, validStepIds };
  }

  // Publication validation ensures that the view and its component references exist.
  const view = story.model.views.find(({ id }) => id === step.view)!;
  const items = new Map(story.model.items.map((item) => [item.id, item]));
  const component = step.component === undefined ? undefined : items.get(step.component);
  return {
    id: step.id,
    title: step.title,
    body: step.body,
    view: { id: view.id, name: view.name },
    ...(component && {
      component: { id: component.id, name: component.name, notes: htmlToText(component.description ?? '') }
    }),
    components: view.items.map(({ id }) => items.get(id)!.name)
  };
}

type ToolInput = { stepId?: string };
type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: true };
type Tool = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: 'string'; description: string }>;
    required?: string[];
    additionalProperties: false;
  };
  annotations: { readOnlyHint: true; untrustedContentHint: true };
  execute: (input?: ToolInput) => Promise<ToolResult>;
};
type ModelContext = {
  registerTool?: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void>;
  unregisterTool?: (name: string) => void | Promise<void>;
};
type ModelContextHost = { readonly modelContext?: ModelContext };

const noop = () => {};
const stepIdProperty = { type: 'string', description: 'A step ID from list_steps.' } as const;
const annotations = { readOnlyHint: true, untrustedContentHint: true } as const;

function toolResult(payload: object): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...('error' in payload ? { isError: true as const } : {})
  };
}

function execute(buildPayload: (input?: ToolInput) => object): Tool['execute'] {
  return async (input) => {
    try {
      return toolResult(buildPayload(input));
    } catch {
      return toolResult({ error: 'The walkthrough tool could not complete the request.' });
    }
  };
}

export function registerWalkthroughTools(options: {
  story: Walkthrough;
  currentStepId: () => string;
  goToStep: (stepId: string) => void;
}): () => void {
  let cleanup = noop;
  try {
    const navigatorContext = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & ModelContextHost).modelContext;
    const context = typeof navigatorContext?.registerTool === 'function'
      ? navigatorContext
      : typeof document === 'undefined' ? undefined : (document as Document & ModelContextHost).modelContext;
    if (typeof context?.registerTool !== 'function') return noop;
    // Call the method on its host object: WebMCP methods need their receiver, and static
    // scanners look for this exact form.
    const fromNavigator = context === navigatorContext;

    const { story, currentStepId, goToStep } = options;
    const tools: Tool[] = [
      {
        name: 'list_steps',
        description: 'List the walkthrough steps and their links. Identify the current step.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations,
        execute: execute(() => buildListStepsPayload(story, currentStepId(), location))
      },
      {
        name: 'read_step',
        description: 'Read a step, its view, and any focused component notes. Omit the step ID to read the current step.',
        inputSchema: { type: 'object', properties: { stepId: stepIdProperty }, additionalProperties: false },
        annotations,
        execute: execute((input) => buildReadStepPayload(story, input?.stepId === undefined ? currentStepId() : input.stepId))
      },
      {
        name: 'go_to_step',
        description: 'Show a walkthrough step and return its details. Does not edit the walkthrough.',
        inputSchema: { type: 'object', properties: { stepId: stepIdProperty }, required: ['stepId'], additionalProperties: false },
        annotations,
        execute: execute((input) => {
          const payload = buildReadStepPayload(story, input?.stepId);
          if (!('error' in payload)) goToStep(payload.id);
          return payload;
        })
      }
    ];

    const controller = new AbortController();
    const { signal } = controller;
    const unregisterTool = context?.unregisterTool;
    const registered = new Set<string>();
    const remove = (name: string) => {
      // Older Chromium builds use explicit removal and may ignore the signal.
      if (typeof unregisterTool !== 'function') return;
      try {
        void Promise.resolve(unregisterTool.call(context, name)).catch(noop);
      } catch {
        // A partial API can fail during removal too.
      }
    };
    cleanup = () => {
      if (signal.aborted) return;
      controller.abort();
      for (const name of registered) remove(name);
      registered.clear();
    };

    for (const tool of tools) {
      const onRegistered = () => {
        if (signal.aborted) remove(tool.name);
        else registered.add(tool.name);
      };
      const pending = fromNavigator
        ? (navigator as Navigator & ModelContextHost).modelContext!.registerTool!(tool, { signal })
        : (document as Document & ModelContextHost).modelContext!.registerTool!(tool, { signal });
      if (pending === undefined) onRegistered();
      else void Promise.resolve(pending).then(onRegistered, cleanup);
    }
    return cleanup;
  } catch {
    cleanup();
    return noop;
  }
}
