window.__ModuleLoader__.load({ id: "@dsh-plugins/4u", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const React = require('react');

const PLUGINS = Object.freeze([
  {
    id: 'wechat',
    name: '微信',
    packageName: '@dsh-plugins/wechat',
    description: '连接微信与 DSH 会话，并在侧栏提供快捷入口。',
    extension: 'Cordis Host · sidebar.footer.action',
    color: '#07c160',
    endpoint: '/plugins/dsh-wechat/config',
    fields: [
      { key: 'enabled', label: '启用微信桥接', type: 'checkbox', hint: '关闭后停止本地微信桥接进程。' },
      { key: 'bridgePort', label: '本地桥接端口', type: 'number', min: 1, max: 65535, step: 1 },
      { key: 'owner', label: '微信 owner ID', type: 'text', placeholder: '留空则由首个已验证消息自动绑定', hint: '设置后只接受这个微信 owner。' },
      { key: 'sessionId', label: 'DSH 会话 ID', type: 'text', placeholder: '留空则自动创建或复用“微信”会话' },
      { key: 'analyzeInboundImages', label: '自动分析微信图片', type: 'checkbox' },
    ],
  },
  {
    id: 'wallpaper',
    name: '壁纸',
    packageName: '@dsh-plugins/wallpaper',
    description: '使用内置预设或本地图片更换 DSH Web 背景。',
    extension: 'Cordis Host · webServer.tapIndex',
    color: '#8b5cf6',
    endpoint: '/plugins/dsh-wallpaper/config',
    fields: [
      { key: 'enabled', label: '启用壁纸', type: 'checkbox' },
      { key: 'localFile', label: '选择本地图片', type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hint: '支持 PNG、JPEG、WebP、GIF；文件会安全复制到插件数据目录。' },
      { key: 'source', label: '壁纸来源', type: 'text', placeholder: 'preset:midnight 或本地图片绝对路径', list: ['preset:midnight', 'preset:aurora', 'preset:forest', 'preset:sunset'], hint: '内置预设可直接选择；本地图片必须填写绝对路径。' },
      { key: 'opacity', label: '壁纸透明度', type: 'number', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    id: 'vision',
    name: '识图',
    packageName: '@dsh-plugins/vision',
    description: '分析粘贴或拖入的图片，再将视觉结果交给文本模型。',
    extension: 'Cordis Host · conversation.input.right',
    color: '#0ea5e9',
    endpoint: '/plugins/dsh-vision/config',
    fields: [
      { key: 'apiKeyEnv', label: 'Credential 名称', type: 'text', hint: 'DSH credential 中用于保存密钥的名称。' },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: '留空则保留现有密钥', hint: '只写入 DSH credential；保存后不会回显。' },
      { key: 'model', label: '识图模型', type: 'text' },
      { key: 'maxImages', label: '每次最多图片数', type: 'number', min: 1, max: 6, step: 1 },
      { key: 'maxImageMB', label: '单张图片上限（MB）', type: 'number', min: 0.1, max: 50, step: 0.1 },
      { key: 'maxTokens', label: '最大输出 Token', type: 'number', min: 1, max: 4096, step: 1 },
      { key: 'temperature', label: 'Temperature', type: 'number', min: 0, max: 2, step: 0.1 },
      { key: 'retries', label: '失败重试次数', type: 'number', min: 0, max: 3, step: 1 },
    ],
  },
]);

function toDraft(plugin, config) {
  const draft = { ...config };
  if (plugin.id === 'vision') {
    draft.apiKey = '';
    draft.maxImageMB = Math.round((Number(config.maxImageBytes) / 1024 / 1024) * 10) / 10;
    delete draft.maxImageBytes;
  }
  return draft;
}

function toPayload(plugin, draft) {
  const payload = { ...draft };
  if (plugin.id === 'wallpaper') delete payload.localFile;
  if (plugin.id === 'vision') {
    payload.maxImageBytes = Math.round(Number(payload.maxImageMB) * 1024 * 1024);
    delete payload.maxImageMB;
    if (!String(payload.apiKey || '').trim()) delete payload.apiKey;
  }
  for (const field of plugin.fields) {
    if (field.type === 'number' && field.key in payload) payload[field.key] = Number(payload[field.key]);
  }
  return payload;
}

function ConfigField({ plugin, field, value, onChange }) {
  const id = `dsh-plugin-${plugin.id}-${field.key}`;
  if (field.type === 'checkbox') {
    return React.createElement('label', {
      htmlFor: id,
      style: {
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
        borderRadius: 10, background: 'color-mix(in srgb, currentColor 3%, transparent)', cursor: 'pointer',
      },
    },
    React.createElement('input', {
      id, type: 'checkbox', checked: Boolean(value), onChange: event => onChange(event.target.checked),
      style: { marginTop: 2, accentColor: plugin.color },
    }),
    React.createElement('span', { style: { display: 'grid', gap: 3 } },
      React.createElement('strong', { style: { fontSize: 13, fontWeight: 600 } }, field.label),
      field.hint ? React.createElement('small', { style: { opacity: 0.6, lineHeight: 1.45 } }, field.hint) : null,
    ));
  }
  if (field.type === 'file') {
    return React.createElement('label', { htmlFor: id, style: { display: 'grid', gap: 6 } },
      React.createElement('span', { style: { fontSize: 12, fontWeight: 600 } }, field.label),
      React.createElement('input', {
        id, type: 'file', accept: field.accept,
        onChange: event => onChange(event.target.files?.[0] || null),
        style: {
          minWidth: 0, width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 9,
          border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
          background: 'color-mix(in srgb, currentColor 4%, transparent)', color: 'inherit', font: 'inherit', fontSize: 12,
        },
      }),
      field.hint ? React.createElement('small', { style: { opacity: 0.6, lineHeight: 1.45 } }, field.hint) : null,
    );
  }
  const listId = field.list ? `${id}-options` : undefined;
  return React.createElement('label', { htmlFor: id, style: { display: 'grid', gap: 6 } },
    React.createElement('span', { style: { fontSize: 12, fontWeight: 600 } }, field.label),
    React.createElement('input', {
      id,
      type: field.type,
      value: value ?? '',
      min: field.min,
      max: field.max,
      step: field.step,
      list: listId,
      placeholder: field.placeholder,
      autoComplete: field.type === 'password' ? 'new-password' : 'off',
      onChange: event => onChange(event.target.value),
      style: {
        minWidth: 0, width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 9,
        border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
        background: 'color-mix(in srgb, currentColor 4%, transparent)', color: 'inherit', font: 'inherit', fontSize: 13,
      },
    }),
    field.list ? React.createElement('datalist', { id: listId }, field.list.map(item => React.createElement('option', { key: item, value: item }))) : null,
    field.hint ? React.createElement('small', { style: { opacity: 0.6, lineHeight: 1.45 } }, field.hint) : null,
  );
}

function PluginConfigForm({ plugin }) {
  const [draft, setDraft] = React.useState(null);
  const [metadata, setMetadata] = React.useState(null);
  const [busy, setBusy] = React.useState(true);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');

  const load = async (active = () => true) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(plugin.endpoint, { headers: { accept: 'application/json' } });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `加载失败（${response.status}）`);
      if (!active()) return;
      setDraft(toDraft(plugin, body.config));
      setMetadata(body);
    } catch (caught) {
      if (active()) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (active()) setBusy(false);
    }
  };

  React.useEffect(() => {
    let mounted = true;
    void load(() => mounted);
    return () => { mounted = false; };
  }, [plugin.endpoint]);

  const save = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let pending = draft;
      if (plugin.id === 'wallpaper' && draft.localFile) {
        const upload = await fetch('/plugins/dsh-wallpaper/upload', {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': draft.localFile.type },
          body: draft.localFile,
        });
        const uploadBody = await upload.json();
        if (!upload.ok || !uploadBody.ok) throw new Error(uploadBody.error || `上传失败（${upload.status}）`);
        pending = { ...draft, localFile: null, source: uploadBody.config.source, enabled: true };
      }
      const response = await fetch(plugin.endpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(toPayload(plugin, pending)),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `保存失败（${response.status}）`);
      setDraft(toDraft(plugin, body.config));
      setMetadata(body);
      setMessage(draft.localFile ? '本地图片已上传并生效' : '已保存并生效');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  if (busy && draft === null) return React.createElement('div', { role: 'status', style: { padding: '8px 0', opacity: 0.65 } }, '正在读取配置…');
  if (draft === null) return React.createElement('div', { role: 'alert', style: { color: '#ef4444' } }, error || '无法读取配置');

  const credential = plugin.id === 'vision' ? metadata?.credential : null;
  return React.createElement('form', { onSubmit: save, 'data-config-endpoint': plugin.endpoint, style: { display: 'grid', gap: 14 } },
    React.createElement('div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 13 },
    }, plugin.fields.map(field => React.createElement(ConfigField, {
      key: field.key,
      plugin,
      field,
      value: draft[field.key],
      onChange: value => {
        setDraft(current => ({ ...current, [field.key]: value }));
        setMessage('');
      },
    }))),
    credential ? React.createElement('div', {
      style: { padding: '9px 11px', borderRadius: 9, fontSize: 12, background: 'color-mix(in srgb, #0ea5e9 10%, transparent)' },
    }, credential.configured ? `Credential 已配置${credential.source ? ` · ${credential.source}` : ''}` : 'Credential 尚未配置') : null,
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' } },
      React.createElement('button', {
        type: 'submit', disabled: busy,
        style: { border: 0, borderRadius: 9, padding: '8px 14px', background: plugin.color, color: 'white', font: 'inherit', fontSize: 13, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.65 : 1 },
      }, busy ? '保存中…' : '保存配置'),
      React.createElement('button', {
        type: 'button', disabled: busy, onClick: () => void load(),
        style: { border: '1px solid color-mix(in srgb, currentColor 18%, transparent)', borderRadius: 9, padding: '8px 12px', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 13, cursor: busy ? 'wait' : 'pointer' },
      }, '重新读取'),
      message ? React.createElement('span', { role: 'status', style: { color: plugin.color, fontSize: 12 } }, message) : null,
      error ? React.createElement('span', { role: 'alert', style: { color: '#ef4444', fontSize: 12 } }, error) : null,
      React.createElement('small', { style: { marginLeft: 'auto', opacity: 0.55 } }, '保存到 DSH 本地设置'),
    ),
  );
}

