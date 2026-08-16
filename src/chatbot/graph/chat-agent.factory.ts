import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import {
  AIMessage,
  BaseMessage,
  SystemMessage,
} from '@langchain/core/messages';
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { EnvironmentVariables } from '../../config/env.validation';
import { CHATBOT_TEMPERATURE, MAX_TOOL_ITERATIONS } from '../chatbot.constants';
import { buildChatSystemPrompt } from '../prompts/chat-agent.prompt';
import { ChatToolsFactory } from '../tools/chat-tools.factory';
import { ChatTurnContext, ChatTurnSources } from '../types/chat-turn';

export interface AgentRunResult {
  readonly text: string;
  /** True when the loop was cut short rather than finishing on its own. */
  readonly exhaustedToolBudget: boolean;
}

/**
 * Builds and runs the agent graph — **one per request**.
 *
 * There is no cached, long-lived agent, and that is the point: the tools close
 * over this turn's `storeId` and `userId`, so a shared instance would trade the
 * tenant guarantee for the cost of constructing a few objects.
 *
 * The graph is deliberately small. It holds routing and the tool loop and no
 * business rule at all, which is what keeps LangGraph — a fast-moving dependency
 * — swappable in an afternoon.
 *
 * ```
 *   START → agent ⇄ tools
 *             ↓
 *            END
 * ```
 */
@Injectable()
export class ChatAgentFactory {
  private readonly logger = new Logger(ChatAgentFactory.name);

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly toolsFactory: ChatToolsFactory,
  ) {}

  async run(
    context: ChatTurnContext,
    history: BaseMessage[],
    sources: ChatTurnSources,
  ): Promise<AgentRunResult> {
    const tools = this.toolsFactory.build(context, sources);
    const model = new ChatGoogleGenerativeAI({
      apiKey: this.configService.get('GEMINI_API_KEY', { infer: true }),
      model: this.configService.get('CHATBOT_MODEL', { infer: true }),
      temperature: CHATBOT_TEMPERATURE,
    }).bindTools(tools);

    const systemMessage = new SystemMessage(
      buildChatSystemPrompt({
        store: context.store,
        isSignedIn: context.user !== null,
      }),
    );

    let exhaustedToolBudget = false;

    const graph = new StateGraph(MessagesAnnotation)
      .addNode('agent', async (state) => {
        const reply = await model.invoke([systemMessage, ...state.messages]);
        return { messages: [reply] };
      })
      .addNode('tools', new ToolNode(tools))
      .addEdge(START, 'agent')
      .addConditionalEdges(
        'agent',
        (state) => {
          const last = state.messages.at(-1) as AIMessage | undefined;
          if (!last?.tool_calls?.length) {
            return END;
          }
          // A loop that wants a fifth round of tools is a loop. Ending here
          // leaves the last reply in state, and `finalize` reports it as an
          // error rather than pretending the turn succeeded.
          if (countToolRounds(state.messages) >= MAX_TOOL_ITERATIONS) {
            exhaustedToolBudget = true;
            return END;
          }
          return 'tools';
        },
        { tools: 'tools', [END]: END },
      )
      .addEdge('tools', 'agent')
      .compile();

    const finalState = await graph.invoke({ messages: history });
    return {
      text: extractText(finalState.messages.at(-1)),
      exhaustedToolBudget,
    };
  }
}

function countToolRounds(messages: readonly BaseMessage[]): number {
  return messages.filter(
    (message) =>
      message.getType() === 'ai' &&
      ((message as AIMessage).tool_calls?.length ?? 0) > 0,
  ).length;
}

/**
 * Gemini can answer in content blocks rather than a plain string, so the text
 * parts are joined instead of assuming `content` is one.
 */
function extractText(message: BaseMessage | undefined): string {
  if (!message) {
    return '';
  }
  const { content } = message;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) =>
      typeof part === 'string'
        ? part
        : ((part as { text?: string }).text ?? ''),
    )
    .join('')
    .trim();
}
