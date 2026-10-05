import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';

import cors from 'cors';
import express from 'express';
import multer from 'multer';

import {
  type ActionProposalScope,
  type AgentActionProposal,
  claimActionProposalForApply,
  claimActionProposalForUndo,
  configureActionProposalStore,
  createActionProposal,
  getActionProposal,
  listActionProposals,
  readActionProposal,
  updateActionProposalStatus,
} from './actions';
import {
  type AiBackendConfig,
  loadConfig,
  mainTextModelForProvider,
  OPENAI_COMPATIBLE_PROVIDER_NAMES,
  PROVIDER_NAMES,
  saveConfig,
  updateConfig,
} from './config';
import { registerGoogleCalendarRoutes } from './google-calendar';
import { createGraphQLHandler } from './graphql';
import {
  assertLocalOnnxTextReady,
  localOnnxFilesComplete,
  onnxTextRuntimeAvailable,
} from './local-onnx';
import {
  executeApprovedMcpTool,
  getConfiguredMcpServers,
  loadMcpToolContext,
  resetMcpPool,
} from './mcp';
import {
  getLocalModelHealth,
  getSttProviderManifests,
  registerMeetingRoutes,
  resumeRetainedMeetingTranscriptions,
  validateAppleSpeechLanguage,
} from './meetings';
import { isLocalOnnxTextModel } from './model-registry';
import { AiModelRouter } from './providers';
import { installSeededLocalModels } from './seeded-models';
import { CopilotStore } from './store';
import { createImageHandler, createStreamHandler } from './stream';
import {
  deleteWorkspaceContentDocuments,
  searchWorkspace,
  upsertWorkspaceContentDocuments,
} from './workspace-search';

const BACKEND_AUTH_HEADER = 'x-nota-backend-token';
const NOTA_RENDERER_ORIGINS = new Set(['assets://.', 'assets://another-host']);

class ProposalRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function configuredDevRendererOrigin() {
  const configured = process.env.DEV_SERVER_URL?.trim();
  if (!configured) {
    return null;
  }

  try {
    const url = new URL(configured);
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    ) {
      return url.origin;
    }
  } catch {
    // An invalid dev-server URL must not widen the backend origin policy.
  }

  return null;
}

export function isAllowedNotaBackendOrigin(origin: string) {
  if (NOTA_RENDERER_ORIGINS.has(origin)) {
    return true;
  }

  return origin === configuredDevRendererOrigin();
}

