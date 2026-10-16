// The Map canvas lives in ./map/ (plan §5 2.2); this shim keeps the dynamic
// import('./map-canvas.js') in views/map.js working.
export * from './map/index.js';
