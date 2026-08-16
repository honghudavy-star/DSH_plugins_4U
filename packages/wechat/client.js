window.__ModuleLoader__.load({ id: "@dsh-plugins/wechat", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const React = require('react');

function BubbleIcon() {
  return React.createElement('svg', {
    viewBox: '0 0 24 24', width: 19, height: 19, 'aria-hidden': true,
  }, React.createElement('path', {
    fill: 'currentColor',
    d: 'M4.2 4.8A8.3 8.3 0 0 1 10.1 2.5c4.4 0 7.9 3 7.9 6.8s-3.5 6.8-7.9 6.8c-.8 0-1.6-.1-2.4-.3l-3.6 1.8 1-3.2A6.5 6.5 0 0 1 2.2 9.3c0-1.7.7-3.2 2-4.5Zm11.5 10.4c3.4 0 6.1 2.3 6.1 5.1 0 1.4-.7 2.7-1.8 3.6l.7 2.4-2.8-1.4c-.7.2-1.4.3-2.2.3-2.8 0-5.2-1.6-5.9-3.9h.3c5 0 9.2-3.4 9.2-7.8v-.1c-.9 1.1-2.1 1.8-3.6 1.8Z',
  }));
}

function WechatAction({ wide, useSessions, open }) {
  const sessionId = useSessions(state => state.ids.find(id => {
    const row = state.byId[id];
    return row && (row.title === '微信' || row.displayTitle === '微信');
  }));
  if (sessionId === undefined) return null;
  return React.createElement('button', {
    type: 'button',
    title: '打开微信会话',
    'aria-label': '打开微信会话',
    'data-dsh-plugin': '@dsh-plugins/wechat',
    onClick: () => open(sessionId),
    style: {
      width: '100%', minHeight: 36, border: 0, borderRadius: 8,
      background: 'transparent', color: '#07c160', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: wide ? 'flex-start' : 'center',
      gap: 10, padding: wide ? '7px 10px' : '7px 0', font: 'inherit',
    },
  }, React.createElement(BubbleIcon), wide ? React.createElement('span', null, '微信') : null);
}

exports.name = 'dsh-plugins-wechat-client';
exports.inject = ['slots', 'sessions'];
exports.apply = function apply(ctx) {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-plugins-wechat',
    order: 20,
    inject: () => ({ open: id => ctx.sessions.open(id) }),
  }, WechatAction));
};

return module.exports; } });