function PluginCard({ plugin, expanded, onToggle }) {
  return React.createElement('article', {
    'data-custom-plugin': plugin.id,
    style: {
      overflow: 'hidden', width: '100%', boxSizing: 'border-box',
      border: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
      borderRadius: 14, background: 'color-mix(in srgb, currentColor 3%, transparent)',
    },
  },
  React.createElement('button', {
    type: 'button', onClick: onToggle, 'aria-expanded': expanded,
    'aria-controls': `dsh-plugin-details-${plugin.id}`,
    style: {
      width: '100%', minHeight: 86, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto',
      alignItems: 'center', gap: 18, padding: '15px 18px', border: 0, background: 'transparent',
      color: 'inherit', cursor: 'pointer', textAlign: 'left', font: 'inherit',
    },
  },
  React.createElement('div', { style: { minWidth: 0, display: 'grid', gap: 6 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      React.createElement('span', { 'aria-hidden': true, style: { width: 10, height: 10, flex: '0 0 auto', borderRadius: 99, background: plugin.color, boxShadow: `0 0 0 4px color-mix(in srgb, ${plugin.color} 16%, transparent)` } }),
      React.createElement('strong', { style: { fontSize: 16 } }, plugin.name),
      React.createElement('code', { style: { fontSize: 12, opacity: 0.63, overflowWrap: 'anywhere' } }, plugin.packageName),
    ),
    React.createElement('span', { style: { fontSize: 13, opacity: 0.78, lineHeight: 1.45 } }, plugin.description),
  ),
  React.createElement('div', { style: { display: 'grid', justifyItems: 'end', gap: 7 } },
    React.createElement('span', { style: { fontSize: 12, whiteSpace: 'nowrap', color: plugin.color } }, expanded ? '收起配置' : '展开配置', ' ', React.createElement('span', { 'aria-hidden': true, style: { display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 160ms ease' } }, '⌄')),
    React.createElement('small', { style: { opacity: 0.5, whiteSpace: 'nowrap' } }, plugin.extension),
  )),
  expanded ? React.createElement('div', {
    id: `dsh-plugin-details-${plugin.id}`, role: 'region', 'aria-label': `${plugin.name}配置`,
    style: { padding: '17px 18px 19px', borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)', background: 'color-mix(in srgb, currentColor 2%, transparent)' },
  }, React.createElement(PluginConfigForm, { plugin })) : null);
}

function CustomPluginsPage() {
  const [expanded, setExpanded] = React.useState(null);
  return React.createElement('section', {
    'data-dsh-plugin': '@dsh-plugins/4u', style: { display: 'grid', gap: 18, padding: '4px 0 24px' },
  },
  React.createElement('header', { style: { display: 'grid', gap: 6 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      React.createElement('h2', { style: { margin: 0, fontSize: 20 } }, 'DSH Plugins 4U'),
      React.createElement('span', { style: { padding: '3px 8px', borderRadius: 99, fontSize: 12, background: 'color-mix(in srgb, #0ea5e9 14%, transparent)', color: '#0284c7' } }, `${PLUGINS.length} 个插件`),
    ),
    React.createElement('p', { style: { margin: 0, opacity: 0.66, fontSize: 13 } }, '每个插件占一行；展开后可直接读取、修改并保存配置。'),
  ),
  React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr', gap: 10, width: '100%' } },
    PLUGINS.map(plugin => React.createElement(PluginCard, {
      key: plugin.id, plugin, expanded: expanded === plugin.id,
      onToggle: () => setExpanded(current => current === plugin.id ? null : plugin.id),
    })),
  ));
}

exports.name = 'dsh-plugins-4u-client';
exports.inject = ['slots'];
exports.apply = function apply(ctx) {
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab', id: 'dsh-plugins-4u', order: 50, label: '自定义插件',
  }, CustomPluginsPage));
};
exports.plugins = PLUGINS;
exports.PluginCard = PluginCard;
exports.PluginConfigForm = PluginConfigForm;
exports.CustomPluginsPage = CustomPluginsPage;

return module.exports; } });
