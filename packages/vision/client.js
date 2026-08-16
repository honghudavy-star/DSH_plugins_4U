window.__ModuleLoader__.load({ id: "@dsh-plugins/vision", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const React = require('react');

function bytesToBase64(bytes) {
  let out = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    out += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(out);
}

async function serializeFiles(files) {
  return Promise.all(files.map(async file => ({
    mediaType: file.type,
    name: file.name,
    data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
  })));
}

function VisionAction({ input, inputActions, analyzeDraft }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const latestInput = React.useRef(input);
  latestInput.current = input;
  const ready = input.imageIds.length > 0 && input.phase === 'plain' && !busy;
  const run = async () => {
    if (!ready) return;
    const draft = input.draft;
    const imageIds = [...input.imageIds];
    setBusy(true);
    setError('');
    try {
      const result = await analyzeDraft(imageIds, draft);
      const current = latestInput.current;
      if (current.draft !== draft || current.imageIds.length !== imageIds.length || current.imageIds.some((id, index) => id !== imageIds[index])) {
        throw new Error('识图期间草稿已变化，请确认后重新点击');
      }
      for (const id of imageIds) inputActions.removeImage(id);
      const question = draft.trim();
      inputActions.setDraft([
        question ? `我对刚上传图片的问题：${question}` : '请根据刚上传图片的视觉分析结果作答。',
        '',
        '[视觉分析结果]',
        result,
      ].join('\n'));
      queueMicrotask(() => inputActions.submit());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      type: 'button',
      title: busy ? '正在识图…' : '识图并发送',
      'aria-label': busy ? '正在识图' : '识图并发送',
      'data-dsh-plugin': '@dsh-plugins/vision',
      disabled: !ready,
      onClick: run,
      style: {
        height: 28, padding: '0 9px', borderRadius: 8,
        border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
        background: 'transparent', color: ready ? 'inherit' : 'color-mix(in srgb, currentColor 35%, transparent)',
        cursor: ready ? 'pointer' : 'default', font: 'inherit', fontSize: 12,
      },
    }, busy ? '识图中…' : '识图发送'),
    error ? React.createElement('span', { role: 'status', title: error, style: { color: '#d33', fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, error) : null,
  );
}

exports.name = 'dsh-plugins-vision-client';
exports.inject = ['slots', 'conversation'];
exports.apply = function apply(ctx) {
  const analyzeDraft = async (imageIds, prompt) => {
    const attachments = ctx.conversation.draftImages(imageIds);
    if (attachments.length !== imageIds.length) throw new Error('图片草稿已失效，请重新添加');
    const images = await serializeFiles(attachments.map(item => item.file));
    const response = await fetch('/plugins/dsh-vision/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ images, prompt }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || `识图请求失败 (${response.status})`);
    return body.result;
  };
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'dsh-plugins-vision',
    order: 30,
    inject: () => ({ analyzeDraft }),
  }, VisionAction));
};

return module.exports; } });
