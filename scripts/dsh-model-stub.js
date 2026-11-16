// Poros DSH 容器内模型桩（OpenAI 兼容 /chat/completions，SSE 流式）。
// 用途：开发/CI 的"真实 DSH 执行 + 测试桩模型"通道（POROS_DSH_MODEL_STUB=1）。
// DSH 会话、工具循环、事件流完全真实；本文件是唯一的测试替身，产出含固定标记
// POROS-DSH-OK 供机械 Judgment 规则断言。生产禁用（生产走容器内真实网关密钥）。
// 本文件是普通 .js 资产：node --check 可直接验证，由 dsh-runtime.ts 读盘注入容器。
'use strict';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('http');

http
  .createServer((req, res) => {
    if (!req.url.includes('chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      let req2 = {};
      try {
        req2 = JSON.parse(body);
      } catch {
        /* 桩不挑请求 */
      }
      const hasTools = Array.isArray(req2.tools) && req2.tools.length > 0;
      const toolMsgs = (req2.messages || []).filter((m) => m.role === 'tool').length;
      if (hasTools) tools = req2.tools.map((t) => (t.function ? t.function.name : ''));
      const send = (obj) => {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (hasTools && toolMsgs === 0 && tools.includes('bash')) {
        const fn = {
          name: 'bash',
          arguments: JSON.stringify({ command: 'echo POROS-DSH-REAL-EXEC', description: 'verify dsh exec' }),
        };
        send({
          id: 'stub-1',
          object: 'chat.completion.chunk',
          model: 'poros-stub',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{ id: 'call-1', type: 'function', function: fn }],
              },
            },
          ],
        });
        send({
          id: 'stub-1',
          object: 'chat.completion.chunk',
          model: 'poros-stub',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        });
      } else {
        send({
          id: 'stub-2',
          object: 'chat.completion.chunk',
          model: 'poros-stub',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content:
                  'POROS-DSH-OK 已在专属 DSH 容器内完成本次任务（真实 DSH 执行回路，模型为测试桩）。',
              },
            },
          ],
        });
        send({
          id: 'stub-2',
          object: 'chat.completion.chunk',
          model: 'poros-stub',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        });
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  })
  .listen(9919, () => console.log('poros-stub up'));

let tools = [];
