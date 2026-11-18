// Vite emits /assets/index-<hash>.js and Evolu's /assets/Db.worker-<hash>.js;
// Metro emits /_expo/static/js/web/index-<hash>.js.
export const MAIN_BUNDLE =
  /\/(?:src\/main\.tsx|(?:assets|_expo\/static\/js\/web)\/index-[^/]+\.js)(?:\?.*)?$/;
export const EVOLU_WORKER_BUNDLE = /\/Db\.worker-[^/]+\.js$/;
// Also matches the Vite dev server's .../local-first/Db.worker.js?worker_file.
export const EVOLU_WORKER_REQUEST = /\/Db\.worker[-.]/;
