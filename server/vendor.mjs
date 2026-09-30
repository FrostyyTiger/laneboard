// The browser dependencies served as /vendor/<name>, straight out of
// node_modules (no bundler). Shared by the server and the demo build, so the
// two can never disagree about what the page loads.
export const VENDOR = {
  'xterm.js': '@xterm/xterm/lib/xterm.js',
  'xterm.css': '@xterm/xterm/css/xterm.css',
  'addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js',
  'addon-web-links.js': '@xterm/addon-web-links/lib/addon-web-links.js',
};