function validBackendToken(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

function cloneAiBackendConfig(config: AiBackendConfig): AiBackendConfig {
  return {
    ...config,
    compatibleProviders: Object.fromEntries(
      Object.entries(config.compatibleProviders).map(([provider, settings]) => [
        provider,
        { ...settings },
      ])
    ) as AiBackendConfig['compatibleProviders'],
  };
}

async function localOnnxSelectionError(config: AiBackendConfig) {
  if (
    config.defaultProvider !== 'local' ||
    !isLocalOnnxTextModel(config.localModel)
  ) {
    return null;
  }
  if (!(await localOnnxFilesComplete(config, config.localModel))) {
    return `Download ${config.localModel} before selecting it as the default Nota AI model.`;
  }
  if (!(await onnxTextRuntimeAvailable())) {
    return `The local ONNX runtime is unavailable, so ${config.localModel} cannot be selected.`;
  }
  return null;
}

async function warmSelectedLocalOnnxModel(config: AiBackendConfig) {
  if (
    config.defaultProvider !== 'local' ||
    !isLocalOnnxTextModel(config.localModel) ||
    !(await localOnnxFilesComplete(config, config.localModel))
  ) {
    return;
  }
  await assertLocalOnnxTextReady(config, config.localModel);
}

export function createServer() {
  const config = loadConfig();
  const backendToken = process.env.NOTA_AI_BACKEND_TOKEN?.trim();
  if (!backendToken) {
    throw new Error(
      'NOTA_AI_BACKEND_TOKEN is required. The desktop app generates one for each app process.'
    );
  }
  const seededModelsReady = installSeededLocalModels(config).catch(error => {
    console.error('[seeded-models] failed to install bundled models', error);
  });
  const models = new AiModelRouter(config);
  const mainTextModel = () => mainTextModelForProvider(config);
  configureActionProposalStore(
    path.join(path.dirname(config.settingsPath), 'agent-action-proposals.json')
  );
  const initialModelCatalog = models.models();
  const store = new CopilotStore(
    initialModelCatalog.defaultModel,
    initialModelCatalog.optionalModels.map(model => model.id),
    path.join(path.dirname(config.settingsPath), 'copilot-sessions.json')
  );
  const ready = seededModelsReady.then(async () => {
    try {
      // Seed installation changes the on-disk catalog after the router and
      // Copilot store are constructed. Refresh from the existing health
      // metadata before any route is allowed through so a first chat cannot
      // select a missing, blocked, or device-incompatible local model.
      // getLocalModelHealth reads cached probe results; it does not load every
      // model runtime.
      const localModelHealth = await getLocalModelHealth(config);
      const startupModelCatalog = models.models(localModelHealth.models);
      store.setDefaultModel(
        startupModelCatalog.defaultModel,
        startupModelCatalog.optionalModels
          .filter(model => model.selectable)
          .map(model => model.id)
      );
    } catch (error) {
      // A catalog refresh must not make the local backend fail to start. The
      // settings/catalog routes will retry the same metadata refresh later.
      console.warn('[models] failed to refresh startup model health', error);
    }
  });
  const upload = multer();
  const app = express();

  // Direct app consumers may begin listening before startup has finished.
  // Keep every route, especially meeting start, behind the same model-seed
  // barrier that the desktop utility-process readiness signal awaits.
  app.use(async (_req, _res, next) => {
    await ready;
    next();
  });

  function readProposalScope(input: unknown): ActionProposalScope {
    const body =
      input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : {};
    const requestedSessionId =
      typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const requestedWorkspaceId =
      typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
    if (!requestedSessionId || !requestedWorkspaceId) {
      throw new ProposalRequestError(
        400,
        'workspaceId and sessionId are required for action proposals.'
      );
    }

    const session = store.getSessionInWorkspace(
      requestedWorkspaceId,
      requestedSessionId
    );
    if (!session) {
      throw new ProposalRequestError(
        403,
        'The requested AI chat session does not belong to that workspace.'
      );
    }

    return {
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
    };
  }

  function sendProposalError(
    res: express.Response,
    error: unknown,
    fallbackStatus = 400
  ) {
    res
      .status(
        error instanceof ProposalRequestError
          ? error.statusCode
          : fallbackStatus
      )
      .json({ error: error instanceof Error ? error.message : String(error) });
  }

  function scopedProposalResult(
    result: Record<string, unknown> | undefined,
    scope: ActionProposalScope
  ) {
    return result ? { ...result, workspaceId: scope.workspaceId } : undefined;
  }

  function describeActionProposal(proposal: AgentActionProposal) {
    switch (proposal.type) {
      case 'create_note':
      case 'create_database':
      case 'create_task_list':
        return `${proposal.type.replace(/_/g, ' ')} "${proposal.title}"`;
      case 'create_mindmap':
      case 'insert_markdown':
      case 'replace_selection':
        return `${proposal.type.replace(/_/g, ' ')} in ${proposal.docId}`;
      case 'append_database_rows':
        return `append database rows in ${proposal.docId}`;
      case 'clear_doc':
        return `clear document ${proposal.docId}`;
      case 'run_mcp_tool':
        return `run MCP tool ${proposal.toolName}`;
    }
  }

  function appendActionStatusMessage(input: {
    proposal: ReturnType<typeof updateActionProposalStatus>;
    status: 'applied' | 'approved' | 'failed' | 'rejected' | 'undone';
  }) {
    if (!input.proposal?.sessionId) {
      return;
    }

    const docId =
      input.proposal.result && typeof input.proposal.result.docId === 'string'
        ? input.proposal.result.docId
        : null;
    const message =
      input.status === 'applied'
        ? `Applied Nota AI action: ${describeActionProposal(
            input.proposal.proposal
          )}${docId ? ` -> ${docId}` : ''}.`
        : input.status === 'undone'
          ? `Undid Nota AI action: ${describeActionProposal(
              input.proposal.proposal
            )}${docId ? ` -> ${docId}` : ''}.`
          : input.status === 'failed'
            ? `Failed Nota AI action: ${describeActionProposal(
                input.proposal.proposal
              )}.`
            : `${input.status === 'approved' ? 'Approved' : 'Rejected'} Nota AI action: ${describeActionProposal(
                input.proposal.proposal
              )}.`;

    try {
      store.appendAssistantMessage(input.proposal.sessionId, message);
    } catch {
      // The originating chat can be gone after a backend restart or cleanup.
    }
  }

  async function localProviderAvailable() {
    if (isLocalOnnxTextModel(config.localModel)) {
      return (
        (await onnxTextRuntimeAvailable()) &&
        (await localOnnxFilesComplete(config, config.localModel))
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 750);
    try {
      const baseUrl = config.localBaseUrl.replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${config.localApiKey}`,
        },
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function textGenerationAvailable() {
    switch (config.defaultProvider) {
      case 'anthropic':
        return !!config.anthropicApiKey;
      case 'google':
        return !!config.googleApiKey;
      case 'openai':
        return !!config.openaiApiKey;
      case 'local':
        return localProviderAvailable();
      case 'openrouter':
      case 'deepseek':
      case 'xai':
      case 'mistral':
      case 'groq':
      case 'perplexity':
      case 'custom': {
        const provider = config.compatibleProviders[config.defaultProvider];
        return (
          !!provider.baseUrl &&
          (config.defaultProvider === 'custom' || !!provider.apiKey)
        );
      }
    }
  }

  async function imageGenerationAvailable() {
    switch (config.imageProvider) {
      case 'google':
        return !!config.googleApiKey;
      case 'openai':
        return !!config.openaiApiKey;
      case 'local':
        if (isLocalOnnxTextModel(config.localImageModel)) {
          return false;
        }
        return localProviderAvailable();
    }
  }

  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        callback(
          null,
          typeof origin === 'string' && isAllowedNotaBackendOrigin(origin)
            ? origin
            : false
        );
      },
    })
  );
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && !isAllowedNotaBackendOrigin(origin)) {
      res.status(403).json({ error: 'Origin is not allowed.' });
      return;
    }

    const providedToken = req.get(BACKEND_AUTH_HEADER)?.trim() ?? '';
    if (!providedToken || !validBackendToken(providedToken, backendToken)) {
      res.status(401).json({ error: 'Invalid Nota backend token.' });
      return;
    }

    next();
  });
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    const modelCatalog = models.models();
    const selected = modelCatalog.defaultModel
      ? models.select(modelCatalog.defaultModel)
      : null;
    res.json({
      instanceId: process.env.NOTA_AI_INSTANCE_ID ?? null,
      ok: true,
      provider: config.defaultProvider,
      model: mainTextModel(),
      modelAvailable: selected !== null,
      runtime: selected?.runtime ?? null,
      localBaseUrl: config.localBaseUrl,
      workspaceRoot: config.workspaceRoot,
    });
  });

  app.get('/api/ai/settings', async (_req, res) => {
    const canGenerateText = await textGenerationAvailable();
    const canGenerateImages = await imageGenerationAvailable();
    const sttProviders = await getSttProviderManifests(
      config,
      process.platform
    );
    const localModelHealth = await getLocalModelHealth(config);
    const modelCatalog = await models.modelsWithDiscovery(
      localModelHealth.models
    );
    const mcpContext = await loadMcpToolContext(config);
    const selected = modelCatalog.defaultModel
      ? models.select(modelCatalog.defaultModel)
      : null;
    try {
      res.json({
        provider: config.defaultProvider,
        model: mainTextModel(),
        runtime: selected?.runtime ?? null,
        providers: PROVIDER_NAMES,
        models: modelCatalog,
        settingsPath: config.settingsPath,
        localBaseUrl: config.localBaseUrl,
        localModel: config.localModel,
        openaiModel: config.openaiModel,
        anthropicModel: config.anthropicModel,
        googleModel: config.googleModel,
        compatibleProviders: Object.fromEntries(
          OPENAI_COMPATIBLE_PROVIDER_NAMES.map(provider => [
            provider,
            {
              baseUrl: config.compatibleProviders[provider].baseUrl,
              hasKey: !!config.compatibleProviders[provider].apiKey,
              model: config.compatibleProviders[provider].model,
            },
          ])
        ),
        imageProvider: config.imageProvider,
        openaiImageModel: config.openaiImageModel,
        googleImageModel: config.googleImageModel,
        localImageModel: config.localImageModel,
        tools: {
          embeddingAllowRemote: config.embeddingAllowRemote,
          embeddingMode: config.embeddingMode,
          embeddingModel: config.embeddingModel,
          enabled: config.toolsEnabled,
          webCrawl: config.webCrawlToolEnabled,
          shell: config.shellToolEnabled,
          workspaceSearch: config.workspaceSearchToolEnabled,
          maxSteps: config.toolMaxSteps,
        },
        mcp: {
          enabled: config.mcpEnabled,
          config: config.mcpConfig,
          servers:
            mcpContext.status.length > 0
              ? mcpContext.status
              : getConfiguredMcpServers(config),
          toolNames: mcpContext.tools ? Object.keys(mcpContext.tools) : [],
        },
        meetings: {
          device: localModelHealth.device,
          localModels: localModelHealth.models,
          sttModelId: config.meetingSttModelId,
          sttLanguage: config.meetingSttLanguage,
          sttProviderId: config.meetingSttProviderId,
          sttProviders,
          transcriptionAvailable: sttProviders.some(
            provider => provider.canProduceTranscript
          ),
        },
        hasKeys: {
          openai: !!config.openaiApiKey,
          anthropic: !!config.anthropicApiKey,
          google: !!config.googleApiKey,
          local: !!config.localApiKey,
          ...Object.fromEntries(
            OPENAI_COMPATIBLE_PROVIDER_NAMES.map(provider => [
              provider,
              !!config.compatibleProviders[provider].apiKey ||
                (provider === 'custom' &&
                  !!config.compatibleProviders[provider].baseUrl),
            ])
          ),
        },
        capabilities: {
          chat: canGenerateText,
          context: true,
          imageGeneration: canGenerateImages,
          tools: config.toolsEnabled,
          webCrawl: config.toolsEnabled && config.webCrawlToolEnabled,
          shell: config.toolsEnabled && config.shellToolEnabled,
          workspaceSearch:
            config.toolsEnabled && config.workspaceSearchToolEnabled,
          mcp: config.toolsEnabled && config.mcpEnabled,
          appActions: config.toolsEnabled,
          databaseCreation: config.toolsEnabled,
          meetingTranscription: sttProviders.some(
            provider => provider.canProduceTranscript
          ),
          noteCreation: config.toolsEnabled,
          mindMapCreation: config.toolsEnabled,
        },
      });
    } finally {
      await mcpContext.close();
    }
  });

  app.post('/api/ai/settings', async (req, res) => {
    try {
      const nextConfig = cloneAiBackendConfig(config);
      try {
        updateConfig(nextConfig, req.body ?? {});
        validateAppleSpeechLanguage(
          nextConfig.meetingSttLanguage,
          nextConfig.meetingSttProviderId
        );
      } catch (validationError) {
        res.status(400).json({
          error:
            validationError instanceof Error
              ? validationError.message
              : String(validationError),
        });
        return;
      }
      const changesTextSelection =
        req.body &&
        typeof req.body === 'object' &&
        ('defaultModel' in req.body ||
          'defaultProvider' in req.body ||
          'localModel' in req.body);
      const selectionError = changesTextSelection
        ? await localOnnxSelectionError(nextConfig)
        : null;
      if (selectionError) {
        res.status(400).json({ error: selectionError });
        return;
      }
      Object.assign(config, nextConfig);
      saveConfig(config);
      models.refresh();
      resetMcpPool();
      const nextModelCatalog = models.models();
      store.setDefaultModel(
        nextModelCatalog.defaultModel,
        nextModelCatalog.optionalModels.map(model => model.id)
      );
      res.json({
        ok: true,
        provider: config.defaultProvider,
        model: mainTextModel(),
        localBaseUrl: config.localBaseUrl,
        settingsPath: config.settingsPath,
      });
    } catch (settingsError) {
      res.status(500).json({
        error:
          settingsError instanceof Error
            ? settingsError.message
            : String(settingsError),
      });
    }
  });

  app.get('/api/auth/session', (_req, res) => {
    res.json({
      user: {
        id: 'local-user',
        name: 'Local User',
        email: 'local@nota.local',
      },
    });
  });

  app.post('/v1/workspace/search', async (req, res) => {
    try {
      const result = await searchWorkspace(config, {
        glob: typeof req.body?.glob === 'string' ? req.body.glob : undefined,
        limit: req.body?.limit,
        query: typeof req.body?.query === 'string' ? req.body.query : '',
        userId:
          typeof req.body?.userId === 'string' ? req.body.userId : 'local-user',
        workspaceId:
          typeof req.body?.workspaceId === 'string'
            ? req.body.workspaceId
            : undefined,
      });
      res.json(result);
    } catch (searchError) {
      res.status(400).json({
        error:
          searchError instanceof Error
            ? searchError.message
            : String(searchError),
      });
    }
  });

  app.post('/v1/workspace/content/upsert', async (req, res) => {
    try {
      const result = await upsertWorkspaceContentDocuments(config, {
        documents: req.body?.documents,
        replacement: req.body?.replacement,
        replaceWorkspace: req.body?.replaceWorkspace === true,
        requireAccessVerification: true,
        workspaceId:
          typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '',
      });
      res.json(result);
    } catch (upsertError) {
      res.status(400).json({
        error:
          upsertError instanceof Error
            ? upsertError.message
            : String(upsertError),
      });
    }
  });

  app.post('/v1/workspace/content/delete', async (req, res) => {
    try {
      const docIds = Array.isArray(req.body?.docIds)
        ? req.body.docIds.filter(
            (docId: unknown): docId is string => typeof docId === 'string'
          )
        : [];
      const result = await deleteWorkspaceContentDocuments(config, {
        docIds,
        workspaceId:
          typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '',
      });
      res.json(result);
    } catch (deleteError) {
      res.status(400).json({
        error:
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError),
      });
    }
  });

  app.post('/v1/agent/actions/proposals', (req, res) => {
    try {
      const scope = readProposalScope(req.body);
      const proposal = createActionProposal({
        proposal: readActionProposal(req.body?.proposal ?? req.body),
        reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
        ...scope,
      });
      res.json({ proposal });
    } catch (proposalError) {
      sendProposalError(res, proposalError);
    }
  });

  app.get('/v1/agent/actions/proposals', (req, res) => {
    try {
      const scope = readProposalScope(req.query);
      res.json({ proposals: listActionProposals(scope) });
    } catch (proposalError) {
      sendProposalError(res, proposalError);
    }
  });

  app.get('/v1/agent/actions/proposals/:id', (req, res) => {
    try {
      const scope = readProposalScope(req.query);
      const proposal = getActionProposal(req.params.id, scope);
      if (!proposal) {
        res
          .status(404)
          .json({ error: `Action proposal not found: ${req.params.id}` });
        return;
      }
      res.json({ proposal });
    } catch (proposalError) {
      sendProposalError(res, proposalError);
    }
  });

  app.get('/v1/mcp/status', async (_req, res) => {
    const context = await loadMcpToolContext(config);
    try {
      res.json({
        enabled: config.toolsEnabled && config.mcpEnabled,
        servers: context.status,
        toolNames: context.tools ? Object.keys(context.tools) : [],
      });
    } finally {
      await context.close();
    }
  });

  app.patch('/v1/agent/actions/proposals/:id', (req, res) => {
    const status = req.body?.status;
    if (
      status !== 'approved' &&
      status !== 'failed' &&
      status !== 'rejected' &&
      status !== 'applied' &&
      status !== 'undone'
    ) {
      res.status(400).json({
        error:
          'status must be one of approved, failed, rejected, applied, or undone',
      });
      return;
    }

    try {
      const scope = readProposalScope(req.body);
      const current = getActionProposal(req.params.id, scope);
      if (!current) {
        res
          .status(404)
          .json({ error: `Action proposal not found: ${req.params.id}` });
        return;
      }
      if (
        current.status === 'applying' &&
        (current.proposal.type === 'run_mcp_tool' ||
          (status !== 'applied' && status !== 'failed'))
      ) {
        res.status(409).json({
          error:
            current.proposal.type === 'run_mcp_tool'
              ? 'The backend owns the status of an applying MCP action.'
              : 'An applying action proposal can only be completed or failed.',
        });
        return;
      }
      if (
        current.status === 'undoing' &&
        status !== 'applied' &&
        status !== 'undone'
      ) {
        res.status(409).json({
          error:
            'An undoing action proposal can only be completed or returned to applied.',
        });
        return;
      }
      const result = scopedProposalResult(
        req.body?.result && typeof req.body.result === 'object'
          ? (req.body.result as Record<string, unknown>)
          : undefined,
        scope
      );
      const proposal = updateActionProposalStatus(
        req.params.id,
        scope,
        status,
        result
      );
      if (!proposal) {
        res
          .status(404)
          .json({ error: `Action proposal not found: ${req.params.id}` });
        return;
      }
      // Returning an unsuccessful local undo claim to `applied` is not a new
      // apply event and must not duplicate the original chat audit message.
      if (current.status !== 'undoing' || status !== 'applied') {
        appendActionStatusMessage({ proposal, status });
      }
      res.json({ proposal });
    } catch (proposalError) {
      sendProposalError(res, proposalError, 409);
    }
  });

  app.post('/v1/agent/actions/proposals/:id/claim', (req, res) => {
    try {
      const scope = readProposalScope(req.body);
      const stored = getActionProposal(req.params.id, scope);
      if (!stored) {
        res
          .status(404)
          .json({ error: `Action proposal not found: ${req.params.id}` });
        return;
      }
      if (stored.proposal.type === 'run_mcp_tool') {
        res.status(400).json({
          error: 'MCP action proposals must use the backend apply endpoint.',
        });
        return;
      }

      const proposal = claimActionProposalForApply(stored.id, scope);
      if (!proposal) {
        res
          .status(404)
          .json({ error: `Action proposal not found: ${req.params.id}` });
        return;
      }
      res.json({ proposal });
    } catch (proposalError) {
      sendProposalError(res, proposalError, 409);
    }
  });

  app.post('/v1/agent/actions/proposals/:id/undo-claim', (req, res) => {
    try {
      const scope = readProposalScope(req.body);
      const stored = getActionProposal(req.params.id, scope);
      if (!stored) {
        res
          .status(404)
          .json({ error: `Action proposal not found: ${req.params.id}` });
        return;
      }
      if (
        stored.proposal.type === 'run_mcp_tool' ||
        !stored.result?.undo ||
        typeof stored.result.undo !== 'object'
      ) {
        res.status(400).json({
          error: 'This action proposal does not include a local undo target.',
        });
        return;
      }

      const proposal = claimActionProposalForUndo(stored.id, scope);
      if (!proposal) {
        res
          .status(404)
          .json({ error: `Action proposal not found: ${req.params.id}` });
        return;
      }
      res.json({ proposal });
    } catch (proposalError) {
      sendProposalError(res, proposalError, 409);
    }
  });

  app.post('/v1/agent/actions/proposals/:id/apply', async (req, res) => {
    try {
      const scope = readProposalScope(req.body);
      const stored = getActionProposal(req.params.id, scope);
      if (!stored) {
        res
          .status(404)
          .json({ error: `Action proposal not found: ${req.params.id}` });
        return;
      }
      if (stored.proposal.type !== 'run_mcp_tool') {
        res.status(400).json({
          error:
            'Only gated MCP tool proposals can be applied by this endpoint.',
        });
        return;
      }

      const claimed = claimActionProposalForApply(stored.id, scope);
      if (!claimed || claimed.proposal.type !== 'run_mcp_tool') {
        res
          .status(404)
          .json({ error: `Action proposal not found: ${req.params.id}` });
        return;
      }

      let execution: Awaited<ReturnType<typeof executeApprovedMcpTool>>;
      try {
        execution = await executeApprovedMcpTool(config, {
          args: claimed.proposal.args ?? {},
          namespacedToolName: claimed.proposal.toolName,
        });
      } catch (executionError) {
        const errorMessage =
          executionError instanceof Error
            ? executionError.message
            : String(executionError);
        const proposal = updateActionProposalStatus(
          claimed.id,
          scope,
          'failed',
          {
            error: errorMessage,
            failedAt: new Date().toISOString(),
            retryable: false,
            reviewRequired: true,
            type: claimed.proposal.type,
            workspaceId: scope.workspaceId,
          }
        );
        appendActionStatusMessage({ proposal, status: 'failed' });
        res.status(502).json({ error: errorMessage, proposal });
        return;
      }

      const proposal = updateActionProposalStatus(stored.id, scope, 'applied', {
        appliedAt: new Date().toISOString(),
        mcp: execution,
        type: claimed.proposal.type,
        workspaceId: scope.workspaceId,
      });
      if (!proposal) {
        res
          .status(404)
          .json({ error: `Action proposal not found: ${req.params.id}` });
        return;
      }
      appendActionStatusMessage({ proposal, status: 'applied' });
      res.json({ proposal });
    } catch (proposalError) {
      sendProposalError(res, proposalError, 409);
    }
  });

  app.post(
    '/graphql',
    upload.any(),
    createGraphQLHandler({ config, models, store })
  );

  const streamHandler = createStreamHandler({ config, models, store });
  const imageHandler = createImageHandler({ config, models, store });
  for (const prefix of ['/api/ai/chat', '/api/copilot/chat']) {
    app.get(`${prefix}/:sessionId/stream`, streamHandler);
    app.get(`${prefix}/:sessionId/stream-object`, streamHandler);
    app.get(`${prefix}/:sessionId/workflow`, streamHandler);
    app.get(`${prefix}/:sessionId/images`, imageHandler);
  }

  registerMeetingRoutes({ app, config, models, store });
  void ready
    .then(() => resumeRetainedMeetingTranscriptions(config))
    .catch(error => {
      console.error(
        '[meetings] failed to resume retained meeting transcription',
        error
      );
    });
  void ready
    .then(() => {
      // Start the selected local pipeline shortly after the backend is ready.
      // Chat requests share the same cached promise, so an early Send coalesces
      // with this warmup instead of loading the model twice.
      setTimeout(() => {
        warmSelectedLocalOnnxModel(config).catch(error => {
          console.warn('[local-onnx] background warmup skipped', error);
        });
      }, 1500);
    })
    .catch(error => {
      console.warn('[local-onnx] background warmup was not scheduled', error);
    });
  registerGoogleCalendarRoutes(app);

  return { app, config, ready };
}
